import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseOvernightLocalDate } from "../../src/shared/contracts";
import { OvernightNightShift, overnightBranchName } from "./overnight-night-shift";
import { OvernightStore } from "./overnight-store";

const execFileAsync = promisify(execFile);

describe("overnightBranchName", () => {
  it("uses mm-dd-yyyy-overnight from the start date", () => {
    expect(overnightBranchName(new Date(2026, 7, 28, 23, 0))).toBe("08-28-2026-overnight");
  });
});

describe("OvernightNightShift.schedule", () => {
  let dataDir: string;
  let repoDir: string;
  let store: OvernightStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "night-shift-data-"));
    repoDir = await mkdtemp(join(tmpdir(), "night-shift-repo-"));
    await execFileAsync("git", ["-C", repoDir, "init"]);
    await execFileAsync("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "seed"], {
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      },
    });
    store = new OvernightStore({ dataDir });
    store.open();
  });

  afterEach(async () => {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });

  it("decomposes, cuts the branch, and stores a scheduled card", async () => {
    const generation = store.commitGeneration({
      localDate: parseOvernightLocalDate("2026-08-28"),
      cards: [{
        goal: "끊긴 로그인 작업 마무리",
        finishCondition: "테스트 통과",
        workAi: "claude",
        verifyAi: "claude",
        stallHours: 0.5,
        decisionsLog: [],
      }],
    });
    const shift = new OvernightNightShift({
      store,
      dataDir,
      decompose: async () => [
        { title: "폼 완성", plan: "로그인 폼을 끝낸다", provider: "claude" },
        { title: "테스트", plan: "테스트를 통과시킨다", provider: "codex" },
      ],
      availableProviders: () => ["claude", "codex"],
    });
    const startAt = new Date(2026, 7, 28, 23, 0).toISOString();
    const card = await shift.schedule({
      cardId: generation.cards[0].id,
      targetDirectory: repoDir,
      startAt,
      endAt: new Date(2026, 7, 29, 7, 0).toISOString(),
    });

    expect(card.status).toBe("scheduled");
    expect(card.branch).toBe("08-28-2026-overnight");
    expect(card.tickets).toHaveLength(2);
    expect(card.tickets.every((ticket) => ticket.lane === "waiting")).toBe(true);
    const { stdout } = await execFileAsync("git", ["-C", repoDir, "branch", "--list", "08-28-2026-overnight"]);
    expect(stdout).toContain("08-28-2026-overnight");
    expect(store.listByStatus("scheduled").map((item) => item.id)).toEqual([card.id]);
  });

  it("rejects a directory that is not a git repository", async () => {
    const generation = store.commitGeneration({
      localDate: parseOvernightLocalDate("2026-08-28"),
      cards: [{
        goal: "goal", finishCondition: "done", workAi: "claude", verifyAi: "claude", stallHours: 0, decisionsLog: [],
      }],
    });
    const shift = new OvernightNightShift({
      store,
      dataDir,
      decompose: async () => [{ title: "t", plan: "p", provider: "claude" }],
      availableProviders: () => ["claude"],
    });
    await expect(shift.schedule({
      cardId: generation.cards[0].id,
      targetDirectory: dataDir,
      startAt: new Date(2026, 7, 28, 23, 0).toISOString(),
      endAt: new Date(2026, 7, 29, 7, 0).toISOString(),
    })).rejects.toThrow("git 저장소");
  });
});
