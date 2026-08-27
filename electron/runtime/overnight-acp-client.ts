const ACP_PROTOCOL_VERSION = 1;
const DEFAULT_CANCEL_TIMEOUT_MS = 1_000;
const MAX_CANCEL_TIMEOUT_MS = 30_000;

type JsonRpcId = number | string;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: Record<string, unknown>;
  options: Array<{ optionId: string; name: string; kind: "allow_once" | "allow_always" | "reject_once" | "reject_always" }>;
}

export interface AcpSessionRunReceipt {
  sessionId: string;
  stopReason: string;
  providerReceiptId: string;
}

export interface AcpJsonRpcClientOptions {
  send(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void | Promise<void>;
  approvePermission?: (request: AcpPermissionRequest) => boolean | Promise<boolean>;
  onUpdate?: (update: Record<string, unknown>) => void;
  cancelTimeoutMs?: number;
}

export class AcpJsonRpcClient {
  private readonly options: AcpJsonRpcClientOptions;
  private readonly cancelTimeoutMs: number;
  private readonly pending = new Map<JsonRpcId, { resolve(value: unknown): void; reject(reason: Error): void }>();
  private nextId = 1;

  constructor(options: AcpJsonRpcClientOptions) {
    this.options = options;
    this.cancelTimeoutMs = cancelTimeout(options.cancelTimeoutMs);
  }

  async runSession(cwd: string, prompt: string, provider: string, signal?: AbortSignal): Promise<AcpSessionRunReceipt> {
    if (!cwd.startsWith("/")) throw new Error("ACP Overnight sessions require an absolute working directory.");
    assertSessionNotAborted(signal);
    const initialized = asRecord(await this.request("initialize", {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        auth: { terminal: false },
      },
      clientInfo: { name: "morrow-overnight", title: "Morrow Overnight", version: "0.1.0" },
    }));
    if (initialized.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new Error(`ACP provider negotiated unsupported protocol version ${String(initialized.protocolVersion)}.`);
    }
    assertSessionNotAborted(signal);
    const session = asRecord(await this.request("session/new", { cwd, mcpServers: [] }));
    if (typeof session.sessionId !== "string" || !session.sessionId) throw new Error("ACP provider did not return a session id.");
    const completed = asRecord(await this.promptSession(session.sessionId, prompt, signal));
    if (typeof completed.stopReason !== "string" || !completed.stopReason) throw new Error("ACP provider did not return a stop reason.");
    return {
      sessionId: session.sessionId,
      stopReason: completed.stopReason,
      providerReceiptId: `${provider}:acp:${session.sessionId}`,
    };
  }

