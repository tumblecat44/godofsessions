# Dogfood cycle 16 — 승인한 실행 인자가 실제 worker 인자다

## Cycle contract

작성 기준일: **2026-08-20 PDT**. 능동 조사 구간은 **2026-08-20
01:49:32–01:59:33 PDT**로 **10분 1초**였고, 구현·focused 검증·production
Electron dogfood는 **2026-08-20 01:59–02:12 PDT**, 전체 회귀와 macOS
패키징은 **2026-08-20 02:12–02:15 PDT**에 수행했다. 대기 시간은 조사
시간에 포함하지 않았다.

검증 대상은 다음 exact-approval 계약 하나다.

> 사용자가 Run 전에 본 fixed cwd와 argument vector가 plan에 고정되고,
> 실제 detached worker가 같은 vector를 순서 변경이나 숨은 인자 추가 없이
> 소비한다. Chat과 Orchestrate는 실행에 의미 있는 전체 값을 잘리지 않게
> 보여 준다.

실제 Codex 또는 Claude 실행은 승인하지 않았다. 모든 plan/context/root는
합성 데이터였고 provider executable은 stdin을 버리고 받은 인자만 한 줄씩
출력하는 임시 합성 명령으로 대체했다. 실제 current worker process는
실행했지만 provider process, subscription request, personal session은 사용하지
않았다.

## Active research and current evidence

accepted ADR과 V2 product contract, current source와 compiled worker,
actual-service preview, fake-executable argv receipt, production approval CSS,
installed Codex CLI 0.145.0과 Claude Code 2.1.235, current primary provider 및
process-spawn guidance를 대조했다.

- OWASP의 What You See Is What You Sign 원칙은 중요한 authorization data가
  사용자가 식별할 수 있어야 하고 authority에서 execution까지 변형 없이
  전달되어야 한다고 요구한다.
- Node `spawn(command, args, options)`는 shell string이 아니라 executable,
  string argument list, 별도 cwd를 직접 받는다. 현재 worker도 shell을 쓰지
  않는다.
- current official Codex source와 installed help는 `--sandbox`, `--cd`,
  `--ephemeral`, `--json`, `--skip-git-repo-check`를 확인한다.
- current official Claude headless/CLI docs와 installed help는 safe mode,
  strict MCP, `acceptEdits`, `stream-json`, `verbose`를 확인한다.
- Claude `acceptEdits`는 대부분의 arbitrary shell/network 작업을 자동 승인하지
  않는다. 이 제한은 별도 safety cycle로 남기고 여기서 permission을 넓히지
  않았다.

Sources:

- <https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html>
- <https://nodejs.org/api/child_process.html>
- <https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs>
- <https://github.com/openai/codex/blob/main/codex-rs/exec/src/lib.rs>
- <https://code.claude.com/docs/en/cli-reference>
- <https://code.claude.com/docs/en/headless>
- <https://code.claude.com/docs/en/permission-modes>
- `docs/adr/0007-approval-is-exact-expiring-and-single-use.md`
- `docs/adr/0051-bounded-local-overnight.md`
- `CONTEXT.md`
- `DESIGN.md`
- `electron/runtime/overnight-service.ts`
- `electron/overnight-worker.ts`
- `src/components/ChatView.tsx`
- `src/components/OrchestrateView.tsx`
- `src/styles.css`

## Baseline failures

actual current service가 만든 Codex preview에는 worker가 실제로 추가하는
`--skip-git-repo-check`가 없었다. preview는 CLI argument 8개, compiled worker
receipt는 9개였다. 이 인자는 non-Git fixed root를 허용하므로 실행 의미가
있는데 승인 뒤 worker에서 새로 파생됐다.

Claude preview는 `-p`, safe mode, strict MCP, `acceptEdits`까지만 보였지만
compiled worker는 `--output-format stream-json --verbose`도 사용했다. preview는
argument 5개, worker는 8개였고 cwd는 Node의 별도 cwd 대신 괄호 설명으로만
표시됐다.

