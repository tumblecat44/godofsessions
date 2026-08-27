import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  InMemoryCredentialStore,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  ModelRuntime,
  type CreateAgentSessionOptions,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OvernightPortfolioItem } from "./overnight-portfolio-coordinator";
import { overnightProviderAdapterInvocation } from "./overnight-provider-adapter";
import {
  createOvernightPiRunner,
  type OvernightPiSessionPort,
} from "./overnight-pi-runner";

const NOW = Date.parse("2099-08-26T12:00:00.000Z");
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("embedded Overnight Pi runner", () => {
  it("uses the post-initialize ModelRuntime getter and edits only an approved in-memory scope", async () => {
    const root = await temporaryRoot();
    const target = join(root, "src", "allowed.txt");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "before\n");
    const { runtime, faux } = await fauxRuntime([
      fauxAssistantMessage(fauxToolCall("edit", {
        path: "src/allowed.txt",
        edits: [{ oldText: "before", newText: "after" }],
      }), { stopReason: "toolUse" }),
      fauxAssistantMessage("The output contains verified."),
    ]);
    let initializedRuntime: ModelRuntime | undefined;
    let captured: CreateAgentSessionOptions | undefined;
    const runPi = createOvernightPiRunner({
      getModelRuntime: () => initializedRuntime,
      now: fixedNow,
      createSession: async (options) => {
        captured = options;
        const { session } = await createAgentSession(options);
        return { session };
      },
    });
    initializedRuntime = runtime;

    const result = await runPi(runInput(root));

    expect(result).toMatchObject({
      status: "completed",
      providerReceiptId: expect.stringMatching(/^pi:session:[^\s]+$/u),
      report: "The output contains verified.",
    });
    expect(await readFile(target, "utf8")).toBe("after\n");
    expect(faux.state.callCount).toBe(2);
    expect(captured?.cwd).toBe(await realpath(root));
    expect(captured?.modelRuntime).toBe(runtime);
    expect(captured?.sessionManager?.isPersisted()).toBe(false);
    expect(captured?.sessionManager?.getSessionFile()).toBeUndefined();
    expect(captured?.tools).toEqual(["read", "grep", "find", "ls", "bash", "edit", "write"]);
    expect(captured?.resourceLoader?.getExtensions().extensions).toEqual([]);
    expect(captured?.resourceLoader?.getSkills().skills).toEqual([]);
    expect(captured?.resourceLoader?.getPrompts().prompts).toEqual([]);
    expect(captured?.resourceLoader?.getThemes().themes).toEqual([]);
    expect(captured?.resourceLoader?.getAgentsFiles().agentsFiles).toEqual([]);
  });

  it("denies outside-scope reads and writes without leaking or mutating the target", async () => {
    const base = await temporaryRoot();
    const root = join(base, "root");
    const outside = join(base, "outside-secret.txt");
    const outsideWrite = join(base, "outside-write.txt");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(outside, "PRIVATE_OUTSIDE_VALUE\n");
    const { runtime, faux } = await fauxRuntime([
      fauxAssistantMessage(fauxToolCall("read", { path: outside }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("write", { path: outsideWrite, content: "must-not-exist" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("The output contains verified."),
    ]);
    const runPi = createOvernightPiRunner({ getModelRuntime: () => runtime, now: fixedNow });

    const result = await runPi(runInput(root));

    expect(result).toMatchObject({ status: "failed", error: expect.stringMatching(/scope/u) });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_OUTSIDE_VALUE");
    expect(await readFile(outside, "utf8")).toBe("PRIVATE_OUTSIDE_VALUE\n");
    await expect(access(outsideWrite)).rejects.toMatchObject({ code: "ENOENT" });
    expect(faux.state.callCount).toBe(3);
  });

  it("records only the exact approved verification command and rejects external-effect variants", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      private: true,
      scripts: { test: "node -e \"console.log('verified')\"" },
    }));
    const verification = "Run npm test and require exit code 0.";
    const exact = await fauxRuntime([
      fauxAssistantMessage(fauxToolCall("bash", { command: "npm test" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("npm test passed with exit code 0."),
    ]);
    const exactRunner = createOvernightPiRunner({ getModelRuntime: () => exact.runtime, now: fixedNow });

    await expect(exactRunner(runInput(root, verification))).resolves.toMatchObject({
      status: "completed",
      providerReceiptId: expect.stringMatching(/^pi:session:/u),
      report: "npm test passed with exit code 0.",
    });
    expect(exact.faux.state.callCount).toBe(2);

    const marker = join(root, "must-not-exist.txt");
    const unsafe = await fauxRuntime([
      fauxAssistantMessage(fauxToolCall("bash", { command: `npm test; touch ${marker}` }), { stopReason: "toolUse" }),
      fauxAssistantMessage("npm test passed with exit code 0."),
    ]);
    const unsafeRunner = createOvernightPiRunner({ getModelRuntime: () => unsafe.runtime, now: fixedNow });
    const unsafeResult = await unsafeRunner(runInput(root, verification));

    expect(unsafeResult).toMatchObject({ status: "failed", error: expect.stringMatching(/외부 효과|검증/u) });
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not complete when the exact verification fails even if the final text claims success", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      private: true,
      scripts: { test: "node -e \"process.exit(7)\"" },
    }));
    const verification = "Run npm test and require exit code 0.";
    const { runtime } = await fauxRuntime([
      fauxAssistantMessage(fauxToolCall("bash", { command: "npm test" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("npm test passed with exit code 0."),
    ]);
    const runPi = createOvernightPiRunner({ getModelRuntime: () => runtime, now: fixedNow });

    await expect(runPi(runInput(root, verification))).resolves.toMatchObject({
      status: "failed",
      report: "npm test passed with exit code 0.",
    });
  });

  it("connects cancellation to session.abort, waits for settlement, then disposes", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "src"), { recursive: true });
    const { runtime } = await fauxRuntime([]);
    const order: string[] = [];
    let resolvePrompt!: () => void;
    const promptPending = new Promise<void>((resolve) => { resolvePrompt = resolve; });
    const session = fauxSession({
      sessionId: "native-cancellation-session",
      prompt: vi.fn(() => promptPending.finally(() => { order.push("prompt-settled"); })),
      abort: vi.fn(async () => {
        order.push("abort");
        resolvePrompt();
        await promptPending;
      }),
      waitForIdle: vi.fn(async () => {
        await promptPending;
        order.push("idle");
      }),
      dispose: vi.fn(() => { order.push("dispose"); }),
    });
    const controller = new AbortController();
    const runPi = createOvernightPiRunner({
      getModelRuntime: () => runtime,
      now: fixedNow,
      abortSettleTimeoutMs: 100,
      createSession: async () => ({ session }),
    });
    const run = runPi(runInput(root, undefined, controller.signal));
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalledOnce());

    controller.abort(new Error("stop"));
    const result = await run;

    expect(result).toMatchObject({ status: "failed", error: expect.stringMatching(/중지/u) });
    expect(session.abort).toHaveBeenCalledOnce();
    expect(order.at(-1)).toBe("dispose");
    expect(order.indexOf("abort")).toBeLessThan(order.indexOf("prompt-settled"));
    expect(order.indexOf("prompt-settled")).toBeLessThan(order.indexOf("dispose"));
  });

  it("reports a noncooperative deadline honestly instead of claiming completion", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "src"), { recursive: true });
    const { runtime } = await fauxRuntime([]);
    const never = new Promise<void>(() => undefined);
    const session = fauxSession({
      sessionId: "native-noncooperative-session",
      prompt: vi.fn(() => never),
      abort: vi.fn(() => never),
      waitForIdle: vi.fn(() => never),
      dispose: vi.fn(),
    });
    vi.useFakeTimers();
    const runPi = createOvernightPiRunner({
      getModelRuntime: () => runtime,
      now: fixedNow,
      abortSettleTimeoutMs: 10,
      createSession: async () => ({ session }),
    });
    const input = runInput(root);
    input.deadlineAt = new Date(NOW + 5).toISOString();

    const run = runPi(input);
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(20);
    const result = await run;

    expect(result).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/정착하지 않았|완료로 기록하지 않았/u),
    });
    expect(result.providerReceiptId).toBeUndefined();
    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
  });
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "morrow-overnight-pi-"));
  temporaryRoots.push(root);
  return root;
}

