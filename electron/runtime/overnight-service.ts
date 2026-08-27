import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";
import type {
  OrchestrationSnapshot,
  OvernightExecutor,
  OvernightPlanSummary,
  OvernightRunSummary,
} from "../../src/shared/contracts";
import type { DailyContextSnapshot } from "./daily-context";

const PLAN_LIFETIME_MS = 5 * 60 * 1_000;
const LOG_TAIL_LIMIT = 120;

export interface PrepareOvernightInput {
  title: string;
  outcome: string;
  verification: string;
  sessionIds: string[];
  executor: "auto" | OvernightExecutor;
}

export interface OvernightWorkerRequest {
  runId: string;
  planId: string;
  root: string;
  dataDir: string;
  executor: OvernightExecutor;
  executable: string;
  prompt: string;
  title: string;
  selectedSessions: OvernightRunSummary["selectedSessions"];
  startedAt: string;
}

export interface OvernightServiceOptions {
  root: string;
  dataDir: string;
  workerPath: string;
  now?: () => Date;
  commandAvailable?: (executor: OvernightExecutor) => Promise<boolean>;
  launchWorker?: (request: OvernightWorkerRequest) => Promise<number>;
}

export class OvernightService {
  private readonly root: string;
  private readonly dataDir: string;
  private readonly workerPath: string;
  private readonly now: () => Date;
  private readonly commandAvailable: (executor: OvernightExecutor) => Promise<boolean>;
  private readonly launchWorker: (request: OvernightWorkerRequest) => Promise<number>;
  private readonly plans = new Map<string, OvernightPlanSummary>();

  constructor(options: OvernightServiceOptions) {
    this.root = options.root;
    this.dataDir = options.dataDir;
    this.workerPath = options.workerPath;
    this.now = options.now ?? (() => new Date());
    this.commandAvailable = options.commandAvailable ?? (async (executor) => Boolean(await findExecutable(executor)));
    this.launchWorker = options.launchWorker ?? ((request) => this.spawnWorker(request));
  }

