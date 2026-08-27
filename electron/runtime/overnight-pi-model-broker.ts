import { createHash } from "node:crypto";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";

export const OVERNIGHT_PI_MODEL_BROKER_PROTOCOL_VERSION = 1 as const;
export const OVERNIGHT_PI_MODEL_BROKER_FRAME_LIMIT = 512 * 1_024;
const PROVIDER_ID = "morrow-overnight-model-broker";

export interface OvernightPiModelBrokerRequest {
  version: typeof OVERNIGHT_PI_MODEL_BROKER_PROTOCOL_VERSION;
  type: "model_request";
  authoritySha256: string;
  requestId: string;
  sequence: number;
  model: { provider: string; id: string; api: string };
  context: Context;
}

export interface OvernightPiModelBrokerResponse {
  version: typeof OVERNIGHT_PI_MODEL_BROKER_PROTOCOL_VERSION;
  type: "model_response";
  authoritySha256: string;
  requestId: string;
  sequence: number;
  contextSha256: string;
  message: AssistantMessage;
}

export interface OvernightPiModelBrokerTransport {
  request(frame: Readonly<OvernightPiModelBrokerRequest>, signal?: AbortSignal): Promise<OvernightPiModelBrokerResponse>;
}

export function createOvernightPiModelBrokerProvider(input: {
  authoritySha256: string;
  model: Model<string>;
  transport: OvernightPiModelBrokerTransport;
}): Provider {
  assertSha(input.authoritySha256);
  let sequence = 0;
  let terminal = false;
  const model = Object.freeze({ ...input.model, provider: PROVIDER_ID, api: "morrow-overnight-broker" });

  const streamSimple = (_model: Model<string>, context: Context, options?: SimpleStreamOptions) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const current = ++sequence;
      try {
        if (terminal) throw new Error("broker_terminal");
        if (options?.signal?.aborted) throw new Error("broker_aborted");
        const requestId = `model-${current}`;
        const request: OvernightPiModelBrokerRequest = {
          version: OVERNIGHT_PI_MODEL_BROKER_PROTOCOL_VERSION,
          type: "model_request",
          authoritySha256: input.authoritySha256,
          requestId,
          sequence: current,
          model: { provider: input.model.provider, id: input.model.id, api: input.model.api },
          context: structuredClone(context),
        };
        assertFrameSize(request);
        const response = await input.transport.request(Object.freeze(request), options?.signal);
        if (terminal || options?.signal?.aborted) throw new Error("broker_aborted");
        assertResponse(response, request);
        const message = Object.freeze({
          ...structuredClone(response.message),
          provider: model.provider,
          model: model.id,
          api: model.api,
        }) as AssistantMessage;
        if (message.stopReason === "error" || message.stopReason === "aborted" || message.stopReason === "pending") throw new Error("broker_model_failed");
        stream.push({ type: "done", reason: message.stopReason, message });
        stream.end(message);
      } catch (reason) {
        terminal = true;
        const message = failedMessage(model, reason);
        stream.push({ type: "error", reason: "error", error: message });
        stream.end(message);
      }
    })();
    return stream;
  };

  return Object.freeze({
    id: PROVIDER_ID,
    name: "Morrow Overnight model broker",
    auth: {
      apiKey: {
        name: "Proof-bound parent broker",
        check: async () => ({ type: "api_key" as const, source: "proof-bound parent" }),
        resolve: async () => ({ auth: {}, source: "proof-bound parent" }),
      },
    },
    getModels: () => [model],
    stream: streamSimple,
    streamSimple,
  });
}

export function overnightPiModelContextSha256(context: Context) {
  return sha256(stableJson(context));
}

export function encodeOvernightPiModelBrokerFrame(value: unknown) {
  assertFrameSize(value);
  const encoded = JSON.stringify(value);
  if (encoded.includes("\n")) throw new Error("invalid_broker_frame");
  return `${encoded}\n`;
}

export function parseOvernightPiModelBrokerResponse(
  encoded: string,
  request: Readonly<OvernightPiModelBrokerRequest>,
) {
  if (encoded.includes("\n") || Buffer.byteLength(encoded) > OVERNIGHT_PI_MODEL_BROKER_FRAME_LIMIT) {
    throw new Error("invalid_broker_frame");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(encoded); } catch { throw new Error("invalid_broker_frame"); }
  assertResponse(parsed, request);
  return parsed;
}

function assertResponse(value: unknown, request: Readonly<OvernightPiModelBrokerRequest>): asserts value is OvernightPiModelBrokerResponse {
  if (!isRecord(value)
    || Object.keys(value).sort().join(",") !== "authoritySha256,contextSha256,message,requestId,sequence,type,version"
    || value.version !== OVERNIGHT_PI_MODEL_BROKER_PROTOCOL_VERSION
    || value.type !== "model_response"
    || value.authoritySha256 !== request.authoritySha256
    || value.requestId !== request.requestId
    || value.sequence !== request.sequence
    || value.contextSha256 !== overnightPiModelContextSha256(request.context)
    || !isAssistantMessage(value.message)) throw new Error("invalid_broker_response");
  assertFrameSize(value);
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
  return isRecord(value)
    && value.role === "assistant"
    && Array.isArray(value.content)
    && typeof value.api === "string"
    && typeof value.provider === "string"
    && typeof value.model === "string"
    && typeof value.timestamp === "number"
    && typeof value.stopReason === "string"
    && isRecord(value.usage);
}

function failedMessage(model: Model<string>, reason: unknown): AssistantMessage {
  return {
    role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "error", errorMessage: reason instanceof Error ? reason.message.slice(0, 256) : "broker_failed",
    timestamp: Date.now(),
  };
}

function assertFrameSize(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > OVERNIGHT_PI_MODEL_BROKER_FRAME_LIMIT) throw new Error("oversized_broker_frame");
}
function assertSha(value: string) { if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("invalid_authority"); }
function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
