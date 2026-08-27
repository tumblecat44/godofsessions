import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENAI_CODEX_TEAM_IDENTIFIER,
  createMacOsOvernightProviderContainmentHost,
  macOsOfficialTeamIdentifiers,
  type MacOsContainmentSpawn,
  type MacOsNativeExecutableResolver,
} from "./overnight-provider-containment-macos";

interface CommandScript {
  exitCode?: number | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  hang?: boolean;
}

interface SpawnCall {
  executable: string;
  args: readonly string[];
  options: unknown;
}

let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "morrow-macos-identity-"));
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function nativeFixture(name: string, suffix = "synthetic-native") {
  const path = join(fixtureRoot, name);
  const contents = Buffer.concat([Buffer.from("cffaedfe", "hex"), Buffer.from(suffix)]);
  await writeFile(path, contents);
  return { path: await realpath(path), contents };
}

function scriptedSpawn(scripts: readonly CommandScript[]) {
  const calls: SpawnCall[] = [];
  const children: Array<{ kill: ReturnType<typeof vi.fn> }> = [];
  let index = 0;
  const spawnCommand: MacOsContainmentSpawn = (executable, args, options) => {
    calls.push({ executable, args: [...args], options });
    const script = scripts[index++];
    if (!script) throw new Error(`unexpected command ${index}`);

    const events = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const kill = vi.fn(() => true);
    children.push({ kill });
    const child = Object.assign(events, { stdout, stderr, kill });

    queueMicrotask(() => {
      if (script.stdout !== undefined) stdout.write(script.stdout);
      if (script.stderr !== undefined) stderr.write(script.stderr);
      if (script.hang) return;
      stdout.end();
      stderr.end();
      events.emit("close", script.exitCode ?? 0);
    });
    return child;
  };
  return { calls, children, spawnCommand };
}

function host(options: {
  scripts?: readonly CommandScript[];
  resolver?: MacOsNativeExecutableResolver;
  timeoutMs?: number;
  outputLimitBytes?: number;
  platform?: NodeJS.Platform;
  provider?: "codex" | "claude";
  officialTeamIdentifiers?: readonly string[];
} = {}) {
  const commands = scriptedSpawn(options.scripts ?? []);
  const runCanary = vi.fn(async () => {
    throw new Error("synthetic canary was not requested by identity tests");
  });
  return {
    commands,
    runCanary,
    value: createMacOsOvernightProviderContainmentHost({
      platform: options.platform ?? "darwin",
      provider: options.provider ?? "codex",
      officialTeamIdentifiers: options.officialTeamIdentifiers,
      runCanary,
      resolveNativeExecutable: options.resolver,
      commandTimeoutMs: options.timeoutMs,
      commandOutputLimitBytes: options.outputLimitBytes,
      spawnCommand: commands.spawnCommand,
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    }),
  };
}

