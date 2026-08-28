import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  OvernightCard,
  OvernightExecutionProvider,
  OvernightId,
  OvernightPlanTicket,
} from "../../src/shared/contracts";
import type { OvernightStore } from "./overnight-store";
import { overnightExecutorInvocation } from "./overnight-executor-contract";

const execFileAsync = promisify(execFile);

/** mm-dd-yyyy-overnight, from the run window's start date. */
export function overnightBranchName(startAt: Date): string {
  const mm = String(startAt.getMonth() + 1).padStart(2, "0");
  const dd = String(startAt.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${startAt.getFullYear()}-overnight`;
}

export interface NightShiftScheduleRequest {
  cardId: OvernightId;
  targetDirectory: string;
  /** ISO datetimes. */
  startAt: string;
  endAt: string;
}

/**
 * Decompose one approved plan into kanban tickets. Implemented by
 * MorrowService with the same model runtime that generates candidates.
 */
export type NightShiftDecomposer = (
  card: OvernightCard,
  providers: readonly OvernightExecutionProvider[],
) => Promise<readonly Omit<OvernightPlanTicket, "id" | "lane">[]>;

export interface NightShiftOptions {
  store: OvernightStore;
  dataDir: string;
  decompose: NightShiftDecomposer;
  /** Providers currently usable as headless CLI executors. */
  availableProviders: () => readonly OvernightExecutionProvider[];
  now?: () => Date;
  log?: (message: string) => void;
  /** Test-only overrides; production uses the 60s clock and 30m watch. */
  clockIntervalMs?: number;
  watchIntervalMs?: number;
}

interface ActiveNight {
  cardId: OvernightId;
  workDir: string;
  child?: ChildProcessWithoutNullStreams;
  lastOutputAt: number;
  restartedTicketIds: Set<string>;
  stopping: boolean;
}

const WATCH_INTERVAL_MS = 30 * 60 * 1_000;
const CLOCK_INTERVAL_MS = 60 * 1_000;

/**
 * M46 night runtime: schedule → branch → run tickets sequentially in a
 * worktree of the user-chosen directory → WIP-commit and stop at the
 * window end. Deliberately bypasses the portfolio containment chain
 * (docs/overnight-m46.md) — this is the simple route.
 */
export class OvernightNightShift {
  private readonly store: OvernightStore;
  private readonly dataDir: string;
  private readonly decompose: NightShiftDecomposer;
  private readonly availableProviders: () => readonly OvernightExecutionProvider[];
  private readonly now: () => Date;
  private readonly log: (message: string) => void;
  private readonly active = new Map<string, ActiveNight>();
  private lastWatchAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly clockIntervalMs: number;
  private readonly watchIntervalMs: number;

  constructor(options: NightShiftOptions) {
    this.store = options.store;
    this.dataDir = options.dataDir;
    this.decompose = options.decompose;
    this.availableProviders = options.availableProviders;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => {});
    this.clockIntervalMs = options.clockIntervalMs ?? CLOCK_INTERVAL_MS;
    this.watchIntervalMs = options.watchIntervalMs ?? WATCH_INTERVAL_MS;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch((reason) => this.log(String(reason))); }, this.clockIntervalMs);
    void this.tick().catch((reason) => this.log(String(reason)));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Approve a candidate: decompose, create the branch, persist as scheduled. */
  async schedule(request: NightShiftScheduleRequest): Promise<OvernightCard> {
    const card = this.store.getCard(request.cardId);
    if (!card) throw new Error("이 Overnight을 찾을 수 없습니다.");
    const directory = resolve(request.targetDirectory);
    const stats = await stat(directory).catch(() => undefined);
    if (!stats?.isDirectory()) throw new Error("대상 디렉토리를 찾을 수 없습니다.");
    await this.git(directory, ["rev-parse", "--show-toplevel"]).catch(() => {
      throw new Error("대상 디렉토리가 git 저장소가 아닙니다.");
    });
    const startAt = new Date(request.startAt);
    const endAt = new Date(request.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new Error("시작/종료 시간이 올바르지 않습니다.");
    }

    const providers = this.availableProviders();
    if (providers.length === 0) throw new Error("사용 가능한 야간 실행 CLI가 없습니다.");
    const drafts = await this.decompose(card, providers);
    if (drafts.length === 0) throw new Error("계획을 작업 카드로 분해하지 못했습니다.");
    const tickets: OvernightPlanTicket[] = drafts.map((draft) => ({
      ...draft,
      id: randomUUID(),
      lane: "waiting",
    }));

    const branch = overnightBranchName(startAt);
    const existing = await this.git(directory, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).catch(() => "");
    if (!existing.trim()) await this.git(directory, ["branch", branch]);

    return this.store.schedule(card.id, {
      planId: randomUUID(),
      targetDirectory: directory,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      branch,
      tickets,
    });
  }

  /** One clock beat: start due nights, stop overdue ones, watch every 30 minutes. */
  async tick(): Promise<void> {
    const now = this.now();
    for (const card of this.store.listByStatus("scheduled")) {
      if (card.startAt && Date.parse(card.startAt) <= now.getTime()) {
        void this.begin(card).catch((reason) => this.log(String(reason)));
      }
    }
    for (const card of this.store.listByStatus("running")) {
      if (card.endAt && Date.parse(card.endAt) <= now.getTime()) {
        void this.finish(card.id, "종료 시간이 되어 WIP를 커밋하고 정지했습니다.").catch((reason) => this.log(String(reason)));
      }
    }
    if (now.getTime() - this.lastWatchAt >= this.watchIntervalMs) {
      this.lastWatchAt = now.getTime();
      this.watch();
    }
  }

  /** Morning evidence: commits the night produced on the branch. */
  async branchLog(cardId: OvernightId): Promise<string> {
    const card = this.store.getCard(cardId);
    if (!card?.targetDirectory || !card.branch) return "";
    return this.git(card.targetDirectory, [
      "log", "--oneline", "-n", "50", card.branch,
      ...(card.startAt ? [`--since=${card.startAt}`] : []),
    ]).catch(() => "");
  }

  private async begin(card: OvernightCard): Promise<void> {
    if (this.active.has(card.id)) return;
    if (!card.targetDirectory || !card.branch) throw new Error("예약 정보가 불완전합니다.");
    const workDir = join(this.dataDir, "overnight", "night-shift", card.branch);
    const night: ActiveNight = {
      cardId: card.id,
      workDir,
      lastOutputAt: Date.now(),
      restartedTicketIds: new Set(),
      stopping: false,
    };
    this.active.set(card.id, night);
    const started = this.store.beginRun(card.id);
    this.store.appendDecisions(card.id, [{
      at: this.now().toISOString(),
      kind: "started",
      note: `밤 실행 시작 — 브랜치 ${card.branch}, 디렉토리 ${card.targetDirectory}`,
    }]);
    const hasWorktree = await stat(workDir).then((stats) => stats.isDirectory()).catch(() => false);
    if (!hasWorktree) {
      await this.git(card.targetDirectory, ["worktree", "add", workDir, card.branch]);
    }
    void this.runTickets(started, night).catch((reason) => this.log(String(reason)));
  }

  private async runTickets(card: OvernightCard, night: ActiveNight): Promise<void> {
    let tickets = [...card.tickets];
    const retried = new Set<string>();
    for (let index = 0; index < tickets.length; index += 1) {
      if (night.stopping) return;
      if (tickets[index].lane === "done") continue;
      tickets = this.moveLane(card.id, tickets, index, "working");
      const succeeded = await this.runTicket(card, tickets[index], night)
        .catch((reason) => { this.log(String(reason)); return false; });
      if (night.stopping) return;
      if (!succeeded && night.restartedTicketIds.has(tickets[index].id) && !retried.has(tickets[index].id)) {
        // The watch killed a silent worker; give the ticket one fresh run.
        retried.add(tickets[index].id);
        index -= 1;
        continue;
      }
      tickets = this.moveLane(card.id, tickets, index, succeeded ? "done" : "failed");
      await this.commitTicket(night.workDir, tickets[index], succeeded);
    }
    await this.finish(card.id, "모든 카드가 끝나 밤 실행을 마쳤습니다.");
  }

  private async runTicket(card: OvernightCard, ticket: OvernightPlanTicket, night: ActiveNight): Promise<boolean> {
    const executor = ticket.provider === "codex" ? "codex" : "claude";
    const invocation = overnightExecutorInvocation(executor, night.workDir);
    const prompt = [
      `밤샘 자동 작업 카드입니다. 작업 디렉토리는 현재 디렉토리이고 브랜치 ${card.branch}에서 작업 중입니다.`,
      `전체 목표: ${card.goal}`,
      `완료 조건: ${card.finishCondition}`,
      `이 카드의 계획: ${ticket.plan}`,
      "작업을 끝내면 변경 사항을 저장하고 종료하세요. 질문하지 말고 스스로 판단해서 진행하세요.",
    ].join("\n\n");
    return new Promise<boolean>((resolvePromise) => {
      const child = spawn(invocation.executableName, [...invocation.args], {
        cwd: night.workDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env,
      });
      night.child = child;
      night.lastOutputAt = Date.now();
      child.stdout.on("data", () => { night.lastOutputAt = Date.now(); });
      child.stderr.on("data", () => { night.lastOutputAt = Date.now(); });
      child.on("error", () => resolvePromise(false));
      child.on("exit", (code) => {
        night.child = undefined;
        resolvePromise(code === 0);
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  /** The 30-minute check: restart a night whose worker went silent. */
  private watch(): void {
    for (const card of this.store.listByStatus("running")) {
      const night = this.active.get(card.id);
      if (!night) {
        // App restarted mid-night: resume from the first unfinished ticket.
        void this.begin({ ...card, status: "scheduled" } as OvernightCard).catch((reason) => this.log(String(reason)));
        continue;
      }
      const working = card.tickets.find((ticket) => ticket.lane === "working");
      const silentMs = Date.now() - night.lastOutputAt;
      if (working && night.child && silentMs >= this.watchIntervalMs && !night.restartedTicketIds.has(working.id)) {
        night.restartedTicketIds.add(working.id);
        this.store.appendDecisions(card.id, [{
          at: this.now().toISOString(),
          kind: "revised",
          note: `30분 점검 — "${working.title}" 작업이 ${Math.round(silentMs / 60_000)}분간 조용해서 재시작했습니다.`,
        }]);
        night.child.kill("SIGTERM");
      } else {
        this.store.appendDecisions(card.id, [{
          at: this.now().toISOString(),
          kind: "revised",
          note: `30분 점검 — 이상 없음 (${card.tickets.filter((ticket) => ticket.lane === "done").length}/${card.tickets.length} 완료).`,
        }]);
      }
    }
  }

  private async finish(cardId: OvernightId, note: string): Promise<void> {
    const night = this.active.get(cardId);
    if (night) {
      night.stopping = true;
      night.child?.kill("SIGTERM");
      await this.git(night.workDir, ["add", "-A"]).catch(() => "");
      await this.git(night.workDir, ["commit", "-m", "WIP: overnight window ended", "--no-verify"]).catch(() => "");
      this.active.delete(cardId);
    }
    const card = this.store.getCard(cardId);
    if (card?.status === "running") {
      this.store.markRan(cardId);
      this.store.appendDecisions(cardId, [{ at: this.now().toISOString(), kind: "finished", note }]);
    }
  }

  private moveLane(
    cardId: OvernightId,
    tickets: readonly OvernightPlanTicket[],
    index: number,
    lane: OvernightPlanTicket["lane"],
  ): OvernightPlanTicket[] {
    const next = tickets.map((ticket, position) => (position === index ? { ...ticket, lane } : ticket));
    try {
      this.store.updateTickets(cardId, next);
    } catch {
      // Card left running state (cancelled mid-night); keep going shut-down path.
    }
    return next;
  }

  private async commitTicket(workDir: string, ticket: OvernightPlanTicket, succeeded: boolean): Promise<void> {
    await this.git(workDir, ["add", "-A"]).catch(() => "");
    await this.git(workDir, [
      "commit", "-m",
      `overnight${succeeded ? "" : " (실패 시점 저장)"}: ${ticket.title}`,
      "--no-verify",
    ]).catch(() => "");
  }

  private async git(directory: string, args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", ["-C", directory, ...args], { timeout: 60_000 });
    return stdout;
  }
}
