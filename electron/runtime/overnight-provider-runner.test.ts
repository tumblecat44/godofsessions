import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { describe, expect, it, vi } from "vitest";
import type { LocalSessionProvider } from "../../src/shared/contracts";
import type { OvernightPortfolioItem } from "./overnight-portfolio-coordinator";
import {
  overnightProviderAdapterIdentity,
  overnightProviderAdapterInvocation,
  overnightProviderEffectiveEnvironment,
  overnightProviderEnvironmentSha256,
  type OvernightProviderAdapterInvocation,
} from "./overnight-provider-adapter";
import type {
  VerifiedOvernightProviderContainmentProof,
  VerifiedOvernightProviderLaunchBinding,
} from "./overnight-provider-containment";
import { containmentProofIdentitySha256 } from "./overnight-provider-containment";
import { containmentWriteScopesSha256 } from "./overnight-provider-containment";
import {
  approveOvernightAcpPermission,
  defaultOvernightProviderHostPath,
  OvernightProviderRunner,
  type OvernightLaunchedProviderProcess,
  type OvernightProviderProcessLauncher,
} from "./overnight-provider-runner";

const ACP_PROVIDERS = ["grok"] as const;
const DEADLINE_AT = "2099-08-26T19:30:00.000Z";

function syntheticContainment(invocation: OvernightProviderAdapterInvocation): {
  containmentProof: VerifiedOvernightProviderContainmentProof;
  launchBinding: VerifiedOvernightProviderLaunchBinding;
} {
  const identity = overnightProviderAdapterIdentity(invocation);
  const effectiveEnvironment = overnightProviderEffectiveEnvironment(invocation, "/private");
  const bindingSha256 = "f".repeat(64);
  const containmentProof: VerifiedOvernightProviderContainmentProof = {
      version: 2,
      provider: invocation.provider,
      proofSha256: "",
      platform: "darwin",
      verifiedAt: "2099-08-26T11:59:00.000Z",
      scope: {
        canonical: true,
        disjoint: true,
        bindingSha256,
        writeScopesSha256: containmentWriteScopesSha256(["*"]),
        mutationAuthority: "direct-provider-root-wide-only",
      },
      executable: {
        realpathVerified: true,
        sha256: "a".repeat(64),
        signature: "verified",
        teamIdentifier: "ABCDEFGHIJ",
        version: "synthetic 1.0",
        wrapperInvocationSha256: "b".repeat(64),
      },
      invocation: {
        adapterIdentityVersion: identity.version,
        sha256: identity.sha256,
        adapterKind: identity.adapterKind,
        promptTransport: identity.promptTransport,
      },
      environment: {
        policyId: "morrow-exact-ephemeral-v1",
        sha256: overnightProviderEnvironmentSha256(effectiveEnvironment),
      },
      launcher: {
        providerHostSha256: "c".repeat(64),
        sandboxLauncherSha256: "d".repeat(64),
        sandboxProfileId: `synthetic-${invocation.provider}`,
        sandboxProfileSha256: "e".repeat(64),
      },
      policy: {
        fileRead: "system-fixed-root-runtime-auth-only",
        fileWrite: "fixed-root-runtime-dev-null-only",
        network: "provider-only",
        commandExternalEffect: "denied",
      },
      canary: {
        identityBound: true,
        processExit: "zero",
        providerTurn: "completed",
        commandReceipt: "observed",
        insideWrite: "verified",
        adjacentOutsideWrite: "blocked-and-absent",
        outsideSecretRead: "blocked-and-unobserved",
        providerCredentialRead: "verified",
        toolCredentialRead: "blocked-and-unobserved",
        commandNetwork: "blocked",
        commandExternalEffect: "blocked",
      },
      attestation: {
        version: 1,
        sha256: "7".repeat(64),
        expiresAt: "2099-08-27T12:00:00.000Z",
      },
    };
  containmentProof.proofSha256 = containmentProofIdentitySha256(containmentProof);
  return {
    containmentProof,
    launchBinding: {
      version: 1,
      provider: invocation.provider,
      proofBindingSha256: bindingSha256,
      canonicalNativeExecutable: invocation.executableName ?? `/exact/${invocation.provider}-sdk-host`,
      providerHostPath: defaultOvernightProviderHostPath(),
      sandboxLauncherPath: "/usr/bin/sandbox-exec",
      sandboxProfilePath: `/exact/${invocation.provider}.sb`,
      writeScopes: ["*"],
      effectiveEnvironment,
    },
  };
}