describe("macOS Overnight provider containment host", () => {
  it("observes a stable native identity with streaming SHA-256 and three exact bounded probes", async () => {
    const native = await nativeFixture("codex-native", "streamed-identity");
    const harness = host({
      scripts: [
        { exitCode: 0 },
        { exitCode: 0, stderr: `Executable=redacted\nTeamIdentifier=${OPENAI_CODEX_TEAM_IDENTIFIER}\n` },
        { exitCode: 0, stdout: "codex-cli 1.2.3\n" },
      ],
    });

    await expect(harness.value.inspectExecutable(native.path, ["--version"])).resolves.toEqual({
      realpath: native.path,
      sha256: createHash("sha256").update(native.contents).digest("hex"),
      invocationIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      signatureValid: true,
      teamIdentifier: OPENAI_CODEX_TEAM_IDENTIFIER,
      version: "codex-cli 1.2.3",
    });
    expect(harness.commands.calls.map(({ executable, args }) => ({ executable, args }))).toEqual([
      { executable: "/usr/bin/codesign", args: ["--verify", "--strict", native.path] },
      { executable: "/usr/bin/codesign", args: ["-dv", native.path] },
      { executable: native.path, args: ["--version"] },
    ]);
    for (const call of harness.commands.calls) {
      expect(call.options).toMatchObject({ shell: false, cwd: "/", stdio: ["ignore", "pipe", "pipe"] });
    }
    expect(harness.runCanary).not.toHaveBeenCalled();
  });

  it("returns signatureValid false without parsing or exposing raw codesign stderr", async () => {
    const native = await nativeFixture("unsigned-native");
    const privateStderr = `invalid signature at ${fixtureRoot}/private-provider-token`;
    const harness = host({ scripts: [{ exitCode: 1, stderr: privateStderr }] });

    const observation = await harness.value.inspectExecutable(native.path, ["--version"]);

    expect(observation).toMatchObject({ realpath: native.path, signatureValid: false });
    expect(observation).not.toHaveProperty("teamIdentifier");
    expect(observation).not.toHaveProperty("version");
    expect(JSON.stringify(observation)).not.toContain(privateStderr);
    expect(harness.commands.calls).toHaveLength(1);
  });

  it("does not invent a TeamIdentifier when codesign details omit it", async () => {
    const native = await nativeFixture("team-missing-native");
    const harness = host({
      scripts: [
        { exitCode: 0 },
        { exitCode: 0, stderr: "Identifier=synthetic.provider\nTeamIdentifier=not set\n" },
      ],
    });

    const observation = await harness.value.inspectExecutable(native.path, ["--version"]);

    expect(observation.signatureValid).toBe(true);
    expect(observation).not.toHaveProperty("teamIdentifier");
    expect(observation).not.toHaveProperty("version");
    expect(harness.commands.calls).toHaveLength(2);
  });

  it("does not execute an otherwise signed binary until the caller allows its non-Codex Team ID", async () => {
    const native = await nativeFixture("caller-team-native");
    const blocked = host({
      provider: "claude",
      scripts: [
        { exitCode: 0 },
        { exitCode: 0, stderr: "TeamIdentifier=Q6L2SF6YDW\n" },
      ],
    });

    await expect(blocked.value.inspectExecutable(native.path, ["--version"])).resolves.toEqual({
      realpath: native.path,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      invocationIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      signatureValid: true,
      teamIdentifier: "Q6L2SF6YDW",
    });
    expect(blocked.commands.calls).toHaveLength(2);

    const allowed = host({
      provider: "claude",
      officialTeamIdentifiers: ["Q6L2SF6YDW"],
      scripts: [
        { exitCode: 0 },
        { exitCode: 0, stderr: "TeamIdentifier=Q6L2SF6YDW\n" },
        { exitCode: 0, stdout: "claude 4.2.0" },
      ],
    });
    await expect(allowed.value.inspectExecutable(native.path, ["--version"])).resolves.toMatchObject({
      signatureValid: true,
      teamIdentifier: "Q6L2SF6YDW",
      version: "claude 4.2.0",
    });
    expect(allowed.commands.calls[2]).toMatchObject({ executable: native.path, args: ["--version"] });
  });

  it("never promotes raw version stderr into the bounded public observation", async () => {
    const native = await nativeFixture("version-stderr-native");
    const privateStderr = "PRIVATE PROVIDER STDERR MUST NOT ESCAPE";
    const harness = host({
      scripts: [
        { exitCode: 0 },
        { exitCode: 0, stderr: `TeamIdentifier=${OPENAI_CODEX_TEAM_IDENTIFIER}\n` },
        { exitCode: 0, stderr: privateStderr },
      ],
    });

    const observation = await harness.value.inspectExecutable(native.path, ["--version"]);

    expect(observation).not.toHaveProperty("version");
    expect(JSON.stringify(observation)).not.toContain(privateStderr);
  });

  it("kills and rejects a timed-out probe without leaking its executable path", async () => {
    const native = await nativeFixture("timeout-native");
    const harness = host({ scripts: [{ hang: true }], timeoutMs: 5 });

    const error = await harness.value.inspectExecutable(native.path, ["--version"]).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("command_timeout");
    expect((error as Error).message).not.toContain(native.path);
    expect(harness.commands.children[0]?.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("kills and rejects output larger than the shared stdout/stderr cap", async () => {
    const native = await nativeFixture("large-output-native");
    const privateOutput = Buffer.alloc(65, "x");
    const harness = host({ scripts: [{ stderr: privateOutput }], outputLimitBytes: 64 });

    const error = await harness.value.inspectExecutable(native.path, ["--version"]).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("command_output_limit_exceeded");
    expect((error as Error).message).not.toContain(privateOutput.toString("utf8"));
    expect(harness.commands.children[0]?.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("resolves a wrapper to its final vendor-native executable and probes only that native", async () => {
    const wrapper = join(fixtureRoot, "codex-wrapper");
    const manifest = join(fixtureRoot, "package.json");
    const native = await nativeFixture("vendor-codex-native");
    await writeFile(wrapper, `#!/bin/sh\nexec ${native.path} \"$@\"\n`);
    await writeFile(manifest, "{\"name\":\"synthetic-codex-wrapper\"}");
    const resolver = vi.fn<MacOsNativeExecutableResolver>(async () => ({
      nativeExecutable: native.path,
      invocationIdentityPaths: [wrapper, manifest, native.path],
    }));
    const harness = host({
      resolver,
      scripts: [
        { exitCode: 0 },
        { exitCode: 0, stderr: `TeamIdentifier=${OPENAI_CODEX_TEAM_IDENTIFIER}\n` },
        { exitCode: 0, stdout: "codex-cli 1.2.3" },
      ],
    });
    const wrapperRealpath = await realpath(wrapper);

    await expect(harness.value.canonicalize(wrapper)).resolves.toBe(native.path);
    await expect(harness.value.inspectExecutable(native.path, ["--version"])).resolves.toMatchObject({
      realpath: native.path,
      signatureValid: true,
      teamIdentifier: OPENAI_CODEX_TEAM_IDENTIFIER,
    });
    expect(resolver).toHaveBeenCalledWith({ requestedExecutable: wrapper, requestedRealpath: wrapperRealpath });
    expect(harness.commands.calls.every(({ executable }) => executable !== wrapper)).toBe(true);
    expect(harness.commands.calls[2]).toMatchObject({ executable: native.path, args: ["--version"] });
  });

  it("fails closed when any wrapper invocation-identity file drifts after resolution", async () => {
    const wrapper = join(fixtureRoot, "drifting-wrapper");
    const native = await nativeFixture("drift-target-native");
    await writeFile(wrapper, "#!/bin/sh\n# revision one\n");
    const resolver: MacOsNativeExecutableResolver = async () => ({
      nativeExecutable: native.path,
      invocationIdentityPaths: [wrapper],
    });
    const harness = host({ resolver });

    await expect(harness.value.canonicalize(wrapper)).resolves.toBe(native.path);
    await writeFile(wrapper, "#!/bin/sh\n# revision two with changed bytes\n");
    const error = await harness.value.inspectExecutable(native.path, ["--version"]).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("executable_resolution_drift");
    expect((error as Error).message).not.toContain(wrapper);
    expect(harness.commands.calls).toHaveLength(0);
  });

  it("fails closed when the resolver changes a wrapper's native target", async () => {
    const wrapper = join(fixtureRoot, "retargeted-wrapper");
    const first = await nativeFixture("first-native");
    const second = await nativeFixture("second-native");
    await writeFile(wrapper, "#!/bin/sh\n# provider-aware resolver input\n");
    let resolutionCount = 0;
    const resolver: MacOsNativeExecutableResolver = async () => ({
      nativeExecutable: resolutionCount++ === 0 ? first.path : second.path,
      invocationIdentityPaths: [wrapper],
    });
    const harness = host({ resolver });

    await expect(harness.value.canonicalize(wrapper)).resolves.toBe(first.path);
    await expect(harness.value.inspectExecutable(first.path, ["--version"]))
      .rejects.toThrow("executable_resolution_drift");
    expect(harness.commands.calls).toHaveLength(0);
  });

  it("never treats a shell or JavaScript wrapper's own signature as native provider identity", async () => {
    const wrapper = join(fixtureRoot, "signed-looking-wrapper");
    await writeFile(wrapper, "#!/usr/bin/env node\nconsole.log('provider wrapper')\n");
    const harness = host();

    await expect(harness.value.canonicalize(wrapper)).rejects.toThrow("native_executable_required");
    expect(harness.commands.calls).toHaveLength(0);
  });

  it("requires an injected canary and has no default that can fabricate verified evidence", () => {
    expect(() => createMacOsOvernightProviderContainmentHost({
      platform: "darwin",
      provider: "codex",
      runCanary: undefined as never,
    })).toThrow("canary_not_configured");
  });

  it("performs no path or executable observation off Darwin", async () => {
    const native = await nativeFixture("linux-native");
    const harness = host({ platform: "linux" });

    await expect(harness.value.canonicalize(native.path)).rejects.toThrow("unsupported_platform");
    await expect(harness.value.inspectExecutable(native.path, ["--version"]))
      .rejects.toThrow("unsupported_platform");
    expect(harness.commands.calls).toHaveLength(0);
  });

  it("hard-codes only Codex and requires caller evidence for every other Team ID", () => {
    expect(macOsOfficialTeamIdentifiers("codex")).toEqual([OPENAI_CODEX_TEAM_IDENTIFIER]);
    expect(macOsOfficialTeamIdentifiers("cursor")).toEqual([]);
    expect(macOsOfficialTeamIdentifiers("claude", { claude: ["Q6L2SF6YDW"] })).toEqual(["Q6L2SF6YDW"]);
    expect(() => macOsOfficialTeamIdentifiers("grok", { grok: ["unverified"] }))
      .toThrow("invalid_team_identifier_allowlist");
  });
});
