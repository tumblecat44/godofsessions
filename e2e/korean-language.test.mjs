#!/usr/bin/env node
/**
 * Electron-based test for Korean language toggle.
 * Reproduces the scenario: Settings → Conversation language → 한국어
 * 
 * The test fails if clicking 한국어 blanks the window (sidebar and content gone).
 * Uses Playwright's Electron support to drive the actual app.
 * 
 * Run: npm run build && node e2e/korean-language.test.mjs
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "@playwright/test";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const sandbox = await mkdtemp(join(tmpdir(), "gos-korean-test-"));
const userData = join(sandbox, "user-data");
const workspace = join(sandbox, "workspace");
await Promise.all([mkdir(userData), mkdir(workspace)]);

process.stdout.write(`Korean language toggle test\n`);
process.stdout.write(`Sandbox: ${sandbox}\n`);

const app = await electron.launch({
  executablePath: electronPath,
  args: [repo, `--user-data-dir=${userData}`],
  cwd: repo,
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("ELECTRON_") && k !== "NODE_OPTIONS")),
    LANG: "en_US.UTF-8",
    MORROW_ROOT: workspace,
    MORROW_VERIFY_IDENTITY: "local",
  },
});

try {
  const page = await app.firstWindow();
  
  // Install synthetic IPC to bypass real Morrow service
  await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
    const channels = [
      "github:state",
      "morrow:bootstrap", "morrow:overnight-snapshot", "morrow:start-conversation", "morrow:open-conversation",
      "morrow:send-message", "morrow:abort", "morrow:set-model", "morrow:set-thinking", "morrow:answer-approval",
      "morrow:connect-provider", "morrow:answer-auth", "morrow:disconnect-provider", "morrow:finish-onboarding",
      "morrow:refresh-daily-context", "morrow:prepare-overnight-portfolio", "morrow:start-overnight-portfolio",
      "morrow:stop-overnight-portfolio", "morrow:verify-overnight-provider", "morrow:open-external",
    ];
    for (const channel of channels) ipcMain.removeHandler(channel);
    
    let currentLanguage = "en";
    const bootstrap = () => ({
      rootName: "test-workspace",
      rootPath: "/tmp/korean-test-workspace",
      onboardingComplete: true,
      language: currentLanguage,
      thinkingLevel: "medium",
      providers: [],
      models: [],
      conversations: [],
      orchestration: {
        context: { date: "2026-08-27", timeZone: "UTC", generatedAt: new Date().toISOString(), totalSessions: 0, providerCounts: {}, sessions: [], warnings: [], methodology: "test" },
        providerRoutes: [{ provider: "codex", label: "Codex", status: "ready" }],
        portfolioAssessments: [],
        portfolioPlans: [],
        portfolioRuns: [],
        overnightCards: [],
      },
    });
    
    ipcMain.handle("github:state", () => ({ status: "authenticated", profile: { id: 42, login: "test-user" } }));
    ipcMain.handle("morrow:bootstrap", () => JSON.parse(JSON.stringify(bootstrap())));
    ipcMain.handle("morrow:overnight-snapshot", () => JSON.parse(JSON.stringify(bootstrap().orchestration)));
    ipcMain.handle("morrow:finish-onboarding", (_event, input) => {
      currentLanguage = input.language;
      process.stdout.write?.(`Language changed to: ${currentLanguage}\n`);
    });
    
    for (const channel of channels.filter(c => !["github:state", "morrow:bootstrap", "morrow:overnight-snapshot", "morrow:finish-onboarding"].includes(c))) {
      ipcMain.handle(channel, () => undefined);
    }
  });
  
  await page.reload();
  
  // Wait for the app to render with English
  await page.getByRole("button", { name: "Ask Morrow" }).waitFor({ timeout: 10_000 });
  process.stdout.write("✓ App loaded with English\n");
  
  // Navigate to Settings
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Settings" }).waitFor({ timeout: 5_000 });
  process.stdout.write("✓ Settings opened\n");
  
  // Click 한국어 button
  await page.getByRole("button", { name: "한국어" }).click();
  
  // Wait a moment for the transition
  await page.waitForTimeout(500);
  
  // Verify the shell is still visible (not blank)
  // The sidebar should show Korean text
  const sidebarVisible = await page.getByRole("button", { name: "Morrow에게 묻기" }).isVisible().catch(() => false);
  const settingsVisible = await page.getByRole("button", { name: "설정" }).isVisible().catch(() => false);
  const headingVisible = await page.getByRole("heading", { name: "설정" }).isVisible().catch(() => false);
  
  // Take a screenshot for evidence
  const screenshotPath = join(sandbox, "korean-toggle.png");
  await page.screenshot({ path: screenshotPath });
  process.stdout.write(`Screenshot saved: ${screenshotPath}\n`);
  
  // These assertions fail if the window is blank
  assert.ok(sidebarVisible, "Sidebar 'Morrow에게 묻기' button should be visible after switching to Korean");
  assert.ok(settingsVisible, "Sidebar '설정' button should be visible after switching to Korean");
  assert.ok(headingVisible, "Settings heading '설정' should be visible in Korean");
  
  process.stdout.write("✓ Korean toggle successful - shell remains visible\n");
  
  // Switch back to English
  await page.getByRole("button", { name: "English" }).click();
  await page.waitForTimeout(500);
  
  const englishHeadingVisible = await page.getByRole("heading", { name: "Settings" }).isVisible().catch(() => false);
  assert.ok(englishHeadingVisible, "Settings heading should be visible in English after switching back");
  
  process.stdout.write("✓ English toggle successful\n");
  process.stdout.write("PASS: Korean language toggle does not blank the window\n");
  
} catch (error) {
  process.stderr.write(`FAIL: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await app.close();
  await rm(sandbox, { recursive: true, force: true });
}
