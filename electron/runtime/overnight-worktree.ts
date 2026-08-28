import { execFile } from "node:child_process";
import { access, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface OvernightWorkspaceSnapshot {
  root: string;
  repositoryRoot?: string;
  repositoryRevision?: string;
  repositoryRelativeRoot?: string;
  workspaceKey: string;
  isolation: "isolated" | "shared";
  reason: "clean_git_worktree" | "dirty_git_worktree" | "not_a_git_worktree";
}

export interface OvernightWorkspaceAllocation extends OvernightWorkspaceSnapshot {
  executionRoot: string;
  worktreeKey: string;
  branch?: string;
}

export interface OvernightWorkspaceResultMetadata {
  executionRoot: string;
  worktreeKey: string;
  branch?: string;
  baseRevision?: string;
  integrationStatus: "not_integrated" | "shared_workspace";
}

export type OvernightGitRunner = (args: readonly string[]) => Promise<string>;

const NOT_A_GIT_ERROR = "Overnight는 git 저장소 안에서만 시작할 수 있습니다.";

export class OvernightWorktreeManager {
  private readonly root: string;
  private readonly dataDir: string;
  private readonly runGit: OvernightGitRunner;

  constructor(options: { root: string; dataDir: string; runGit?: OvernightGitRunner }) {
    this.root = resolve(options.root);
    this.dataDir = resolve(options.dataDir);
    this.runGit = options.runGit ?? runGit;
  }

  async inspect(): Promise<OvernightWorkspaceSnapshot> {
    const root = await realpath(this.root);
    try {
      const repositoryRoot = await realpath((await this.runGit(["-C", root, "rev-parse", "--show-toplevel"])).trim());
      const repositoryRelativeRoot = relative(repositoryRoot, root);
      if (repositoryRelativeRoot.startsWith("..") || isAbsolute(repositoryRelativeRoot)) {
        return sharedSnapshot(root, "not_a_git_worktree");
      }
      const repositoryRevision = (await this.runGit(["-C", repositoryRoot, "rev-parse", "HEAD"])).trim();
      const dirty = Boolean((await this.runGit(["-C", repositoryRoot, "status", "--porcelain=v1", "--untracked-files=normal"])).trim());
      return {
        root,
        repositoryRoot,
        repositoryRevision,
        repositoryRelativeRoot,
        workspaceKey: repositoryRoot,
        isolation: "isolated",
        reason: dirty ? "dirty_git_worktree" : "clean_git_worktree",
      };
    } catch {
      return sharedSnapshot(root, "not_a_git_worktree");
    }
  }

  async allocate(snapshot: OvernightWorkspaceSnapshot, runId: string, itemId: string): Promise<OvernightWorkspaceAllocation> {
    const root = await realpath(snapshot.root);
    const canonical = { ...snapshot, root };
    assertGitWorkspace(canonical);
    const planned = this.plannedAllocation(canonical, runId, itemId);
    const worktreeRoot = planned.worktreeKey;
    if (await this.worktreeExists(canonical.repositoryRoot!, worktreeRoot)) {
      return planned;
    }
    await mkdir(dirname(worktreeRoot), { recursive: true, mode: 0o700 });
    await this.runGit([
      "-C", canonical.repositoryRoot!,
      "worktree", "add", "-b", planned.branch!, worktreeRoot, canonical.repositoryRevision!,
    ]);
    return planned;
  }

  plannedAllocation(snapshot: OvernightWorkspaceSnapshot, runId: string, itemId: string): OvernightWorkspaceAllocation {
    assertGitWorkspace(snapshot);
    const safeRunId = safeSegment(runId, "run id");
    const safeItemId = safeSegment(itemId, "item id");
    const worktreeBase = resolve(this.dataDir, "overnight", "worktrees");
    const worktreeRoot = resolve(worktreeBase, safeRunId, safeItemId);
    assertInside(worktreeBase, worktreeRoot);
    const executionRoot = resolve(worktreeRoot, snapshot.repositoryRelativeRoot!);
    assertInside(worktreeRoot, executionRoot, true);
    return {
      ...snapshot,
      isolation: "isolated",
      executionRoot,
      worktreeKey: worktreeRoot,
      branch: `morrow/overnight/${safeRunId}/${safeItemId}`,
    };
  }

  resultMetadata(allocation: OvernightWorkspaceAllocation): OvernightWorkspaceResultMetadata {
    return overnightWorkspaceResultMetadata(allocation);
  }

  private async worktreeExists(repositoryRoot: string, worktreeRoot: string) {
    try {
      await access(worktreeRoot);
    } catch {
      return false;
    }
    let existing: string;
    try {
      existing = await realpath(worktreeRoot);
    } catch {
      return false;
    }
    const listed = await this.runGit(["-C", repositoryRoot, "worktree", "list", "--porcelain"]);
    for (const block of listed.split("\n\n")) {
      const line = block.split("\n").find((entry) => entry.startsWith("worktree "));
      if (!line) continue;
      const listedPath = line.slice("worktree ".length);
      try {
        if (await realpath(listedPath) === existing) return true;
      } catch {
        if (resolve(listedPath) === existing) return true;
      }
    }
    return false;
  }
}

export function overnightWorkspaceResultMetadata(
  allocation: OvernightWorkspaceAllocation,
): OvernightWorkspaceResultMetadata {
  return {
    executionRoot: allocation.executionRoot,
    worktreeKey: allocation.worktreeKey,
    ...(allocation.branch ? { branch: allocation.branch } : {}),
    ...(allocation.repositoryRevision ? { baseRevision: allocation.repositoryRevision } : {}),
    integrationStatus: "not_integrated",
  };
}

async function runGit(args: readonly string[]) {
  const { stdout } = await execFileAsync("git", [...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1_024 * 1_024 });
  return stdout;
}

function sharedSnapshot(root: string, reason: OvernightWorkspaceSnapshot["reason"]): OvernightWorkspaceSnapshot {
  return {
    root,
    workspaceKey: root,
    isolation: "shared",
    reason,
  };
}

function assertGitWorkspace(snapshot: OvernightWorkspaceSnapshot) {
  if (
    snapshot.reason === "not_a_git_worktree"
    || snapshot.isolation === "shared"
    || !snapshot.repositoryRoot
    || !snapshot.repositoryRevision
    || snapshot.repositoryRelativeRoot === undefined
  ) {
    throw new Error(NOT_A_GIT_ERROR);
  }
}

function safeSegment(value: string, label: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(value)) throw new Error(`Invalid Overnight ${label}.`);
  return value;
}

function assertInside(parent: string, child: string, allowEqual = false) {
  const rel = relative(parent, child);
  if ((!rel && !allowEqual) || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Overnight worktree path escaped its private runtime directory.");
}
