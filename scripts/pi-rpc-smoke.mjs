import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");

if (!existsSync(cli)) {
  console.log("skip: pinned pi-coding-agent CLI is not installed");
  process.exit(0);
}

const child = spawn("node", [cli, "--mode", "rpc", "--no-session"], {
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
let settled = false;

function fail(msg) {
  if (settled) return;
  settled = true;
  child.kill("SIGKILL");
  console.error(msg);
  process.exit(1);
}

const timer = setTimeout(() => fail("timeout waiting for get_state"), 15_000);

child.on("error", (err) => fail(`spawn error: ${err.message}`));
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  for (;;) {
    const nl = buf.indexOf("\n");
    if (nl === -1) break;
    const line = buf.slice(0, nl).replace(/\r$/, "");
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(`bad jsonl: ${line}`);
      return;
    }
    if (msg.type === "response" && msg.command === "get_state") {
      if (msg.success !== true) {
        fail(`get_state failed: ${JSON.stringify(msg)}`);
        return;
      }
      child.stdin.write(JSON.stringify({ type: "abort" }) + "\n");
      child.kill();
      clearTimeout(timer);
      settled = true;
      console.log("ok: get_state success=true");
      process.exit(0);
    }
  }
});

child.stdin.write(JSON.stringify({ id: "smoke-1", type: "get_state" }) + "\n");
