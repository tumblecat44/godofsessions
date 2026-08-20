import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildDailyContext } from "./daily-context";

async function jsonl(path: string, rows: unknown[]) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  await utimes(path, new Date("2026-08-13T18:00:00.000Z"), new Date("2026-08-13T18:00:00.000Z"));
}

describe("daily local session context", () => {
  it("keeps only today's user and final assistant text across supported local agents", async () => {
    const home = await mkdtemp(join(tmpdir(), "morrow-daily-context-"));
    const today = "2026-08-13T12:00:00.000Z";

    await jsonl(join(home, ".claude/projects/project/session-claude.jsonl"), [
      { type: "user", timestamp: "2026-08-12T23:59:59.000Z", sessionId: "session-claude", cwd: "/work/old", message: { content: "어제 내용" } },
      { type: "user", timestamp: today, sessionId: "session-claude", cwd: "/work/alpha", message: { content: "오늘 Claude 목표 sk-secretshouldhide" } },
      { type: "assistant", timestamp: "2026-08-13T12:01:00.000Z", sessionId: "session-claude", message: { content: [{ type: "thinking", thinking: "private chain" }, { type: "text", text: "Claude 최종 결정" }] } },
      { type: "user", timestamp: "2026-08-13T12:02:00.000Z", sessionId: "session-claude", message: { content: [{ type: "tool_result", content: "private tool output" }] } },
    ]);

    const codexDir = join(home, ".codex/sessions/2026/08/13");
    const codexRollout = join(codexDir, "rollout-session-codex.jsonl");
    await jsonl(codexRollout, [
      { type: "response_item", timestamp: today, payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Codex에서 고칠 일" }] } },
      { type: "response_item", timestamp: "2026-08-13T12:02:00.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Codex 검증 완료" }] } },
      { type: "response_item", timestamp: "2026-08-13T12:03:00.000Z", payload: { type: "function_call", name: "shell", arguments: "private" } },
    ]);
    await mkdir(join(home, ".codex"), { recursive: true });
    const codexDb = new DatabaseSync(join(home, ".codex/state_5.sqlite"));
    codexDb.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, created_at INTEGER, updated_at INTEGER, cwd TEXT, title TEXT, archived INTEGER DEFAULT 0)");
    codexDb.prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, 0)").run("session-codex", codexRollout, 1786622400, 1786622520, "/work/beta", "Codex session");
    codexDb.close();

    const grokDir = join(home, ".grok/sessions/project/session-grok");
    await jsonl(join(grokDir, "updates.jsonl"), [
      { timestamp: today, params: { update: { sessionUpdate: "user_message_chunk", content: { text: "Grok 조사 목표" } } } },
      { timestamp: "2026-08-13T12:04:00.000Z", params: { update: { sessionUpdate: "agent_message_chunk", content: { text: "Grok 조사 결론" } } } },
    ]);
    await writeFile(join(grokDir, "summary.json"), JSON.stringify({ generated_title: "Grok research", last_active_at: today, info: { cwd: "/work/gamma" } }));

    await jsonl(join(home, ".pi/agent/sessions/project/session-pi.jsonl"), [
      { type: "session", id: "session-pi", timestamp: today, cwd: "/work/delta" },
      { type: "message", timestamp: today, message: { role: "user", content: [{ type: "text", text: "Pi에서 정리할 것" }] } },
      { type: "message", timestamp: "2026-08-13T12:05:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "Pi 정리 완료" }] } },
    ]);

    await jsonl(join(home, ".openclaw/agents/main/sessions/session-openclaw.jsonl"), [
      { type: "message", timestamp: today, message: { role: "user", content: [{ type: "text", text: "OpenClaw 확인" }] } },
      { type: "message", timestamp: "2026-08-13T12:06:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "OpenClaw 결론" }] } },
    ]);

    await mkdir(join(home, ".hermes"), { recursive: true });
    const hermesDb = new DatabaseSync(join(home, ".hermes/state.db"));
    hermesDb.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT, title TEXT, started_at REAL, archived INTEGER DEFAULT 0); CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL, active INTEGER)");
    hermesDb.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, 0)").run("session-hermes", "/work/epsilon", "Hermes session", 1786622400);
    hermesDb.prepare("INSERT INTO messages VALUES (1, ?, 'user', ?, ?, 1)").run("session-hermes", "Hermes에서 이어갈 일", 1786622400);
    hermesDb.prepare("INSERT INTO messages VALUES (2, ?, 'assistant', ?, ?, 1)").run("session-hermes", "Hermes 최종 판단", 1786622460);
    hermesDb.close();

    const cursorDir = join(home, "Library/Application Support/Cursor/User/globalStorage");
    await mkdir(cursorDir, { recursive: true });
    const cursorDb = new DatabaseSync(join(cursorDir, "state.vscdb"));
    cursorDb.exec("CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB)");
    cursorDb.prepare("INSERT INTO ItemTable VALUES ('composer.composerHeaders', ?)").run(JSON.stringify({ allComposers: [{ composerId: "session-cursor", name: "Cursor plan", createdAt: 1786622400000, lastUpdatedAt: 1786622520000, trackedGitRepos: [{ repoPath: "/work/zeta" }] }] }));
    cursorDb.close();

    const snapshot = await buildDailyContext({
      home,
      now: new Date("2026-08-13T18:00:00.000Z"),
      timeZone: "UTC",
    });

    expect(snapshot.summary.date).toBe("2026-08-13");
    expect(snapshot.summary.totalSessions).toBe(7);
    expect(new Set(snapshot.summary.sessions.map((session) => session.provider))).toEqual(new Set(["claude", "codex", "grok", "cursor", "pi", "hermes", "openclaw"]));
    expect(snapshot.prompt).toContain("오늘 Claude 목표");
    expect(snapshot.prompt).toContain("Codex 검증 완료");
    expect(snapshot.prompt).toContain("Cursor plan");
    expect(snapshot.prompt).not.toContain("어제 내용");
    expect(snapshot.prompt).not.toContain("private chain");
    expect(snapshot.prompt).not.toContain("private tool output");
    expect(snapshot.prompt).not.toContain("sk-secretshouldhide");
    expect(snapshot.prompt).toContain("[민감값 숨김]");
    expect(snapshot.summary.warnings).toContain("Cursor 대화 본문은 안정적인 공개 형식이 없어 제목과 작업 위치만 포함했습니다.");
  });
});
