import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { OvernightCliLoginState, OvernightExecutionProvider } from "../../src/shared/contracts";

const execFileAsync = promisify(execFile);
const AUTH_TIMEOUT_MS = 12_000;
const MAX_BUFFER = 64 * 1_024;
const PROBE_ATTEMPTS = 2;

export interface OvernightCliAuthCommand {
  executable: string;
  args: readonly string[];
}

export interface OvernightCliAuthOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export function overnightCliAuthArgs(provider: OvernightExecutionProvider): readonly string[] | undefined {
  if (provider === "claude") return ["auth", "status", "--json"];
  if (provider === "codex") return ["login", "status"];
  if (provider === "grok") return ["models"];
  return undefined;
}

export function overnightCliLoginStateFromOutput(input: {
  provider: OvernightExecutionProvider;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
}): OvernightCliLoginState {
  if (input.timedOut) return "unknown";
  if (input.provider === "claude") {
    const loggedIn = claudeLoggedIn(input.stdout) ?? claudeLoggedIn(input.stderr);
    if (loggedIn === true) return "signed_in";
    if (loggedIn === false) return "signed_out";
    return "unknown";
  }
  const text = `${input.stdout}\n${input.stderr}`.toLowerCase();
  if (input.provider === "codex") {
    if (/\bnot logged in\b/.test(text) || /\blogged out\b/.test(text)) return "signed_out";
    if (/\blogged in\b/.test(text)) return "signed_in";
    if (input.exitCode !== 0) return "signed_out";
    return "unknown";
  }
  if (input.provider === "grok") {
    if (/you are logged in/.test(text) || /\blogged in with\b/.test(text)) return "signed_in";
    if (/sign in|not logged|login required|please log/.test(text)) return "signed_out";
    if (input.exitCode !== 0) return "signed_out";
    return "unknown";
  }
  return "unknown";
}

export async function probeOvernightCliLogin(input: {
  provider: OvernightExecutionProvider;
  executable?: string;
  run?: (command: OvernightCliAuthCommand) => Promise<OvernightCliAuthOutput>;
}): Promise<OvernightCliLoginState> {
  const args = overnightCliAuthArgs(input.provider);
  if (!args || !input.executable) return "unknown";
  const run = input.run ?? runOfficialStatus;
  let last: OvernightCliLoginState = "unknown";
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
    try {
      const output = await run({ executable: input.executable, args });
      last = overnightCliLoginStateFromOutput({ provider: input.provider, ...output });
      if (last !== "unknown") return last;
    } catch {
      last = "unknown";
    }
  }
  return last;
}

function claudeLoggedIn(text: string): boolean | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || !("loggedIn" in parsed)) return undefined;
  if (parsed.loggedIn === true) return true;
  if (parsed.loggedIn === false) return false;
  return undefined;
}

async function runOfficialStatus(command: OvernightCliAuthCommand): Promise<OvernightCliAuthOutput> {
  try {
    const { stdout, stderr } = await execFileAsync(command.executable, [...command.args], {
      timeout: AUTH_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: "utf8",
      windowsHide: true,
      env: cliProbeEnvironment(),
    });
    return { stdout: String(stdout), stderr: String(stderr), exitCode: 0, timedOut: false };
  } catch (error) {
    return execOutput(error);
  }
}

function cliProbeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  const home = homedir();
  env.HOME = home;
  env.PATH = [
    join(home, ".local", "bin"),
    join(home, ".grok", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    env.PATH ?? "",
  ].filter(Boolean).join(delimiter);
  return env;
}

function execOutput(error: unknown): OvernightCliAuthOutput {
  if (!error || typeof error !== "object") {
    return { stdout: "", stderr: "", exitCode: 1, timedOut: false };
  }
  const stdout = "stdout" in error && error.stdout != null ? String(error.stdout) : "";
  const stderr = "stderr" in error && error.stderr != null ? String(error.stderr) : "";
  const timedOut = "killed" in error && error.killed === true;
  const exitCode = "code" in error && typeof error.code === "number" ? error.code : 1;
  return { stdout, stderr, exitCode, timedOut };
}