Chat approval card는 command를 한 줄로 강제하고 overflow hidden, ellipsis를
적용했다. 대표 actual temporary root의 Codex preview는 160자로 label column을
제외해도 card 폭보다 길었다. 사용자에게 전체 root를 보여 주는 다른 곳도
없어 중요한 tail이 사라졌다.

actual service의 Codex label은 English UI에서도 `구독`을 포함했고 executable
존재만 확인하면서 subscription이 검증됐다고 주장했다. focused baseline
28/28은 네 failure를 모두 놓쳤다.

## Selected correction

`electron/runtime/overnight-executor-contract.ts`를 canonical authority로
추가했다. executor마다 다음을 한 번만 정의한다.

- neutral technical label;
- logical executable name;
- fixed cwd;
- exact readonly argument vector;
- readable `cwd:`/`argv:` two-line preview.

`OvernightService.prepare`는 이 contract로 plan을 만들고 argument vector를
frozen prompt와 함께 memory에 고정한다. plan 교체·만료·성공 시 둘 다
폐기하고, 명시적 prelaunch failure에서는 exact retry를 위해 둘 다 유지한다.
`start`는 frozen vector 사본을 private request에 넣는다. worker는 provider별
branch를 제거하고 오직 `spawn(request.executable, request.args, { cwd:
request.root })`를 수행한다.

Chat과 Orchestrate는 같은 plan field를 accessible `Fixed working directory and
execution arguments` region으로 보여 준다. `white-space: pre-wrap`과
`overflow-wrap: anywhere`를 공통 적용했고 hidden overflow와 ellipsis를
제거했다. identity는 `Codex CLI · codex exec`, `Claude Code · claude -p`다.

새 dependency, shell string, CLI flag, permission, provider preflight,
authentication read는 추가하지 않았다.

## Deterministic regressions

새 contract test는 공백이 포함된 root에서 Codex와 Claude의 full object를
exact equality로 검증한다. service test는 preview와 worker request의 exact
arguments를 비교하고 executor가 prelaunch에 사라졌다가 복구된 뒤에도 같은
vector가 전달되는지 확인한다.

Chat과 Orchestrate regression은 neutral label, complete two-line preview,
accessible name, significant tail을 검증한다. focused suite는 4 files,
**30/30** 통과했다.

## Actual-service production Electron and worker trial

`npm run dogfood:electron:executor-contract`는 production renderer와 preload
bridge, current source에서 bundle한 actual `OvernightService`, current built
detached worker, isolated synthetic app data와 long fixed root를 사용했다.

Observed trace:

1. Chat에서 Codex plan을 준비했다. card는 neutral label, quoted fixed cwd,
   `--skip-git-repo-check -`까지 포함한 complete argv, 별도 Run을 표시했다.
2. DOM computed style은 `white-space: pre-wrap`, `scrollWidth <= clientWidth`,
   2줄보다 큰 client height였다. 즉 긴 인자가 가려지지 않았다.
3. Run 후 actual detached worker가 합성 executable을 시작했고 completed
   ledger의 log tail은 reviewed Codex argument 9개와 exact order로 같았다.
4. 같은 app에서 Codex를 unavailable로, Claude만 available로 바꾼 뒤 fresh
   plan을 준비했다. Claude card는 `stream-json --verbose`까지 완전히 보였다.
5. 두 번째 Run도 completed가 되었고 worker receipt는 reviewed Claude
   argument 8개와 exact order로 같았다. root의 공백은 하나의 argument로
   보존됐다.

네 screenshot은 저장소 밖 OS 임시 폴더에만 기록하고 직접 눈으로 확인했다.
Codex와 Claude card 모두 complete invocation과 Run이 동시에 보였고, 최종
Orchestrate 화면은 두 terminal run을 표시했다. 테스트 초기 시각 캡처가
320ms 진입 animation 중간을 찍는 문제는 product failure가 아니었고 final
visual capture는 animation completion 후 수행했다.

