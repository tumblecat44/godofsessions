import { describe, expect, it } from "vitest";
import type { DailyContextSnapshot, DailyContextSession } from "./daily-context";
import {
  assessOvernightPortfolio,
  type OvernightCandidateEvidence,
  type OvernightPortfolioCandidateProposal,
  type OvernightPortfolioProposal,
  type OvernightProviderId,
} from "./overnight-portfolio-recommendation";

const root = "/work/app";
const allProviders: Record<OvernightProviderId, boolean> = {
  codex: true,
  claude: true,
  grok: true,
  cursor: true,
  pi: true,
  hermes: true,
  openclaw: true,
};

function session(id: string, title: string, last: string, workspace = root): DailyContextSession {
  const provider = id.split(":")[0] as DailyContextSession["provider"];
  return {
    id,
    nativeId: id.split(":")[1],
    provider,
    title,
    workspace,
    updatedAt: "2026-08-26T05:00:00.000Z",
    summary: last,
    excerptCount: 2,
    excerpts: [
      { role: "user", text: title },
      { role: "assistant", text: last },
    ],
  };
}

function context(sessions: DailyContextSession[]): DailyContextSnapshot {
  return {
    summary: {
      date: "2026-08-26",
      timeZone: "America/Los_Angeles",
      generatedAt: "2026-08-26T05:10:00.000Z",
      totalSessions: sessions.length,
      providerCounts: {},
      sessions: sessions.map(({ nativeId: _nativeId, excerpts: _excerpts, ...item }) => item),
      warnings: [],
      methodology: "synthetic portfolio recommendation fixture",
    },
    sessions,
    prompt: "synthetic",
  };
}

function evidence(summary: string, source: OvernightCandidateEvidence["source"] = "workspace"): OvernightCandidateEvidence {
  return { source, summary };
}

function candidate(overrides: Partial<OvernightPortfolioCandidateProposal> = {}): OvernightPortfolioCandidateProposal {
  return {
    stableKey: "checkout-transition",
    origin: "continuation",
    disposition: "recommend",
    title: "Fix checkout transition regression",
    rationale: "The reproduced regression benefits from an uninterrupted unattended implementation and verification loop.",
    reasonCodes: ["unfinished_work", "bounded_scope", "clear_verification", "overnight_leverage"],
    sessionIds: ["codex:checkout"],
    evidence: [],
    excludedSessions: [],
    outcome: "The checkout transition regression is fixed without changing unrelated settings behavior.",
    verification: "Run npm test -- checkout and require exit code 0.",
    preferredProvider: "codex",
    providerReason: "Codex fits this repository implementation and executable regression-test loop.",
    estimatedMinutes: 90,
    risks: ["Preserve unrelated worktree changes."],
    questions: [],
    dependencyKeys: [],
    conflictKeys: ["checkout-state"],
    writeScopes: ["src/checkout", "tests/checkout"],
    ...overrides,
  };
}

function proposal(candidates: OvernightPortfolioCandidateProposal[]): OvernightPortfolioProposal {
  return { requestKind: "discover", candidates };
}

const checkout = session("codex:checkout", "Fix checkout transition regression", "The checkout transition test still fails and implementation remains.");
const checkoutCause = session("claude:checkout-cause", "Investigate checkout transition regression", "The checkout transition root cause is isolated and the code fix remains.");
const checkoutVerification = session("grok:checkout-verification", "Verify checkout transition regression", "The checkout transition fixture defines the expected state and still fails.");
const billing = session("claude:billing", "Fix billing invoice regression", "The billing invoice total test still fails and implementation remains.");
const search = session("grok:search", "Fix search pagination regression", "The search pagination integration test still fails and implementation remains.");
const bridge = session("codex:bridge", "Checkout pricing, pricing billing mapper, and billing invoice", "The checkout pricing, pricing billing mapper, and billing invoice tasks are three independent unfinished failures.");
const completedSettings = session("cursor:settings", "Finish settings save repair", "The settings save repair is complete and all settings tests pass.");
const outside = session("codex:outside", "Repair another repository", "The implementation remains.", "/work/other");
const external = session("claude:deploy", "Deploy the release", "Deploy the release and post the announcement after tests pass.");
const credentialed = session("grok:credential", "Repair the live account", "Use the production API token to update the customer account.");
const destructive = session("cursor:destructive", "Clean generated output", "Run rm -rf generated before rebuilding everything.");
const choice = session("pi:choice", "Choose the onboarding design", "The user must choose between the two incompatible onboarding designs.");
const headerOnly: DailyContextSession = { ...session("hermes:header", "Fix checkout transition regression", ""), summary: "Conversation body unavailable.", excerptCount: 0, excerpts: [] };
const priority = {
  ...session("openclaw:priority", "Fix priority authentication regression", "The authentication regression still fails."),
  excerptCount: 3,
  excerpts: [
    { role: "user" as const, text: "Fix priority authentication regression" },
    { role: "assistant" as const, text: "The authentication regression still fails." },
    { role: "user" as const, text: "This is my highest priority tonight." },
  ],
};
const manyIndependentSessions = Array.from({ length: 30 }, (_, index) => session(
  `codex:independent-${index}`,
  `Repair independent module-${index} failure`,
  `The independent module-${index} regression still fails and remains unfinished.`,
));
const manyIndependentCandidates = manyIndependentSessions.map((brief, index) => candidate({
  stableKey: `independent-${index}`,
  title: `Repair independent module-${index} failure`,
  sessionIds: [brief.id],
  outcome: `The independent module-${index} regression is fixed without changing other modules.`,
  verification: `Run npm test -- module-${index} and require exit code 0.`,
  conflictKeys: [`module-${index}`],
  writeScopes: [`src/module-${index}`],
}));
const manySameTaskSessions = Array.from({ length: 30 }, (_, index) => session(
  `codex:checkout-evidence-${index}`,
  `Fix checkout transition regression evidence ${index}`,
  `Evidence ${index} confirms the checkout transition regression still fails and remains unfinished.`,
));

