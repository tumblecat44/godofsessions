import { describe, expect, it } from "vitest";
import type { DailyContextSnapshot } from "./daily-context";
import {
  assessOvernightProposal,
  type OvernightProposal,
} from "./overnight-recommendation";

const root = "/work/app";

function session(
  id: string,
  title: string,
  last: string,
  workspace: string | null = root,
  role: "user" | "assistant" = "assistant",
) {
  const provider = id.startsWith("claude:") ? "claude" as const : "codex" as const;
  return {
    id,
    nativeId: id.split(":")[1],
    provider,
    title,
    workspace: workspace ?? undefined,
    updatedAt: "2026-08-25T05:00:00.000Z",
    summary: last,
    excerptCount: 2,
    excerpts: [
      { role: "user" as const, text: title },
      { role, text: last },
    ],
  };
}

function context(...sessions: ReturnType<typeof session>[]): DailyContextSnapshot {
  return {
    summary: {
      date: "2026-08-25",
      timeZone: "America/Los_Angeles",
      generatedAt: "2026-08-25T05:10:00.000Z",
      totalSessions: sessions.length,
      providerCounts: {},
      sessions: sessions.map(({ nativeId: _nativeId, excerpts: _excerpts, ...item }) => item),
      warnings: [],
      methodology: "synthetic recommendation fixture",
    },
    sessions,
    prompt: "synthetic",
  };
}

function withUserFollowup(base: ReturnType<typeof session>, text: string) {
  return {
    ...base,
    excerptCount: base.excerptCount + 1,
    excerpts: [...base.excerpts, { role: "user" as const, text }],
  };
}

const ready = session("codex:ready", "Fix the checkout regression", "The failing checkout transition test is reproduced; implementation remains.");
const headerOnly = { ...session("codex:header-only", "Fix the checkout regression", ""), summary: "Conversation body unavailable.", excerptCount: 0, excerpts: [] };
const companion = session("claude:companion", "Investigate checkout regression", "Root cause found in checkout state transitions.");
const checkoutVerificationCompanion = session("codex:checkout-verification", "Verify checkout transition regression", "The checkout transition fixture defines the exact expected state.");
const completed = session("codex:done", "Polish settings UI", "완료했습니다. npm test도 모두 통과했습니다.");
const outside = session("codex:outside", "Repair another repository", "The failing test remains.", "/work/other");
const outsidePathInBrief = session("codex:outside-path", "Repair checkout integration", "Continue the repair in ../sibling-repo before running the local checkout test.");
const unknownRoot = session("codex:unknown", "Continue a local task", "Implementation remains.", null);
const needsChoice = session("codex:choice", "Choose the launch design", "Which of the two incompatible designs should we ship?", root, "user");
const decisionNotNeeded = session("codex:no-decision-needed", "Implement the decided checkout repair", "No product decision is needed; the exact checkout behavior and regression test are already specified.");
const external = session("codex:deploy", "Deploy the release", "Run the production deployment and post the announcement.");
const destructive = session("codex:destroy", "Reset the database", "Delete the production database and rebuild it.");
const broad = session("codex:broad", "Rewrite the whole application", "Architecture, UI, runtime, storage, and testing all remain.");
const researchOnly = session("claude:research", "Compare possible frameworks", "Sources collected, but no implementation decision was made.");
const negatedDeploy = session("codex:no-deploy", "Fix the local release test", "Deployment is explicitly out of scope; only the local regression remains.");
const notCompleted = session("codex:not-done", "Continue the failed migration test", "This is not completed; the local test still fails.");
const shipProduction = session("codex:ship", "Ship the hotfix", "Ship the hotfix to production after the test passes.");
const sendSlack = session("codex:slack", "Notify the team", "Send a Slack message with the result.");
const truncateData = session("codex:truncate", "Clean stale users", "Truncate the users table before rebuilding fixtures.");
const relativeRoot = session("codex:relative", "Continue an ambiguously rooted task", "The local regression remains.", "packages/app");
const partialCompletion = session("codex:partial", "Finish checkout implementation", "Fixture setup completed, but the checkout implementation remains.");
const deploymentNotNeeded = session("codex:no-release-needed", "Fix local checkout tests", "Deployment is not needed; only the local failing test remains.");
const landedAndGreen = session("codex:landed-green", "Fix the checkout regression", "The checkout change has landed and CI is green.");
const unrelatedVerificationAfterGap = session("codex:unrelated-verification", "Fix the checkout regression", "No verification method is defined for checkout. Run npm test -- billing and require exit code 0.");
const fakeCredentialFixture = session("codex:fake-key", "Add credential redaction coverage", "Use a synthetic API key fixture and verify the redacted snapshot.");
const forcePush = session("codex:force-push", "Rewrite remote history", "Force-push the repaired branch after tests pass.");
const mergePullRequest = session("codex:merge-pr", "Merge release pull request", "Merge the pull request after the local check.");
const uploadAppStore = session("codex:app-store", "Upload the release", "Upload the signed build to App Store Connect.");
const createGithubRelease = session("codex:github-release", "Create the release", "Create a GitHub release and attach the generated archive.");
const deleteRemoteBranch = session("codex:delete-remote", "Clean up the remote branch", "Delete the remote release branch after the local checks pass.");
const discardWorktree = session("codex:discard-worktree", "Restore a clean checkout", "Run git checkout -- . before rebuilding the fixture.");
const findDelete = session("codex:find-delete", "Remove generated files", "Run find . -name '*.generated' -delete before the build.");
const userConfirmedDone = session("codex:user-confirmed-done", "Check the repaired settings flow", "I verified the repaired flow and all tests pass; no more work is needed.", root, "user");
const terraformApply = session("codex:terraform-apply", "Apply the cloud repair", "Run terraform apply against the staging account after the local checks pass.");
const kubectlRestart = session("codex:kubectl-restart", "Restart the service", "Run kubectl rollout restart deployment/checkout in the production cluster.");
const customerPost = session("codex:customer-post", "Reconcile the customer", "Send an HTTP POST request to the customer API with the repaired record.");
const koreanLiveUpdate = session("codex:korean-live-update", "운영 계정 정리", "운영 DB의 고객 레코드를 갱신하고 결과를 확인한다.");
const forcedCheckout = session("codex:forced-checkout", "Discard local changes", "Run git checkout -f before applying the clean patch.");
const restorePath = session("codex:restore-path", "Restore the source file", "Run git restore src/checkout.ts before retrying the implementation.");
const unsafeLiteralFixture = session("codex:unsafe-literal", "Add command safety regression coverage", "Add a unit test whose synthetic fixture contains the literal terraform apply and git checkout -- ., and verify both commands are rejected without executing them.");
const stagingApplyTest = session("codex:staging-apply", "Test the staging infrastructure", "Test terraform apply against the staging account and confirm the resources change.");
const reproductionDoneFixNext = session("codex:repro-next", "Fix the checkout crash", "I completed the reproduction; the implementation fix is next.");
const doneExceptTests = session("codex:except-tests", "Finish the migration", "The migration is complete except for the integration tests.");
const partOneDone = session("codex:part-one", "Finish both checkout phases", "Done with part 1; part 2 still needs implementation.");
const koreanAnalysisNext = session("codex:korean-analysis-next", "체크아웃 수정 마무리", "원인 분석은 완료했고 이제 수정 코드를 구현해야 합니다.");
const completedThenThanks = withUserFollowup(session("codex:thanks", "Finish settings repair", "The settings repair is completed and all tests passed."), "Thanks, that looks good.");
const completedThenBroken = withUserFollowup(session("codex:broken-followup", "Finish settings repair", "The settings repair is completed and all tests passed."), "Actually the save flow still fails; please continue fixing it.");
const completedThenMoreWork = withUserFollowup(session("codex:more-followup", "Finish settings repair", "The settings repair is completed and all tests passed."), "Also add the missing keyboard navigation before we call this done.");
const completedThenConfirmed = withUserFollowup(session("codex:confirmed-followup", "Finish settings repair", "The settings repair is completed and all tests passed."), "Actually, it looks good after all. Thanks.");
const completedThenNoMore = withUserFollowup(session("codex:no-more-followup", "Finish settings repair", "The settings repair is completed and all tests passed."), "No need to change anything else.");
const completedThenExplained = {
  ...session("codex:explained-followup", "Finish settings repair", "The settings repair is completed and all tests passed."),
  excerptCount: 4,
  excerpts: [
    { role: "user" as const, text: "Finish settings repair" },
    { role: "assistant" as const, text: "The settings repair is completed and all tests passed." },
    { role: "user" as const, text: "What changed?" },
    { role: "assistant" as const, text: "I updated the settings state transition and its regression fixture." },
  ],
};
const markCompleteRequest = session("codex:mark-complete", "Fix the checkout regression", "Please mark the checkout regression completed.", root, "user");
const koreanMarkCompleteRequest = session("codex:korean-mark-complete", "체크아웃 회귀 수정", "체크아웃 회귀를 완료로 처리해 주세요.", root, "user");
const markedCompleteAfterVerification = session("codex:marked-complete", "Fix the checkout regression", "The checkout regression was marked completed after npm test passed.");
const koreanMarkedCompleteAfterVerification = session("codex:korean-marked-complete", "체크아웃 회귀 수정", "체크아웃 회귀를 완료 처리했고 관련 테스트도 통과했습니다.");
const incompleteThenAskedIfDone = withUserFollowup(
  session("codex:asked-if-done", "Fix the checkout repair", "The checkout implementation still remains."),
  "Is the checkout repair completed?",
);
const koreanIncompleteThenAskedIfDone = withUserFollowup(
  session("codex:korean-asked-if-done", "체크아웃 수정", "체크아웃 구현이 아직 남았습니다."),
  "체크아웃 수정이 완료됐나요?",
);
const doneAndGreen = session("codex:done-green", "Fix the search regression", "Done. The search regression test is green.");
const analysisDoneImplementationRemains = session("codex:analysis-only", "Finish the checkout repair", "Analysis is done; implementation still remains.");
const implementationDoneUnverified = session("codex:unverified-implementation", "Verify the checkout repair", "Implemented the change, but tests were not run.");
const verificationNotDefined = session("codex:verification-not-defined", "Fix the checkout regression", "The implementation remains, but no verification method is defined.");
const verificationDefinedLater = withUserFollowup(verificationNotDefined, "Run npm test -- checkout and require exit code 0 as the exact verification.");
const koreanVerificationNotDefined = session("codex:korean-verification-not-defined", "체크아웃 회귀 수정", "구현은 남았지만 검증 방법이 없습니다.");
const koreanVerificationDefinedLater = withUserFollowup(koreanVerificationNotDefined, "npm test -- checkout을 실행하고 종료 코드 0을 정확한 검증으로 사용하세요.");
const exactVerificationWithNoFailures = session("codex:exact-verification-no-failures", "Fix the checkout regression", "The implementation remains. Run npm test -- checkout; no test failures are allowed.");
const verificationWithdrawnInSameMessage = session("codex:verification-withdrawn-same-message", "Fix the checkout regression", "Run npm test -- checkout was suggested earlier, but no verification method is defined now.");
const verificationAddedInSameMessage = session("codex:verification-added-same-message", "Fix the checkout regression", "No verification method was defined earlier, but now run npm test -- checkout and require exit code 0.");
const olderVerificationGap = { ...session("codex:older-verification-gap", "Fix checkout transition regression", "The checkout transition implementation remains, but no verification method is defined."), updatedAt: "2026-08-25T04:00:00.000Z" };
const newerVerificationCommand = { ...session("codex:newer-verification-command", "Verify checkout transition regression", "Run npm test -- checkout and require exit code 0."), updatedAt: "2026-08-25T05:00:00.000Z" };
const olderVerificationCommand = { ...newerVerificationCommand, id: "codex:older-verification-command", nativeId: "older-verification-command", updatedAt: "2026-08-25T04:00:00.000Z" };
const newerVerificationGap = { ...olderVerificationGap, id: "codex:newer-verification-gap", nativeId: "newer-verification-gap", updatedAt: "2026-08-25T05:00:00.000Z" };
const sameTimestampVerificationGap = { ...olderVerificationGap, id: "codex:same-time-verification-gap", nativeId: "same-time-verification-gap", updatedAt: "2026-08-25T05:00:00.000Z" };
const undatedVerificationGap = { ...olderVerificationGap, id: "codex:undated-verification-gap", nativeId: "undated-verification-gap", updatedAt: undefined };
const invalidTimestampVerificationCommand = { ...newerVerificationCommand, id: "codex:invalid-time-verification-command", nativeId: "invalid-time-verification-command", updatedAt: "not-a-timestamp" };
const completedWithVerificationGap = session("codex:completed-with-verification-gap", "Fix checkout regression", "The checkout fix is completed and all tests passed. No additional verification method is defined.");
const externalWithVerificationGap = session("codex:external-with-verification-gap", "Deploy checkout regression fix", "The checkout implementation remains and no verification method is defined. Deploy the release afterward.");
const verificationTbd = session("codex:verification-tbd", "Fix checkout regression", "The checkout implementation remains; verification is TBD.");
const koreanVerificationUndecided = session("codex:korean-verification-undecided", "체크아웃 회귀 수정", "체크아웃 구현은 남았고 검증 방법은 미정입니다.");
const verificationTbdThenCommand = withUserFollowup(verificationTbd, "Run npm test -- checkout and require exit code 0.");
const resolvedVerificationPriority = {
  ...withUserFollowup(verificationNotDefined, "Tonight's highest priority is checkout. Run npm test -- checkout and require exit code 0."),
  id: "codex:resolved-verification-priority",
  nativeId: "resolved-verification-priority",
};
const unresolvedVerificationPriority = {
  ...withUserFollowup(verificationNotDefined, "Tonight's highest priority is checkout."),
  id: "codex:unresolved-verification-priority",
  nativeId: "unresolved-verification-priority",
};
const conditionalCompletion = session("codex:conditional-completion", "Fix the checkout regression", "This will be completed once npm test passes. The checkout test is still failing.");
const reverseConditionalCompletion = session("codex:reverse-conditional-completion", "Fix the checkout regression", "Once npm test passes, this will be completed. The checkout test is still failing.");
const koreanDone = session("codex:korean-done", "검색 회귀 수정", "다 했고 검색 회귀 테스트도 녹색입니다.");
const koreanPartial = session("codex:korean-partial", "검색 회귀 마무리", "수정은 끝났지만 통합 테스트가 남았습니다.");
const unrelatedCompletion = session("codex:unrelated-completion", "Fix the checkout regression", "The settings UI is completed and all settings tests passed.");
const genericEnglishCompletion = session("codex:generic-english-completion", "Fix the checkout regression", "Everything is done and all checks pass.");
const genericKoreanCompletion = session("codex:generic-korean-completion", "체크아웃 수정", "다 끝냈습니다. 테스트도 모두 통과했습니다.");
const bridgeCheckoutPricing = session("codex:bridge-checkout-pricing", "Checkout pricing regression", "The checkout pricing snapshot still fails.");
const bridgePricingBilling = session("claude:bridge-pricing-billing", "Pricing billing regression", "The pricing billing mapper still fails.");
const bridgeBillingInvoice = session("codex:bridge-billing-invoice", "Billing invoice regression", "The billing invoice total still fails.");
const redactedCredentialSession = session("codex:redacted-credential", "Repair the authenticated checkout", "Use [민감값 숨김] to reconcile the live account.");
const unrelatedDocumentation = session("claude:unrelated-docs", "Write the pricing documentation", "The pricing terminology still needs synthesis.");
const unrelatedCheckoutError = session("codex:checkout-error", "Repair checkout state error", "The local screen error remains in the checkout flow.");
const unrelatedBillingError = session("claude:billing-error", "Repair billing state error", "The local screen error remains in the billing flow.");
const checkoutRounding = session("codex:checkout-rounding", "Fix checkout tax rounding", "The checkout tax total rounds down by one cent and the money fixture fails.");
const checkoutAccessibility = session("claude:checkout-a11y", "Fix checkout keyboard accessibility", "The checkout focus order skips the submit button and the accessibility check fails.");
const casualConversation = session("claude:lunch", "Discuss lunch ideas", "Sushi could be nice, but there is no work item here.");
const billingFix = session("claude:billing-fix", "Fix the billing regression", "The billing regression still fails locally.");
const secondPriorityBilling = session("claude:billing-second", "Fix the billing regression", "This is my second priority for tonight and the billing regression still fails locally.");
const priorityCheckout = withUserFollowup(
  session("codex:priority-checkout", "Fix the checkout priority regression", "The local checkout test still fails."),
  "This checkout regression is my highest priority tonight.",
);
const assistantPriorityBilling = session("claude:assistant-priority", "Fix the billing regression", "This billing regression should be the highest priority tonight and the local test still fails.");
const completedPriorityCheckout = session("codex:priority-checkout-done", "Fix the checkout priority regression", "This was my highest priority tonight. The checkout repair is completed and all tests passed.");
const unsafePriorityRelease = session("codex:priority-release", "Ship the priority release", "This release is my highest priority tonight; deploy it to production after the local check.");
const koreanCheckoutFailure = session("codex:korean-checkout", "체크아웃 상태 전환 오류 수정", "체크아웃에서 재현되는 로컬 실패의 구현이 남아 있다.");
const koreanCheckoutCause = session("claude:korean-checkout-cause", "체크아웃 회귀 원인 조사", "체크아웃 상태 전환에서 원인을 찾았고 수정이 남았다.");