  async prepare(input: PrepareOvernightInput, context: DailyContextSnapshot) {
    const title = bounded(input.title, "제목", 120);
    const outcome = bounded(input.outcome, "완료 기준", 4_000);
    const verification = bounded(input.verification, "검증 방법", 2_000);
    const selectedIds = [...new Set(input.sessionIds)].slice(0, 24);
    const selectedSessions = selectedIds.map((id) => context.summary.sessions.find((session) => session.id === id));
    const missing = selectedIds.filter((_id, index) => !selectedSessions[index]);
    if (missing.length) throw new Error(`찾을 수 없는 오늘 세션입니다: ${missing.join(", ")}`);
    const executor = await this.resolveExecutor(input.executor);
    const createdAt = this.now();
    const plan: OvernightPlanSummary = {
      id: crypto.randomUUID(),
      status: "draft",
      title,
      outcome,
      verification,
      executor,
      executorLabel: executor === "codex" ? "GPT Codex 구독 · codex exec" : "Claude · claude -p",
      commandPreview: commandPreview(executor, this.root),
      selectedSessions: selectedSessions.filter((session): session is NonNullable<typeof session> => Boolean(session)),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + PLAN_LIFETIME_MS).toISOString(),
    };
    this.plans.set(plan.id, plan);
    return plan;
  }

  async start(planId: string, context: DailyContextSnapshot) {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error("이 Overnight 계획을 찾을 수 없거나 앱을 다시 시작해 만료되었습니다.");
    if (plan.status !== "draft") throw new Error("이 Overnight 계획은 이미 사용되었습니다.");
    if (this.now().getTime() >= new Date(plan.expiresAt).getTime()) {
      plan.status = "expired";
      throw new Error("이 Overnight 계획은 만료되었습니다. Morrow에게 새로 준비해 달라고 해주세요.");
    }
    if (!(await this.commandAvailable(plan.executor))) throw new Error(`${plan.executorLabel} 실행기를 더 이상 찾을 수 없습니다.`);
    plan.status = "starting";
    const startedAt = this.now().toISOString();
    const runId = crypto.randomUUID();
    const executable = await findExecutable(plan.executor) ?? plan.executor;
    const request: OvernightWorkerRequest = {
      runId,
      planId: plan.id,
      root: this.root,
      dataDir: this.dataDir,
      executor: plan.executor,
      executable,
      prompt: buildWorkerPrompt(plan, context, this.root),
      title: plan.title,
      selectedSessions: plan.selectedSessions,
      startedAt,
    };
    const initial: OvernightRunSummary = {
      id: runId,
      planId: plan.id,
      title: plan.title,
      executor: plan.executor,
      executorLabel: plan.executorLabel,
      status: "starting",
      selectedSessions: plan.selectedSessions,
      startedAt,
      updatedAt: startedAt,
      logTail: [],
    };
    await this.writeRun(initial);
    try {
      const workerPid = await this.launchWorker(request);
      initial.workerPid = workerPid;
      plan.status = "started";
      return initial;
    } catch (reason) {
      plan.status = "draft";
      initial.status = "failed";
      initial.error = message(reason);
      initial.completedAt = this.now().toISOString();
      initial.updatedAt = initial.completedAt;
      await this.writeRun(initial);
      throw reason;
    }
  }

  async snapshot(context: DailyContextSnapshot): Promise<OrchestrationSnapshot> {
    this.expirePlans();
    return {
      context: context.summary,
      plans: [...this.plans.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      runs: await this.readRuns(),
    };
  }

  async stop(runId: string) {
    const path = this.runPath(runId);
    const run = JSON.parse(await readFile(path, "utf8")) as OvernightRunSummary;
    if (!run.workerPid || !["starting", "running", "unknown"].includes(run.status)) return;
    run.status = "stopping";
    run.updatedAt = this.now().toISOString();
    await this.writeRun(run);
    try { process.kill(-run.workerPid, "SIGTERM"); }
    catch { try { process.kill(run.workerPid, "SIGTERM"); } catch { /* It may have just finished. */ } }
  }

  latestDraft() {
    this.expirePlans();
    return [...this.plans.values()].filter((plan) => plan.status === "draft").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }

  private async resolveExecutor(requested: "auto" | OvernightExecutor): Promise<OvernightExecutor> {
    if (requested !== "auto") {
      if (!(await this.commandAvailable(requested))) throw new Error(`${requested === "codex" ? "GPT Codex" : "Claude"} 실행기를 찾지 못했습니다.`);
      return requested;
    }
    if (await this.commandAvailable("codex")) return "codex";
    if (await this.commandAvailable("claude")) return "claude";
    throw new Error("Overnight를 실행할 Codex 또는 Claude 명령을 찾지 못했습니다.");
  }

  private async spawnWorker(request: OvernightWorkerRequest) {
    await mkdir(join(this.dataDir, "overnight", "requests"), { recursive: true });
    const requestPath = join(this.dataDir, "overnight", "requests", `${request.runId}.json`);
    await writeFile(requestPath, JSON.stringify(request));
    await chmod(requestPath, 0o600);
    const child = spawn(process.execPath, [this.workerPath, requestPath], {
      cwd: this.root,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    child.unref();
    if (!child.pid) throw new Error("Overnight worker를 시작하지 못했습니다.");
    return child.pid;
  }

  private async writeRun(run: OvernightRunSummary) {
    await mkdir(join(this.dataDir, "overnight", "runs"), { recursive: true });
    await writeFile(this.runPath(run.id), JSON.stringify(run, null, 2));
  }

  private async readRuns() {
    const directory = join(this.dataDir, "overnight", "runs");
    let names: string[] = [];
    try { names = await readdir(directory); } catch { return []; }
    const runs = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      try {
        const run = JSON.parse(await readFile(join(directory, name), "utf8")) as OvernightRunSummary;
        const logPath = join(this.dataDir, "overnight", "logs", `${run.id}.log`);
        try { run.logTail = (await readFile(logPath, "utf8")).split("\n").filter(Boolean).slice(-LOG_TAIL_LIMIT); } catch { run.logTail = []; }
        return run;
      } catch { return undefined; }
    }));
    return runs.filter((run): run is OvernightRunSummary => Boolean(run)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private runPath(runId: string) { return join(this.dataDir, "overnight", "runs", `${basename(runId)}.json`); }

  private expirePlans() {
    const now = this.now().getTime();
    for (const plan of this.plans.values()) if (plan.status === "draft" && now >= new Date(plan.expiresAt).getTime()) plan.status = "expired";
  }
}

function buildWorkerPrompt(plan: OvernightPlanSummary, context: DailyContextSnapshot, root: string) {
  const selected = new Set(plan.selectedSessions.map((session) => session.id));
  const sessionBrief = context.sessions.filter((session) => selected.has(session.id)).map((session) => [
    `## ${session.provider.toUpperCase()} — ${session.title}`,
    session.workspace ? `작업 위치: ${session.workspace}` : "",
    ...session.excerpts.map((excerpt) => `${excerpt.role === "user" ? "사용자" : "응답"}: ${excerpt.text}`),
  ].filter(Boolean).join("\n")).join("\n\n");
  return `당신은 Morrow가 사용자의 명시적 승인을 받아 시작한 비대화형 Overnight 작업자입니다.
고정 작업 루트: ${root}

완료할 일: ${plan.title}
완료 기준: ${plan.outcome}
검증 방법: ${plan.verification}

규칙:
- 현재 작업 루트 밖을 수정하지 마세요.
- 인증 정보, 세션 원문, 내부 추론을 출력물에 복사하지 마세요.
- 파괴적 명령, 배포, 게시, 외부 메시지 전송은 하지 마세요.
- 먼저 현재 상태를 읽고, 필요한 최소 변경만 수행하고, 지정한 검증을 실행하세요.
- 마지막 응답에 바꾼 것, 검증 결과, 남은 위험을 간결하게 남기세요.

선택된 오늘 세션의 제한된 문맥:
${sessionBrief || "선택된 세션 없음"}`;
}

function commandPreview(executor: OvernightExecutor, root: string) {
  return executor === "codex"
    ? `codex exec --sandbox workspace-write --cd ${JSON.stringify(root)} --ephemeral --json -`
    : `claude -p --safe-mode --strict-mcp-config --permission-mode acceptEdits (cwd ${JSON.stringify(root)})`;
}

async function findExecutable(executor: OvernightExecutor) {
  const name = executor === "codex" ? "codex" : "claude";
  const candidates = [join(homedir(), ".local", "bin", name), ...(process.env.PATH ?? "").split(":").filter(Boolean).map((directory) => join(directory, name))];
  for (const candidate of [...new Set(candidates)]) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Continue. */ }
  }
  return undefined;
}

function bounded(value: string, label: string, limit: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > limit) throw new Error(`${label}이 비어 있거나 너무 깁니다.`);
  return normalized;
}
function message(reason: unknown) { return reason instanceof Error ? reason.message : String(reason); }