## Rubric and trajectory

Cycle 15의 **15/22**를 Cycle 16에서도 **15/22**로 유지한다. exact approval
consistency와 actionability의 증거는 강해졌지만 해당 dimension은 이미
2점이었다. real provider result, capacity/billing truth, actual route
verification은 만들지 않았으므로 점수를 올리지 않았다.

| Dimension | Before | After | Evidence |
| --- | ---: | ---: | --- |
| user-context fidelity | 2 | 2 | Frozen prompt and exact-root regressions remain green. |
| provider-capability currency | 1 | 1 | Current CLIs/docs inspected; no provider capability consumed. |
| capacity and billing fidelity | 0 | 0 | Outside this slice. |
| project and goal inference | 1 | 1 | Exact outcome remains visible; live inference not graded. |
| route and portfolio reasoning | 1 | 1 | Auto selected only the available synthetic executor; no live route choice. |
| exclusion quality | 1 | 1 | No new relevance judgment tested. |
| authority boundary | 2 | 2 | Frozen argv now crosses approval and worker without derivation. |
| morning evidence contract | 1 | 1 | Terminal receipts exist, but no human morning result. |
| uncertainty honesty | 2 | 2 | Neutral labels and Claude permission limitation remain explicit. |
| actionability and attention saved | 2 | 2 | Full invocation is readable in one approval card. |
| chat/approval-plan consistency | 2 | 2 | Chat, Orchestrate, request, and worker receipt agree. |

## Verification

- focused contract/service/Chat/Orchestrate suite: 4 files, 30/30 passed;
- `npm run check`: 10 test files and 72 app tests passed; 5 landing tests passed;
- seven sequential Electron trials passed: lifecycle, frozen context,
  concurrent exact-plan single use, five-minute expiry, actual local-context
  read-only, one active fixed-root owner, and exact Codex/Claude worker receipt;
- final actual-service/actual-worker Electron screenshots visually inspected;
- `npm run package:mac`: unsigned arm64 application directory built;
- new E2E syntax, package JSON, evidence JSONL, unique IDs, diff whitespace,
  touched-artifact secret/private-path scan: passed.

Packaging retains the pre-existing non-blocking missing description/author and
duplicate transitive reference warnings. No publish, push, deploy, signing,
provider dispatch, subscription-consuming request, credential capture, or
personal session mutation occurred.

## Keep, discard, defer

Keep:

- one canonical executor invocation contract;
- freeze-on-prepare argument vector with exact prelaunch retry;
- actual worker consumption of request args without provider branches;
- full wrapped cwd/argv in both approval surfaces;
- neutral technical executor identities;
- actual-worker synthetic receipt regression for both executors.

Discard:

- deriving flags after the user approved a different preview;
- hiding approval data behind ellipsis;
- informal parenthesized cwd semantics for only one provider;
- claiming a Codex subscription from binary existence;
- separate Chat and Orchestrate display rules for the same plan.

Defer with explicit evidence:

- executable availability does not prove official CLI authentication;
- executable absolute path is resolved at start rather than frozen at prepare;
- Claude `acceptEdits` does not prove arbitrary verification commands will run;
- stale `starting` ledger recovery, atomic/overlapping ledger writes, request
  write-then-chmod, and unbounded run/log retention;
- raw provider event JSON is not a bounded human morning result;
- real provider execution, capacity truth, refreshed Morrow context, and
  morning proof remain separate audits.

## Cycle decision

Keep the change. The approval surface no longer presents a simplified command
while a different vector runs later. Long roots and all significant current
flags are visible, the vector is frozen at preparation, and the actual detached
worker receives exactly that reviewed vector for both executors. The result is
strong transport and UX proof without pretending that a provider itself has
been authenticated or can complete the requested verification.

The next named cycle must begin with a new minimum ten-minute active
synchronization window before changing another defect.