function contained<T extends { invocation: OvernightProviderAdapterInvocation }>(input: T) {
  const containment = syntheticContainment(input.invocation);
  const runId = "runId" in input && typeof input.runId === "string" ? input.runId : "run";
  const itemId = "item" in input && input.item && typeof input.item === "object" && "id" in input.item
    ? String(input.item.id)
    : `${input.invocation.provider}-item`;
  return {
    ...input,
    ...containment,
    launchCapability: {
      version: 1 as const,
      runId,
      itemId,
      provider: input.invocation.provider,
      proofSha256: containment.containmentProof.proofSha256,
      invocationSha256: containment.containmentProof.invocation.sha256,
      token: "11111111-1111-4111-8111-111111111111",
    },
  };
}

function item(provider: LocalSessionProvider): OvernightPortfolioItem {
  return {
    id: `${provider}-item`,
    stableKey: `${provider}-item`,
    origin: "continuation",
    provider,
    title: `Verify ${provider}`,
    outcome: `${provider} writes the bounded canary.`,
    verification: "The output contains verified.",
    providerReason: `${provider} fits this bounded repository implementation and verification task.`,
    selectedSessionIds: [`${provider}:session`],
    risks: [],
    commandPreview: `run ${provider}`,
    frozenBriefSha256: "a".repeat(64),
    capacityPool: `provider:${provider}`,
    workspaceKey: "/repo",
    isolation: "isolated",
    worktreeKey: `/work/${provider}`,
    conflictKeys: [],
    writeScopes: ["*"],
    dependencyIds: [],
    estimatedMinutes: 30,
  };
}

function completedProcess(lines: unknown[]): OvernightLaunchedProviderProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let resolveWait!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const wait = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => { resolveWait = resolve; });
  stdin.resume();
  stdin.on("end", () => {
    lines.forEach((line) => stdout.write(`${JSON.stringify(line)}\n`));
    stdout.end();
    stderr.end();
    resolveWait({ code: 0, signal: null });
  });
  return { stdin, stdout, stderr, wait, terminate: vi.fn(), cleanup: vi.fn(async () => undefined) };
}

function stoppableProcess(): OvernightLaunchedProviderProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let resolveWait!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const wait = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => { resolveWait = resolve; });
  stdin.resume();
  const terminate = vi.fn((signal: NodeJS.Signals = "SIGTERM") => {
    stdout.end();
    stderr.end();
    resolveWait({ code: null, signal });
  });
  return { stdin, stdout, stderr, wait, terminate, cleanup: vi.fn(async () => undefined) };
}

function acpProcess(provider: string): OvernightLaunchedProviderProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let resolveWait!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const wait = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => { resolveWait = resolve; });
  const reader = createInterface({ input: stdin });
  reader.on("line", (line) => {
    const message = JSON.parse(line) as { id?: number; method?: string };
    if (message.method === "initialize") stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } })}\n`);
    if (message.method === "session/new") stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: `${provider}-session-native` } })}\n`);
    if (message.method === "session/prompt") {
      stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "The output contains verified." } } } })}\n`);
      stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } })}\n`);
    }
  });
  const terminate = vi.fn(() => {
    reader.close();
    stdout.end();
    stderr.end();
    resolveWait({ code: null, signal: "SIGTERM" });
  });
  return { stdin, stdout, stderr, wait, terminate, cleanup: vi.fn(async () => undefined) };
}

