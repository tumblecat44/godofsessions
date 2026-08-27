import { StringDecoder } from "node:string_decoder";
import type {
  OvernightActivityKind,
  OvernightCliExecutor,
  OvernightProviderResult,
  OvernightResultWarning,
  OvernightResultWarningCode,
} from "../../src/shared/contracts";

export const OVERNIGHT_RESULT_LIMIT = 12_000;
export const OVERNIGHT_EVENT_LINE_LIMIT = 256 * 1_024;
const WARNING_MESSAGE_LIMIT = 1_000;
const WARNING_LIMIT = 5;
const failedVerificationReport = /(?:\b(?:tests?|checks?|verification|verify|validation)\b[^.\n]{0,100}\b(?:fail(?:ed|s|ure)?|not\s+(?:run|executed|verified|complete)|wasn['’]?t\s+(?:run|verified|complete)|could(?:n['’]?t|\s+not)|unable|pending|incomplete|inconclusive|unverified|skipped|omitted|unsuccessful(?:ly)?)\b|\b(?:fail(?:ed|s|ure)?|unable|incomplete|unverified|inconclusive|skipped|omitted|unsuccessful(?:ly)?)\b[^.\n]{0,80}\b(?:tests?|checks?|verification|validation)\b|\b(?:pass(?:ed|es)?)\b[^.\n]{0,30}\bexcept\b|\bexit(?:ed)?\s+(?:with\s+)?(?:code\s+)?[1-9]\d*\b|\b(?:[1-9]\d*|one|two|three|four|five|six|seven|eight|nine|several|some)\s+(?:errors?|failures?)\b|\b(?:errors?|failures?)\s+(?:still\s+)?remain\b|(?:테스트|검증|검사).{0,60}(?:실패|못\s*했|못함|실행하지\s*못|안\s*함|미실행|미검증|불완전|불확실|생략|제외|남았))/iu;
const omittedVerificationBeforeCommand = /(?:\b(?:did|do|was|were|could|can|have|has)\s+not\s+(?:run|execute|rerun)\b|\b(?:didn['’]?t|wasn['’]?t|weren['’]?t|couldn['’]?t|can['’]?t)\s+(?:run|execute|rerun)\b|\bnever\s+(?:ran|run|executed|reran)\b)[^.\n]{0,120}\b(?:(?:npm|pnpm|yarn|bun|deno|dart|flutter|cargo|go)\b|pytest|vitest|playwright|xcodebuild|tests?|checks?|verification)\b|(?:실행|재실행)(?:하지\s*않|못했|못함).{0,100}(?:npm|pnpm|yarn|bun|pytest|vitest|테스트|검증|검사)/iu;
const recoveredVerificationReport = /(?:\b(?:failed|failing|exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?[1-9]\d*)\b[\s\S]{0,160}\b(?:now|then|after(?:ward)?s?)\b[\s\S]{0,100}\b(?:pass(?:ed|es)?|exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?0)\b|(?:실패|깨졌)[\s\S]{0,120}(?:이후|뒤|수정)[\s\S]{0,80}(?:통과|성공))/iu;
const successfulVerificationReport = /(?:\b(?:tests?|checks?|verification|validation)\b[^.\n]{0,100}\b(?:pass(?:ed|es)?|succeed(?:ed|s)?|exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?0)\b|\b(?:verified|verification\s+passed|exit\s+code\s+0)\b|\bno\s+(?:tests?|checks?)\s+failed\b|\b(?:file|screen|screenshot|output|result)\b[^.\n]{0,100}\b(?:contain(?:s|ed)?|show(?:s|ed)?|match(?:es|ed)?|is\s+(?:present|absent|visible|hidden)|exist(?:s|ed)?)\b|(?:테스트|검증|검사).{0,60}(?:통과|성공|종료\s*코드\s*0)|(?:파일|화면|스크린샷|출력|결과).{0,80}(?:포함|표시|일치|존재|없(?:다|고|음|습니다)|보(?:인다|임)|숨겨))/iu;

export interface OvernightResultCollector {
  push(chunk: Uint8Array | string): void;
  finish(): OvernightProviderResult;
}

export function createOvernightResultCollector(
  executor: OvernightCliExecutor,
  onActivity: (activity: OvernightActivityKind) => void = () => undefined,
  expectedVerification?: string,
): OvernightResultCollector {
  const decoder = new StringDecoder("utf8");
  const warnings: OvernightResultWarning[] = [];
  let pending = "";
  let discardingOversizedLine = false;
  let report: string | undefined;
  let terminalStatus: OvernightProviderResult["status"] = "unknown";
  let finished = false;
  const expectedCommands = expectedVerificationCommands(expectedVerification ?? "");
  const commandReceipts = new Map<string, boolean>();
  const claudeBashCalls = new Map<string, string>();

  function warn(code: OvernightResultWarningCode, detail: { message?: unknown; count?: number } = {}) {
    if (warnings.some((warning) => warning.code === code) || warnings.length >= WARNING_LIMIT) return;
    const message = typeof detail.message === "string" ? cleanText(detail.message).slice(0, WARNING_MESSAGE_LIMIT) : undefined;
    warnings.push({ code, ...(message ? { message } : {}), ...(detail.count ? { count: detail.count } : {}) });
  }

  function setReport(value: unknown) {
    if (typeof value !== "string") return;
    const cleaned = cleanText(value).trim();
    if (!cleaned) return;
    report = cleaned.slice(0, OVERNIGHT_RESULT_LIMIT);
    if (cleaned.length > OVERNIGHT_RESULT_LIMIT) warn("result_truncated");
  }

  function readEvent(rawLine: string) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) return;
    let event: Record<string, unknown>;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an event object");
      event = parsed as Record<string, unknown>;
    } catch {
      warn("invalid_event");
      return;
    }

    if (executor === "codex") readCodexEvent(event);
    else readClaudeEvent(event);
  }

  function readCodexEvent(event: Record<string, unknown>) {
    if (event.type === "turn.started") {
      onActivity("working");
      return;
    }
    if ((event.type === "item.started" || event.type === "item.completed") && isRecord(event.item)) {
      onActivity(codexActivity(event.item));
    }
    if (event.type === "item.completed" && isRecord(event.item)) {
      if (event.item.type === "command_execution" && typeof event.item.command === "string" && Number.isSafeInteger(event.item.exit_code)) {
        recordCommandReceipt(event.item.command, event.item.exit_code === 0);
      }
      if (event.item.type === "agent_message") setReport(event.item.text);
      if (event.item.type === "error") warn("provider_error", { message: event.item.message });
      return;
    }
    if (event.type === "turn.completed") {
      onActivity("reporting");
      if (terminalStatus !== "failure") terminalStatus = "success";
      return;
    }
    if (event.type === "turn.failed") {
      onActivity("reporting");
      terminalStatus = "failure";
      warn("provider_error", { message: isRecord(event.error) ? event.error.message : undefined });
      return;
    }
    if (event.type === "error") {
      onActivity("reporting");
      terminalStatus = "failure";
      warn("provider_error", { message: event.message });
    }
  }

  function readClaudeEvent(event: Record<string, unknown>) {
    if (event.type === "system") {
      onActivity("starting");
      return;
    }
    if (event.type === "assistant" && isRecord(event.message)) {
      rememberClaudeBashCalls(event.message.content);
      onActivity(claudeActivity(event.message.content));
      return;
    }
    if (event.type === "user") {
      readClaudeToolResults(event);
      onActivity("working");
      return;
    }
    if (event.type !== "result") {
      onActivity("working");
      return;
    }
    onActivity("reporting");
    setReport(event.result);
    terminalStatus = event.subtype === "success" && event.is_error === false ? "success" : "failure";
    const errors = Array.isArray(event.errors) ? event.errors.filter((item): item is string => typeof item === "string") : [];
    if (errors.length) warn("provider_error", { message: errors.join("\n") });
    const permissionDenials = Array.isArray(event.permission_denials) ? event.permission_denials.length : 0;
    if (permissionDenials) warn("permission_denials", { count: permissionDenials });
  }

  function consume(decoded: string, flush = false) {
    const segments = decoded.split("\n");
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const ended = index < segments.length - 1;
      if (discardingOversizedLine) {
        if (ended) discardingOversizedLine = false;
        continue;
      }
      if (pending.length + segment.length > OVERNIGHT_EVENT_LINE_LIMIT) {
        pending = "";
        warn("oversized_event");
        if (!ended) discardingOversizedLine = true;
        continue;
      }
      pending += segment;
      if (ended) {
        readEvent(pending);
        pending = "";
      }
    }
    if (flush && !discardingOversizedLine && pending) {
      readEvent(pending);
      pending = "";
    }
  }

  return {
    push(chunk) {
      if (finished) return;
      if (typeof chunk === "string") consume(chunk);
      else consume(decoder.write(Buffer.from(chunk)));
    },
    finish() {
      if (!finished) {
        consume(decoder.end(), true);
        finished = true;
      }
      const denied = warnings.some((warning) => warning.code === "permission_denials");
      const verificationStatus = report ? reportVerificationStatus(report, expectedVerification, commandReceipts) : "unknown";
      const status = terminalStatus === "success"
        ? denied ? "failure" : verificationStatus
        : terminalStatus;
      return { status, ...(report ? { report } : {}), warnings: warnings.map((warning) => ({ ...warning })) };
    },
  };

  function recordCommandReceipt(command: string, success: boolean) {
    const script = receiptShellScript(command);
    if (!script || /(?:\|\||[|;]|\$\(|`|\r|\n|(?:^|[^&])&(?:[^&]|$))/u.test(script)) return;
    const segments = script.split(/\s*&&\s*/u).map(normalizeEvidence).filter(Boolean);
    // A successful shell receipt is evidence only when an approved command is
    // itself a complete fail-fast segment. Merely printing or embedding the
    // approved text (for example `echo 'npm test'`) proves nothing.
    const matches = expectedCommands.filter((expected) => segments.includes(expected));
    for (const expected of matches) commandReceipts.set(expected, success);
  }

  function rememberClaudeBashCalls(content: unknown) {
    if (!Array.isArray(content)) return;
    for (const item of content) {
      if (!isRecord(item) || item.type !== "tool_use" || item.name !== "Bash" || typeof item.id !== "string" || !isRecord(item.input) || typeof item.input.command !== "string") continue;
      claudeBashCalls.set(item.id, item.input.command);
    }
  }

  function readClaudeToolResults(event: Record<string, unknown>) {
    if (!isRecord(event.message) || !Array.isArray(event.message.content)) return;
    const outerResult = isRecord(event.tool_use_result) ? event.tool_use_result : undefined;
    for (const item of event.message.content) {
      if (!isRecord(item) || item.type !== "tool_result" || typeof item.tool_use_id !== "string") continue;
      const command = claudeBashCalls.get(item.tool_use_id);
      if (!command) continue;
      claudeBashCalls.delete(item.tool_use_id);
      const exitCode = Number.isSafeInteger(event.exit_code)
        ? event.exit_code as number
        : Number.isSafeInteger(item.exit_code)
          ? item.exit_code as number
          : outerResult && Number.isSafeInteger(outerResult.exitCode)
            ? outerResult.exitCode as number
            : outerResult && Number.isSafeInteger(outerResult.exit_code)
              ? outerResult.exit_code as number
              : undefined;
      const interrupted = outerResult?.interrupted === true;
      const explicitError = item.is_error === true;
      const explicitSuccess = item.is_error === false || exitCode === 0;
      if (explicitError || interrupted || (exitCode !== undefined && exitCode !== 0)) recordCommandReceipt(command, false);
      else if (explicitSuccess) recordCommandReceipt(command, true);
    }
  }
}

export function reportVerificationStatus(report: string, expectedVerification?: string, commandReceipts = new Map<string, boolean>()): OvernightProviderResult["status"] {
  const failureReported = failedVerificationReport.test(report) || omittedVerificationBeforeCommand.test(report);
  const recovered = recoveredVerificationReport.test(report)
    && (!expectedVerification || expectedVerificationCommands(expectedVerification).length <= 1 || everyFailedCommandRecovered(report, expectedVerification));
  if (failureReported && !recovered) return "failure";
  const expectedCommands = expectedVerificationCommands(expectedVerification ?? "");
  if (expectedCommands.some((command) => commandReceipts.get(command) === false)) return "failure";
  if (expectedCommands.length && !expectedCommands.every((command) => commandReceipts.get(command) === true)) return "unknown";
  if (!successfulVerificationReport.test(report)) return "unknown";
  return !expectedVerification || reportCoversExpectedVerification(report, expectedVerification) ? "success" : "unknown";
}

const expectedCommand = /\b(?:(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|typecheck|build)|(?:deno|dart|flutter|cargo)\s+(?:test|check|analyze|build)|(?:pytest|vitest|playwright|make|xcodebuild)|(?:node|python3?|ruby)\s+[A-Za-z0-9._/@+*,-]+|go\s+test|\.\/[A-Za-z0-9._/@+*,-]+)(?:\s+(?!(?:after|all|and|before|both|code|complete(?:d)?|confirm|exit(?:ed|s)?|fail(?:ed|s|ure)?|must|output|pass(?:ed|es)?|require(?:d|s)?|should|succeed(?:ed|s)?|then|was|were|with|without)\b)(?:-{1,2}[A-Za-z0-9][A-Za-z0-9._:/=@+*,-]*|--|[A-Za-z0-9._:/=@+*,-]+))*)/giu;
const commandSuccessEvidence = /(?:\b(?:pass(?:ed|es)?|succeed(?:ed|s)?|exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?0)\b|통과|성공|종료\s*코드\s*0)/iu;
const sharedCommandSuccess = /(?:\b(?:all|both)\b|모두)[^.;]{0,80}(?:\b(?:pass(?:ed|es)?|succeed(?:ed|s)?|exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?0)\b|통과|성공|종료\s*코드\s*0)/iu;
const verificationStopWords = new Set([
  "absent", "after", "all", "and", "before", "both", "check", "checks", "code", "command", "commands", "confirm", "contain", "contained", "contains", "created", "ensure", "equal", "equaled", "equals", "exact", "exactly", "execute", "exist", "existed", "exists", "exit", "exited", "file", "hidden", "inspect", "match", "matched", "matches", "must", "observe", "open", "output", "pass", "passed", "present", "read", "remain", "remained", "remains", "removed", "require", "required", "requires", "result", "reviewed", "run", "screen", "section", "sections", "should", "show", "shows", "succeed", "succeeded", "success", "test", "tests", "the", "then", "updated", "verification", "verified", "verify", "visible", "with", "without", "worker", "zero",
  "검사", "검증", "결과", "명령", "모두", "보여야", "성공", "실행", "없고", "없다", "없어야", "없음", "열기", "종료", "존재해야", "출력", "코드", "테스트", "통과", "표시되어야", "한다", "해야", "파일", "확인", "화면",
]);

function reportCoversExpectedVerification(report: string, expectedVerification: string) {
  const normalizedReport = normalizeEvidence(report);
  const commands = expectedVerificationCommands(expectedVerification);
  if (commands.length > 0 && !commands.every((command) => reportShowsCommandSuccess(normalizedReport, command))) return false;
  // A bounded observable statement can itself be the approved verification
  // receipt (for example, "The output contains verified"). Command-based
  // verification still requires the structured command receipts above.
  if (commands.length === 0 && normalizedReport === normalizeEvidence(expectedVerification)) return true;
  const anchors = verificationAnchors(commands.length ? verificationWithoutCommands(expectedVerification, commands) : expectedVerification);
  if (commands.length > 0 && anchors.length === 0) return true;
  if (anchors.length === 0) return false;
  const negativeAnchors = new Set(anchors.filter((anchor) => expectedAnchorIsNegative(expectedVerification, anchor)));
  if ([...negativeAnchors].some((anchor) => !reportSatisfiesNegativeAnchor(normalizedReport, anchor))) return false;
  const positiveAnchors = anchors.filter((anchor) => !negativeAnchors.has(anchor));
  if (positiveAnchors.length === 0) return negativeAnchors.size > 0;
  // Observable verification is the final trust boundary, so partial noun
  // overlap is not enough. Missing or negated approved evidence stays unknown.
  return positiveAnchors.every((anchor) => reportSatisfiesPositiveAnchor(normalizedReport, anchor));
}

function verificationWithoutCommands(value: string, commands: readonly string[]) {
  return commands.reduce(
    (remaining, command) => remaining.replace(new RegExp(escapeRegExp(command), "gu"), " "),
    normalizeEvidence(value),
  );
}

function expectedAnchorIsNegative(value: string, anchor: string) {
  const normalized = normalizeEvidence(value);
  return evidenceOccurrences(normalized, anchor).some((index) => {
    const start = evidenceClauseStart(normalized, index);
    const before = normalized.slice(start, index);
    const after = normalized.slice(index + anchor.length, index + anchor.length + 48);
    return /\b(?:no|not|without)\b/iu.test(before)
      || /^\s*(?:must|should)?\s*(?:be\s+)?(?:absent|hidden|missing|not\s+(?:present|visible))\b/iu.test(after)
      || /^\s*(?:은|는|이|가|을|를)?\s*(?:없이|없(?:고|다|어야|음|습니다)|제거|숨(?:겨|김)|보이지\s*않)/u.test(after);
  });
}

function reportSatisfiesNegativeAnchor(report: string, anchor: string) {
  return evidenceOccurrences(report, anchor).some((index) => {
    const start = evidenceClauseStart(report, index);
    const before = report.slice(start, index);
    const after = report.slice(index + anchor.length, index + anchor.length + 56);
    return /\b(?:no|not|without)\b/iu.test(before)
      || /^\s*(?:(?:is|was|remains?)\s+)?(?:absent|hidden|missing|not\s+(?:present|visible|shown))\b/iu.test(after)
      || /^\s*(?:은|는|이|가|을|를)?\s*(?:없이|없(?:고|다|어졌|음|습니다)|제거|숨(?:겨|김)|보이지\s*않)/u.test(after);
  });
}

function reportSatisfiesPositiveAnchor(report: string, anchor: string) {
  return evidenceOccurrences(report, anchor).some((index) => {
    const start = evidenceClauseStart(report, index);
    const before = report.slice(start, index);
    const after = report.slice(index + anchor.length, index + anchor.length + 48);
    const negatedBefore = /\b(?:(?:does|did|was|is)\s+not|(?:doesn|didn|wasn|isn)['’]?t|fail(?:ed|s)?\s+to|broken|incorrect|missing|unrepaired|wrong)\b/iu.test(before)
      || /(?:깨진|깨져|고장|수정되지\s*않|잘못된)/u.test(before);
    const negatedAfter = /^\s*(?:is|was|remains?)\s+(?:absent|hidden|missing|not\s+(?:present|visible|shown))\b/iu.test(after)
      || /^\s*(?:is|was|remains?)\s+(?:broken|incorrect|unrepaired|wrong|not\s+repaired|still\s+failing)\b/iu.test(after)
      || /^\s*(?:은|는|이|가|을|를)?\s*(?:없(?:다|어졌|음|습니다)|깨(?:져|짐)|고장|수정되지\s*않|잘못|제거|숨(?:겨|김)|보이지\s*않)/u.test(after);
    return !negatedBefore && !negatedAfter;
  });
}

function evidenceOccurrences(value: string, anchor: string) {
  return [...value.matchAll(new RegExp(escapeRegExp(anchor), "gu"))].map((match) => match.index ?? -1);
}

function evidenceClauseStart(value: string, index: number) {
  return Math.max(value.lastIndexOf(".", index), value.lastIndexOf(";", index), value.lastIndexOf(" and ", index)) + 1;
}

function reportShowsCommandSuccess(report: string, command: string) {
  const occurrences = [...report.matchAll(new RegExp(escapeRegExp(command), "gu"))].map((match) => match.index ?? -1);
  return occurrences.some((index) => {
    const sentenceStart = Math.max(report.lastIndexOf(".", index), report.lastIndexOf(";", index)) + 1;
    const periodEnd = report.indexOf(".", index + command.length);
    const semicolonEnd = report.indexOf(";", index + command.length);
    const sentenceEnd = [periodEnd, semicolonEnd].filter((value) => value >= 0).sort((left, right) => left - right)[0] ?? report.length;
    const sentence = report.slice(sentenceStart, sentenceEnd);
    const localIndex = index - sentenceStart;
    const commands = [...sentence.matchAll(expectedCommand)].map((match) => ({
      index: match.index ?? -1,
      value: normalizeEvidence(match[0]),
    }));
    const current = commands.find((item) => item.index === localIndex && item.value === command);
    if (!current) return false;
    const next = commands.find((item) => item.index > current.index);
    const directEvidence = sentence.slice(current.index + command.length, next?.index ?? sentence.length);
    if (commandSuccessEvidence.test(directEvidence)) return true;
    return commands.length > 1 && sharedCommandSuccess.test(sentence.slice(commands.at(-1)!.index + commands.at(-1)!.value.length));
  });
}

export function expectedVerificationCommands(value: string) {
  return [...new Set([...value.matchAll(expectedCommand)].map((match) => normalizeEvidence(match[0])))];
}

export function verificationCommandReceiptKeys(command: string) {
  const script = receiptShellScript(command);
  if (!script || /(?:\|\||[|;]|\$\(|`|\r|\n|(?:^|[^&])&(?:[^&]|$))/u.test(script)) return [];
  return script.split(/\s*&&\s*/u).map(normalizeEvidence).filter(Boolean);
}

function receiptShellScript(command: string) {
  const trimmed = command.trim();
  const wrapper = trimmed.match(/^(?:(?:\/usr)?\/bin\/)?(?:ba|z|)sh\s+-lc\s+([\s\S]+)$/u);
  if (!wrapper) return trimmed;
  const argument = wrapper[1].trim();
  if (/^'[^']*'$/u.test(argument)) return argument.slice(1, -1);
  if (/^"(?:[^"\\]|\\.)*"$/u.test(argument)) {
    return argument.slice(1, -1).replace(/\\(["\\$`])/gu, "$1");
  }
  // An unquoted single token is a valid `-lc` script (`bash -lc false`).
  // Multiple unquoted words are separate argv entries, not one trustworthy
  // shell script representation, so do not infer an approved invocation.
  return /\s/u.test(argument) ? undefined : argument;
}

function everyFailedCommandRecovered(report: string, expectedVerification: string) {
  const normalized = normalizeEvidence(report);
  return expectedVerificationCommands(expectedVerification).every((command) => {
    const mentions = [...normalized.matchAll(new RegExp(escapeRegExp(command), "gu"))].map((match) => match.index ?? -1);
    const failedAt = mentions.find((index) => /\b(?:fail(?:ed|s|ure)?|exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?[1-9]\d*)\b/iu.test(normalized.slice(index, index + command.length + 80)));
    if (failedAt === undefined) return true;
    return mentions.some((index) => index > failedAt
      && /\b(?:pass(?:ed|es)?|succeed(?:ed|s)?|exit(?:ed)?\s+(?:with\s+)?(?:code\s+)?0)\b/iu.test(normalized.slice(index, index + command.length + 80)));
  });
}

function verificationAnchors(value: string) {
  return [...new Set(normalizeEvidence(value).match(/[\p{L}\p{N}_-]+/gu)
    ?.map(normalizeVerificationToken)
    .filter((token) => (token.length >= 3 || /^[가-힣]{2}$/u.test(token)) && !verificationStopWords.has(token)) ?? [])];
}

function normalizeVerificationToken(token: string) {
  if (!/^[가-힣]+$/u.test(token)) return token;
  const withoutParticle = token.replace(/(?:으로|에서|에게|께서|부터|까지|처럼|보다|은|는|이|가|을|를|에|로|와|과|도)$/u, "");
  return withoutParticle.length >= 2 ? withoutParticle : token;
}

function normalizeEvidence(value: string) {
  return value.toLowerCase().replace(/[`'"()]/gu, "").replace(/\s+/gu, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function codexActivity(value: unknown): OvernightActivityKind {
  if (!isRecord(value)) return "working";
  if (value.type === "reasoning") return "reasoning";
  if (value.type === "command_execution") return isVerificationCommand(value.command) ? "verification" : "command";
  if (value.type === "mcp_tool_call") return "command";
  if (value.type === "file_change") return "file-change";
  if (value.type === "agent_message") return "reporting";
  return "working";
}

function claudeActivity(value: unknown): OvernightActivityKind {
  if (!Array.isArray(value)) return "reasoning";
  const tools = value.flatMap((block) => isRecord(block) && block.type === "tool_use" && typeof block.name === "string" ? [block] : []);
  if (tools.some((tool) => ["Edit", "Write", "NotebookEdit"].includes(tool.name as string))) return "file-change";
  if (tools.some((tool) => tool.name === "Bash" && isRecord(tool.input) && isVerificationCommand(tool.input.command))) return "verification";
  if (tools.length) return "command";
  return "reasoning";
}

function isVerificationCommand(value: unknown) {
  const command = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(" ") : value;
  if (typeof command !== "string") return false;
  return /(?:^|[\s;&|])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|typecheck|build)\b|(?:pytest|vitest|jest|eslint|tsc|xcodebuild)\b|cargo\s+(?:test|check)\b|go\s+test\b|dart\s+(?:test|analyze)\b|flutter\s+(?:test|analyze)\b)/i.test(command);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, "[sensitive value hidden]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [sensitive value hidden]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[sensitive value hidden]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{8,}\b/gi, "[sensitive value hidden]")
    .replace(/\b(?:sk-|ghp_|glpat-|npm_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/gi, "[sensitive value hidden]")
    .replace(/\b[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?)\s*[:=]\s*[^\s,;]+/g, "[sensitive value hidden]")
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, "$1[sensitive value hidden]@")
    .replace(/\b(?:api[_-]?key|apikey|password|secret|authorization|bearer)\s*[:=]\s*\S+/gi, "[sensitive value hidden]");
}
