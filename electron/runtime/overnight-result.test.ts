import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import {
  createOvernightResultCollector,
  OVERNIGHT_EVENT_LINE_LIMIT,
  OVERNIGHT_RESULT_LIMIT,
} from "./overnight-result";

function lines(...events: unknown[]) {
  return `${events.map((event) => typeof event === "string" ? event : JSON.stringify(event)).join("\n")}\n`;
}

describe("Overnight provider result collector", () => {
  it("keeps the last Codex agent message and requires a completed turn", () => {
    const collector = createOvernightResultCollector("codex");
    collector.push(lines(
      { type: "item.completed", item: { id: "first", type: "agent_message", text: "중간 보고" } },
      { type: "item.completed", item: { id: "last", type: "agent_message", text: "최종 보고 · 검증 완료" } },
      { type: "turn.completed", usage: {} },
    ));

    expect(collector.finish()).toEqual({ status: "success", report: "최종 보고 · 검증 완료", warnings: [] });
  });

  it("lets Codex terminal failure override a zero-exit-shaped final message", () => {
    const collector = createOvernightResultCollector("codex");
    collector.push(lines(
      { type: "item.completed", item: { id: "partial", type: "agent_message", text: "부분 보고" } },
      { type: "turn.failed", error: { message: "verification command failed" } },
    ));

    expect(collector.finish()).toEqual({
      status: "failure",
      report: "부분 보고",
      warnings: [{ code: "provider_error", message: "verification command failed" }],
    });
  });

  it("reads Claude success and treats contradictory is_error as failure", () => {
    const success = createOvernightResultCollector("claude");
    success.push(lines({ type: "result", subtype: "success", is_error: false, result: "Tests passed", permission_denials: [] }));
    expect(success.finish()).toEqual({ status: "success", report: "Tests passed", warnings: [] });

    const failure = createOvernightResultCollector("claude");
    failure.push(lines({ type: "result", subtype: "success", is_error: true, result: "API failed", errors: ["gateway timeout"] }));
    expect(failure.finish()).toEqual({
      status: "failure",
      report: "API failed",
      warnings: [{ code: "provider_error", message: "gateway timeout" }],
    });
  });

  it("retains only a permission-denial count and never raw tool input", () => {
    const collector = createOvernightResultCollector("claude");
    collector.push(lines({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Completed with a denied check",
      permission_denials: [{ tool_name: "Write", tool_input: { secret: "must-not-survive" } }],
    }));

    const result = collector.finish();
    expect(result.warnings).toEqual([{ code: "permission_denials", count: 1 }]);
    expect(JSON.stringify(result)).not.toContain("Write");
    expect(JSON.stringify(result)).not.toContain("must-not-survive");
  });

  it("redacts credential-shaped values from retained report and error prose", () => {
    const collector = createOvernightResultCollector("claude");
    collector.push(lines({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "Could not use api_key=private-example-value",
      errors: ["authorization: Bearer-private-example-value"],
      permission_denials: [],
    }));

    const result = collector.finish();
    expect(result.report).toBe("Could not use [sensitive value hidden]");
    expect(result.warnings).toEqual([{ code: "provider_error", message: "[sensitive value hidden]" }]);
    expect(JSON.stringify(result)).not.toContain("private-example-value");
  });

  it("preserves split UTF-8 and recovers after malformed JSON", () => {
    const collector = createOvernightResultCollector("codex");
    const stream = Buffer.from(lines(
      "not-json",
      { type: "item.completed", item: { id: "last", type: "agent_message", text: "한글 최종 보고" } },
      { type: "turn.completed", usage: {} },
    ));
    for (const byte of stream) collector.push(Uint8Array.of(byte));

    expect(collector.finish()).toEqual({
      status: "success",
      report: "한글 최종 보고",
      warnings: [{ code: "invalid_event" }],
    });
  });

  it("bounds event lines and result text without losing later terminal evidence", () => {
    const collector = createOvernightResultCollector("codex");
    collector.push(`${"x".repeat(OVERNIGHT_EVENT_LINE_LIMIT + 1)}\n`);
    collector.push(lines(
      { type: "item.completed", item: { id: "last", type: "agent_message", text: "r".repeat(OVERNIGHT_RESULT_LIMIT + 20) } },
      { type: "turn.completed", usage: {} },
    ));

    const result = collector.finish();
    expect(result.status).toBe("success");
    expect(result.report).toHaveLength(OVERNIGHT_RESULT_LIMIT);
    expect(result.warnings).toEqual([{ code: "oversized_event" }, { code: "result_truncated" }]);
  });

  it("stays unknown when no recognized provider terminal event exists", () => {
    const collector = createOvernightResultCollector("codex");
    collector.push(lines({ type: "item.completed", item: { id: "last", type: "agent_message", text: "Unconfirmed report" } }));
    expect(collector.finish()).toEqual({ status: "unknown", report: "Unconfirmed report", warnings: [] });
  });
});
