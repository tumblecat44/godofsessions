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

function codexCommandReceipt(command: string, exitCode = 0) {
  return { type: "item.completed", item: { type: "command_execution", command, exit_code: exitCode, status: "completed" } };
}

describe("Overnight provider result collector", () => {
  it("keeps the last Codex agent message and requires a completed turn", () => {
    const collector = createOvernightResultCollector("codex");
    collector.push(lines(
      { type: "item.completed", item: { id: "first", type: "agent_message", text: "중간 보고" } },
      { type: "item.completed", item: { id: "last", type: "agent_message", text: "최종 보고 · 검증 통과" } },
      { type: "turn.completed", usage: {} },
    ));

    expect(collector.finish()).toEqual({ status: "success", report: "최종 보고 · 검증 통과", warnings: [] });
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
    expect(result.status).toBe("failure");
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

  it("redacts private keys, cloud keys, package tokens, and URL passwords from a retained report", () => {
    const collector = createOvernightResultCollector("codex");
    const syntheticPrivateKey = ["-----BEGIN", "PRIVATE KEY-----\nprivate-material\n-----END", "PRIVATE KEY-----"].join(" ");
    const syntheticAwsKey = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
    const syntheticEnvSecret = `${["GITHUB", "TOKEN"].join("_")}=${["private", "opaque", "value"].join("-")}`;
    const syntheticFineGrainedToken = ["github", "pat", "privateexampletoken"].join("_");
    collector.push(lines(
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: [
            syntheticPrivateKey,
            syntheticAwsKey,
            syntheticEnvSecret,
            syntheticFineGrainedToken,
            "npm_privateexampletoken",
            "https://user:private-password@example.test/path",
          ].join(" "),
        },
      },
      { type: "turn.completed" },
    ));

    const serialized = JSON.stringify(collector.finish());
    expect(serialized).not.toContain("private-material");
    expect(serialized).not.toContain(syntheticAwsKey);
    expect(serialized).not.toContain(syntheticEnvSecret);
    expect(serialized).not.toContain(syntheticFineGrainedToken);
    expect(serialized).not.toContain("privateexampletoken");
    expect(serialized).not.toContain("private-password");
  });

  it("does not call a terminal success completed without a final report", () => {
    const codex = createOvernightResultCollector("codex");
    codex.push(lines({ type: "turn.completed" }));
    expect(codex.finish()).toEqual({ status: "unknown", warnings: [] });

    const claude = createOvernightResultCollector("claude");
    claude.push(lines({ type: "result", subtype: "success", is_error: false, result: "", permission_denials: [] }));
    expect(claude.finish()).toEqual({ status: "unknown", warnings: [] });
  });

  it("does not treat a vague final message as verified success", () => {
    const collector = createOvernightResultCollector("codex");
    collector.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "Done." } },
      { type: "turn.completed" },
    ));

    expect(collector.finish()).toEqual({ status: "unknown", report: "Done.", warnings: [] });
  });

  it("downgrades a successful provider turn when the worker reports failed or missing verification", () => {
    const failed = createOvernightResultCollector("codex");
    failed.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "Implementation finished, but npm test failed." } },
      { type: "turn.completed" },
    ));
    expect(failed.finish()).toEqual({ status: "failure", report: "Implementation finished, but npm test failed.", warnings: [] });

    const unverified = createOvernightResultCollector("claude");
    unverified.push(lines({ type: "result", subtype: "success", is_error: false, result: "The ADR was edited, but verification was not run.", permission_denials: [] }));
    expect(unverified.finish()).toEqual({ status: "failure", report: "The ADR was edited, but verification was not run.", warnings: [] });
  });

  it("never treats a completed command with nonzero evidence as verified success", () => {
    for (const report of [
      "npm test completed with exit code 1.",
      "npm test completed unsuccessfully.",
      "npm test completed with 3 errors.",
    ]) {
      const collector = createOvernightResultCollector("codex", undefined, "Run npm test and require exit code 0.");
      collector.push(lines(
        { type: "item.completed", item: { type: "agent_message", text: report } },
        { type: "turn.completed" },
      ));
      expect(collector.finish().status, report).toBe("failure");
    }

    const ambiguous = createOvernightResultCollector("codex", undefined, "Run npm test and require exit code 0.");
    ambiguous.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "npm test completed." } },
      { type: "turn.completed" },
    ));
    expect(ambiguous.finish().status).toBe("unknown");
  });

  it("rejects a success claim contradicted by incomplete or remaining-failure evidence", () => {
    for (const report of [
      "npm run check passed with exit code 0; however verification is incomplete.",
      "npm run check and npm test both passed with exit code 0, but two failures remain.",
    ]) {
      const collector = createOvernightResultCollector("codex", undefined, "Run npm run check and npm test; both must exit 0.");
      collector.push(lines(
        { type: "item.completed", item: { type: "agent_message", text: report } },
        { type: "turn.completed" },
      ));
      expect(collector.finish().status, report).toBe("failure");
    }
  });

  it("accepts explicit command or observable verification evidence in the final report", () => {
    const command = createOvernightResultCollector("codex");
    command.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "npm run check passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(command.finish().status).toBe("success");

    const observable = createOvernightResultCollector("claude");
    observable.push(lines({ type: "result", subtype: "success", is_error: false, result: "The ADR file contains the required Decision and Risks sections.", permission_denials: [] }));
    expect(observable.finish().status).toBe("success");
  });

  it("does not substitute a different successful command for the approved verification", () => {
    const collector = createOvernightResultCollector("codex", undefined, "Run npm run check and require exit code 0.");
    collector.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "npm test passed with exit code 0." } },
      { type: "turn.completed" },
    ));

    expect(collector.finish().status).toBe("unknown");
  });

  it("does not count an approved command that is merely mentioned beside a different passing command", () => {
    const collector = createOvernightResultCollector("codex", undefined, "Run npm run check and require exit code 0.");
    collector.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "The approved command was npm run check. npm test passed with exit code 0." } },
      { type: "turn.completed" },
    ));

    expect(collector.finish().status).toBe("unknown");
  });

  it("requires all approved command arguments rather than accepting a shorter prefix", () => {
    const shortened = createOvernightResultCollector("codex", undefined, "Run npm test -- checkout --runInBand and require exit code 0.");
    shortened.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "npm test -- checkout passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(shortened.finish().status).toBe("unknown");

    const exact = createOvernightResultCollector("codex", undefined, "Run npm test -- checkout --runInBand and require exit code 0.");
    exact.push(lines(
      codexCommandReceipt("npm test -- checkout --runInBand"),
      { type: "item.completed", item: { type: "agent_message", text: "npm test -- checkout --runInBand passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(exact.finish().status).toBe("success");
  });

  it("requires success evidence for each mentioned approved command rather than one command in the sentence", () => {
    const collector = createOvernightResultCollector("codex", undefined, "Run npm run check and npm test; both must exit 0.");
    collector.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "npm run check and npm test passed with exit code 0." } },
      { type: "turn.completed" },
    ));

    expect(collector.finish().status).toBe("unknown");
  });

  it("requires every approved verification command to appear in the final report", () => {
    const partial = createOvernightResultCollector("codex", undefined, "Run npm test -- checkout and npm run check; both must exit 0.");
    partial.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "npm run check passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(partial.finish().status).toBe("unknown");

    const complete = createOvernightResultCollector("codex", undefined, "Run npm test -- checkout and npm run check; both must exit 0.");
    complete.push(lines(
      codexCommandReceipt("npm test -- checkout"),
      codexCommandReceipt("npm run check"),
      { type: "item.completed", item: { type: "agent_message", text: "npm test -- checkout passed, then npm run check passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(complete.finish().status).toBe("success");

    const shared = createOvernightResultCollector("codex", undefined, "Run npm test and npm run check; both must exit 0.");
    shared.push(lines(
      codexCommandReceipt("npm test"),
      codexCommandReceipt("npm run check"),
      { type: "item.completed", item: { type: "agent_message", text: "npm test and npm run check both passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(shared.finish().status).toBe("success");
  });

  it("ties observable final evidence to the approved verification anchors", () => {
    const unrelated = createOvernightResultCollector("claude", undefined, "The ADR file must contain Decision and Risks sections.");
    unrelated.push(lines({ type: "result", subtype: "success", is_error: false, result: "The README file contains the install section.", permission_denials: [] }));
    expect(unrelated.finish().status).toBe("unknown");

    const matching = createOvernightResultCollector("claude", undefined, "The ADR file must contain Decision and Risks sections.");
    matching.push(lines({ type: "result", subtype: "success", is_error: false, result: "The ADR file contains the required Decision and Risks sections.", permission_denials: [] }));
    expect(matching.finish().status).toBe("success");
  });

  it("does not accept observable evidence that repeats the right nouns with the opposite result", () => {
    const expected = "The checkout screenshot must show the repaired transition without a spinner.";
    for (const report of [
      "The checkout screenshot does not show the repaired transition and the spinner remains visible.",
      "The checkout screenshot does not show the repaired transition. No spinner is visible.",
      "The checkout screenshot shows a damaged transition. No spinner is visible.",
      "The checkout screenshot shows the repaired transition is broken. The spinner is absent.",
    ]) {
      const contradicted = createOvernightResultCollector("claude", undefined, expected);
      contradicted.push(lines({ type: "result", subtype: "success", is_error: false, result: report, permission_denials: [] }));
      expect(contradicted.finish().status, report).toBe("unknown");
    }

    const matching = createOvernightResultCollector("claude", undefined, expected);
    matching.push(lines({ type: "result", subtype: "success", is_error: false, result: "The checkout screenshot shows the repaired transition. No spinner is visible.", permission_denials: [] }));
    expect(matching.finish().status).toBe("success");
  });

  it("matches Korean observable evidence without treating particles and predicates as proof", () => {
    const expected = "체크아웃 화면에 스피너가 없고 수정된 전환이 보여야 한다.";
    const contradicted = createOvernightResultCollector("claude", undefined, expected);
    for (const report of [
      "체크아웃 화면에 스피너가 없고 수정되지 않은 전환이 보인다.",
      "체크아웃 화면에 스피너가 없고 수정된 전환이 깨져 있다.",
    ]) {
      const contradicted = createOvernightResultCollector("claude", undefined, expected);
      contradicted.push(lines({ type: "result", subtype: "success", is_error: false, result: report, permission_denials: [] }));
      expect(contradicted.finish().status, report).toBe("unknown");
    }

    const matching = createOvernightResultCollector("claude", undefined, expected);
    matching.push(lines({ type: "result", subtype: "success", is_error: false, result: "체크아웃 화면에 스피너가 없고 수정된 전환이 보인다.", permission_denials: [] }));
    expect(matching.finish().status).toBe("success");
  });

  it("requires both command receipts and observable evidence for a mixed verification contract", () => {
    const expected = "Run npm test and require exit code 0; the checkout screenshot must show the repaired transition without a spinner.";
    const commandOnly = createOvernightResultCollector("codex", undefined, expected);
    commandOnly.push(lines(
      codexCommandReceipt("npm test"),
      { type: "item.completed", item: { type: "agent_message", text: "npm test passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(commandOnly.finish().status).toBe("unknown");

    const complete = createOvernightResultCollector("codex", undefined, expected);
    complete.push(lines(
      codexCommandReceipt("npm test"),
      { type: "item.completed", item: { type: "agent_message", text: "npm test passed with exit code 0. The checkout screenshot shows the repaired transition and the spinner is absent." } },
      { type: "turn.completed" },
    ));
    expect(complete.finish().status).toBe("success");
  });

  it("does not accept passed-except or skipped-required-check reports as verified success", () => {
    const except = createOvernightResultCollector("codex");
    except.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "All tests passed except the checkout regression test." } },
      { type: "turn.completed" },
    ));
    expect(except.finish().status).toBe("failure");

    const skipped = createOvernightResultCollector("codex");
    skipped.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "npm test passed, but npm run check was skipped." } },
      { type: "turn.completed" },
    ));
    expect(skipped.finish().status).toBe("failure");
  });

  it("rejects a required command mentioned only after saying it was not run", () => {
    const collector = createOvernightResultCollector("codex", undefined, "Run npm run check and require exit code 0.");
    collector.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "I did not run npm run check. npm test passed with exit code 0." } },
      { type: "turn.completed" },
    ));

    expect(collector.finish().status).toBe("failure");
  });

  it("rejects a Korean report that says the approved command was not run", () => {
    const collector = createOvernightResultCollector("codex", undefined, "Run npm run check and require exit code 0.");
    collector.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "npm run check는 실행하지 않았지만 npm test는 종료 코드 0으로 통과했습니다." } },
      { type: "turn.completed" },
    ));

    expect(collector.finish().status).toBe("failure");
  });

  it("accepts verification that failed initially and explicitly passed after the fix", () => {
    const collector = createOvernightResultCollector("codex");
    collector.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "npm test failed initially, then passed after the patch with exit code 0." } },
      { type: "turn.completed" },
    ));

    expect(collector.finish().status).toBe("success");
  });

  it("accepts an approved command that explicitly passes on a later rerun sentence", () => {
    const collector = createOvernightResultCollector("codex", undefined, "Run npm run check and require exit code 0.");
    collector.push(lines(
      codexCommandReceipt("npm run check", 1),
      codexCommandReceipt("npm run check"),
      { type: "item.completed", item: { type: "agent_message", text: "npm run check failed initially. After the fix, npm run check passed with exit code 0." } },
      { type: "turn.completed" },
    ));

    expect(collector.finish().status).toBe("success");
  });

  it("does not let a different passing command recover a failed approved command", () => {
    const collector = createOvernightResultCollector("codex", undefined, "Run npm run check and npm test; both must exit 0.");
    collector.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "npm run check failed, then npm test passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(collector.finish().status).toBe("failure");

    const recovered = createOvernightResultCollector("codex", undefined, "Run npm run check and npm test; both must exit 0.");
    recovered.push(lines(
      codexCommandReceipt("npm run check", 1),
      codexCommandReceipt("npm run check"),
      codexCommandReceipt("npm test"),
      { type: "item.completed", item: { type: "agent_message", text: "npm run check failed, then npm run check passed. npm test passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(recovered.finish().status).toBe("success");
  });

  it("requires in-memory provider receipts for approved commands", () => {
    const withoutReceipt = createOvernightResultCollector("codex", undefined, "Run npm run check and require exit code 0.");
    withoutReceipt.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "npm run check passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(withoutReceipt.finish().status).toBe("unknown");

    const claude = createOvernightResultCollector("claude", undefined, "Run npm run check and require exit code 0.");
    claude.push(lines(
      { type: "assistant", message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm run check" } }] } },
      { type: "user", exit_code: 0, message: { content: [{ type: "tool_result", tool_use_id: "tool-1" }] }, tool_use_result: { interrupted: false } },
      { type: "result", subtype: "success", is_error: false, result: "npm run check passed with exit code 0.", permission_denials: [] },
    ));
    expect(claude.finish().status).toBe("success");
  });

  it("requires a structured receipt for an approved interpreter verification command", () => {
    const verification = "Run node scripts/verify.mjs and confirm output contains PASS.";
    const withoutReceipt = createOvernightResultCollector("codex", undefined, verification);
    withoutReceipt.push(lines(
      { type: "item.completed", item: { type: "agent_message", text: "node scripts/verify.mjs passed; output contains PASS." } },
      { type: "turn.completed" },
    ));
    expect(withoutReceipt.finish().status).toBe("unknown");

    const withReceipt = createOvernightResultCollector("codex", undefined, verification);
    withReceipt.push(lines(
      codexCommandReceipt("node scripts/verify.mjs"),
      { type: "item.completed", item: { type: "agent_message", text: "node scripts/verify.mjs passed; output contains PASS." } },
      { type: "turn.completed" },
    ));
    expect(withReceipt.finish().status).toBe("success");
  });

  it("does not accept a zero-exit receipt produced by failure-masking shell syntax", () => {
    for (const command of [
      "npm run check || true",
      "npm run check; exit 0",
      "npm run check | cat",
      "npm run check & true",
      "echo 'npm run check' && true",
      "printf npm\\ run\\ check && true",
    ]) {
      const collector = createOvernightResultCollector("codex", undefined, "Run npm run check and require exit code 0.");
      collector.push(lines(
        codexCommandReceipt(command),
        { type: "item.completed", item: { type: "agent_message", text: "npm run check passed with exit code 0." } },
        { type: "turn.completed" },
      ));
      expect(collector.finish().status, command).toBe("unknown");
    }
  });

  it("accepts one successful receipt when approved commands are joined by fail-fast AND", () => {
    const collector = createOvernightResultCollector("codex", undefined, "Run npm run check and npm test; both must exit 0.");
    collector.push(lines(
      codexCommandReceipt("npm run check && npm test"),
      { type: "item.completed", item: { type: "agent_message", text: "npm run check and npm test both passed with exit code 0." } },
      { type: "turn.completed" },
    ));

    expect(collector.finish().status).toBe("success");
  });

  it("unwraps Codex shell-launch receipts without accepting echoed command text", () => {
    const verified = createOvernightResultCollector("codex", undefined, "Run npm run check and require exit code 0.");
    verified.push(lines(
      codexCommandReceipt("/bin/zsh -lc 'npm run check'"),
      { type: "item.completed", item: { type: "agent_message", text: "npm run check passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(verified.finish().status).toBe("success");

    const echoed = createOvernightResultCollector("codex", undefined, "Run npm run check and require exit code 0.");
    echoed.push(lines(
      codexCommandReceipt("/bin/bash -lc \"echo 'npm run check' && true\""),
      { type: "item.completed", item: { type: "agent_message", text: "npm run check passed with exit code 0." } },
      { type: "turn.completed" },
    ));
    expect(echoed.finish().status).toBe("unknown");
  });

  it("preserves split UTF-8 and recovers after malformed JSON", () => {
    const collector = createOvernightResultCollector("codex");
    const stream = Buffer.from(lines(
      "not-json",
      { type: "item.completed", item: { id: "last", type: "agent_message", text: "한글 최종 보고 · 검증 통과" } },
      { type: "turn.completed", usage: {} },
    ));
    for (const byte of stream) collector.push(Uint8Array.of(byte));

    expect(collector.finish()).toEqual({
      status: "success",
      report: "한글 최종 보고 · 검증 통과",
      warnings: [{ code: "invalid_event" }],
    });
  });

  it("bounds event lines and result text without losing later terminal evidence", () => {
    const collector = createOvernightResultCollector("codex");
    collector.push(`${"x".repeat(OVERNIGHT_EVENT_LINE_LIMIT + 1)}\n`);
    collector.push(lines(
      { type: "item.completed", item: { id: "last", type: "agent_message", text: `Verification passed. ${"r".repeat(OVERNIGHT_RESULT_LIMIT + 20)}` } },
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

  it("emits only content-free Codex activity categories while retaining the final result", () => {
    const activity: string[] = [];
    const collector = createOvernightResultCollector("codex", (next) => activity.push(next));
    collector.push(lines(
      { type: "turn.started" },
      { type: "item.started", item: { type: "reasoning", text: "private reasoning" } },
      { type: "item.completed", item: { type: "command_execution", command: "cat /private/path" } },
      { type: "item.completed", item: { type: "file_change", changes: [{ path: "/private/path" }] } },
      { type: "item.completed", item: { type: "agent_message", text: "Safe final report. Verification passed." } },
      { type: "turn.completed" },
    ));

    expect(activity).toEqual(["working", "reasoning", "command", "file-change", "reporting", "reporting"]);
    expect(JSON.stringify(activity)).not.toContain("private");
    expect(collector.finish()).toMatchObject({ status: "success", report: "Safe final report. Verification passed." });
  });

  it("classifies Claude tool activity without retaining tool input", () => {
    const activity: string[] = [];
    const collector = createOvernightResultCollector("claude", (next) => activity.push(next));
    collector.push(lines(
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { path: "/private/path" } }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "secret" } }] } },
      { type: "result", subtype: "success", is_error: false, result: "Done", permission_denials: [] },
    ));

    expect(activity).toEqual(["file-change", "command", "reporting"]);
    expect(JSON.stringify(activity)).not.toContain("private");
    expect(JSON.stringify(activity)).not.toContain("secret");
  });

  it("distinguishes verification commands without retaining their contents", () => {
    const codexActivity: string[] = [];
    const codex = createOvernightResultCollector("codex", (next) => codexActivity.push(next));
    codex.push(lines({ type: "item.started", item: { type: "command_execution", command: "npm test -- private-suite" } }));
    expect(codexActivity).toEqual(["verification"]);

    const claudeActivity: string[] = [];
    const claude = createOvernightResultCollector("claude", (next) => claudeActivity.push(next));
    claude.push(lines({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm run check -- private-suite" } }] } }));
    expect(claudeActivity).toEqual(["verification"]);
    expect(JSON.stringify([codexActivity, claudeActivity])).not.toContain("private-suite");
  });
});
