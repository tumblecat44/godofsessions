import { createInterface } from "node:readline";
import {
  encodeOvernightHermesChildFrame,
  parseOvernightHermesChildAbortFrame,
  parseOvernightHermesChildStartFrame,
  type OvernightHermesChildResultFrame,
} from "../overnight-hermes-child-contract";

const expectedAuthoritySha256 = process.argv[2];
const mode = process.argv[3] ?? "complete";
if (!expectedAuthoritySha256) process.exit(64);

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = reader[Symbol.asyncIterator]();
const first = await iterator.next();
if (first.done) process.exit(65);

const start = parseOvernightHermesChildStartFrame(first.value, expectedAuthoritySha256);
const sessionId = `faux-hermes-${process.pid}`;
process.stdout.write(encodeOvernightHermesChildFrame({
  type: "session",
  authoritySha256: start.authoritySha256,
  sessionId,
}));

if (mode === "noncooperative") {
  // Synthetic only: prove a force-killed child cannot manufacture the host's
  // bounded close, Docker inspect, or post-exit absence observations.
  await new Promise(() => undefined);
}

let result: OvernightHermesChildResultFrame;
if (mode === "cooperative") {
  const next = await iterator.next();
  if (next.done) process.exit(66);
  const abort = parseOvernightHermesChildAbortFrame(next.value, start.authoritySha256);
  result = {
    type: "result",
    authoritySha256: start.authoritySha256,
    native: {
      sessionId,
      completed: false,
      failed: false,
      interrupted: true,
      turnExitReason: "interrupted_during_api_call",
      model: start.authority.model,
      provider: start.authority.provider,
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      estimatedCostUsd: 0,
    },
    error: abort.reason,
  };
} else {
  result = {
    type: "result",
    authoritySha256: start.authoritySha256,
    native: {
      sessionId,
      completed: true,
      failed: false,
      interrupted: false,
      turnExitReason: "text_response(finish_reason=stop)",
      model: start.authority.model,
      provider: start.authority.provider,
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      estimatedCostUsd: 0,
    },
    report: "Synthetic Hermes result; no provider or Docker operation ran.",
  };
}

await new Promise<void>((resolveWrite) => {
  process.stdout.write(encodeOvernightHermesChildFrame(result), () => resolveWrite());
});
reader.close();
process.stdin.unref();