  async receive(message: unknown) {
    if (!isRecord(message) || message.jsonrpc !== "2.0") throw new Error("Invalid ACP JSON-RPC message.");
    if (typeof message.method === "string") {
      if (message.method === "session/update") {
        const params = asRecord(message.params);
        const update = asRecord(params.update);
        this.options.onUpdate?.(update);
        return;
      }
      if (message.method === "session/request_permission" && isJsonRpcId(message.id)) {
        await this.answerPermission(message.id, message.params);
        return;
      }
      if (isJsonRpcId(message.id)) {
        await this.options.send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Unsupported ACP client method: ${message.method}` },
        });
      }
      return;
    }
    if (!isJsonRpcId(message.id)) throw new Error("ACP response did not include an id.");
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    if (isRecord(message.error) && typeof message.error.message === "string") {
      waiter.reject(new Error(message.error.message));
    } else {
      waiter.resolve(message.result);
    }
  }

  cancel(sessionId: string) {
    return this.options.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } });
  }

  private async promptSession(sessionId: string, prompt: string, signal: AbortSignal | undefined) {
    if (!signal) {
      return this.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: prompt }],
      });
    }

    let cancellationStarted = false;
    let cancellationError: Error | undefined;
    let rejectCancellation!: (reason: Error) => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const onAbort = () => {
      if (cancellationStarted) return;
      cancellationStarted = true;
      void this.sendCancellation(sessionId).then(
        () => {
          cancellationError = new Error(`ACP Overnight session ${sessionId} was cancelled.`);
          rejectCancellation(cancellationError);
        },
        (reason: unknown) => {
          cancellationError = reason instanceof Error ? reason : new Error(String(reason));
          rejectCancellation(cancellationError);
        },
      );
    };

    signal.addEventListener("abort", onAbort);
    try {
      // The signal may have changed after session/new resolved but before this
      // listener was installed. Close that barrier before session/prompt.
      if (signal.aborted) onAbort();
      if (cancellationStarted) return await cancellation;

      const request = this.beginRequest("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: prompt }],
      });
      try {
        const completed = await Promise.race([request.response, cancellation]);
        // An abort listener can run after the provider resolves the request but
        // before this continuation resumes. Once observed, native cancellation
        // remains authoritative and a late stopReason cannot become a receipt.
        if (cancellationStarted) return await cancellation;
        return completed;
      } catch (reason) {
        if (cancellationStarted && !cancellationError) return await cancellation;
        throw reason;
      } finally {
        if (cancellationStarted) {
          request.abandon(cancellationError ?? new Error(`ACP Overnight session ${sessionId} was cancelled.`));
        }
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  private async sendCancellation(sessionId: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`ACP session/cancel timed out for ${sessionId} after ${this.cancelTimeoutMs}ms.`));
      }, this.cancelTimeoutMs);
    });
    try {
      await Promise.race([
        Promise.resolve().then(() => this.cancel(sessionId)).catch((reason: unknown) => {
          const detail = reason instanceof Error ? reason.message : String(reason);
          throw new Error(`ACP session/cancel failed for ${sessionId}: ${detail}`);
        }),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private request(method: string, params: unknown) {
    return this.beginRequest(method, params).response;
  }

  private beginRequest(method: string, params: unknown) {
    const id = this.nextId++;
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    Promise.resolve(this.options.send({ jsonrpc: "2.0", id, method, params })).catch((reason) => {
      const waiter = this.pending.get(id);
      if (!waiter) return;
      this.pending.delete(id);
      waiter.reject(reason instanceof Error ? reason : new Error(String(reason)));
    });
    return {
      response,
      abandon: (reason: Error) => {
        const waiter = this.pending.get(id);
        if (!waiter) return;
        this.pending.delete(id);
        waiter.reject(reason);
      },
    };
  }

  private async answerPermission(id: JsonRpcId, value: unknown) {
    const request = permissionRequest(value);
    const approved = await this.options.approvePermission?.(request) ?? false;
    // Overnight authority is single-use. Never translate it into a provider-
    // persistent allow/deny preference, even when that is the only option an
    // ACP implementation offers.
    const option = request.options.find((candidate) => candidate.kind === (approved ? "allow_once" : "reject_once"));
    const result = option
      ? { outcome: { outcome: "selected", optionId: option.optionId } }
      : { outcome: { outcome: "cancelled" } };
    await this.options.send({ jsonrpc: "2.0", id, result });
  }
}

function assertSessionNotAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new Error("ACP Overnight run was cancelled before an ACP session was created.");
}

function cancelTimeout(value: number | undefined) {
  if (value === undefined) return DEFAULT_CANCEL_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 1 || value > MAX_CANCEL_TIMEOUT_MS) {
    throw new Error(`ACP cancel timeout must be an integer from 1 to ${MAX_CANCEL_TIMEOUT_MS} milliseconds.`);
  }
  return value;
}

function permissionRequest(value: unknown): AcpPermissionRequest {
  const params = asRecord(value);
  if (typeof params.sessionId !== "string") throw new Error("ACP permission request did not include a session id.");
  const options = Array.isArray(params.options) ? params.options.flatMap((option) => {
    if (!isRecord(option) || typeof option.optionId !== "string" || typeof option.name !== "string" || !isPermissionKind(option.kind)) return [];
    return [{ optionId: option.optionId, name: option.name, kind: option.kind }];
  }) : [];
  return {
    sessionId: params.sessionId,
    toolCall: asRecord(params.toolCall),
    options,
  };
}

function isPermissionKind(value: unknown): value is AcpPermissionRequest["options"][number]["kind"] {
  return value === "allow_once" || value === "allow_always" || value === "reject_once" || value === "reject_always";
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || typeof value === "number";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("ACP message contained an invalid object.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
