import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  encodeOvernightPiChildFrame,
  OvernightPiChildToolAuthority,
  parseOvernightPiChildAbortFrame,
  parseOvernightPiChildStartFrame,
  type OvernightPiChildResultFrame,
} from "../overnight-pi-child-contract";

const expectedAuthoritySha256 = process.argv[2];
const mode = process.argv[3] ?? "run";
if (!expectedAuthoritySha256) process.exit(64);

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = reader[Symbol.asyncIterator]();
const first = await iterator.next();
if (first.done) process.exit(65);

const start = parseOvernightPiChildStartFrame(first.value, expectedAuthoritySha256);
const sessionId = `faux-${process.pid}`;
process.stdout.write(encodeOvernightPiChildFrame({
  type: "session",
  authoritySha256: start.authoritySha256,
  sessionId,
}));

if (mode === "noncooperative") {
  // Deliberately ignore stdin, signals handled by the caller, and the approved
  // deadline. This is a synthetic proof that a late/non-cooperative child can
  // never turn into a completed receipt.
  await new Promise(() => undefined);
}

if (mode === "cooperative") {
  const next = await iterator.next();
  if (next.done) process.exit(66);
  const abort = parseOvernightPiChildAbortFrame(next.value, start.authoritySha256);
  const result: OvernightPiChildResultFrame = {
    type: "result",
    authoritySha256: start.authoritySha256,
    sessionId,
    status: "failed",
    verificationReceipts: [],
    error: abort.reason === "deadline" ? "deadline" : "cancelled",
  };
  process.stdout.write(encodeOvernightPiChildFrame(result));
  process.exit(0);
}

const authority = await OvernightPiChildToolAuthority.create(
  start.authority.root,
  start.authority.writeScopes,
  start.authority.verification,
);
const insidePath = await authority.assertApprovedPath("scope/inside.txt");
await writeFile(insidePath, "inside", "utf8");

let outsideReadDenied = false;
let outsideWriteDenied = false;
try {
  await authority.assertApprovedPath(resolve(start.authority.root, "..", "outside.txt"));
  await readFile(resolve(start.authority.root, "..", "outside.txt"), "utf8");
} catch {
  outsideReadDenied = true;
}
try {
  await authority.assertApprovedPath(resolve(start.authority.root, "..", "outside-write.txt"));
  await writeFile(resolve(start.authority.root, "..", "outside-write.txt"), "outside", "utf8");
} catch {
  outsideWriteDenied = true;
}

const verification = [...authority.expectedCommands][0];
if (!verification) process.exit(67);
authority.recordVerification(verification, 0);
const result: OvernightPiChildResultFrame = {
  type: "result",
  authoritySha256: start.authoritySha256,
  sessionId,
  status: "completed",
  verificationReceipts: authority.receipts(),
  report: `npm test passed with exit code 0. Inside edit: yes. Outside read denied: ${outsideReadDenied}. Outside write denied: ${outsideWriteDenied}.`,
};
await new Promise<void>((resolveWrite) => {
  process.stdout.write(encodeOvernightPiChildFrame(result), () => resolveWrite());
});
reader.close();
process.stdin.unref();