type Scenario = {
  name: string;
  sessions: DailyContextSession[];
  candidates: OvernightPortfolioCandidateProposal[];
  providers?: Partial<Record<OvernightProviderId, boolean>>;
  assert(result: ReturnType<typeof assessOvernightPortfolio>): void;
};

const scenario = (
  name: string,
  sessions: DailyContextSession[],
  candidates: OvernightPortfolioCandidateProposal[],
  expected: { disposition: "recommend" | "clarify" | "no_run"; count?: number; runnable?: number; keys?: string[] },
  providers?: Partial<Record<OvernightProviderId, boolean>>,
): Scenario => ({
  name,
  sessions,
  candidates,
  providers,
  assert(result) {
    expect(result.disposition).toBe(expected.disposition);
    if (expected.count !== undefined) expect(result.candidates).toHaveLength(expected.count);
    if (expected.runnable !== undefined) expect(result.candidates.filter((item) => item.disposition === "recommend")).toHaveLength(expected.runnable);
    if (expected.keys) expect(result.candidates.map((item) => item.stableKey)).toEqual(expected.keys);
  },
});

const scenarios: Scenario[] = [
  scenario("recommends one bounded unfinished continuation", [checkout], [candidate()], { disposition: "recommend", count: 1, runnable: 1 }),
  scenario("preserves two independent unfinished tasks", [checkout, billing], [candidate(), candidate({ stableKey: "billing-invoice", title: "Fix billing invoice regression", sessionIds: [billing.id], outcome: "The billing invoice regression is fixed without changing checkout.", verification: "Run npm test -- billing and require exit code 0.", conflictKeys: ["billing"], writeScopes: ["src/billing"] })], { disposition: "recommend", count: 2, runnable: 2, keys: ["checkout-transition", "billing-invoice"] }),
  scenario("preserves three independent unfinished tasks", [checkout, billing, search], [candidate(), candidate({ stableKey: "billing-invoice", title: "Fix billing invoice regression", sessionIds: [billing.id], outcome: "The billing invoice regression is fixed.", verification: "Run npm test -- billing and require exit code 0.", conflictKeys: ["billing"], writeScopes: ["src/billing"] }), candidate({ stableKey: "search-pagination", title: "Fix search pagination regression", sessionIds: [search.id], outcome: "The search pagination regression is fixed.", verification: "Run npm test -- search and require exit code 0.", conflictKeys: ["search"], writeScopes: ["src/search"] })], { disposition: "recommend", count: 3, runnable: 3 }),
  scenario("preserves more than twenty-four independent candidates without an admission cutoff", manyIndependentSessions, manyIndependentCandidates, { disposition: "recommend", count: 30, runnable: 30 }),
  scenario("merges two proposals describing the same task across sessions", [checkout, checkoutCause], [candidate(), candidate({ stableKey: "checkout-root-cause", title: "Repair checkout transition failure", sessionIds: [checkoutCause.id], outcome: "The checkout transition regression is repaired without unrelated changes." })], { disposition: "recommend", count: 1, runnable: 1 }),
  scenario("merges three same-task sessions into one candidate", [checkout, checkoutCause, checkoutVerification], [candidate(), candidate({ stableKey: "checkout-cause", title: "Repair checkout transition regression", sessionIds: [checkoutCause.id] }), candidate({ stableKey: "checkout-proof", title: "Verify checkout transition regression fix", sessionIds: [checkoutVerification.id] })], { disposition: "recommend", count: 1, runnable: 1 }),
  scenario("merges an exact duplicate stable key for the same work", [checkout, checkoutCause], [candidate(), candidate({ sessionIds: [checkoutCause.id] })], { disposition: "recommend", count: 1, runnable: 1 }),
  {
    name: "preserves more than twenty-four related session briefs as one candidate's approval evidence",
    sessions: manySameTaskSessions,
    candidates: [candidate({
      stableKey: "checkout-many-sources",
      title: "Fix checkout transition regression",
      reasonCodes: ["unfinished_work", "same_task", "bounded_scope", "clear_verification", "overnight_leverage"],
      sessionIds: manySameTaskSessions.map((brief) => brief.id),
    })],
    assert(result) {
      expect(result.disposition).toBe("recommend");
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].sessionIds).toEqual(manySameTaskSessions.map((brief) => brief.id));
      expect(result.candidates[0].selectedSessions.map((brief) => brief.id)).toEqual(manySameTaskSessions.map((brief) => brief.id));
    },
  },
  {
    name: "preserves every per-session exclusion reason beyond the old display cap",
    sessions: [checkout, ...manyIndependentSessions],
    candidates: [candidate({
      excludedSessions: manyIndependentSessions.map((brief) => ({
        sessionId: brief.id,
        reasonCode: "not_relevant",
        explanation: `${brief.title} is an independent module task and is not evidence for the checkout repair.`,
      })),
    })],
    assert(result) {
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].excludedSessions).toHaveLength(30);
      expect(result.candidates[0].excludedSessions.map((item) => item.sessionId))
        .toEqual(manyIndependentSessions.map((brief) => brief.id));
    },
  },
  scenario("keeps checkout rounding and checkout accessibility independent", [checkout], [candidate({ stableKey: "checkout-rounding", title: "Fix checkout tax rounding", outcome: "Checkout tax cents round correctly.", verification: "Run npm test -- checkout-rounding and require exit code 0." }), candidate({ stableKey: "checkout-accessibility", title: "Fix checkout keyboard accessibility", outcome: "Checkout keyboard focus reaches submit.", verification: "Run npm test -- checkout-a11y and require exit code 0.", writeScopes: ["src/checkout/accessibility"] })], { disposition: "recommend", count: 2, runnable: 2 }),
  scenario("does not merge independent API test failures just because their titles share generic words", [
    session("codex:login-api", "Fix login API tests", "The login API regression remains unfinished."),
    session("claude:signup-api", "Fix signup API tests", "The signup API regression remains unfinished."),
  ], [
    candidate({
      stableKey: "login-api-tests",
      title: "Fix login API tests",
      sessionIds: ["codex:login-api"],
      outcome: "The login API tests pass without changing signup behavior.",
      verification: "Run npm test -- login-api and require exit code 0.",
      conflictKeys: ["login-api"],
      writeScopes: ["src/login"],
    }),
    candidate({
      stableKey: "signup-api-tests",
      title: "Fix signup API tests",
      sessionIds: ["claude:signup-api"],
      outcome: "The signup API tests pass without changing login behavior.",
      verification: "Run npm test -- signup-api and require exit code 0.",
      conflictKeys: ["signup-api"],
      writeScopes: ["src/signup"],
    }),
  ], { disposition: "recommend", count: 2, runnable: 2, keys: ["login-api-tests", "signup-api-tests"] }),
  scenario("does not merge a bridge chain of three different tasks", [bridge], [candidate({ stableKey: "checkout-pricing", title: "Fix checkout pricing regression", sessionIds: [bridge.id], outcome: "Checkout pricing totals are correct." }), candidate({ stableKey: "pricing-billing", title: "Fix pricing billing mapper", sessionIds: [bridge.id], outcome: "Pricing maps into billing correctly.", verification: "Run npm test -- pricing and require exit code 0." }), candidate({ stableKey: "billing-invoice", title: "Fix billing invoice total", sessionIds: [bridge.id], outcome: "Billing invoice totals are correct.", verification: "Run npm test -- billing and require exit code 0." })], { disposition: "recommend", count: 3, runnable: 3 }),
  {
    name: "preserves a true transitive bridge in either candidate order",
    sessions: [bridge],
    candidates: [
      candidate({ stableKey: "checkout-pricing-a", title: "Fix checkout pricing", sessionIds: [bridge.id], outcome: "Checkout pricing values are correct.", verification: "Run npm test -- checkout and require exit code 0." }),
      candidate({ stableKey: "checkout-pricing-billing-b", title: "Fix checkout pricing billing", sessionIds: [bridge.id], outcome: "Checkout pricing billing values are correct.", verification: "Run npm test -- pricing and require exit code 0." }),
      candidate({ stableKey: "pricing-billing-c", title: "Fix pricing billing", sessionIds: [bridge.id], outcome: "Pricing billing values are correct.", verification: "Run npm test -- billing and require exit code 0." }),
    ],
    assert(result) {
      const reverse = assessOvernightPortfolio({
        proposal: proposal([
          candidate({ stableKey: "pricing-billing-c", title: "Fix pricing billing", sessionIds: [bridge.id], outcome: "Pricing billing values are correct.", verification: "Run npm test -- billing and require exit code 0." }),
          candidate({ stableKey: "checkout-pricing-billing-b", title: "Fix checkout pricing billing", sessionIds: [bridge.id], outcome: "Checkout pricing billing values are correct.", verification: "Run npm test -- pricing and require exit code 0." }),
          candidate({ stableKey: "checkout-pricing-a", title: "Fix checkout pricing", sessionIds: [bridge.id], outcome: "Checkout pricing values are correct.", verification: "Run npm test -- checkout and require exit code 0." }),
        ]),
        context: context([bridge]),
        root,
        providers: allProviders,
      });
      expect(result.candidates).toHaveLength(3);
      expect(reverse.candidates).toHaveLength(3);
      expect(result.candidates.map((item) => `${item.stableKey}:${item.disposition}`).sort())
        .toEqual(reverse.candidates.map((item) => `${item.stableKey}:${item.disposition}`).sort());
    },
  },
  scenario("allows one session to support two genuinely different tasks", [checkout], [candidate({ stableKey: "checkout-code", title: "Fix checkout transition code", outcome: "Checkout state transitions are repaired." }), candidate({ stableKey: "checkout-docs", origin: "follow_up", title: "Document checkout state transitions", outcome: "The checkout state-transition reference documents every supported state.", verification: "The checkout reference file contains pending, paid, and failed states.", providerReason: "Claude fits this bounded documentation task and repository review.", preferredProvider: "claude", writeScopes: ["docs/checkout.md"] })], { disposition: "recommend", count: 2, runnable: 2 }),
  scenario("keeps same-title candidates independent when outcomes prove different work", [checkout], [candidate({ stableKey: "checkout-runtime", title: "Improve checkout", outcome: "The checkout state machine rejects invalid transitions." }), candidate({ stableKey: "checkout-copy", title: "Improve checkout", outcome: "Checkout validation errors use the approved Korean copy.", verification: "The checkout copy snapshot contains the approved Korean errors.", writeScopes: ["src/checkout/copy.ts"] })], { disposition: "recommend", count: 2, runnable: 2 }),
  {
    name: "does not collapse distinct tasks whose model stable keys normalize to the same text",
    sessions: [checkout, billing],
    candidates: [
      candidate({ stableKey: "work.item", title: "Fix checkout transition regression", sessionIds: [checkout.id] }),
      candidate({ stableKey: "work-item", title: "Fix billing invoice regression", sessionIds: [billing.id], outcome: "The billing invoice regression is fixed.", verification: "Run npm test -- billing and require exit code 0.", writeScopes: ["src/billing"], conflictKeys: ["billing"] }),
    ],
    assert(result) {
      expect(result.candidates).toHaveLength(2);
      expect(new Set(result.candidates.map((item) => item.stableKey))).toHaveProperty("size", 2);
      expect(result.candidates.every((item) => item.disposition === "recommend")).toBe(true);
      expect(result.candidates.every((item) => item.stableKey.length <= 80)).toBe(true);
    },
  },
  {
    name: "does not collapse distinct tasks whose long stable keys share one prefix",
    sessions: [checkout, billing],
    candidates: [
      candidate({ stableKey: `${"a".repeat(90)}-checkout`, title: "Fix checkout transition regression", sessionIds: [checkout.id] }),
      candidate({ stableKey: `${"a".repeat(90)}-billing`, title: "Fix billing invoice regression", sessionIds: [billing.id], outcome: "The billing invoice regression is fixed.", verification: "Run npm test -- billing and require exit code 0.", writeScopes: ["src/billing"], conflictKeys: ["billing"] }),
    ],
    assert(result) {
      expect(result.candidates).toHaveLength(2);
      expect(new Set(result.candidates.map((item) => item.stableKey))).toHaveProperty("size", 2);
      expect(result.candidates.every((item) => item.stableKey.length <= 80)).toBe(true);
    },
  },
  scenario("merges same work but asks when verification contracts conflict", [checkout, checkoutCause], [candidate(), candidate({ stableKey: "checkout-second", title: "Repair checkout transition regression", sessionIds: [checkoutCause.id], verification: "Run npm run e2e -- checkout and require exit code 0." })], { disposition: "clarify", count: 1, runnable: 0 }),
  {
    name: "removes dependencies that become internal when duplicate work is merged",
    sessions: [checkout, checkoutCause],
    candidates: [
      candidate({ stableKey: "checkout-implementation" }),
      candidate({ stableKey: "checkout-proof", title: "Repair checkout transition regression", sessionIds: [checkoutCause.id], dependencyKeys: ["checkout-implementation"] }),
    ],
    assert(result) {
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({ disposition: "recommend", dependencyKeys: [] });
    },
  },
  {
    name: "does not approve contradictory outcomes that reuse the same stable key",
    sessions: [checkout],
    candidates: [
      candidate({ stableKey: "checkout-change", title: "Change checkout", outcome: "Remove the legacy checkout transition behavior." }),
      candidate({ stableKey: "checkout-change", title: "Change checkout", outcome: "Preserve the legacy checkout transition behavior exactly." }),
    ],
    assert(result) {
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates.every((item) => item.disposition !== "recommend")).toBe(true);
      expect(new Set(result.candidates.map((item) => item.stableKey))).toHaveProperty("size", 2);
    },
  },
  {
    name: "keeps a hazardous source member from disappearing inside a safe-looking merge",
    sessions: [checkout],
    candidates: [
      candidate({ stableKey: "checkout-repair-safe", title: "Repair checkout transition regression", outcome: "The checkout transition regression is repaired and its local tests pass." }),
      candidate({ stableKey: "checkout-repair-release", title: "Repair checkout transition regression", outcome: "The checkout transition regression is repaired, deployed to production, and its local tests pass." }),
    ],
    assert(result) {
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].disposition).toBe("no_run");
      expect(result.candidates[0].reasonCodes).toContain("external_side_effect");
    },
  },
  scenario("keeps conflicting explicit provider choices visible even when an auto proposal is also merged", [checkout, checkoutCause, checkoutVerification], [
    candidate({ preferredProvider: "auto", providerReason: "This bounded repository implementation needs an executable regression-test loop." }),
    candidate({ stableKey: "checkout-codex", title: "Repair checkout transition regression", sessionIds: [checkoutCause.id], preferredProvider: "codex", providerReason: "Codex fits this bounded repository implementation and executable regression-test loop." }),
    candidate({ stableKey: "checkout-grok", title: "Verify checkout transition regression", sessionIds: [checkoutVerification.id], preferredProvider: "grok", providerReason: "Grok fits this bounded repository investigation and executable regression-test loop." }),
  ], { disposition: "clarify", count: 1, runnable: 0 }),
  {
    name: "preserves one explicit provider choice when the other same-task proposal uses auto",
    sessions: [checkout, checkoutCause],
    candidates: [
      candidate({ preferredProvider: "auto", providerReason: "This bounded repository implementation needs an executable regression-test loop." }),
      candidate({ stableKey: "checkout-grok", title: "Repair checkout transition regression", sessionIds: [checkoutCause.id], preferredProvider: "grok", providerReason: "Grok fits this bounded repository investigation and executable regression-test loop." }),
    ],
    assert(result) {
      expect(result.disposition).toBe("recommend");
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({ disposition: "recommend", preferredProvider: "grok" });
    },
  },
  {
    name: "keeps the explicit Codex rationale when a merged auto proposal mentions Claude",
    sessions: [checkout, checkoutCause],
    candidates: [
      candidate({ preferredProvider: "codex", providerReason: "Codex fits this bounded repository implementation and executable checkout regression-test loop." }),
      candidate({ stableKey: "checkout-auto", title: "Repair checkout transition regression", sessionIds: [checkoutCause.id], preferredProvider: "auto", providerReason: "Claude would provide a much longer review and documentation explanation for this repository implementation, although the route was left automatic." }),
    ],
    assert(result) {
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({ disposition: "recommend", preferredProvider: "codex" });
      expect(result.candidates[0].providerReason).toContain("Codex fits");
    },
  },
  scenario("returns an honest no-run portfolio when there are no candidates", [], [], { disposition: "no_run", count: 0, runnable: 0 }),
  scenario("preserves a rejected candidate beside runnable work", [checkout, external], [candidate(), candidate({ stableKey: "release", title: "Deploy the release", sessionIds: [external.id], outcome: "The release is deployed and announced.", verification: "The production release page shows the new version." })], { disposition: "recommend", count: 2, runnable: 1 }),
  scenario("preserves a clarification beside runnable work", [checkout, choice], [candidate(), candidate({ stableKey: "onboarding", disposition: "clarify", title: "Implement onboarding design", sessionIds: [choice.id], outcome: "The chosen onboarding design is implemented.", questions: ["Which approved onboarding design should be implemented?"], reasonCodes: ["needs_user_decision"] })], { disposition: "recommend", count: 2, runnable: 1 }),
  scenario("returns clarify when every candidate needs a decision", [choice], [candidate({ stableKey: "onboarding", disposition: "clarify", title: "Implement onboarding design", sessionIds: [choice.id], reasonCodes: ["needs_user_decision"], questions: ["Which onboarding design should be implemented?"] })], { disposition: "clarify", count: 1, runnable: 0 }),

  scenario("rejects a continuation whose observed work is complete", [completedSettings], [candidate({ stableKey: "settings", title: "Finish settings save repair", sessionIds: [completedSettings.id], outcome: "The settings save repair is complete.", verification: "Run npm test -- settings and require exit code 0." })], { disposition: "no_run", runnable: 0 }),
  scenario("recommends a distinct regression-test follow-up after completed work", [completedSettings], [candidate({ stableKey: "settings-regression-tests", origin: "follow_up", title: "Add settings save regression coverage", sessionIds: [completedSettings.id], outcome: "A regression test reproduces the former settings save failure and passes against the repaired implementation.", verification: "Run npm test -- settings-regression and require exit code 0.", providerReason: "Codex fits this bounded regression-test addition and executable verification." })], { disposition: "recommend", runnable: 1 }),
  scenario("does not relabel already completed work as a follow-up", [completedSettings], [candidate({ stableKey: "settings-again", origin: "follow_up", title: "Finish settings save repair", sessionIds: [completedSettings.id], outcome: "The settings save repair is complete.", verification: "Run npm test -- settings and require exit code 0." })], { disposition: "no_run", runnable: 0 }),
  scenario("recommends a proactive dead-code audit grounded in a completed session", [completedSettings], [candidate({ stableKey: "settings-dead-code-audit", origin: "proactive", title: "Audit obsolete settings save paths", sessionIds: [completedSettings.id], outcome: "A local report identifies obsolete settings save paths with file and line evidence; confirmed dead code is removed only when existing tests cover it.", verification: "Run npm test -- settings and require exit code 0.", providerReason: "Grok fits repository-wide discovery while Codex can verify bounded confirmed changes.", preferredProvider: "grok", evidence: [evidence("The completed repair left both legacy and current settings save paths in the local module.", "session")] })], { disposition: "recommend", runnable: 1 }),
  scenario("recommends proactive work from verified read-only workspace evidence", [], [candidate({ stableKey: "dependency-audit", origin: "proactive", title: "Audit dependency upgrade risks", sessionIds: [], evidence: [evidence("package.json contains pinned dependencies whose local lockfile metadata is older than the documented compatibility baseline.")], outcome: "UPGRADE-NOTES.md lists each relevant dependency, observed version, compatibility risk, and a local validation command without changing dependencies.", verification: "UPGRADE-NOTES.md contains a source, risk, and validation entry for every inspected dependency.", preferredProvider: "claude", providerReason: "Claude fits this bounded documentation synthesis from read-only repository evidence.", writeScopes: ["UPGRADE-NOTES.md"], conflictKeys: ["dependency-audit"] })], { disposition: "recommend", runnable: 1 }),
  scenario("refuses proactive work invented without session or workspace evidence", [], [candidate({ stableKey: "invented-audit", origin: "proactive", title: "Audit something useful", sessionIds: [], evidence: [], outcome: "A useful audit report exists.", verification: "The report contains findings.", rationale: "An unattended audit might be useful overnight." })], { disposition: "no_run", runnable: 0 }),
  scenario("recommends a finite repeated batch", [checkout], [candidate({ stableKey: "checkout-fixture-batch", origin: "batch", title: "Apply the verified checkout fixture pattern to twelve cases", outcome: "All twelve named checkout fixtures use the approved transition pattern and their regression tests pass.", verification: "Run npm test -- checkout-fixtures and require exit code 0.", evidence: [evidence("Twelve named checkout fixtures still use the superseded transition helper.", "session")], estimatedMinutes: 150 })], { disposition: "recommend", runnable: 1 }),
  scenario("asks to bound a vague batch across everything", [checkout], [candidate({ stableKey: "fix-everything", origin: "batch", title: "Fix everything", outcome: "Everything is improved.", verification: "Check that everything works.", rationale: "Let the agent work across the whole repository overnight." })], { disposition: "clarify", runnable: 0 }),
  scenario("recommends a user-defined local routine", [], [candidate({ stableKey: "nightly-flake-report", origin: "routine", title: "Run the approved flaky-test sample", sessionIds: [], evidence: [evidence("The user-defined routine runs the checkout test 20 times and records failures without changing product code.", "routine")], outcome: "A local flake report records 20 runs, exit codes, and failing seeds.", verification: "The report contains exactly 20 timestamped run results.", preferredProvider: "hermes", providerReason: "Hermes fits this finite repeatable local command-and-report routine.", estimatedMinutes: 120, writeScopes: ["artifacts/flake-report.json"], conflictKeys: ["test-runner"] })], { disposition: "recommend", runnable: 1 }),
  scenario("asks for evidence before inventing a routine", [], [candidate({ stableKey: "nightly-maintenance", origin: "routine", title: "Do nightly maintenance", sessionIds: [], evidence: [], outcome: "Maintenance is complete.", verification: "Check the maintenance report." })], { disposition: "no_run", runnable: 0 }),
  scenario("asks when a follow-up has no source work", [], [candidate({ stableKey: "orphan-follow-up", origin: "follow_up", title: "Add follow-up coverage", sessionIds: [], evidence: [], outcome: "Follow-up coverage exists." })], { disposition: "no_run", runnable: 0 }),
  scenario("asks when proactive work has no concrete overnight leverage", [completedSettings], [candidate({ stableKey: "tiny-copy", origin: "proactive", title: "Rename one settings label", sessionIds: [completedSettings.id], rationale: "This one-word rename is unfinished.", outcome: "The label is renamed.", verification: "The settings snapshot contains the new label." })], { disposition: "clarify", runnable: 0 }),
  scenario("blocks a batch that still requires a product decision", [choice], [candidate({ stableKey: "onboarding-batch", origin: "batch", title: "Apply the onboarding design everywhere", sessionIds: [choice.id], outcome: "The chosen design is applied to every onboarding screen.", questions: ["Which design should be used?"] })], { disposition: "clarify", runnable: 0 }),
  scenario("rejects a routine that mutates an external tracker", [], [candidate({ stableKey: "issue-routine", origin: "routine", title: "Create nightly GitHub issues", sessionIds: [], evidence: [evidence("A proposed routine would file issues for local findings.", "routine")], outcome: "Create GitHub issues for every finding.", verification: "The issues exist on GitHub." })], { disposition: "no_run", runnable: 0 }),

  scenario("rejects work outside the fixed root", [outside], [candidate({ stableKey: "outside", sessionIds: [outside.id] })], { disposition: "no_run", runnable: 0 }),
  scenario("rejects external deployment side effects", [external], [candidate({ stableKey: "deploy", title: "Deploy release", sessionIds: [external.id], outcome: "Deploy the release and post the announcement." })], { disposition: "no_run", runnable: 0 }),
  scenario("rejects credential-dependent work", [credentialed], [candidate({ stableKey: "live-account", title: "Repair live account", sessionIds: [credentialed.id], outcome: "The production customer account is updated using its API token." })], { disposition: "no_run", runnable: 0 }),
  scenario("rejects destructive work", [destructive], [candidate({ stableKey: "destructive", title: "Clean generated output", sessionIds: [destructive.id], outcome: "Run rm -rf generated and rebuild." })], { disposition: "no_run", runnable: 0 }),
  scenario("keeps completed work refused even when provider reasoning is weak", [completedSettings], [candidate({ stableKey: "settings-complete", title: "Finish settings save repair", sessionIds: [completedSettings.id], providerReason: "Use it." })], { disposition: "no_run", runnable: 0 }),
  scenario("keeps external work refused when its preferred provider is unavailable", [external], [candidate({ stableKey: "release-external", title: "Deploy the release", sessionIds: [external.id], outcome: "Deploy the release and post the announcement.", preferredProvider: "grok" })], { disposition: "no_run", runnable: 0 }, { grok: false }),
  scenario("keeps credentialed work refused even when its duration is too small", [credentialed], [candidate({ stableKey: "credential-short", title: "Repair the live account", sessionIds: [credentialed.id], outcome: "Use the production API token to update the customer account.", estimatedMinutes: 10 })], { disposition: "no_run", runnable: 0 }),
  scenario("keeps destructive work refused even with a missing dependency", [destructive], [candidate({ stableKey: "destructive-dependent", title: "Clean generated output", sessionIds: [destructive.id], outcome: "Run rm -rf generated and rebuild.", dependencyKeys: ["missing"] })], { disposition: "no_run", runnable: 0 }),
  scenario("asks for concrete verification", [checkout], [candidate({ verification: "Check that it works." })], { disposition: "clarify", runnable: 0 }),
  scenario("asks to narrow an unbounded repository rewrite", [checkout], [candidate({ title: "Rewrite the whole application", outcome: "Rewrite the entire application architecture, UI, storage, and tests.", verification: "Run npm run check and require exit code 0." })], { disposition: "clarify", runnable: 0 }),
  scenario("does not plan from a header-only session", [headerOnly], [candidate({ sessionIds: [headerOnly.id] })], { disposition: "clarify", runnable: 0 }),
  scenario("rejects an invented session id", [checkout], [candidate({ sessionIds: ["codex:not-real"] })], { disposition: "no_run", runnable: 0 }),
  scenario("does not let a completed priority suppress safe independent work", [checkout, completedSettings], [candidate()], { disposition: "recommend", runnable: 1 }),
  scenario("does not downgrade other candidates when the explicit priority is covered elsewhere in the portfolio", [checkout, billing, priority], [candidate(), candidate({ stableKey: "auth-priority", title: "Fix priority authentication regression", sessionIds: [priority.id], outcome: "The authentication regression is fixed.", verification: "Run npm test -- auth and require exit code 0.", conflictKeys: ["auth"], writeScopes: ["src/auth"] }), candidate({ stableKey: "billing-invoice", title: "Fix billing invoice regression", sessionIds: [billing.id], outcome: "The billing invoice regression is fixed.", verification: "Run npm test -- billing and require exit code 0.", conflictKeys: ["billing"], writeScopes: ["src/billing"] })], { disposition: "recommend", count: 3, runnable: 3 }),

  scenario("auto-selects one ready provider without using the source provider as evidence", [checkout], [candidate({ preferredProvider: "auto", providerReason: "This repository patch needs an execution route with local edit and regression-test support." })], { disposition: "recommend", runnable: 1 }, { codex: true, claude: false, grok: false, cursor: false, pi: false, hermes: false, openclaw: false }),
  scenario("does not auto-substitute Codex while retaining a Grok-only selection rationale", [checkout], [candidate({ preferredProvider: "auto", providerReason: "Grok fits this bounded repository investigation and executable regression check." })], { disposition: "clarify", runnable: 0 }, { codex: true, claude: false, grok: false, cursor: false, pi: false, hermes: false, openclaw: false }),
  scenario("asks before substituting an unavailable preferred provider", [checkout], [candidate({ preferredProvider: "grok", providerReason: "Grok fits this repository investigation and local verification." })], { disposition: "clarify", runnable: 0 }, { grok: false, codex: true }),
  scenario("refuses execution when no provider route is ready", [checkout], [candidate()], { disposition: "no_run", runnable: 0 }, { codex: false, claude: false, grok: false, cursor: false, pi: false, hermes: false, openclaw: false }),
  scenario("accepts a ready Grok provider for a grounded investigation", [checkout], [candidate({ preferredProvider: "grok", providerReason: "Grok fits this bounded repository investigation with an executable regression check." })], { disposition: "recommend", runnable: 1 }, { grok: true }),
  scenario("asks for corrected reasoning when an explicit Grok route is justified only with Codex", [checkout], [candidate({ preferredProvider: "grok", providerReason: "Codex fits this bounded repository implementation and executable regression check." })], { disposition: "clarify", runnable: 0 }, { grok: true }),
  scenario("accepts a ready Cursor provider for a bounded patch", [checkout], [candidate({ preferredProvider: "cursor", providerReason: "Cursor fits this bounded repository implementation and regression-test loop." })], { disposition: "recommend", runnable: 1 }, { cursor: true }),
  scenario("asks for a provider-task fit explanation", [checkout], [candidate({ providerReason: "Use it." })], { disposition: "clarify", runnable: 0 }),
  scenario("asks when a dependency key does not exist", [checkout], [candidate({ dependencyKeys: ["missing-setup"] })], { disposition: "clarify", runnable: 0 }),
  scenario("holds a dependent task when its prerequisite needs clarification", [checkout, choice], [candidate({ stableKey: "decide-onboarding", disposition: "clarify", title: "Decide onboarding", sessionIds: [choice.id], reasonCodes: ["needs_user_decision"], questions: ["Which design?"] }), candidate({ stableKey: "implement-onboarding", title: "Implement onboarding", sessionIds: [choice.id], dependencyKeys: ["decide-onboarding"], outcome: "The selected onboarding flow is implemented.", verification: "Run npm test -- onboarding and require exit code 0." })], { disposition: "clarify", runnable: 0 }),
  scenario("detects a dependency cycle", [checkout, billing], [candidate({ stableKey: "checkout-a", dependencyKeys: ["billing-b"] }), candidate({ stableKey: "billing-b", title: "Fix billing invoice regression", sessionIds: [billing.id], outcome: "The billing invoice regression is fixed.", verification: "Run npm test -- billing and require exit code 0.", dependencyKeys: ["checkout-a"] })], { disposition: "clarify", count: 2, runnable: 0 }),
  scenario("preserves an acyclic dependency chain", [checkout, billing], [candidate({ stableKey: "checkout-a" }), candidate({ stableKey: "billing-b", title: "Fix billing invoice regression", sessionIds: [billing.id], outcome: "The billing invoice regression is fixed.", verification: "Run npm test -- billing and require exit code 0.", dependencyKeys: ["checkout-a"], conflictKeys: ["billing"], writeScopes: ["src/billing"] })], { disposition: "recommend", count: 2, runnable: 2 }),
  scenario("rejects an outside-root write scope", [checkout], [candidate({ writeScopes: ["../other-repo"] })], { disposition: "no_run", runnable: 0 }),
  scenario("rejects a normalized relative write scope that escapes the root", [checkout], [candidate({ writeScopes: ["src/../../other-repo"] })], { disposition: "no_run", runnable: 0 }),
  scenario("rejects direct mutation of git internals", [checkout], [candidate({ writeScopes: [".git/config"] })], { disposition: "no_run", runnable: 0 }),
  scenario("rejects a normalized relative write scope that reaches git internals", [checkout], [candidate({ writeScopes: ["src/../.git/config"] })], { disposition: "no_run", runnable: 0 }),
  {
    name: "defaults an omitted write scope to a conservative whole-root conflict",
    sessions: [checkout],
    candidates: [candidate({ writeScopes: [], conflictKeys: [] })],
    assert(result) {
      expect(result.disposition).toBe("recommend");
      expect(result.candidates[0].writeScopes).toEqual(["*"]);
      expect(result.candidates[0].conflictKeys).toContain("root:*");
    },
  },
  {
    name: "preserves explicit conflict and write scopes for the scheduler",
    sessions: [checkout],
    candidates: [candidate({ conflictKeys: ["test-runner", "checkout-state"], writeScopes: ["src/checkout", "tests/checkout"] })],
    assert(result) {
      expect(result.candidates[0]).toMatchObject({ conflictKeys: ["test-runner", "checkout-state"], writeScopes: ["src/checkout", "tests/checkout"] });
    },
  },
  scenario("preserves independent candidates assigned to different ready providers", [checkout, billing], [candidate({ preferredProvider: "codex" }), candidate({ stableKey: "billing", title: "Fix billing invoice regression", sessionIds: [billing.id], outcome: "The billing invoice regression is fixed.", verification: "Run npm test -- billing and require exit code 0.", preferredProvider: "claude", providerReason: "Claude fits this bounded repository review and executable verification.", conflictKeys: ["billing"], writeScopes: ["src/billing"] })], { disposition: "recommend", count: 2, runnable: 2 }),
  {
    name: "keeps an explicitly preferred Grok route outside legacy Codex selection",
    sessions: [search],
    candidates: [candidate({
      stableKey: "search-grok",
      title: "Fix search pagination regression",
      sessionIds: [search.id],
      outcome: "The search pagination regression is fixed without changing unrelated search behavior.",
      verification: "Run npm test -- search and require exit code 0.",
      preferredProvider: "grok",
      providerReason: "Grok fits this bounded repository investigation and executable regression-test loop.",
      conflictKeys: ["search"],
      writeScopes: ["src/search"],
    })],
    assert(result) {
      expect(result.disposition).toBe("recommend");
      expect(result.candidates[0]).toMatchObject({ disposition: "recommend", preferredProvider: "grok" });
    },
  },
  {
    name: "keeps an explicitly preferred Hermes route outside legacy Codex selection",
    sessions: [checkout],
    candidates: [candidate({
      stableKey: "checkout-hermes",
      preferredProvider: "hermes",
      providerReason: "Hermes fits this bounded repeatable repository command and executable regression-test loop.",
    })],
    assert(result) {
      expect(result.disposition).toBe("recommend");
      expect(result.candidates[0]).toMatchObject({ disposition: "recommend", preferredProvider: "hermes" });
    },
  },
  scenario("asks to correct a duration below the minimum", [checkout], [candidate({ estimatedMinutes: 10 })], { disposition: "clarify", runnable: 0 }),
  scenario("asks to split a candidate longer than the overnight window", [checkout], [candidate({ estimatedMinutes: 600 })], { disposition: "clarify", runnable: 0 }),
  {
    name: "normalizes duplicate dependency and conflict keys without losing the task",
    sessions: [checkout, billing],
    candidates: [candidate({ stableKey: "checkout-a" }), candidate({ stableKey: "billing-b", title: "Fix billing invoice regression", sessionIds: [billing.id], outcome: "The billing invoice regression is fixed.", verification: "Run npm test -- billing and require exit code 0.", dependencyKeys: ["checkout-a", "checkout-a"], conflictKeys: ["billing", "billing"], writeScopes: ["src/billing", "src/billing"] })],
    assert(result) {
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[1]).toMatchObject({ dependencyKeys: ["checkout-a"], conflictKeys: ["billing"], writeScopes: ["src/billing"] });
    },
  },
  scenario("detects a self dependency", [checkout], [candidate({ dependencyKeys: ["checkout-transition"] })], { disposition: "clarify", runnable: 0 }),
];

describe("Overnight portfolio recommendation contract — scenarios fixed before implementation", () => {
  it("contains at least forty distinct synthetic scenarios", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(40);
  });

  it.each(scenarios)("$name", ({ sessions, candidates, providers, assert }) => {
    const available = { ...allProviders, ...providers };
    const result = assessOvernightPortfolio({
      proposal: proposal(candidates),
      context: context(sessions),
      root,
      providers: available,
    });
    assert(result);
  });
});
