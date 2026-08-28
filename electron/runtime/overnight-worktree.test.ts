import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { OvernightWorktreeManager } from "./overnight-worktree";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Overnight worktree manager", () => {
  it("freezes a clean revision and allocates an isolated branch from that exact commit", async () => {
    const fixture = await gitFixture();
    const manager = new OvernightWorktreeManager({ root: fixture.repository, dataDir: fixture.dataDir });
    const snapshot = await manager.inspect();

    expect(snapshot).toMatchObject({ isolation: "isolated", reason: "clean_git_worktree" });
    expect(snapshot.repositoryRevision).toMatch(/^[a-f0-9]{40}$/u);

    const planned = manager.plannedAllocation(snapshot, "run-1", "item-1");
    const allocation = await manager.allocate(snapshot, "run-1", "item-1");
    expect(allocation).toEqual(planned);
    expect(allocation.executionRoot).not.toBe(await realpath(fixture.repository));
    expect(allocation.executionRoot).toContain(join("overnight", "worktrees", "run-1", "item-1"));
    expect(allocation.branch).toBe("morrow/overnight/run-1/item-1");
    expect((await git(["-C", allocation.executionRoot, "rev-parse", "HEAD"])).trim()).toBe(snapshot.repositoryRevision);
    expect(await realpath(join(allocation.executionRoot, "README.md"))).toBe(join(await realpath(allocation.executionRoot), "README.md"));
  });

  it("reports an isolated result location and proves it is not integrated into the main workspace", async () => {
    const fixture = await gitFixture();
    const manager = new OvernightWorktreeManager({ root: fixture.repository, dataDir: fixture.dataDir });
    const snapshot = await manager.inspect();
    const allocation = await manager.allocate(snapshot, "run-result", "independent-item");
    await writeFile(join(allocation.executionRoot, "overnight-result.txt"), "isolated result\n");

    expect(manager.resultMetadata(allocation)).toEqual({
      executionRoot: allocation.executionRoot,
      worktreeKey: allocation.worktreeKey,
      branch: "morrow/overnight/run-result/independent-item",
      baseRevision: snapshot.repositoryRevision,
      integrationStatus: "not_integrated",
    });
    await expect(realpath(join(fixture.repository, "overnight-result.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await git(["-C", fixture.repository, "status", "--porcelain=v1"])).toBe("");
  });

  it("keeps dirty main files in place and still allocates an isolated worktree from the frozen HEAD", async () => {
    const fixture = await gitFixture();
    await writeFile(join(fixture.repository, "README.md"), "dirty\n");
    await writeFile(join(fixture.repository, "dirty-only.txt"), "uncommitted\n");
    const dirtyManager = new OvernightWorktreeManager({ root: fixture.repository, dataDir: fixture.dataDir });
    const dirty = await dirtyManager.inspect();
    expect(dirty).toMatchObject({ isolation: "isolated", reason: "dirty_git_worktree" });

    const dirtyAllocation = await dirtyManager.allocate(dirty, "run-2", "item-2");
    expect(dirtyAllocation.executionRoot).not.toBe(await realpath(fixture.repository));
    expect(dirtyAllocation.executionRoot).toContain(join("overnight", "worktrees", "run-2", "item-2"));
    expect(dirtyAllocation.branch).toBe("morrow/overnight/run-2/item-2");
    expect((await git(["-C", dirtyAllocation.executionRoot, "rev-parse", "HEAD"])).trim()).toBe(dirty.repositoryRevision);
    expect(await git(["-C", fixture.repository, "status", "--porcelain=v1"])).toMatch(/dirty-only\.txt/u);
    expect(await git(["-C", fixture.repository, "status", "--porcelain=v1"])).toMatch(/README\.md/u);
    await expect(access(join(dirtyAllocation.executionRoot, "dirty-only.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(dirtyAllocation.executionRoot, "README.md"), "utf8")).toBe("fixture\n");
    expect(dirtyManager.resultMetadata(dirtyAllocation)).toEqual({
      executionRoot: dirtyAllocation.executionRoot,
      worktreeKey: dirtyAllocation.worktreeKey,
      branch: "morrow/overnight/run-2/item-2",
      baseRevision: dirty.repositoryRevision,
      integrationStatus: "not_integrated",
    });
  });

  it("refuses to allocate when the root is not a git worktree", async () => {
    const fixture = await gitFixture();
    const plainRoot = join(fixture.base, "plain");
    await mkdir(plainRoot);
    const manager = new OvernightWorktreeManager({ root: plainRoot, dataDir: fixture.dataDir });
    const plain = await manager.inspect();
    expect(plain).toMatchObject({ isolation: "shared", reason: "not_a_git_worktree" });
    await expect(manager.allocate(plain, "run-plain", "item-plain")).rejects.toThrow(/git 저장소/u);
    await expect(() => manager.plannedAllocation(plain, "run-plain", "item-plain")).toThrow(/git 저장소/u);
  });

  it("returns the planned allocation when the same run and item worktree already exists", async () => {
    const fixture = await gitFixture();
    const manager = new OvernightWorktreeManager({ root: fixture.repository, dataDir: fixture.dataDir });
    const snapshot = await manager.inspect();
    const first = await manager.allocate(snapshot, "run-idempotent", "item-idempotent");
    const second = await manager.allocate(snapshot, "run-idempotent", "item-idempotent");
    expect(second).toEqual(first);
    expect(second.executionRoot).toBe(first.executionRoot);
  });

  it("rejects path-like run and item identifiers before creating anything", async () => {
    const fixture = await gitFixture();
    const manager = new OvernightWorktreeManager({ root: fixture.repository, dataDir: fixture.dataDir });
    const snapshot = await manager.inspect();
    await expect(manager.allocate(snapshot, "../escape", "item")).rejects.toThrow(/Invalid Overnight run id/u);
    await expect(manager.allocate(snapshot, "run", "item/escape")).rejects.toThrow(/Invalid Overnight item id/u);
  });
});

async function gitFixture() {
  const base = await mkdtemp(join(tmpdir(), "morrow-worktree-test-"));
  temporaryDirectories.push(base);
  const repository = join(base, "repository");
  const dataDir = join(base, "data");
  await mkdir(repository);
  await git(["-C", repository, "init"]);
  await git(["-C", repository, "config", "user.name", "Morrow Test"]);
  await git(["-C", repository, "config", "user.email", "morrow@example.invalid"]);
  await writeFile(join(repository, "README.md"), "fixture\n");
  await git(["-C", repository, "add", "README.md"]);
  await git(["-C", repository, "commit", "-m", "fixture"]);
  return { base, repository, dataDir };
}

async function git(args: readonly string[]) {
  const { stdout } = await execFileAsync("git", [...args], { encoding: "utf8", timeout: 10_000 });
  return stdout;
}