async function fauxRuntime(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]) {
  const provider = `overnight-pi-test-${Math.random().toString(36).slice(2)}`;
  const faux = fauxProvider({
    provider,
    models: [{ id: `${provider}-model`, name: "Overnight Pi faux", reasoning: true }],
    tokensPerSecond: 10_000,
  });
  faux.setResponses(responses);
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
    modelsPath: null,
  });
  runtime.registerNativeProvider(faux.provider);
  await runtime.setRuntimeApiKey(provider, "test-only");
  return { runtime, faux };
}

function runInput(
  root: string,
  verification = "The output contains verified.",
  signal = new AbortController().signal,
): Parameters<ReturnType<typeof createOvernightPiRunner>>[0] {
  const item: OvernightPortfolioItem = {
    id: "pi-item",
    stableKey: "pi-item",
    origin: "continuation",
    provider: "pi",
    title: "Bounded Pi edit",
    outcome: "The approved file is updated.",
    verification,
    providerReason: "Pi Agent fits this embedded SDK task.",
    selectedSessionIds: ["pi:source-session"],
    risks: [],
    commandPreview: "embedded Pi SDK",
    frozenBriefSha256: "a".repeat(64),
    capacityPool: "provider:pi",
    workspaceKey: root,
    isolation: "shared",
    worktreeKey: root,
    conflictKeys: [],
    writeScopes: ["src"],
    dependencyIds: [],
    estimatedMinutes: 30,
  };
  return {
    runId: "pi-run",
    deadlineAt: new Date(NOW + 60 * 60 * 1_000).toISOString(),
    signal,
    item,
    invocation: overnightProviderAdapterInvocation("pi", root, join(root, ".runtime")),
    prompt: "PRIVATE APPROVED PROMPT",
  };
}

function fauxSession(overrides: Partial<OvernightPiSessionPort>): OvernightPiSessionPort {
  return {
    sessionId: "native-faux-session",
    messages: [],
    prompt: async () => undefined,
    abort: async () => undefined,
    waitForIdle: async () => undefined,
    dispose: () => undefined,
    subscribe: () => () => undefined,
    ...overrides,
  };
}

function fixedNow() {
  return new Date(NOW);
}