function proposal(overrides: Partial<OvernightProposal> = {}): OvernightProposal {
  return {
    disposition: "recommend",
    requestKind: "discover",
    title: "Fix checkout regression with a bounded patch",
    rationale: "The failure is reproduced, local, bounded, and useful to continue unattended.",
    reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage"],
    sessionIds: [ready.id],
    excludedSessions: [],
    outcome: "The checkout transition regression is fixed without changing unrelated settings behavior.",
    verification: "Run npm test -- checkout and npm run check; both commands must exit 0.",
    executor: "codex",
    executorReason: "The task is a repository patch with executable regression tests.",
    risks: ["The existing dirty worktree must be preserved."],
    questions: [],
    durationMinutes: 420,
    ...overrides,
  };
}

const executors = { codex: true, claude: true };

describe("Overnight recommendation contract — expectations fixed before implementation", () => {
  const scenarios: Array<{
    name: string;
    sessions: ReturnType<typeof session>[];
    input: Partial<OvernightProposal>;
    expected: "recommend" | "clarify" | "no_run";
    reason?: string;
    available?: typeof executors;
  }> = [
    { name: "recommends one bounded unfinished in-root task", sessions: [ready], input: {}, expected: "recommend" },
    { name: "does not ignore a different runnable task marked as tonight's highest priority", sessions: [billingFix, priorityCheckout], input: { title: "Fix the billing regression", rationale: "The bounded billing failure benefits from unattended test iteration.", sessionIds: [billingFix.id], outcome: "The billing regression test passes without unrelated checkout changes.", verification: "Run npm test -- billing and require exit code 0." }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "does not ignore a highest-priority task whose earlier verification gap was later resolved", sessions: [billingFix, resolvedVerificationPriority], input: { title: "Fix the billing regression", rationale: "The bounded billing failure benefits from unattended test iteration.", sessionIds: [billingFix.id], outcome: "The billing regression test passes without unrelated checkout changes.", verification: "Run npm test -- billing and require exit code 0." }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "does not let a highest-priority task with unresolved verification block other runnable work", sessions: [billingFix, unresolvedVerificationPriority], input: { title: "Fix the billing regression", rationale: "The bounded billing failure benefits from unattended test iteration.", sessionIds: [billingFix.id], outcome: "The billing regression test passes without unrelated checkout changes.", verification: "Run npm test -- billing and require exit code 0." }, expected: "recommend" },
    { name: "allows the explicitly prioritized runnable task to be selected", sessions: [billingFix, priorityCheckout], input: { title: "Fix the checkout priority regression", sessionIds: [priorityCheckout.id] }, expected: "recommend" },
    { name: "does not let an omitted second priority veto the selected highest priority", sessions: [secondPriorityBilling, priorityCheckout], input: { title: "Fix the checkout priority regression", sessionIds: [priorityCheckout.id] }, expected: "recommend" },
    { name: "does not treat an assistant-authored priority claim as the user's explicit priority", sessions: [assistantPriorityBilling, ready], input: { sessionIds: [ready.id] }, expected: "recommend" },
    { name: "does not force a completed priority session over runnable work", sessions: [billingFix, completedPriorityCheckout], input: { title: "Fix the billing regression", rationale: "The bounded billing failure benefits from unattended test iteration.", sessionIds: [billingFix.id], outcome: "The billing regression test passes without unrelated checkout changes.", verification: "Run npm test -- billing and require exit code 0." }, expected: "recommend" },
    { name: "does not force an unsafe priority session over runnable work", sessions: [billingFix, unsafePriorityRelease], input: { title: "Fix the billing regression", rationale: "The bounded billing failure benefits from unattended test iteration.", sessionIds: [billingFix.id], outcome: "The billing regression test passes without unrelated release changes.", verification: "Run npm test -- billing and require exit code 0." }, expected: "recommend" },
    { name: "does not recommend from a session header when the conversation body is unavailable", sessions: [headerOnly], input: { sessionIds: [headerOnly.id] }, expected: "clarify", reason: "insufficient_context" },
    { name: "groups two sessions that describe the same unfinished task", sessions: [ready, companion], input: { sessionIds: [ready.id, companion.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "recommend" },
    { name: "groups three sessions that all contain the same concrete checkout task", sessions: [ready, companion, checkoutVerificationCompanion], input: { sessionIds: [ready.id, companion.id, checkoutVerificationCompanion.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "recommend" },
    { name: "does not bundle multiple sessions without same-task evidence", sessions: [ready, companion], input: { sessionIds: [ready.id, companion.id] }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "does not trust a same-task label when the selected sessions share no task evidence", sessions: [ready, unrelatedDocumentation], input: { sessionIds: [ready.id, unrelatedDocumentation.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "does not merge unrelated tasks merely because both mention generic errors and state", sessions: [unrelatedCheckoutError, unrelatedBillingError], input: { sessionIds: [unrelatedCheckoutError.id, unrelatedBillingError.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "does not attach an unrelated casual session to a fabricated task", sessions: [casualConversation], input: { sessionIds: [casualConversation.id] }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "does not treat the generic verb fix as single-session task evidence", sessions: [billingFix], input: { sessionIds: [billingFix.id] }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "does not merge checkout and billing merely because both say fix", sessions: [ready, billingFix], input: { sessionIds: [ready.id, billingFix.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "does not merge different checkout tasks merely because they share one subsystem word", sessions: [checkoutRounding, checkoutAccessibility], input: { title: "Fix checkout rounding and accessibility", rationale: "The two checkout failures are presented as one bounded unattended patch.", outcome: "The checkout tax and keyboard tests pass without unrelated changes.", verification: "Run npm test -- checkout and require exit code 0.", executorReason: "This is a repository implementation patch with executable regression tests.", sessionIds: [checkoutRounding.id, checkoutAccessibility.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "does not merge a chain of different tasks through bridge vocabulary", sessions: [bridgeCheckoutPricing, bridgePricingBilling, bridgeBillingInvoice], input: { title: "Fix checkout pricing billing invoice regressions", rationale: "The three local failures are presented as one bounded unattended patch.", outcome: "The checkout pricing and billing invoice regression tests pass without unrelated changes.", verification: "Run npm test -- checkout-billing and require exit code 0.", executorReason: "This is a repository implementation patch with executable regression tests.", sessionIds: [bridgeCheckoutPricing.id, bridgePricingBilling.id, bridgeBillingInvoice.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "groups Korean sessions when both contain the same concrete checkout task token", sessions: [koreanCheckoutFailure, koreanCheckoutCause], input: { title: "체크아웃 상태 전환 회귀 수정", outcome: "체크아웃 상태 전환 회귀가 수정되고 관련 테스트가 통과함", sessionIds: [koreanCheckoutFailure.id, koreanCheckoutCause.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "recommend" },
    { name: "does not recommend a completed session", sessions: [completed], input: { sessionIds: [completed.id] }, expected: "no_run", reason: "completed" },
    { name: "recognizes landed work with green CI as completed", sessions: [landedAndGreen], input: { sessionIds: [landedAndGreen.id] }, expected: "no_run", reason: "completed" },
    { name: "does not re-recommend proactive work whose workspace evidence says the same audit is complete", sessions: [], input: { origin: "proactive", sessionIds: [], title: "Audit checkout transition coverage", rationale: "A bounded unattended checkout audit would normally be useful.", evidence: [{ source: "workspace", summary: "The checkout transition coverage audit is completed and its report checks passed." }], outcome: "The checkout transition coverage audit report contains every transition.", verification: "The checkout audit report contains pending, paid, and failed transitions." }, expected: "no_run", reason: "completed" },
    { name: "keeps a distinct proactive audit eligible after the underlying repair completed", sessions: [], input: { origin: "proactive", sessionIds: [], title: "Audit checkout transition coverage", rationale: "A bounded unattended checkout audit can find missing cases.", evidence: [{ source: "workspace", summary: "The checkout transition repair is completed and all regression checks passed." }], outcome: "The checkout transition coverage audit report lists every missing case.", verification: "The checkout audit report contains pending, paid, and failed transitions." }, expected: "recommend" },
    { name: "does not smuggle a completed session into a mixed group", sessions: [ready, completed], input: { sessionIds: [ready.id, completed.id] }, expected: "clarify", reason: "completed" },
    { name: "rejects work rooted in another repository", sessions: [outside], input: { sessionIds: [outside.id] }, expected: "no_run", reason: "outside_root" },
    { name: "rejects a mixed-root context bundle", sessions: [ready, outside], input: { sessionIds: [ready.id, outside.id] }, expected: "no_run", reason: "outside_root" },
    { name: "asks before trusting a session with unknown workspace", sessions: [unknownRoot], input: { sessionIds: [unknownRoot.id] }, expected: "clarify", reason: "unknown_root" },
    { name: "asks before resolving a relative session workspace against the app process", sessions: [relativeRoot], input: { sessionIds: [relativeRoot.id] }, expected: "clarify", reason: "unknown_root" },
    { name: "rejects an explicit goal whose target path is outside the fixed root", sessions: [], input: { requestKind: "goal", sessionIds: [], outcome: "Repair /work/other/src/checkout.ts without changing any in-root files." }, expected: "no_run", reason: "outside_root" },
    { name: "rejects an explicit goal targeting a tilde-expanded path", sessions: [], input: { requestKind: "goal", sessionIds: [], outcome: "Repair ~/other-project/src/checkout.ts and verify the resulting file." }, expected: "no_run", reason: "outside_root" },
    { name: "rejects an explicit goal targeting a HOME-expanded path", sessions: [], input: { requestKind: "goal", sessionIds: [], outcome: "Repair $HOME/other-project/src/checkout.ts and verify the resulting file." }, expected: "no_run", reason: "outside_root" },
    { name: "rejects changing to the parent directory with a bare dot-dot path", sessions: [ready], input: { outcome: "Run cd .. before repairing the checkout fixture." }, expected: "no_run", reason: "outside_root" },
    { name: "rejects a PWD-expanded parent path", sessions: [ready], input: { verification: "Run npm test after cd $PWD/../other and require exit code 0." }, expected: "no_run", reason: "outside_root" },
    { name: "rejects an outside file URL target", sessions: [ready], input: { outcome: "Write the checkout snapshot to file:///tmp/checkout-report.txt." }, expected: "no_run", reason: "outside_root" },
    { name: "allows an in-root file URL target", sessions: [ready], input: { outcome: "Write the checkout snapshot to file:///work/app/fixtures/checkout-report.txt." }, expected: "recommend" },
    { name: "rejects a verification command that escapes the fixed root", sessions: [ready], input: { verification: "Run npm test in /work/other and require exit code 0." }, expected: "no_run", reason: "outside_root" },
    { name: "rejects an outside-root instruction hidden in the executor reason", sessions: [ready], input: { executorReason: "Codex should inspect /work/other before applying this bounded in-root patch." }, expected: "no_run", reason: "outside_root" },
    { name: "asks for a missing product decision", sessions: [needsChoice], input: { disposition: "clarify", sessionIds: [needsChoice.id], reasonCodes: ["needs_user_decision"], questions: ["Which design should be implemented?"] }, expected: "clarify" },
    { name: "detects a user-approval blocker even when the model omits its reason code", sessions: [ready], input: { outcome: "Wait for the user to approve whether onboarding or Settings should change." }, expected: "clarify", reason: "needs_user_decision" },
    { name: "detects a Korean A-or-B user decision blocker", sessions: [ready], input: { outcome: "사용자가 A와 B 중 하나를 골라야 구현 범위를 확정할 수 있다." }, expected: "clarify", reason: "needs_user_decision" },
    { name: "does not create approval authority while a recommendation still asks a question", sessions: [ready], input: { questions: ["Should the worker preserve the legacy checkout behavior?"] }, expected: "clarify", reason: "needs_user_decision" },
    { name: "does not invent a missing decision when the brief says no product decision is needed", sessions: [decisionNotNeeded], input: { title: "Implement the decided checkout repair", outcome: "The specified checkout regression test passes.", verification: "Run npm test -- checkout and require exit code 0.", sessionIds: [decisionNotNeeded.id] }, expected: "recommend" },
    { name: "normalizes a mistaken recommendation that still needs a user decision", sessions: [needsChoice], input: { sessionIds: [needsChoice.id], reasonCodes: ["needs_user_decision", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "clarify", reason: "needs_user_decision" },
    { name: "does not ask a fabricated product question when the selected brief contains no unresolved decision", sessions: [ready], input: { disposition: "clarify", sessionIds: [ready.id], reasonCodes: ["needs_user_decision"], questions: ["Which design should be chosen?"] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "detects an unresolved either-or decision even when the model omits its blocker code", sessions: [needsChoice], input: { sessionIds: [needsChoice.id] }, expected: "clarify", reason: "needs_user_decision" },
    { name: "refuses deployment work", sessions: [external], input: { sessionIds: [external.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "refuses destructive work", sessions: [destructive], input: { sessionIds: [destructive.id] }, expected: "no_run", reason: "destructive_action" },
    { name: "asks to bound an application-wide rewrite", sessions: [broad], input: { disposition: "clarify", sessionIds: [broad.id], reasonCodes: ["too_broad"], questions: ["Which user-visible slice is the priority?"] }, expected: "clarify" },
    { name: "does not recommend unbounded work even when the model says recommend", sessions: [broad], input: { sessionIds: [broad.id], reasonCodes: ["unfinished_work", "too_broad", "clear_verification", "overnight_leverage"] }, expected: "clarify", reason: "too_broad" },
    { name: "does not claim bounded selected work is too broad without supporting scope evidence", sessions: [ready], input: { disposition: "clarify", sessionIds: [ready.id], reasonCodes: ["too_broad"], questions: ["Which part should be kept?"] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "detects an application-wide rewrite even when the model omits its blocker code", sessions: [broad], input: { sessionIds: [broad.id] }, expected: "clarify", reason: "too_broad" },
    { name: "asks to bound a refactor of every repository module", sessions: [ready], input: { outcome: "Refactor every module in the repository and keep all behavior unchanged." }, expected: "clarify", reason: "too_broad" },
    { name: "asks to bound fixing every failing test", sessions: [ready], input: { outcome: "Fix every failing test across the repository." }, expected: "clarify", reason: "too_broad" },
    { name: "asks to bound migrating all packages in a monorepo", sessions: [ready], input: { outcome: "Migrate all packages in the monorepo to the new architecture." }, expected: "clarify", reason: "too_broad" },
    { name: "does not confuse one shared package used by every module with an every-module migration", sessions: [ready], input: { outcome: "Migrate one checkout package used by every module and keep its public API unchanged.", verification: "Run npm test -- checkout and require exit code 0." }, expected: "recommend" },
    { name: "asks for an implementation decision after open-ended research", sessions: [researchOnly], input: { disposition: "clarify", sessionIds: [researchOnly.id], reasonCodes: ["needs_user_decision"], questions: ["What decision should this research enable?"] }, expected: "clarify" },
    { name: "does not present an unactionable clarification with no actual question", sessions: [researchOnly], input: { disposition: "clarify", sessionIds: [researchOnly.id], reasonCodes: ["needs_user_decision"], questions: [] }, expected: "no_run", reason: "insufficient_context" },
    { name: "accepts no-run as a successful answer", sessions: [completed], input: { disposition: "no_run", sessionIds: [], reasonCodes: ["completed"], rationale: "All observed work is already complete." }, expected: "no_run" },
    { name: "does not call every unselected runnable unfinished session irrelevant", sessions: [ready], input: { disposition: "no_run", sessionIds: [], reasonCodes: ["not_relevant"], rationale: "None of today's sessions are relevant." }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "accepts an evidence-backed irrelevant no-run for casual conversation", sessions: [casualConversation], input: { disposition: "no_run", sessionIds: [], reasonCodes: ["not_relevant"], rationale: "The observed session is casual conversation with no work item." }, expected: "no_run", reason: "not_relevant" },
    { name: "does not claim context is missing when full unselected briefs exist", sessions: [ready], input: { disposition: "no_run", sessionIds: [], reasonCodes: ["insufficient_context"], rationale: "No session context is available." }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "does not retain contradictory questions on a no-run decision", sessions: [completed], input: { disposition: "no_run", sessionIds: [], reasonCodes: ["completed"], questions: ["Should this run anyway?"] }, expected: "no_run" },
    { name: "does not expose an ungrounded no-run explanation with no exclusion reason", sessions: [ready], input: { disposition: "no_run", reasonCodes: ["unfinished_work"], rationale: "Trust me, there is no reason to run this tonight." }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "does not invent a recommendation when there are no sessions", sessions: [], input: { sessionIds: [] }, expected: "no_run", reason: "insufficient_context" },
    { name: "rejects an invented session id", sessions: [ready], input: { sessionIds: ["codex:invented"] }, expected: "no_run", reason: "unknown_session" },
    { name: "does not call available context missing when a discovery recommendation selects nothing", sessions: [ready], input: { sessionIds: [] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "allows an explicit user goal without session context", sessions: [], input: { requestKind: "goal", sessionIds: [] }, expected: "recommend" },
    { name: "requires a concrete outcome", sessions: [ready], input: { outcome: "Make it better" }, expected: "clarify", reason: "vague_outcome" },
    { name: "accepts a concise observable outcome", sessions: [ready], input: { outcome: "Checkout test passes." }, expected: "recommend" },
    { name: "rejects a longer but subjective improvement outcome", sessions: [ready], input: { outcome: "Make the application much better overall." }, expected: "clarify", reason: "vague_outcome" },
    { name: "rejects a pronoun-only completion outcome", sessions: [ready], input: { outcome: "Fix it completely." }, expected: "clarify", reason: "vague_outcome" },
    { name: "requires executable or observable verification", sessions: [ready], input: { verification: "Check that it works" }, expected: "clarify", reason: "unverifiable" },
    { name: "rejects an observable check unrelated to the planned task", sessions: [ready], input: { verification: "The output file must exist." }, expected: "clarify", reason: "unverifiable" },
    { name: "accepts an observable check tied to the planned task", sessions: [ready], input: { verification: "The checkout snapshot must contain the repaired transition." }, expected: "recommend" },
    { name: "accepts one exact short verification command", sessions: [ready], input: { verification: "npm test" }, expected: "recommend" },
    { name: "rejects verification whose failure is masked by shell OR", sessions: [ready], input: { verification: "Run npm test -- checkout || true and report success." }, expected: "clarify", reason: "unverifiable" },
    { name: "rejects verification commands joined by a non-fail-fast semicolon", sessions: [ready], input: { verification: "Run npm test -- checkout; npm run check and report success." }, expected: "clarify", reason: "unverifiable" },
    { name: "rejects verification whose command is backgrounded", sessions: [ready], input: { verification: "Run npm test -- checkout & true and require exit 0." }, expected: "clarify", reason: "unverifiable" },
    { name: "rejects verification whose exit status is replaced by a pipe", sessions: [ready], input: { verification: "Run npm test -- checkout | tee checkout.log and require exit 0." }, expected: "clarify", reason: "unverifiable" },
    { name: "rejects an optional verification command", sessions: [ready], input: { verification: "If possible, run npm test -- checkout." }, expected: "clarify", reason: "unverifiable" },
    { name: "rejects verification whose failures are declared acceptable", sessions: [ready], input: { verification: "Run npm test -- checkout, but failures are acceptable." }, expected: "clarify", reason: "unverifiable" },
    { name: "rejects a Korean verification command that only runs if time permits", sessions: [ready], input: { verification: "시간이 되면 npm test -- checkout을 실행한다." }, expected: "clarify", reason: "unverifiable" },
    { name: "rejects a Korean verification contract that ignores failures", sessions: [ready], input: { verification: "npm test -- checkout을 실행하되 실패는 무시한다." }, expected: "clarify", reason: "unverifiable" },
    { name: "accepts verification that explicitly forbids ignoring failures", sessions: [ready], input: { verification: "Run npm test -- checkout; do not ignore failures." }, expected: "recommend" },
    { name: "accepts Korean verification that explicitly forbids ignoring failures", sessions: [ready], input: { verification: "npm test -- checkout을 실행하고 실패를 무시하지 말아야 한다." }, expected: "recommend" },
    { name: "allows fail-fast verification commands joined by shell AND", sessions: [ready], input: { verification: "Run npm test -- checkout && npm run check; both must exit 0." }, expected: "recommend" },
    { name: "rejects a screen-check phrase with no observable expectation", sessions: [ready], input: { verification: "Check the screen" }, expected: "clarify", reason: "unverifiable" },
    { name: "rejects generic result verification with no expected evidence", sessions: [ready], input: { verification: "Verify that the result is correct" }, expected: "clarify", reason: "unverifiable" },
    { name: "rejects manual output inspection with no success predicate", sessions: [ready], input: { verification: "Inspect the output manually after the worker stops." }, expected: "clarify", reason: "unverifiable" },
    { name: "accepts an observable screenshot expectation", sessions: [ready], input: { verification: "The checkout screenshot must show the repaired transition without a spinner." }, expected: "recommend" },
    { name: "accepts an observable file-content expectation", sessions: [ready], input: { verification: "The checkout snapshot file must contain status=ready." }, expected: "recommend" },
    { name: "accepts a receipt-trackable Node verification command", sessions: [ready], input: { verification: "Run node scripts/verify-checkout.mjs and confirm output contains PASS." }, expected: "recommend" },
    { name: "does not approve an untrackable command by treating its output predicate as observable proof", sessions: [ready], input: { verification: "Run custom-verifier and confirm output contains PASS." }, expected: "clarify", reason: "unverifiable" },
    { name: "requires an executor selection explanation", sessions: [ready], input: { executorReason: "" }, expected: "clarify", reason: "executor_unexplained" },
    { name: "rejects a generic executor explanation with no task-fit evidence", sessions: [ready], input: { executorReason: "This executor is available and can do the work tonight." }, expected: "clarify", reason: "executor_unexplained" },
    { name: "uses Claude when explicitly selected and available", sessions: [ready], input: { executor: "claude", executorReason: "The bounded task is documentation synthesis with file checks." }, expected: "recommend" },
    { name: "asks before silently changing an unavailable explicit executor", sessions: [ready], input: { executor: "claude" }, expected: "clarify", reason: "executor_unavailable", available: { codex: true, claude: false } },
    { name: "auto chooses the only available executor", sessions: [ready], input: { executor: "auto", executorReason: "Either supported local worker can execute the exact contract." }, expected: "recommend", available: { codex: false, claude: true } },
    { name: "auto prefers Claude for a bounded documentation synthesis", sessions: [], input: { requestKind: "goal", sessionIds: [], title: "Synthesize the architecture ADR", rationale: "This bounded documentation synthesis benefits from uninterrupted unattended work and has exact file-content checks.", outcome: "The architecture ADR contains the approved decisions and residual risks.", verification: "The ADR file must contain Decision and Risks sections.", executor: "auto", executorReason: "This is bounded documentation synthesis and review work." }, expected: "recommend" },
    { name: "auto prefers Codex for a repository implementation and test loop", sessions: [ready], input: { executor: "auto", executorReason: "This repository patch has executable regression tests." }, expected: "recommend" },
    { name: "does not show a Codex rationale when auto actually selects Claude", sessions: [], input: { requestKind: "goal", sessionIds: [], title: "Synthesize the architecture ADR", rationale: "This bounded documentation synthesis benefits from uninterrupted unattended work and has exact file-content checks.", outcome: "The architecture ADR contains the approved decisions and residual risks.", verification: "The ADR file must contain Decision and Risks sections.", executor: "auto", executorReason: "Codex is the best executor for this bounded documentation synthesis." }, expected: "clarify", reason: "executor_unexplained" },
    { name: "does not show a Claude rationale when auto actually selects Codex", sessions: [ready], input: { executor: "auto", executorReason: "Claude is the best executor for this repository patch with executable regression tests." }, expected: "clarify", reason: "executor_unexplained" },
    { name: "allows an auto rationale that truthfully says both executors fit", sessions: [ready], input: { executor: "auto", executorReason: "Both Codex and Claude can execute this repository patch and its exact regression tests." }, expected: "recommend" },
    { name: "allows an explicit Claude rationale that compares both executors", sessions: [ready], input: { executor: "claude", executorReason: "Claude fits this bounded documentation review, while Codex could also inspect the repository." }, expected: "recommend" },
    { name: "refuses when no executor is available", sessions: [ready], input: { executor: "auto" }, expected: "no_run", reason: "no_executor", available: { codex: false, claude: false } },
    { name: "requires at least one positive overnight-worthiness reason", sessions: [ready], input: { reasonCodes: [] }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "requires an explicit unattended-benefit reason instead of unfinished status alone", sessions: [ready], input: { reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification"] }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "does not trust an unattended-benefit code without a substantive leverage explanation", sessions: [ready], input: { rationale: "The local failure is bounded and exactly scoped." }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "derives a usable title from a concrete outcome instead of throwing", sessions: [ready], input: { title: "" }, expected: "recommend" },
    { name: "requires a substantive evidence-grounded recommendation rationale", sessions: [ready], input: { rationale: "Looks useful." }, expected: "clarify", reason: "insufficient_reasoning" },
    { name: "rejects an unsafe outcome even when session text looks safe", sessions: [ready], input: { outcome: "Fix the test, deploy it, and notify the customer." }, expected: "no_run", reason: "external_side_effect" },
    { name: "rejects an unsafe instruction hidden in the recommendation rationale", sessions: [ready], input: { rationale: "The local patch is bounded; deploy it to production when tests pass." }, expected: "no_run", reason: "external_side_effect" },
    { name: "rejects work that requires credentials unavailable to an unattended worker", sessions: [ready], input: { outcome: "Use the production API key to repair the live checkout account." }, expected: "no_run", reason: "credentials_required" },
    { name: "refuses but does not repeat an unsupported external-side-effect claim", sessions: [ready], input: { reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "external_side_effect"] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "refuses but does not repeat an unsupported model completion claim", sessions: [ready], input: { reasonCodes: ["completed", "bounded_scope", "clear_verification"] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "refuses but does not repeat an unsupported unverifiable claim", sessions: [ready], input: { reasonCodes: ["unfinished_work", "bounded_scope", "unverifiable"] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "refuses but does not repeat an unsupported insufficient-context claim for an explicit goal", sessions: [], input: { requestKind: "goal", sessionIds: [], reasonCodes: ["explicit_priority", "insufficient_context"] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "refuses but does not repeat an unsupported unrelated-work claim", sessions: [ready], input: { reasonCodes: ["unfinished_work", "bounded_scope", "not_relevant"] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "refuses but does not repeat an unsupported outside-root claim", sessions: [ready], input: { reasonCodes: ["unfinished_work", "bounded_scope", "outside_root"] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "refuses but does not repeat an unsupported unknown-root claim for a root-fixed explicit goal", sessions: [], input: { requestKind: "goal", sessionIds: [], reasonCodes: ["explicit_priority", "unknown_root"] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "does not claim an unknown root when every selected workspace is known", sessions: [ready], input: { disposition: "clarify", sessionIds: [ready.id], reasonCodes: ["unknown_root"], questions: ["Where is the workspace?"] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "refuses but does not repeat an unsupported vague-outcome claim", sessions: [ready], input: { reasonCodes: ["unfinished_work", "bounded_scope", "vague_outcome"] }, expected: "no_run", reason: "insufficient_reasoning" },
    { name: "does not mistake partial setup completion for task completion", sessions: [partialCompletion], input: { sessionIds: [partialCompletion.id] }, expected: "recommend" },
    { name: "requires a substantive executor-fit explanation", sessions: [ready], input: { executorReason: "It is better." }, expected: "clarify", reason: "executor_unexplained" },
    { name: "does not reject a task because deployment is explicitly unnecessary", sessions: [deploymentNotNeeded], input: { sessionIds: [deploymentNotNeeded.id] }, expected: "recommend" },
    { name: "does not reject a bounded task because a whole-app rewrite is explicitly out of scope", sessions: [ready], input: { rationale: "This bounded checkout fix benefits from unattended test iteration; do not rewrite the whole application." }, expected: "recommend" },
    { name: "allows synthetic credential fixtures that require no real secret", sessions: [fakeCredentialFixture], input: { sessionIds: [fakeCredentialFixture.id], title: "Add credential redaction coverage", rationale: "The local synthetic credential fixture is bounded, requires no real secret, and benefits from unattended test iteration.", outcome: "The credential redaction snapshot contains only the hidden-value marker.", verification: "The credential redaction snapshot must contain the hidden-value marker.", executorReason: "This is a bounded repository test and fixture patch with exact snapshot verification." }, expected: "recommend" },
    { name: "does not let an unrelated synthetic fixture phrase excuse a production credential", sessions: [ready], input: { outcome: "Use the production API key to repair the live account and add a synthetic response fixture." }, expected: "no_run", reason: "credentials_required" },
    { name: "recognizes an OAuth token requirement as a credential dependency", sessions: [ready], input: { outcome: "Use the production OAuth token to reconcile live checkout records." }, expected: "no_run", reason: "credentials_required" },
    { name: "recognizes a named token environment variable as a credential dependency", sessions: [ready], input: { outcome: "Use GITHUB_TOKEN to inspect the private checkout repository." }, expected: "no_run", reason: "credentials_required" },
    { name: "recognizes a cloud profile environment variable as a credential dependency", sessions: [ready], input: { outcome: "Load AWS_PROFILE before checking the checkout account." }, expected: "no_run", reason: "credentials_required" },
    { name: "recognizes an authenticated GitHub CLI read as a credential dependency", sessions: [ready], input: { outcome: "Run gh pr view 42 and record the title in a local checkout snapshot." }, expected: "no_run", reason: "credentials_required" },
    { name: "recognizes an authenticated cloud CLI read as a credential dependency", sessions: [ready], input: { outcome: "Run aws s3 ls and record the checkout artifact listing locally." }, expected: "no_run", reason: "credentials_required" },
    { name: "allows a credential-free CLI help probe", sessions: [ready], input: { outcome: "Run gh --help and save the checkout CLI flag list in a local fixture." }, expected: "recommend" },
    { name: "allows a non-executed synthetic authenticated-CLI parser fixture", sessions: [ready], input: { outcome: "The checkout parser test covers the synthetic literal gh pr view without executing it.", verification: "Run npm test -- checkout-parser and require exit code 0." }, expected: "recommend" },
    { name: "allows a synthetic token environment fixture with no real credential", sessions: [ready], input: { outcome: "The checkout redaction test passes with a synthetic TEST_TOKEN fixture.", verification: "Run npm test -- checkout-redaction and require exit code 0." }, expected: "recommend" },
    { name: "recognizes a double-negated credential requirement", sessions: [ready], input: { outcome: "Do not skip entering the production password before reconciling the account." }, expected: "no_run", reason: "credentials_required" },
    { name: "does not let a negated deployment hide a later external CLI mutation", sessions: [ready], input: { outcome: "Do not deploy the checkout patch, but run gh pr create --fill after tests." }, expected: "no_run", reason: "external_side_effect" },
    { name: "does not let a negated test credential hide a later production password", sessions: [ready], input: { outcome: "Do not use a test password, but enter the production password to reconcile checkout." }, expected: "no_run", reason: "credentials_required" },
    { name: "does not let a negated file deletion hide a later destructive git clean", sessions: [ready], input: { outcome: "Do not delete the fixture, but run git clean -fdx before rebuilding checkout." }, expected: "no_run", reason: "destructive_action" },
    { name: "does not let comma-then negation hide a later deployment", sessions: [ready], input: { outcome: "Do not deploy the preview, then deploy the checkout repair to production." }, expected: "no_run", reason: "external_side_effect" },
    { name: "does not let a test-key negation hide a later production key", sessions: [ready], input: { outcome: "Do not use a test key and use the production key to repair checkout." }, expected: "no_run", reason: "credentials_required" },
    { name: "does not let a fixture-removal negation hide a later rm command", sessions: [ready], input: { outcome: "Do not remove the checkout fixture and run rm -rf tmp/checkout before rebuilding it." }, expected: "no_run", reason: "destructive_action" },
    { name: "does not let a later unrelated without-clause negate deployment", sessions: [ready], input: { outcome: "Deploy the checkout preview without changing release metadata." }, expected: "no_run", reason: "external_side_effect" },
    { name: "does not let a Korean negation hide a later external mutation", sessions: [ready], input: { outcome: "체크아웃 배포는 하지 않지만 gh pr create --fill 명령은 실행한다." }, expected: "no_run", reason: "external_side_effect" },
    { name: "still rejects a named credential after the display copy is redacted", sessions: [ready], input: { verification: "Run npm test with api_key=private-example-value and require exit code 0." }, expected: "no_run", reason: "credentials_required" },
    { name: "rejects a pasted token even when the model omits credential language", sessions: [ready], input: { outcome: "Repair checkout using sk-privateexampletoken and keep unrelated behavior unchanged." }, expected: "no_run", reason: "credentials_required" },
    { name: "rejects a task whose session brief proves a credential was redacted", sessions: [redactedCredentialSession], input: { sessionIds: [redactedCredentialSession.id] }, expected: "no_run", reason: "credentials_required" },
    { name: "recognizes a double-negated deployment requirement", sessions: [ready], input: { outcome: "Do not skip deploying the checkout fix to production after the tests pass." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes a double-negated destructive requirement", sessions: [ready], input: { outcome: "Do not avoid truncating the users table before rebuilding it." }, expected: "no_run", reason: "destructive_action" },
    { name: "recognizes creating an external issue as a side effect", sessions: [ready], input: { outcome: "Fix the test and create a GitHub issue with the remaining risks." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes sharing results in a Slack channel as an external side effect", sessions: [ready], input: { outcome: "Share the checkout results in the Slack team channel." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes an authenticated browser session as a credential dependency", sessions: [ready], input: { outcome: "Use the authenticated browser session to inspect the private checkout dashboard." }, expected: "no_run", reason: "credentials_required" },
    { name: "recognizes git switch discard-changes as destructive", sessions: [ready], input: { outcome: "Run git switch --discard-changes main before rebuilding checkout." }, expected: "no_run", reason: "destructive_action" },
    { name: "asks when the owner has not picked a required option", sessions: [ready], input: { rationale: "The owner hasn't picked which checkout behavior to preserve." }, expected: "clarify", reason: "needs_user_decision" },
    { name: "asks when only a human can judge success", sessions: [ready], input: { verification: "Only a human can judge whether the checkout experience feels right." }, expected: "clarify", reason: "unverifiable" },
    { name: "asks to bound an end-to-end codebase modernization", sessions: [ready], input: { title: "Modernize the codebase end to end", outcome: "The codebase is modernized end to end.", verification: "Run npm run check and require exit code 0." }, expected: "clarify", reason: "too_broad" },
    { name: "rejects a selected-session instruction that leaves the fixed root", sessions: [outsidePathInBrief], input: { sessionIds: [outsidePathInBrief.id] }, expected: "no_run", reason: "outside_root" },
    { name: "recognizes gh pull-request creation syntax as an external side effect", sessions: [ready], input: { outcome: "Fix the test and run gh pr create --fill after verification." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes submitting a pull request as an external side effect", sessions: [ready], input: { outcome: "Submit a pull request with the verified checkout fix." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes raising a PR as an external side effect", sessions: [ready], input: { outcome: "Raise a PR with the verified checkout fix." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes Korean natural-language PR creation", sessions: [ready], input: { outcome: "검증된 체크아웃 수정으로 PR을 올린다." }, expected: "no_run", reason: "external_side_effect" },
    { name: "allows a Korean local fix when PR creation is prohibited", sessions: [ready], input: { outcome: "체크아웃 회귀만 수정하고 PR은 올리지 않는다.", verification: "npm test -- checkout" }, expected: "recommend" },
    { name: "recognizes gh issue creation syntax as an external side effect", sessions: [ready], input: { outcome: "Fix the test and run gh issue create --title checkout after verification." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes gh workflow dispatch syntax as an external side effect", sessions: [ready], input: { outcome: "Fix the test and run gh workflow run release.yml after verification." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes glab merge-request mutation syntax as an external side effect", sessions: [ready], input: { outcome: "Fix the test and run glab mr merge 42 after verification." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes releasing a build to production as a side effect", sessions: [ready], input: { outcome: "Release the verified build to production." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes Korean production promotion phrasing as a side effect", sessions: [ready], input: { outcome: "검증된 빌드를 운영 환경에 올리고 공지를 남긴다." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes invoking a webhook as an external side effect", sessions: [ready], input: { outcome: "Invoke the customer webhook after the local test passes." }, expected: "no_run", reason: "external_side_effect" },
    { name: "rejects an external curl read that the isolated executor cannot perform", sessions: [ready], input: { outcome: "Fetch the checkout schema with curl https://example.com/schema and update the local fixture." }, expected: "no_run", reason: "external_side_effect" },
    { name: "rejects an external wget download that the isolated executor cannot perform", sessions: [ready], input: { outcome: "Download the checkout schema with wget https://example.com/schema before updating the fixture." }, expected: "no_run", reason: "external_side_effect" },
    { name: "rejects a natural-language external URL retrieval without naming a CLI", sessions: [ready], input: { outcome: "Retrieve the checkout schema from https://example.com/schema before updating the fixture." }, expected: "no_run", reason: "external_side_effect" },
    { name: "rejects Korean natural-language external URL download", sessions: [ready], input: { outcome: "외부 URL에서 체크아웃 스키마를 내려받아 로컬 픽스처를 갱신한다." }, expected: "no_run", reason: "external_side_effect" },
    { name: "allows a local fixture update when external URL retrieval is prohibited", sessions: [ready], input: { outcome: "Update the checkout fixture without fetching https://example.com/schema.", verification: "Run npm test -- checkout and require exit code 0." }, expected: "recommend" },
    { name: "allows a non-executed synthetic detector fixture containing external curl syntax", sessions: [ready], input: { outcome: "The synthetic detector fixture rejects the literal curl https://example.com/schema without actually executing it.", verification: "Run npm test -- checkout-detector and require exit code 0." }, expected: "recommend" },
    { name: "recognizes git clean as destructive to an existing worktree", sessions: [ready], input: { outcome: "Run git clean -fdx before rebuilding the checkout fixture." }, expected: "no_run", reason: "destructive_action" },
    { name: "recognizes force-push as an external destructive side effect", sessions: [forcePush], input: { sessionIds: [forcePush.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes merging a pull request as an external side effect", sessions: [mergePullRequest], input: { sessionIds: [mergePullRequest.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes App Store upload as an external side effect", sessions: [uploadAppStore], input: { sessionIds: [uploadAppStore.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes creating a GitHub release as an external side effect", sessions: [createGithubRelease], input: { sessionIds: [createGithubRelease.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes deleting a remote branch as an external side effect", sessions: [deleteRemoteBranch], input: { sessionIds: [deleteRemoteBranch.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes discarding the current worktree as destructive", sessions: [discardWorktree], input: { sessionIds: [discardWorktree.id] }, expected: "no_run", reason: "destructive_action" },
    { name: "recognizes find-delete as destructive local work", sessions: [findDelete], input: { sessionIds: [findDelete.id] }, expected: "no_run", reason: "destructive_action" },
    { name: "recognizes terraform apply as an external infrastructure side effect", sessions: [terraformApply], input: { sessionIds: [terraformApply.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes kubectl rollout restart as an external cluster side effect", sessions: [kubectlRestart], input: { sessionIds: [kubectlRestart.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes an HTTP POST to a customer API as an external side effect", sessions: [customerPost], input: { sessionIds: [customerPost.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes a Korean live database update as an external side effect", sessions: [koreanLiveUpdate], input: { sessionIds: [koreanLiveUpdate.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes forced git checkout as destructive to user changes", sessions: [forcedCheckout], input: { sessionIds: [forcedCheckout.id] }, expected: "no_run", reason: "destructive_action" },
    { name: "recognizes git restore of a path as destructive to user changes", sessions: [restorePath], input: { sessionIds: [restorePath.id] }, expected: "no_run", reason: "destructive_action" },
    { name: "allows a non-executed synthetic fixture that tests unsafe command detection", sessions: [unsafeLiteralFixture], input: { sessionIds: [unsafeLiteralFixture.id] }, expected: "recommend" },
    { name: "does not confuse testing terraform apply on staging with a synthetic unit-test fixture", sessions: [stagingApplyTest], input: { sessionIds: [stagingApplyTest.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "does not mistake completed reproduction with the fix still next for task completion", sessions: [reproductionDoneFixNext], input: { sessionIds: [reproductionDoneFixNext.id] }, expected: "recommend" },
    { name: "does not mistake complete-except-for-tests wording for task completion", sessions: [doneExceptTests], input: { title: "Finish the migration integration tests", outcome: "The migration integration tests pass without unrelated changes.", verification: "Run npm test -- migration and require exit code 0.", sessionIds: [doneExceptTests.id] }, expected: "recommend" },
    { name: "does not mistake one completed part with another still needed for task completion", sessions: [partOneDone], input: { sessionIds: [partOneDone.id] }, expected: "recommend" },
    { name: "does not mistake Korean completed analysis with implementation next for task completion", sessions: [koreanAnalysisNext], input: { title: "체크아웃 수정 코드 구현", outcome: "체크아웃 수정 코드가 구현되고 관련 테스트가 통과함", sessionIds: [koreanAnalysisNext.id] }, expected: "recommend" },
    { name: "still recognizes completion after a non-actionable thank-you", sessions: [completedThenThanks], input: { sessionIds: [completedThenThanks.id] }, expected: "no_run", reason: "completed" },
    { name: "does not close work when the user reports it still broken after completion", sessions: [completedThenBroken], input: { sessionIds: [completedThenBroken.id] }, expected: "recommend" },
    { name: "does not close work when the user adds a required follow-up after completion", sessions: [completedThenMoreWork], input: { sessionIds: [completedThenMoreWork.id] }, expected: "recommend" },
    { name: "keeps completion when the user explicitly confirms the result afterward", sessions: [completedThenConfirmed], input: { sessionIds: [completedThenConfirmed.id] }, expected: "no_run", reason: "completed" },
    { name: "keeps completion when the user says no more changes are needed", sessions: [completedThenNoMore], input: { sessionIds: [completedThenNoMore.id] }, expected: "no_run", reason: "completed" },
    { name: "keeps completion after a later explanatory answer with no new work", sessions: [completedThenExplained], input: { sessionIds: [completedThenExplained.id] }, expected: "no_run", reason: "completed" },
    { name: "does not treat a final English completion question as user confirmation", sessions: [incompleteThenAskedIfDone], input: { sessionIds: [incompleteThenAskedIfDone.id] }, expected: "recommend" },
    { name: "does not treat a final Korean completion question as user confirmation", sessions: [koreanIncompleteThenAskedIfDone], input: { title: "체크아웃 수정 마무리", outcome: "체크아웃 수정이 끝나고 관련 테스트가 통과함", sessionIds: [koreanIncompleteThenAskedIfDone.id] }, expected: "recommend" },
    { name: "accepts the user's own explicit verified-done status as completion evidence", sessions: [userConfirmedDone], input: { sessionIds: [userConfirmedDone.id] }, expected: "no_run", reason: "completed" },
    { name: "recognizes a concise done-and-green assistant handoff as completed", sessions: [doneAndGreen], input: { sessionIds: [doneAndGreen.id] }, expected: "no_run", reason: "completed" },
    { name: "does not confuse completed analysis with completed implementation", sessions: [analysisDoneImplementationRemains], input: { sessionIds: [analysisDoneImplementationRemains.id] }, expected: "recommend" },
    { name: "keeps an implemented but unverified change eligible for verification", sessions: [implementationDoneUnverified], input: { sessionIds: [implementationDoneUnverified.id] }, expected: "recommend" },
    { name: "does not invent a verification command after the latest session state says none is defined", sessions: [verificationNotDefined], input: { sessionIds: [verificationNotDefined.id] }, expected: "clarify", reason: "unverifiable" },
    { name: "does not let an unrelated test command resolve a checkout verification gap", sessions: [unrelatedVerificationAfterGap], input: { sessionIds: [unrelatedVerificationAfterGap.id] }, expected: "clarify", reason: "unverifiable" },
    { name: "allows a later exact verification command to resolve an earlier verification gap", sessions: [verificationDefinedLater], input: { sessionIds: [verificationDefinedLater.id] }, expected: "recommend" },
    { name: "does not invent a verification command after Korean context says none is defined", sessions: [koreanVerificationNotDefined], input: { title: "체크아웃 회귀 수정", outcome: "체크아웃 회귀가 수정되고 관련 테스트가 통과함", sessionIds: [koreanVerificationNotDefined.id] }, expected: "clarify", reason: "unverifiable" },
    { name: "allows a later exact Korean verification command to resolve the gap", sessions: [koreanVerificationDefinedLater], input: { title: "체크아웃 회귀 수정", outcome: "체크아웃 회귀가 수정되고 관련 테스트가 통과함", sessionIds: [koreanVerificationDefinedLater.id] }, expected: "recommend" },
    { name: "does not mistake an exact command with a no-failures predicate for a missing verification", sessions: [exactVerificationWithNoFailures], input: { sessionIds: [exactVerificationWithNoFailures.id] }, expected: "recommend" },
    { name: "honors a verification gap stated after an old command in the same message", sessions: [verificationWithdrawnInSameMessage], input: { sessionIds: [verificationWithdrawnInSameMessage.id] }, expected: "clarify", reason: "unverifiable" },
    { name: "honors an exact command stated after an old verification gap in the same message", sessions: [verificationAddedInSameMessage], input: { sessionIds: [verificationAddedInSameMessage.id] }, expected: "recommend" },
    { name: "combines same-task sessions when a newer session supplies the formerly missing verification", sessions: [olderVerificationGap, newerVerificationCommand], input: { sessionIds: [olderVerificationGap.id, newerVerificationCommand.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "recommend" },
    { name: "does not let an older command override a newer same-task verification gap", sessions: [olderVerificationCommand, newerVerificationGap], input: { sessionIds: [olderVerificationCommand.id, newerVerificationGap.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "clarify", reason: "unverifiable" },
    { name: "fails closed when same-task sessions have conflicting verification states at the same timestamp", sessions: [sameTimestampVerificationGap, newerVerificationCommand], input: { sessionIds: [sameTimestampVerificationGap.id, newerVerificationCommand.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "clarify", reason: "unverifiable" },
    { name: "fails closed when an undated same-task session has an unresolved verification gap", sessions: [undatedVerificationGap, newerVerificationCommand], input: { sessionIds: [undatedVerificationGap.id, newerVerificationCommand.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "clarify", reason: "unverifiable" },
    { name: "does not let an invalid session timestamp make a verification command appear newer", sessions: [olderVerificationGap, invalidTimestampVerificationCommand], input: { sessionIds: [olderVerificationGap.id, invalidTimestampVerificationCommand.id], reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"] }, expected: "clarify", reason: "unverifiable" },
    { name: "keeps completed work as no-run even when its note also mentions no additional verification", sessions: [completedWithVerificationGap], input: { sessionIds: [completedWithVerificationGap.id] }, expected: "no_run", reason: "completed" },
    { name: "keeps external work as no-run instead of downgrading it to a verification question", sessions: [externalWithVerificationGap], input: { sessionIds: [externalWithVerificationGap.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "treats verification TBD as an unresolved verification method", sessions: [verificationTbd], input: { sessionIds: [verificationTbd.id] }, expected: "clarify", reason: "unverifiable" },
    { name: "treats Korean verification-undecided evidence as unresolved", sessions: [koreanVerificationUndecided], input: { title: "체크아웃 회귀 수정", outcome: "체크아웃 회귀가 수정되고 관련 테스트가 통과함", sessionIds: [koreanVerificationUndecided.id] }, expected: "clarify", reason: "unverifiable" },
    { name: "allows a later exact command to resolve a verification-TBD state", sessions: [verificationTbdThenCommand], input: { sessionIds: [verificationTbdThenCommand.id] }, expected: "recommend" },
    { name: "does not treat a future conditional completion as already complete", sessions: [conditionalCompletion], input: { sessionIds: [conditionalCompletion.id] }, expected: "recommend" },
    { name: "does not treat a leading future completion condition as already complete", sessions: [reverseConditionalCompletion], input: { sessionIds: [reverseConditionalCompletion.id] }, expected: "recommend" },
    { name: "recognizes a concise Korean done-and-green handoff as completed", sessions: [koreanDone], input: { sessionIds: [koreanDone.id] }, expected: "no_run", reason: "completed" },
    { name: "accepts a past marked-complete report when verification passed", sessions: [markedCompleteAfterVerification], input: { sessionIds: [markedCompleteAfterVerification.id] }, expected: "no_run", reason: "completed" },
    { name: "accepts a Korean past completion-label report when verification passed", sessions: [koreanMarkedCompleteAfterVerification], input: { title: "체크아웃 회귀 수정", sessionIds: [koreanMarkedCompleteAfterVerification.id] }, expected: "no_run", reason: "completed" },
    { name: "does not treat completion of a different named task as completion of the selected task", sessions: [unrelatedCompletion], input: { sessionIds: [unrelatedCompletion.id] }, expected: "recommend" },
    { name: "still recognizes a generic English done-and-green report in the selected task context", sessions: [genericEnglishCompletion], input: { sessionIds: [genericEnglishCompletion.id] }, expected: "no_run", reason: "completed" },
    { name: "still recognizes a generic Korean done-and-green report in the selected task context", sessions: [genericKoreanCompletion], input: { title: "체크아웃 수정", sessionIds: [genericKoreanCompletion.id] }, expected: "no_run", reason: "completed" },
    { name: "keeps Korean partial completion with tests remaining eligible", sessions: [koreanPartial], input: { title: "검색 회귀 통합 테스트 마무리", outcome: "검색 회귀 통합 테스트가 통과함", sessionIds: [koreanPartial.id] }, expected: "recommend" },
    { name: "accepts a concrete Korean UI verification predicate", sessions: [ready], input: { title: "체크아웃 빈 상태 회귀 수정", outcome: "체크아웃 빈 상태가 전체 스피너 없이 표시됨", verification: "체크아웃 화면에 빈 상태가 표시되고 전체 스피너가 없음" }, expected: "recommend" },
    { name: "deduplicates repeated session ids", sessions: [ready], input: { sessionIds: [ready.id, ready.id] }, expected: "recommend" },
    { name: "preserves explicit risks without treating them as completion proof", sessions: [ready], input: { risks: ["Provider completion does not prove the tests passed."] }, expected: "recommend" },
    { name: "does not treat a prohibited action explicitly out of scope as requested", sessions: [negatedDeploy], input: { title: "Fix the local release regression", outcome: "The local release test passes without deployment.", verification: "Run npm test -- release and require exit code 0.", sessionIds: [negatedDeploy.id] }, expected: "recommend" },
    { name: "does not mistake not-completed evidence for completion", sessions: [notCompleted], input: { title: "Fix the failed migration test", outcome: "The migration test passes without unrelated changes.", verification: "Run npm test -- migration and require exit code 0.", sessionIds: [notCompleted.id] }, expected: "recommend" },
    { name: "recognizes shipping to production as an external side effect", sessions: [shipProduction], input: { sessionIds: [shipProduction.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes Slack delivery as an external message", sessions: [sendSlack], input: { sessionIds: [sendSlack.id] }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes posting a Discord notification as an external message", sessions: [ready], input: { outcome: "Post a Discord notification with the checkout test result." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes pushing a branch to origin without literal git syntax", sessions: [ready], input: { outcome: "Push the repaired checkout branch to origin after the tests pass." }, expected: "no_run", reason: "external_side_effect" },
    { name: "allows a local patch when pushing its branch to origin is prohibited", sessions: [ready], input: { outcome: "Fix the checkout regression without pushing the branch to origin.", verification: "Run npm test -- checkout and require exit code 0." }, expected: "recommend" },
    { name: "recognizes posting the result to Slack as an external message", sessions: [ready], input: { outcome: "Post the checkout test result to Slack." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes emailing the result as an external message", sessions: [ready], input: { outcome: "Email the checkout test report to the team." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes Korean natural-language remote branch push", sessions: [ready], input: { outcome: "수정한 체크아웃 브랜치를 origin에 올린 뒤 결과를 확인한다." }, expected: "no_run", reason: "external_side_effect" },
    { name: "allows a Korean local patch when remote branch push is prohibited", sessions: [ready], input: { outcome: "체크아웃 회귀만 수정하고 브랜치를 origin에 올리지 않는다.", verification: "npm test -- checkout" }, expected: "recommend" },
    { name: "recognizes Korean natural-language Slack delivery", sessions: [ready], input: { outcome: "체크아웃 테스트 결과를 슬랙에 올린다." }, expected: "no_run", reason: "external_side_effect" },
    { name: "recognizes editing a Notion page as an external service mutation", sessions: [ready], input: { outcome: "Update the Notion release page with the checkout result." }, expected: "no_run", reason: "external_side_effect" },
    { name: "does not reject a local patch because Discord posting is explicitly prohibited", sessions: [ready], input: { outcome: "Fix the checkout regression without posting a Discord notification.", verification: "Run npm test -- checkout and require exit code 0." }, expected: "recommend" },
    { name: "allows a parser fixture containing rm when it is never executed", sessions: [ready], input: { outcome: "The synthetic parser fixture covers the literal rm -f tmp/debug.db without actually executing it.", verification: "Run npm test -- checkout-parser and require exit code 0." }, expected: "recommend" },
    { name: "allows a detector fixture containing a Notion mutation when it is never executed", sessions: [ready], input: { outcome: "The synthetic detector fixture rejects the literal update the Notion page without actually executing it.", verification: "Run npm test -- checkout-detector and require exit code 0." }, expected: "recommend" },
    { name: "recognizes truncate as destructive data work", sessions: [truncateData], input: { sessionIds: [truncateData.id] }, expected: "no_run", reason: "destructive_action" },
    { name: "recognizes rm of an untracked local artifact as destructive work", sessions: [ready], input: { outcome: "Run rm -f tmp/checkout-debug.db before rebuilding the fixture." }, expected: "no_run", reason: "destructive_action" },
    { name: "recognizes deleting a local directory without literal shell syntax", sessions: [ready], input: { outcome: "Delete the generated checkout directory before rebuilding the fixture." }, expected: "no_run", reason: "destructive_action" },
    { name: "recognizes Korean natural-language local folder deletion", sessions: [ready], input: { outcome: "생성된 체크아웃 폴더를 삭제한 뒤 픽스처를 다시 만든다." }, expected: "no_run", reason: "destructive_action" },
    { name: "allows a Korean synthetic detector fixture containing folder deletion", sessions: [ready], input: { outcome: "실제로 실행하지 않는 테스트용 탐지 픽스처에 폴더를 삭제한다는 문자열을 포함한다.", verification: "npm test -- checkout-detector" }, expected: "recommend" },
    { name: "allows a synthetic detector fixture containing natural-language folder deletion", sessions: [ready], input: { outcome: "The synthetic detector fixture rejects the literal delete the generated checkout folder without actually executing it.", verification: "Run npm test -- checkout-detector and require exit code 0." }, expected: "recommend" },
  ];

  it.each(scenarios)("$name", ({ sessions, input, expected, reason, available }) => {
    const result = assessOvernightProposal({
      proposal: proposal(input),
      context: context(...sessions),
      root,
      executors: available ?? executors,
    });

    expect(result.disposition).toBe(expected);
    if (reason) expect(result.reasonCodes).toContain(reason);
    if (expected === "clarify") expect(result.questions.length).toBeGreaterThan(0);
  });

  it("contains at least 24 independently named expectation scenarios", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(24);
    expect(new Set(scenarios.map((item) => item.name)).size).toBe(scenarios.length);
    const counts = scenarios.reduce<Record<(typeof scenarios)[number]["expected"], number>>(
      (result, scenario) => ({ ...result, [scenario.expected]: result[scenario.expected] + 1 }),
      { recommend: 0, clarify: 0, no_run: 0 },
    );
    expect(counts.recommend).toBeGreaterThanOrEqual(8);
    expect(counts.clarify).toBeGreaterThanOrEqual(8);
    expect(counts.no_run).toBeGreaterThanOrEqual(8);
  });

  it("replaces a positive model rationale with the grounded latest verification gap", () => {
    const result = assessOvernightProposal({
      proposal: proposal({ sessionIds: [verificationNotDefined.id] }),
      context: context(verificationNotDefined),
      root,
      executors,
    });

    expect(result.disposition).toBe("clarify");
    expect(result.rationale).toContain("latest selected-session evidence");
    expect(result.rationale).toContain("does not define how to verify");
    expect(result.rationale).not.toContain("bounded and benefits from unattended");
  });

  it("keeps every mandatory exclusion category out of recommend", () => {
    const mandatoryExclusions = [
      "completed",
      "outside_root",
      "unknown_root",
      "external_side_effect",
      "credentials_required",
      "destructive_action",
      "needs_user_decision",
      "unverifiable",
      "too_broad",
      "insufficient_context",
    ] as const;

    for (const reason of mandatoryExclusions) {
      const covered = scenarios.filter((scenario) => scenario.reason === reason);
      expect(covered.length, `missing ${reason} scenarios`).toBeGreaterThan(0);
      expect(covered.every((scenario) => scenario.expected !== "recommend"), `${reason} must never be recommended`).toBe(true);
    }
  });

  it("replaces an ungrounded no-run explanation instead of presenting it as fact", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        disposition: "no_run",
        reasonCodes: ["unfinished_work"],
        rationale: "Trust me, there is no reason to run this tonight.",
      }),
      context: context(ready),
      root,
      executors,
    });

    expect(result.disposition).toBe("no_run");
    expect(result.reasonCodes).toEqual(["insufficient_reasoning"]);
    expect(result.rationale).not.toContain("Trust me");
    expect(result.outcome).toBe("");
    expect(result.verification).toBe("");
  });

  it("does not offer unavailable Claude when only Codex lacks a task-fit explanation", () => {
    const result = assessOvernightProposal({
      proposal: proposal({ executor: "codex", executorReason: "" }),
      context: context(ready),
      root,
      executors: { codex: true, claude: false },
    });

    expect(result.disposition).toBe("clarify");
    expect(result.reasonCodes).toContain("executor_unexplained");
    expect(result.questions.join(" ")).toContain("Codex");
    expect(result.questions.join(" ")).not.toContain("Claude");

    const korean = assessOvernightProposal({
      proposal: proposal({
        executor: "codex",
        executorReason: "",
        rationale: "이 로컬 회귀는 범위가 유한하고 밤새 무인 테스트 반복의 이점이 있습니다.",
      }),
      context: context(ready),
      root,
      executors: { codex: true, claude: false },
    });
    expect(korean.reasonCodes).toContain("executor_unexplained");
    expect(korean.questions.join(" ")).toContain("Codex");
    expect(korean.questions.join(" ")).not.toContain("Claude");
  });

  it("explains evidence-backed blockers on omitted explicit-priority sessions", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        title: "Fix the billing regression",
        rationale: "The bounded billing failure benefits from unattended test iteration.",
        sessionIds: [billingFix.id],
        outcome: "The billing regression test passes without unrelated release changes.",
        verification: "Run npm test -- billing and require exit code 0.",
      }),
      context: context(billingFix, completedPriorityCheckout, unsafePriorityRelease),
      root,
      executors,
    });

    expect(result.disposition).toBe("recommend");
    expect(result.excludedSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: completedPriorityCheckout.id, reasonCode: "completed" }),
      expect.objectContaining({ sessionId: unsafePriorityRelease.id, reasonCode: "external_side_effect" }),
    ]));
  });

  it("explains grounded blockers on ordinary omitted sessions even when the model omits exclusions", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        title: "Fix the checkout state transition",
        sessionIds: [ready.id],
        excludedSessions: [],
      }),
      context: context(ready, completed, outside, external),
      root,
      executors,
    });

    expect(result.disposition).toBe("recommend");
    expect(result.excludedSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: completed.id, reasonCode: "completed" }),
      expect.objectContaining({ sessionId: outside.id, reasonCode: "outside_root" }),
      expect.objectContaining({ sessionId: external.id, reasonCode: "external_side_effect" }),
    ]));
  });

  it("asks for the missing outcome and verification when only a session header is available", () => {
    const result = assessOvernightProposal({
      proposal: proposal({ sessionIds: [headerOnly.id] }),
      context: context(headerOnly),
      root,
      executors,
    });

    expect(result.disposition).toBe("clarify");
    expect(result.questions).toEqual([
      "What exact unfinished outcome and verification should Morrow use instead of this session title?",
    ]);
  });

  it("does not let an unauthenticated unused executor veto an authenticated auto alternative", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        executor: "auto",
        executorReason: "Either supported local worker can execute this exact repository test contract.",
        reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage", "executor_unauthenticated"],
      }),
      context: context(ready),
      root,
      executors: { codex: false, claude: true },
      executorBlockers: { codex: "unauthenticated" },
    });

    expect(result.disposition).toBe("recommend");
    expect(result.executor).toBe("claude");
    expect(result.reasonCodes).not.toContain("executor_unauthenticated");
  });

  it("treats an explicitly selected unauthenticated executor as a choice to clarify when another is ready", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        executor: "claude",
        reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage", "executor_unauthenticated"],
      }),
      context: context(ready),
      root,
      executors: { codex: true, claude: false },
      executorBlockers: { claude: "unauthenticated" },
    });

    expect(result.disposition).toBe("clarify");
    expect(result.reasonCodes).toContain("executor_unauthenticated");
  });

  it.each(["no_executor", "executor_unavailable", "executor_unauthenticated"] as const)(
    "does not let a fabricated %s runtime claim veto a verified ready executor",
    (runtimeReason) => {
      const result = assessOvernightProposal({
        proposal: proposal({
          executor: "codex",
          reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage", runtimeReason],
        }),
        context: context(ready),
        root,
        executors: { codex: true, claude: false },
      });

      expect(result.disposition).toBe("recommend");
      expect(result.executor).toBe("codex");
      expect(result.reasonCodes).not.toContain(runtimeReason);
    },
  );

  it("does not invent not-relevant but does explain a grounded blocker on an unselected session", () => {
    const result = assessOvernightProposal({
      proposal: proposal({ sessionIds: [ready.id], excludedSessions: [] }),
      context: context(ready, researchOnly),
      root,
      executors,
    });

    expect(result.excludedSessions).toEqual([
      expect.objectContaining({ sessionId: researchOnly.id, reasonCode: "needs_user_decision" }),
    ]);
    expect(result.excludedSessions.some((item) => item.reasonCode === "not_relevant")).toBe(false);
  });

  it("keeps only explicit evidence-backed exclusions for known unselected sessions", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        sessionIds: [ready.id],
        excludedSessions: [
          { sessionId: researchOnly.id, reasonCode: "needs_user_decision", explanation: "This research has no selected implementation direction." },
          { sessionId: researchOnly.id, reasonCode: "not_relevant", explanation: "Duplicate should not win." },
          { sessionId: "codex:invented-exclusion", reasonCode: "not_relevant", explanation: "Unknown session." },
          { sessionId: ready.id, reasonCode: "not_relevant", explanation: "Selected sessions cannot also be excluded." },
        ],
      }),
      context: context(ready, researchOnly),
      root,
      executors,
    });

    expect(result.excludedSessions).toEqual([
      { sessionId: researchOnly.id, reasonCode: "needs_user_decision", explanation: "This research has no selected implementation direction." },
    ]);
  });

  it("drops a fabricated not-relevant exclusion when the session shares the selected task", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        sessionIds: [ready.id],
        excludedSessions: [{
          sessionId: companion.id,
          reasonCode: "not_relevant",
          explanation: "This investigation is unrelated to the selected checkout repair.",
        }],
      }),
      context: context(ready, companion),
      root,
      executors,
    });

    expect(result.excludedSessions).toEqual([]);
  });

  it("keeps a not-relevant exclusion only when it has no concrete task overlap", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        sessionIds: [ready.id],
        excludedSessions: [{
          sessionId: unrelatedDocumentation.id,
          reasonCode: "not_relevant",
          explanation: "Pricing documentation does not contribute to the checkout regression.",
        }],
      }),
      context: context(ready, unrelatedDocumentation),
      root,
      executors,
    });

    expect(result.excludedSessions).toEqual([{
      sessionId: unrelatedDocumentation.id,
      reasonCode: "not_relevant",
      explanation: "Pricing documentation does not contribute to the checkout regression.",
    }]);
  });

  it("drops a fabricated completed exclusion and replaces it only with a grounded blocker", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        sessionIds: [ready.id],
        excludedSessions: [{ sessionId: researchOnly.id, reasonCode: "completed", explanation: "This session is supposedly complete." }],
      }),
      context: context(ready, researchOnly),
      root,
      executors,
    });

    expect(result.excludedSessions).toEqual([
      expect.objectContaining({ sessionId: researchOnly.id, reasonCode: "needs_user_decision" }),
    ]);
    expect(result.excludedSessions.some((item) => item.reasonCode === "completed")).toBe(false);
  });

  it("keeps a completed exclusion only when the referenced session contains completion evidence", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        sessionIds: [ready.id],
        excludedSessions: [{ sessionId: completed.id, reasonCode: "completed", explanation: "The UI repair and its tests are already complete." }],
      }),
      context: context(ready, completed),
      root,
      executors,
    });

    expect(result.excludedSessions).toEqual([
      { sessionId: completed.id, reasonCode: "completed", explanation: "The UI repair and its tests are already complete." },
    ]);
  });

  it("bounds supporting prose without truncating per-session exclusion evidence", () => {
    const extraSessions = Array.from({ length: 30 }, (_, index) => session(
      `codex:extra-${index}`,
      `Unrelated session ${index}`,
      "A separate local task remains.",
    ));
    const long = "x".repeat(900);
    const result = assessOvernightProposal({
      proposal: proposal({
        disposition: "clarify",
        sessionIds: [ready.id],
        risks: Array.from({ length: 20 }, (_, index) => `risk-${index}-${long}`),
        questions: Array.from({ length: 10 }, (_, index) => `question-${index}-${long}`),
        excludedSessions: extraSessions.map((item) => ({ sessionId: item.id, reasonCode: "not_relevant", explanation: long })),
      }),
      context: context(ready, ...extraSessions),
      root,
      executors,
    });

    expect(result.risks).toHaveLength(8);
    expect(result.questions).toHaveLength(3);
    expect(result.excludedSessions).toHaveLength(30);
    expect(Math.max(...result.risks.map((item) => item.length))).toBe(500);
    expect(Math.max(...result.questions.map((item) => item.length))).toBe(500);
    expect(Math.max(...result.excludedSessions.map((item) => item.explanation.length))).toBe(500);
  });

  it("drops questions from a no-run result instead of showing contradictory next steps", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        disposition: "no_run",
        sessionIds: [],
        reasonCodes: ["completed"],
        questions: ["Should this completed work run again?"],
      }),
      context: context(completed),
      root,
      executors,
    });

    expect(result.disposition).toBe("no_run");
    expect(result.questions).toEqual([]);
  });

  it("does not retain positive evidence that contradicts a completed no-run decision", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        disposition: "no_run",
        sessionIds: [completed.id],
        reasonCodes: ["completed", "unfinished_work", "overnight_leverage", "bounded_scope"],
      }),
      context: context(completed),
      root,
      executors,
    });

    expect(result.disposition).toBe("no_run");
    expect(result.reasonCodes).toContain("completed");
    expect(result.reasonCodes).not.toContain("unfinished_work");
    expect(result.reasonCodes).not.toContain("overnight_leverage");
    expect(result.reasonCodes).toContain("bounded_scope");
  });

  it.each([markCompleteRequest, koreanMarkCompleteRequest])("does not treat an instruction to mark complete as completed evidence: $id", (brief) => {
    const result = assessOvernightProposal({
      proposal: proposal({
        disposition: "no_run",
        sessionIds: [brief.id],
        reasonCodes: ["completed"],
        rationale: "The user said this work is complete.",
      }),
      context: context(brief),
      root,
      executors,
    });

    expect(result.reasonCodes).not.toContain("completed");
    expect(result.reasonCodes).toContain("insufficient_reasoning");
  });

  it("does not claim completion when the selected session contains no completion evidence", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        disposition: "no_run",
        title: "All selected work is complete",
        sessionIds: [ready.id],
        reasonCodes: ["completed"],
        rationale: "All selected work is complete and verified.",
      }),
      context: context(ready),
      root,
      executors,
    });

    expect(result.disposition).toBe("no_run");
    expect(result.reasonCodes).not.toContain("completed");
    expect(result.reasonCodes).toContain("insufficient_reasoning");
    expect(result.title).toBe("Completion claim is not supported");
    expect(result.rationale).not.toContain("complete and verified");
    expect(result.outcome).toBe("");
    expect(result.verification).toBe("");
  });

  it("does not claim every observed task is complete when any observed session remains unfinished", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        disposition: "no_run",
        sessionIds: [],
        reasonCodes: ["completed"],
        rationale: "The model asserted that every observed task was complete.",
      }),
      context: context(completed, ready),
      root,
      executors,
    });

    expect(result.disposition).toBe("no_run");
    expect(result.reasonCodes).not.toContain("completed");
    expect(result.reasonCodes).toContain("insufficient_reasoning");
  });

  it("does not retain a clear-verification claim beside an unverifiable refusal", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        verification: "Check that it works",
        reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "unverifiable"],
      }),
      context: context(ready),
      root,
      executors,
    });

    expect(result.disposition).toBe("no_run");
    expect(result.reasonCodes).toContain("unverifiable");
    expect(result.reasonCodes).not.toContain("clear_verification");
  });

  it("does not retain a bounded-scope claim beside a too-broad clarification", () => {
    const result = assessOvernightProposal({
      proposal: proposal({
        sessionIds: [broad.id],
        reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "too_broad"],
      }),
      context: context(broad),
      root,
      executors,
    });

    expect(result.disposition).toBe("clarify");
    expect(result.reasonCodes).toContain("too_broad");
    expect(result.reasonCodes).not.toContain("bounded_scope");
  });

  it("returns the task-aware executor selected for auto", () => {
    const documentation = assessOvernightProposal({
      proposal: proposal({
        requestKind: "goal",
        sessionIds: [],
        title: "Synthesize the architecture ADR",
        rationale: "This bounded documentation synthesis has exact file-content checks.",
        outcome: "The architecture ADR contains the approved decisions and residual risks.",
        verification: "The ADR file must contain Decision and Risks sections.",
        executor: "auto",
        executorReason: "This is bounded documentation synthesis and review work.",
      }),
      context: context(),
      root,
      executors,
    });
    const implementation = assessOvernightProposal({
      proposal: proposal({ executor: "auto", executorReason: "This repository patch has executable regression tests." }),
      context: context(ready),
      root,
      executors,
    });

    expect(documentation.executor).toBe("claude");
    expect(implementation.executor).toBe("codex");
  });
});
