import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const localizedCopy = await readFile(new URL("./src/main.ts", import.meta.url), "utf8");
const agents = ["Codex", "Claude Code", "Grok Build", "Cursor", "Pi Agent", "Hermes", "OpenClaw"];

test("presents all seven agents as one editable, approval-gated night portfolio", () => {
  for (const agent of agents) {
    assert.match(html, new RegExp(agent));
    assert.match(localizedCopy, new RegExp(agent));
  }

  assert.match(html, /one portfolio you can edit/i);
  assert.match(html, /approve the exact portfolio once/i);
  assert.match(html, /review evidence item by item/i);
  assert.match(localizedCopy, /편집 가능한 하나의 포트폴리오/);
  assert.match(localizedCopy, /항목별 결과/);
});

test("keeps local readiness honest instead of declaring every agent runnable", () => {
  const supportTable = html.match(/<div class="support-table"[\s\S]*?<\/div>\s*<p class="support-footnote"/)?.[0] ?? "";
  const providerRows = [...supportTable.matchAll(/<strong role="cell">([^<]+)<\/strong>/g)].map((match) => match[1]);

  assert.deepEqual(providerRows, agents);
  assert.equal((supportTable.match(/Ready · Setup · Blocked/g) ?? []).length, agents.length);
  assert.match(html, /Ready requires a local\s+installation, sign-in, and proven safe task access/);
  assert.match(localizedCopy, /로컬 설치, 로그인, 안전한 작업 접근/);
  assert.doesNotMatch(html, /Via Hermes|Codex app-server|Claude Code, and Hermes still own execution/);
  assert.doesNotMatch(localizedCopy, /Hermes 경유|Codex 또는 Claude의 공식 로그인/);
});

test("separates Morrow conversation access from Overnight agent preparation", () => {
  assert.match(html, /Connecting Morrow's conversation model is separate from preparing\s+Overnight agents/);
  assert.match(localizedCopy, /Morrow의 대화 모델 연결과 야간 에이전트 준비는 서로 별개/);
});
