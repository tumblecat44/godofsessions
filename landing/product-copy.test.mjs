import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const agents = ["Claude Code", "Codex", "Grok Build", "Pi Agent"];

test("centers the public slogan and the two conversion destinations", () => {
  assert.match(html, /THE AI AGENT/);
  assert.match(html, /THAT SAVES YOU/);
  assert.match(html, /\$500/);
  assert.match(html, /EVERY NIGHT/);
  assert.match(html, /Download for macOS/);
  assert.match(html, /github\.com\/tumblecat44\/godofsessions/);
});

test("puts a product surface directly inside the hero", () => {
  const hero = html.match(/<section class="hero"[\s\S]*?<div class="provider-strip"/)?.[0] ?? "";
  assert.match(hero, /app-window/);
  assert.match(hero, /NIGHT PORTFOLIO/);
  assert.match(hero, /MORNING REVIEW/);
  assert.match(hero, /PRODUCT UI · SYNTHETIC DATA/);
});

test("names the four official execution routes without declaring universal readiness", () => {
  for (const agent of agents) assert.match(html, new RegExp(agent, "i"));
  assert.doesNotMatch(html, /Cursor|Hermes|OpenClaw/i);
  assert.match(html, /ready agents only/i);
  assert.match(html, /Nothing starts until you approve/i);
});

test("uses only the requested open-source trust line and explains the reference value below it", () => {
  assert.match(html, /OPEN SOURCE · MIT LICENSED/);
  assert.match(html, /A reference value, not a guarantee/);
  assert.ok(html.indexOf("WHY $500?") > html.indexOf("OPEN SOURCE."));
  assert.doesNotMatch(html, /local[- ]first/i);
});