function acpCommandProcess(status: "completed" | "failed"): OvernightLaunchedProviderProcess {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let resolveWait!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const wait = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => { resolveWait = resolve; });
  const reader = createInterface({ input: stdin });
  reader.on("line", (line) => {
    const message = JSON.parse(line) as { id?: number; method?: string };
    if (message.method === "initialize") stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } })}\n`);
    if (message.method === "session/new") stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: "native-command-session" } })}\n`);
    if (message.method === "session/prompt") {
      stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call", toolCallId: "tool-1", kind: "execute", status: "in_progress", rawInput: { command: "npm test -- exact", cwd: "/work/grok" } } } })}\n`);
      stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status } } })}\n`);
      stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: status === "completed" ? "npm test -- exact passed with exit code 0." : "npm test -- exact failed with exit code 1." } } } })}\n`);
      stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } })}\n`);
    }
  });
  const terminate = vi.fn(() => {
    reader.close();
    stdout.end();
    stderr.end();
    resolveWait({ code: null, signal: "SIGTERM" });
  });
  return { stdin, stdout, stderr, wait, terminate, cleanup: vi.fn(async () => undefined) };
}

describe("Overnight provider runner", () => {
  it("collects provider-native Codex and Claude receipts without persisting the prompt", async () => {
    const launch = vi.fn<OvernightProviderProcessLauncher>(async (invocation) => invocation.provider === "codex"
      ? completedProcess([
          { type: "thread.started", thread_id: "codex-thread-native" },
          { type: "item.completed", item: { type: "agent_message", text: "The output contains verified." } },
          { type: "turn.completed" },
        ])
      : completedProcess([
          { type: "system", subtype: "init", session_id: "claude-session-native" },
          { type: "result", subtype: "success", is_error: false, result: "The output contains verified." },
        ]));
    const now = () => new Date("2099-08-26T12:00:00.000Z");
    const timedRunner = new OvernightProviderRunner({ dataDir: "/private", launchProcess: launch, now });
    const codex = await timedRunner.run(contained({ runId: "run", deadlineAt: DEADLINE_AT, item: item("codex"), invocation: overnightProviderAdapterInvocation("codex", "/work/codex", "/private", "/exact/codex"), prompt: "PRIVATE PROMPT" }));
    const claude = await timedRunner.run(contained({ runId: "run", deadlineAt: DEADLINE_AT, item: item("claude"), invocation: overnightProviderAdapterInvocation("claude", "/work/claude", "/private", "/exact/claude"), prompt: "PRIVATE PROMPT" }));

    expect(codex).toMatchObject({ status: "completed", providerReceiptId: "codex:thread:codex-thread-native" });
    expect(claude).toMatchObject({ status: "completed", providerReceiptId: "claude:session:claude-session-native" });
    expect(launch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(launch.mock.calls)).not.toContain("PRIVATE PROMPT");
  });

  it("negotiates ACP v1 and returns the native ACP session receipt for Grok Build", async () => {
    const launch = vi.fn<OvernightProviderProcessLauncher>(async (invocation) => acpProcess(invocation.provider));
    const runner = new OvernightProviderRunner({ dataDir: "/private", launchProcess: launch, now: () => new Date("2099-08-26T12:00:00.000Z") });

    for (const provider of ACP_PROVIDERS) {
      const result = await runner.run(contained({
        runId: "run",
        deadlineAt: DEADLINE_AT,
        item: item(provider),
        invocation: overnightProviderAdapterInvocation(provider, `/work/${provider}`, "/private", `/exact/${provider}`),
        prompt: "PRIVATE PROMPT",
      }));
      expect(result).toMatchObject({ status: "completed", providerReceiptId: `${provider}:acp:${provider}-session-native` });
      expect(result.report).toContain("verified");
    }
  });

  it("blocks embedded Pi execution even with a synthetic typed proof", async () => {
    const runner = new OvernightProviderRunner({ dataDir: "/private", now: () => new Date("2099-08-26T12:00:00.000Z") });

    await expect(runner.run(contained({
      runId: "run",
      deadlineAt: DEADLINE_AT,
      item: item("pi"),
      invocation: overnightProviderAdapterInvocation("pi", "/work/pi", "/private"),
      prompt: "PRIVATE PROMPT",
    }))).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/proof-bound OS sandbox/u) });
  });

  it("fails closed when a provider exits without a native receipt", async () => {
    const runner = new OvernightProviderRunner({
      dataDir: "/private",
      now: () => new Date("2099-08-26T12:00:00.000Z"),
      launchProcess: async () => completedProcess([
        { type: "item.completed", item: { type: "agent_message", text: "The output contains verified." } },
        { type: "turn.completed" },
      ]),
    });

    await expect(runner.run(contained({
      runId: "run",
      deadlineAt: DEADLINE_AT,
      item: item("codex"),
      invocation: overnightProviderAdapterInvocation("codex", "/work/codex", "/private", "/exact/codex"),
      prompt: "PRIVATE PROMPT",
    }))).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/영수증/u) });
  });

  it("rejects a missing proof or invocation drift before any launcher is called", async () => {
    const launch = vi.fn<OvernightProviderProcessLauncher>();
    const runner = new OvernightProviderRunner({
      dataDir: "/private",
      launchProcess: launch,
      now: () => new Date("2099-08-26T12:00:00.000Z"),
    });
    const invocation = overnightProviderAdapterInvocation("codex", "/work/codex", "/private", "/exact/codex");
    const base = contained({
      runId: "run",
      deadlineAt: DEADLINE_AT,
      item: item("codex"),
      invocation,
      prompt: "PRIVATE PROMPT",
    });

    await expect(runner.run({ ...base, containmentProof: undefined as never })).resolves
      .toMatchObject({ status: "failed", error: expect.stringMatching(/identity|증거/u) });
    await expect(runner.run({ ...base, invocation: { ...invocation, args: [...invocation.args, "--drift"] } })).resolves
      .toMatchObject({ status: "failed", error: expect.stringMatching(/identity|증거/u) });
    await expect(runner.run({
      ...base,
      launchCapability: { ...base.launchCapability, proofSha256: "9".repeat(64) },
    })).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/launch capability/u) });
    await expect(runner.run({
      ...base,
      launchBinding: {
        ...base.launchBinding,
        effectiveEnvironment: { ...base.launchBinding.effectiveEnvironment, HOME: "/ambient/drift" },
      },
    })).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/identity|증거/u) });
    expect(launch).not.toHaveBeenCalled();
  });

  it("rejects an item whose approved write scopes do not match the attested launch authority", async () => {
    const launch = vi.fn<OvernightProviderProcessLauncher>();
    const runner = new OvernightProviderRunner({
      dataDir: "/private",
      launchProcess: launch,
      now: () => new Date("2099-08-26T12:00:00.000Z"),
    });
    const base = contained({
      runId: "run",
      deadlineAt: DEADLINE_AT,
      item: item("codex"),
      invocation: overnightProviderAdapterInvocation("codex", "/work/codex", "/private", "/exact/codex"),
      prompt: "PRIVATE PROMPT",
    });
    base.containmentProof.scope.writeScopesSha256 = containmentWriteScopesSha256(["*"]);
    base.containmentProof.scope.mutationAuthority = "direct-provider-root-wide-only";
    base.containmentProof.canary.providerCredentialRead = "verified";
    base.containmentProof.canary.toolCredentialRead = "blocked-and-unobserved";
    base.containmentProof.attestation = {
      version: 1,
      sha256: "7".repeat(64),
      expiresAt: "2099-08-27T12:00:00.000Z",
    };
    base.containmentProof.proofSha256 = containmentProofIdentitySha256(base.containmentProof);
    base.launchBinding.writeScopes = ["*"];
    base.launchCapability.proofSha256 = base.containmentProof.proofSha256;
    base.item.writeScopes = ["src/codex"];

    await expect(runner.run(base)).resolves.toMatchObject({
      status: "failed",
      error: expect.stringMatching(/쓰기 범위/u),
    });
    base.item.writeScopes = ["*"];
    base.containmentProof.attestation.expiresAt = "2099-08-26T12:00:00.000Z";
    base.containmentProof.proofSha256 = containmentProofIdentitySha256(base.containmentProof);
    base.launchCapability.proofSha256 = base.containmentProof.proofSha256;
    await expect(runner.run(base)).resolves.toMatchObject({
      status: "failed",
      error: expect.stringMatching(/만료/u),
    });
    expect(launch).not.toHaveBeenCalled();
  });

  it("does not accept a native receipt when verification is failed or unverified", async () => {
    const reports = [
      "Verification failed and one test failure remains.",
      "I could not run verification, so the result is unverified.",
    ];
    const launch = vi.fn<OvernightProviderProcessLauncher>(async () => completedProcess([
      { type: "thread.started", thread_id: `native-${launch.mock.calls.length}` },
      { type: "item.completed", item: { type: "agent_message", text: reports[launch.mock.calls.length - 1] } },
      { type: "turn.completed" },
    ]));
    const runner = new OvernightProviderRunner({ dataDir: "/private", launchProcess: launch, now: () => new Date("2099-08-26T12:00:00.000Z") });

    for (const report of reports) {
      const result = await runner.run(contained({
        runId: "run",
        deadlineAt: DEADLINE_AT,
        item: item("codex"),
        invocation: overnightProviderAdapterInvocation("codex", "/work/codex", "/private", "/exact/codex"),
        prompt: "PRIVATE PROMPT",
      }));
      expect(result).toMatchObject({ status: "failed", report });
    }
  });

  it("requires ACP command verification to include a structured successful tool receipt", async () => {
    const commandItem = { ...item("grok"), verification: "Run npm test -- exact and require exit code 0." };
    const completed = new OvernightProviderRunner({
      dataDir: "/private",
      launchProcess: async () => acpCommandProcess("completed"),
      now: () => new Date("2099-08-26T12:00:00.000Z"),
    });
    const failed = new OvernightProviderRunner({
      dataDir: "/private",
      launchProcess: async () => acpCommandProcess("failed"),
      now: () => new Date("2099-08-26T12:00:00.000Z"),
    });
    const input = contained({
      runId: "run",
      deadlineAt: DEADLINE_AT,
      item: commandItem,
      invocation: overnightProviderAdapterInvocation("grok", "/work/grok", "/private", "/exact/grok"),
      prompt: "PRIVATE PROMPT",
    });

    await expect(completed.run(input)).resolves.toMatchObject({ status: "completed", providerReceiptId: "grok:acp:native-command-session" });
    await expect(failed.run(input)).resolves.toMatchObject({ status: "failed", report: expect.stringMatching(/failed/u) });
  });

  it("allows only one-shot ACP actions with complete in-root scope evidence", () => {
    const base = {
      provider: "grok" as const,
      root: "/work/grok",
      writeScopes: ["src/grok"],
      verification: "Run npm test -- exact and require exit code 0.",
    };
    const request = (toolCall: Record<string, unknown>) => ({
      sessionId: "session",
      toolCall,
      options: [{ optionId: "once", name: "Allow once", kind: "allow_once" as const }],
    });

    expect(approveOvernightAcpPermission({ ...base, request: request({ kind: "edit", rawInput: { path: "/work/grok/src/grok/a.ts" } }) })).toBe(true);
    expect(approveOvernightAcpPermission({ ...base, request: request({ kind: "edit", rawInput: { path: "/work/grok/src/other/a.ts" } }) })).toBe(false);
    expect(approveOvernightAcpPermission({ ...base, request: request({ kind: "edit" }) })).toBe(false);
    expect(approveOvernightAcpPermission({ ...base, request: request({ kind: "execute", rawInput: { command: "npm test -- exact", cwd: "/work/grok" } }) })).toBe(true);
    expect(approveOvernightAcpPermission({ ...base, request: request({ kind: "execute", rawInput: { command: "git push", cwd: "/work/grok" } }) })).toBe(false);
  });

  it("rejects expired or overlong item deadlines before provider dispatch", async () => {
    const launch = vi.fn<OvernightProviderProcessLauncher>();
    const runner = new OvernightProviderRunner({ dataDir: "/private", launchProcess: launch, now: () => new Date("2099-08-26T12:00:00.000Z") });
    const base = contained({
      runId: "run",
      item: item("codex"),
      invocation: overnightProviderAdapterInvocation("codex", "/work/codex", "/private", "/exact/codex"),
      prompt: "PRIVATE PROMPT",
    });
    await expect(runner.run({ ...base, deadlineAt: "2099-08-26T11:59:59.000Z" })).resolves.toMatchObject({ status: "failed" });
    await expect(runner.run({ ...base, deadlineAt: "2099-08-26T19:31:00.000Z" })).resolves.toMatchObject({ status: "failed" });
    expect(launch).not.toHaveBeenCalled();
  });

  it("stops every active child process while Pi remains fail-closed", async () => {
    const launched = stoppableProcess();
    const runner = new OvernightProviderRunner({
      dataDir: "/private",
      launchProcess: async () => launched,
      now: () => new Date("2099-08-26T12:00:00.000Z"),
    });
    const codexRun = runner.run(contained({
      runId: "shared-run",
      deadlineAt: DEADLINE_AT,
      item: item("codex"),
      invocation: overnightProviderAdapterInvocation("codex", "/work/codex", "/private", "/exact/codex"),
      prompt: "PRIVATE PROMPT",
    }));
    const piRun = runner.run(contained({
      runId: "shared-run",
      deadlineAt: DEADLINE_AT,
      item: item("pi"),
      invocation: overnightProviderAdapterInvocation("pi", "/work/pi", "/private"),
      prompt: "PRIVATE PROMPT",
    }));
    await expect(piRun).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/proof-bound OS sandbox/u) });

    await runner.stopRun("shared-run");

    await expect(codexRun).resolves.toMatchObject({ status: "failed" });
    expect(launched.terminate).toHaveBeenCalledWith("SIGTERM");
  });

  it("captures stop while launch is pending and writes no prompt when the handle arrives", async () => {
    let resolveLaunch!: (handle: OvernightLaunchedProviderProcess) => void;
    const launch = vi.fn<OvernightProviderProcessLauncher>(() => new Promise((resolve) => { resolveLaunch = resolve; }));
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let prompt = "";
    stdin.on("data", (chunk) => { prompt += String(chunk); });
    let resolveWait!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
    const wait = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => { resolveWait = resolve; });
    const terminateAndWait = vi.fn(async () => {
      stdin.end();
      stdout.end();
      stderr.end();
      resolveWait({ code: null, signal: "SIGTERM" });
      await wait;
    });
    const handle: OvernightLaunchedProviderProcess = {
      stdin,
      stdout,
      stderr,
      wait,
      terminate: vi.fn(),
      terminateAndWait,
      cleanup: vi.fn(async () => undefined),
    };
    const runner = new OvernightProviderRunner({
      dataDir: "/private",
      launchProcess: launch,
      now: () => new Date("2099-08-26T12:00:00.000Z"),
    });
    const run = runner.run(contained({
      runId: "pending-run",
      deadlineAt: DEADLINE_AT,
      item: item("claude"),
      invocation: overnightProviderAdapterInvocation("claude", "/work/claude", "/private", "/exact/claude"),
      prompt: "PRIVATE PROMPT MUST NOT BE WRITTEN",
    }));
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());

    const stop = runner.stopRun("pending-run");
    resolveLaunch(handle);
    await stop;

    await expect(run).resolves.toMatchObject({ status: "failed", error: expect.stringMatching(/중지/u) });
    expect(terminateAndWait).toHaveBeenCalledOnce();
    expect(prompt).toBe("");
    expect(handle.cleanup).toHaveBeenCalledOnce();
  });
});
