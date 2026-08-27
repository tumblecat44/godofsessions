import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  inspectOvernightDependencyLineage,
  OvernightPortfolioCoordinator,
  OvernightPortfolioDependencyLineageError,
  type OvernightPortfolioItem,
} from "./overnight-portfolio-coordinator";

function item(id: string, provider: OvernightPortfolioItem["provider"], overrides: Partial<OvernightPortfolioItem> = {}): OvernightPortfolioItem {
  return {
    id,
    stableKey: id,
    origin: "continuation",
    provider,
    title: id,
    outcome: `${id} done`,
    verification: `${id} verified`,
    providerReason: `${provider} is prepared for this bounded repository task.`,
    selectedSessionIds: [`session-${id}`],
    risks: [],
    commandPreview: `run ${provider} for ${id}`,
    frozenBriefSha256: id.padEnd(64, "0").slice(0, 64),
    capacityPool: `provider:${provider}`,
    workspaceKey: "repo-a",
    isolation: "isolated",
    worktreeKey: `${provider}:${id}`,
    conflictKeys: [],
    writeScopes: [`src/${id}`],
    dependencyIds: [],
    estimatedMinutes: 30,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("Overnight portfolio coordinator", () => {
  it("consumes one approval and starts independent providers in parallel", async () => {
    const coordinator = new OvernightPortfolioCoordinator();
    const codex = deferred<{ status: "completed"; providerReceiptId: string }>();
    const claude = deferred<{ status: "completed"; providerReceiptId: string }>();
    const grok = deferred<{ status: "completed"; providerReceiptId: string }>();
    const dispatch = vi.fn((work: Readonly<OvernightPortfolioItem>) => ({ codex, claude, grok }[work.provider as "codex" | "claude" | "grok"].promise));
    const plan = coordinator.prepare([
      item("one", "codex"),
      item("two", "claude"),
      item("three", "grok"),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
      "provider:grok": 1,
    });

    const runPromise = coordinator.start(plan.id, dispatch);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(3));
    await expect(coordinator.start(plan.id, dispatch)).rejects.toThrow(/이미 사용/u);
    codex.resolve({ status: "completed", providerReceiptId: "codex-receipt" });
    claude.resolve({ status: "completed", providerReceiptId: "claude-receipt" });
    grok.resolve({ status: "completed", providerReceiptId: "grok-receipt" });

    const run = await runPromise;
    expect(run.status).toBe("completed");
    expect(run.receipts).toEqual([
      expect.objectContaining({ itemId: "one", provider: "codex", providerReceiptId: "codex-receipt" }),
      expect.objectContaining({ itemId: "two", provider: "claude", providerReceiptId: "claude-receipt" }),
      expect.objectContaining({ itemId: "three", provider: "grok", providerReceiptId: "grok-receipt" }),
    ]);
  });

  it("waits for provider capacity and conflicting write scopes to clear", async () => {
    const coordinator = new OvernightPortfolioCoordinator();
    const first = deferred<{ status: "completed" }>();
    const second = deferred<{ status: "completed" }>();
    const third = deferred<{ status: "completed" }>();
    const calls: string[] = [];
    const dispatch = (work: Readonly<OvernightPortfolioItem>) => {
      calls.push(work.id);
      return ({ first, second, third }[work.id] as typeof first).promise;
    };
    const plan = coordinator.prepare([
      item("first", "codex", { writeScopes: ["src/api"] }),
      item("second", "codex", { writeScopes: ["src/web"] }),
      item("third", "claude", { writeScopes: ["src/api/handlers"] }),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
    });

    const runPromise = coordinator.start(plan.id, dispatch);
    await vi.waitFor(() => expect(calls).toEqual(["first"]));
    first.resolve({ status: "completed" });
    await vi.waitFor(() => expect(calls).toEqual(["first", "second", "third"]));
    second.resolve({ status: "completed" });
    third.resolve({ status: "completed" });
    expect((await runPromise).status).toBe("completed");
  });

  it("blocks only a cross-worktree dependency component and preserves an independent candidate for planning", () => {
    const coordinator = new OvernightPortfolioCoordinator();
    const items = [
      item("implement", "codex", { worktreeKey: "isolated-a" }),
      item("verify", "claude", { dependencyIds: ["implement"], worktreeKey: "isolated-b" }),
      item("independent", "grok"),
    ];
    const assessment = inspectOvernightDependencyLineage(items);

    expect(assessment).toEqual({
      issues: [{ itemId: "verify", dependencyId: "implement" }],
      blockedItemIds: ["implement", "verify"],
    });
    expect(() => coordinator.prepare(items, {
      "provider:codex": 1,
      "provider:claude": 1,
      "provider:grok": 1,
    }, { planId: "dependency_blocked" })).toThrow(OvernightPortfolioDependencyLineageError);
    try {
      coordinator.prepare(items, {
        "provider:codex": 1,
        "provider:claude": 1,
        "provider:grok": 1,
      }, { planId: "dependency_blocked" });
    } catch (reason) {
      expect(reason).toMatchObject({
        blockedItemIds: ["implement", "verify"],
        issues: [{ itemId: "verify", dependencyId: "implement" }],
      });
    }
    expect(coordinator.get("dependency_blocked")).toBeUndefined();
    const independentPlan = coordinator.prepare(items.filter((work) => !assessment.blockedItemIds.includes(work.id)), {
      "provider:grok": 1,
    }, { planId: "independent_preserved" });
    expect(independentPlan.items.map((work) => work.id)).toEqual(["independent"]);
  });

  it("allows a dependency chain in one shared execution root and exposes the predecessor result in order", async () => {
    const root = await mkdtemp(join(tmpdir(), "morrow-shared-lineage-"));
    try {
      const coordinator = new OvernightPortfolioCoordinator();
      const plan = coordinator.prepare([
        item("implement", "codex", { isolation: "shared", worktreeKey: root }),
        item("verify", "claude", { isolation: "shared", worktreeKey: root, dependencyIds: ["implement"] }),
      ], {
        "provider:codex": 1,
        "provider:claude": 1,
      });
      const calls: string[] = [];

      const run = await coordinator.start(plan.id, async (work) => {
        calls.push(work.id);
        if (work.id === "implement") await writeFile(join(work.worktreeKey, "lineage.txt"), "visible to dependent\n");
        if (work.id === "verify") expect(await readFile(join(work.worktreeKey, "lineage.txt"), "utf8")).toBe("visible to dependent\n");
        return { status: "completed", providerReceiptId: `${work.provider}:${work.id}` };
      });

      expect(calls).toEqual(["implement", "verify"]);
      expect(run.status).toBe("completed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not dispatch queued work after cancellation and still collects the running receipt", async () => {
    const coordinator = new OvernightPortfolioCoordinator();
    const controller = new AbortController();
    const running = deferred<{ status: "completed"; providerReceiptId: string }>();
    const dispatch = vi.fn(() => running.promise);
    const plan = coordinator.prepare([
      item("running", "codex"),
      item("queued", "codex"),
    ], {
      "provider:codex": 1,
    });

    const runPromise = coordinator.start(plan.id, dispatch, { signal: controller.signal });
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: "running" }));
    controller.abort();
    running.resolve({ status: "completed", providerReceiptId: "codex:running" });

    const run = await runPromise;
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(run.status).toBe("partial");
    expect(run.receipts).toEqual([
      expect.objectContaining({ itemId: "running", status: "completed", providerReceiptId: "codex:running" }),
      expect.objectContaining({ itemId: "queued", status: "skipped", error: expect.stringMatching(/중단/u) }),
    ]);
  });

  it("consumes approval but dispatches nothing when cancellation is already requested", async () => {
    const coordinator = new OvernightPortfolioCoordinator();
    const controller = new AbortController();
    const dispatch = vi.fn(async () => ({ status: "completed" as const }));
    const plan = coordinator.prepare([
      item("one", "codex"),
      item("two", "claude"),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
    });
    controller.abort();

    const run = await coordinator.start(plan.id, dispatch, { signal: controller.signal });

    expect(dispatch).not.toHaveBeenCalled();
    expect(run.status).toBe("failed");
    expect(run.receipts).toEqual([
      expect.objectContaining({ itemId: "one", status: "skipped" }),
      expect.objectContaining({ itemId: "two", status: "skipped" }),
    ]);
    await expect(coordinator.start(plan.id, dispatch)).rejects.toThrow(/이미 사용/u);
  });

  it("freezes the complete portfolio and expires unused approval authority", async () => {
    let now = new Date("2026-08-26T18:00:00.000Z");
    const coordinator = new OvernightPortfolioCoordinator({ now: () => now, approvalLifetimeMs: 1_000 });
    const source = item("one", "codex");
    const plan = coordinator.prepare([source], { "provider:codex": 1 });
    source.writeScopes = ["outside"];
    source.selectedSessionIds = ["outside-session"];
    expect(plan.items[0].writeScopes).toEqual(["src/one"]);
    expect(plan.items[0].selectedSessionIds).toEqual(["session-one"]);
    expect(plan.approvalFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => Object.assign(plan, { expiresAt: "2099-01-01T00:00:00.000Z" })).toThrow();

    now = new Date("2026-08-26T18:00:01.000Z");
    await expect(coordinator.start(plan.id, async () => ({ status: "completed" }))).rejects.toThrow(/만료/u);
    expect(coordinator.get(plan.id)?.status).toBe("expired");
  });

  it("rejects unsafe or reused caller-supplied plan IDs", () => {
    const coordinator = new OvernightPortfolioCoordinator();
    expect(() => coordinator.prepare([item("one", "codex")], { "provider:codex": 1 }, { planId: "../escape" })).toThrow(/ID/u);

    const first = coordinator.prepare([item("one", "codex")], { "provider:codex": 1 }, { planId: "night_20260826" });
    expect(first.id).toBe("night_20260826");
    expect(() => coordinator.prepare([item("two", "claude")], { "provider:claude": 1 }, { planId: "night_20260826" })).toThrow(/이미 사용/u);
    expect(coordinator.get("night_20260826")?.items.map((work) => work.id)).toEqual(["one"]);
  });

  it("restores a persisted draft after restart without changing its approval fingerprint", async () => {
    const original = new OvernightPortfolioCoordinator({ now: () => new Date("2026-08-26T18:00:00.000Z") });
    const plan = original.prepare([item("one", "codex")], { "provider:codex": 1 }, { planId: "restart_plan" });
    const persisted = JSON.parse(JSON.stringify(plan));
    const restarted = new OvernightPortfolioCoordinator({ now: () => new Date("2026-08-26T18:01:00.000Z") });

    const restored = restarted.restore(persisted);
    expect(restored.approvalFingerprint).toBe(plan.approvalFingerprint);
    const run = await restarted.start(restored.id, async () => ({ status: "completed", providerReceiptId: "codex:restored" }), { runId: "restart_run" });
    expect(run).toMatchObject({ id: "restart_run", status: "completed" });
  });

  it("refuses a persisted draft whose approved contents no longer match its fingerprint", () => {
    const original = new OvernightPortfolioCoordinator();
    const plan = original.prepare([item("one", "codex")], { "provider:codex": 1 }, { planId: "tampered_plan" });
    const persisted = JSON.parse(JSON.stringify(plan));
    persisted.items[0].outcome = "tampered";

    expect(() => new OvernightPortfolioCoordinator().restore(persisted)).toThrow(/무결성/u);
  });

  it("accepts a schedule whose makespan is exactly the 450-minute Overnight window", () => {
    const coordinator = new OvernightPortfolioCoordinator();
    const plan = coordinator.prepare([
      item("full-window", "codex", { estimatedMinutes: 450 }),
    ], { "provider:codex": 1 });

    expect(plan.schedule.totalMinutes).toBe(450);
    expect(plan.items.map((work) => work.id)).toEqual(["full-window"]);
  });

  it("accepts parallel work whose summed duration exceeds 450 minutes when its makespan fits", () => {
    const coordinator = new OvernightPortfolioCoordinator();
    const plan = coordinator.prepare([
      item("codex-window", "codex", { estimatedMinutes: 450 }),
      item("claude-window", "claude", { estimatedMinutes: 450 }),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
    });

    expect(plan.items.reduce((sum, work) => sum + work.estimatedMinutes, 0)).toBe(900);
    expect(plan.schedule.totalMinutes).toBe(450);
    expect(plan.schedule.peakParallelism).toBe(2);
  });

  it("rejects a capacity-serialized 451-minute portfolio without silently dropping items", () => {
    const coordinator = new OvernightPortfolioCoordinator();
    const prepare = () => coordinator.prepare([
      item("first", "codex", { estimatedMinutes: 225 }),
      item("outside-window", "codex", { estimatedMinutes: 226 }),
    ], { "provider:codex": 1 }, { planId: "capacity_overflow" });

    expect(prepare).toThrow(/451분.*실행 창 밖 항목: outside-window.*다시 편집/u);
    expect(coordinator.get("capacity_overflow")).toBeUndefined();
    expect(coordinator.prepare([
      item("first", "codex", { estimatedMinutes: 225 }),
    ], { "provider:codex": 1 }, { planId: "capacity_overflow" }).items.map((work) => work.id)).toEqual(["first"]);
  });

  it("rejects a dependency-serialized 451-minute portfolio and identifies the item outside the window", () => {
    const coordinator = new OvernightPortfolioCoordinator();

    expect(() => coordinator.prepare([
      item("prerequisite", "codex", { estimatedMinutes: 225 }),
      item("dependent-outside", "claude", { estimatedMinutes: 226, dependencyIds: ["prerequisite"] }),
    ], {
      "provider:codex": 1,
      "provider:claude": 1,
    })).toThrow(/451분.*실행 창 밖 항목: dependent-outside.*다시 편집/u);
  });

  it("resumes only items without durable terminal receipts after restart", async () => {
    const coordinator = new OvernightPortfolioCoordinator();
    const plan = coordinator.prepare([
      item("completed", "codex"),
      item("interrupted", "grok"),
      item("queued", "hermes"),
    ], {
      "provider:codex": 1,
      "provider:grok": 1,
      "provider:hermes": 1,
    });
    const dispatch = vi.fn(async () => ({ status: "completed" as const, providerReceiptId: "hermes:new" }));

    const run = await coordinator.start(plan.id, dispatch, {
      runId: "recovered_run",
      initialReceipts: [
        { itemId: "completed", provider: "codex", status: "completed", providerReceiptId: "codex:old" },
        { itemId: "interrupted", provider: "grok", status: "failed", error: "interrupted by restart" },
      ],
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: "queued" }));
    expect(run.receipts).toEqual([
      expect.objectContaining({ itemId: "completed", status: "completed", providerReceiptId: "codex:old" }),
      expect.objectContaining({ itemId: "interrupted", status: "failed" }),
      expect.objectContaining({ itemId: "queued", status: "completed", providerReceiptId: "hermes:new" }),
    ]);
  });
});
