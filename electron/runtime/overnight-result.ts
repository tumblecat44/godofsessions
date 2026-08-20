import { StringDecoder } from "node:string_decoder";
import type {
  OvernightExecutor,
  OvernightProviderResult,
  OvernightResultWarning,
  OvernightResultWarningCode,
} from "../../src/shared/contracts";

export const OVERNIGHT_RESULT_LIMIT = 12_000;
export const OVERNIGHT_EVENT_LINE_LIMIT = 256 * 1_024;
const WARNING_MESSAGE_LIMIT = 1_000;
const WARNING_LIMIT = 5;

export interface OvernightResultCollector {
  push(chunk: Uint8Array | string): void;
  finish(): OvernightProviderResult;
}

export function createOvernightResultCollector(executor: OvernightExecutor): OvernightResultCollector {
  const decoder = new StringDecoder("utf8");
  const warnings: OvernightResultWarning[] = [];
  let pending = "";
  let discardingOversizedLine = false;
  let report: string | undefined;
  let terminalStatus: OvernightProviderResult["status"] = "unknown";
  let finished = false;

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
    if (event.type === "item.completed" && isRecord(event.item)) {
      if (event.item.type === "agent_message") setReport(event.item.text);
      if (event.item.type === "error") warn("provider_error", { message: event.item.message });
      return;
    }
    if (event.type === "turn.completed") {
      if (terminalStatus !== "failure") terminalStatus = "success";
      return;
    }
    if (event.type === "turn.failed") {
      terminalStatus = "failure";
      warn("provider_error", { message: isRecord(event.error) ? event.error.message : undefined });
      return;
    }
    if (event.type === "error") {
      terminalStatus = "failure";
      warn("provider_error", { message: event.message });
    }
  }

  function readClaudeEvent(event: Record<string, unknown>) {
    if (event.type !== "result") return;
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
      return { status: terminalStatus, ...(report ? { report } : {}), warnings: warnings.map((warning) => ({ ...warning })) };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\b(?:sk-|ghp_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/gi, "[sensitive value hidden]")
    .replace(/\b(?:api[_-]?key|apikey|password|secret|authorization|bearer)\s*[:=]\s*\S+/gi, "[sensitive value hidden]");
}
