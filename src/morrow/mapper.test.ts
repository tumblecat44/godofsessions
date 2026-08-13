import assert from "node:assert/strict";
import { test } from "node:test";
import { mapPiEvent } from "./mapper.ts";

test("tool_execution_start becomes a tool chip, not a raw JSON dump", () => {
  const views = mapPiEvent({
    type: "tool_execution_start",
    toolCallId: "call_1",
    toolName: "bash",
    args: { command: "ls" },
  });
  assert.equal(views.length, 1);
  assert.equal(views[0].kind, "tool_chip");
  if (views[0].kind !== "tool_chip") throw new Error("unreachable");
  assert.equal(views[0].toolName, "bash");
  assert.equal(views[0].toolCallId, "call_1");
  assert.equal(views[0].status, "start");
  assert.equal(
    Object.prototype.hasOwnProperty.call(views[0], "raw"),
    false,
    "must not stash the raw Pi event on the view",
  );
});

test("message_update text_delta becomes transcript text", () => {
  const views = mapPiEvent({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hello" },
  });
  assert.deepEqual(views, [{ kind: "text_delta", contentIndex: 0, delta: "Hello" }]);
});

test("extension confirm becomes an approval card", () => {
  const views = mapPiEvent({
    type: "extension_ui_request",
    id: "uuid-2",
    method: "confirm",
    title: "Clear session?",
    message: "All messages will be lost.",
  });
  assert.deepEqual(views, [
    { kind: "approval", id: "uuid-2", title: "Clear session?", message: "All messages will be lost." },
  ]);
});
