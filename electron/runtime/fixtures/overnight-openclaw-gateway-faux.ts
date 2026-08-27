import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const mode = process.argv[2] === "noncooperative" ? "noncooperative" : "cooperative";
const expectedToken = process.env.FAUX_GATEWAY_TOKEN ?? "";
const configPath = process.env.OPENCLAW_CONFIG_PATH ?? "";
const stateDir = process.env.OPENCLAW_STATE_DIR ?? "";

const descendant = spawn(process.execPath, [
  "-e",
  mode === "noncooperative"
    ? "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"
    : "setInterval(()=>{},1000)",
], {
  stdio: "ignore",
});

if (mode === "noncooperative") {
  process.on("SIGTERM", () => undefined);
} else {
  process.on("SIGTERM", () => {
    try { descendant.kill("SIGTERM"); } catch { /* It may already be gone. */ }
    process.exit(0);
  });
}

write({
  type: "event",
  event: "faux.process",
  payload: { gatewayPid: process.pid, descendantPid: descendant.pid },
});
write({
  type: "event",
  event: "connect.challenge",
  payload: { nonce: "synthetic-connection-nonce" },
});

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
reader.on("line", (line) => {
  let frame: unknown;
  try {
    frame = JSON.parse(line);
  } catch {
    writeError("malformed_json");
    return;
  }
  if (!isRecord(frame) || frame.type !== "req" || typeof frame.id !== "string") {
    writeError("malformed_request");
    return;
  }
  if (frame.method === "connect") {
    const params = isRecord(frame.params) ? frame.params : {};
    const auth = isRecord(params.auth) ? params.auth : {};
    if (params.minProtocol !== 3
      || params.maxProtocol !== 3
      || params.role !== "operator"
      || !sameStrings(params.scopes, ["operator.write"])
      || auth.token !== expectedToken) {
      write({
        type: "res",
        id: frame.id,
        ok: false,
        error: { code: "INVALID_REQUEST", message: "synthetic connect mismatch" },
      });
      return;
    }
    write({
      type: "res",
      id: frame.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        server: { version: "2026.4.26", connId: "synthetic-connection" },
        features: { methods: ["agent"], events: [] },
        snapshot: {
          presence: [],
          health: {},
          stateVersion: { presence: 0, health: 0 },
          uptimeMs: 1,
          configPath,
          stateDir,
          authMode: "token",
        },
        auth: { role: "operator", scopes: ["operator.write"] },
        policy: { maxPayload: 1_048_576, maxBufferedBytes: 1_048_576, tickIntervalMs: 30_000 },
      },
    });
    return;
  }
  if (frame.method === "agent") {
    const params = isRecord(frame.params) ? frame.params : {};
    if (params.deliver !== false
      || typeof params.idempotencyKey !== "string"
      || typeof params.message !== "string"
      || typeof params.sessionKey !== "string") {
      write({
        type: "res",
        id: frame.id,
        ok: false,
        error: { code: "INVALID_REQUEST", message: "synthetic agent mismatch" },
      });
      return;
    }
    write({
      type: "res",
      id: frame.id,
      ok: true,
      payload: {
        runId: params.idempotencyKey,
        status: "accepted",
        acceptedAt: Date.now(),
      },
    });
    write({
      type: "res",
      id: frame.id,
      ok: true,
      payload: {
        runId: params.idempotencyKey,
        status: "ok",
        summary: "completed",
        result: {
          content: [{ type: "text", text: "synthetic final" }],
          meta: {
            toolSummary: { calls: 1, tools: ["write"], totalToolTimeMs: 1 },
          },
        },
      },
    });
    return;
  }
  write({
    type: "res",
    id: frame.id,
    ok: false,
    error: { code: "METHOD_NOT_FOUND", message: "synthetic unsupported method" },
  });
});

reader.on("close", () => {
  if (mode === "cooperative") {
    try { descendant.kill("SIGTERM"); } catch { /* It may already be gone. */ }
    process.exit(0);
  }
});

function write(frame: unknown) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

function writeError(code: string) {
  write({ type: "event", event: "faux.error", payload: { code } });
}

function sameStrings(value: unknown, expected: readonly string[]) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
