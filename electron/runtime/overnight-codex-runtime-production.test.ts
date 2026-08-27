import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOfficialCodexMacOsNativeExecutableResolver,
  resolveOfficialCodexAuthJson,
  resolveOfficialCodexExecutable,
} from "./overnight-codex-runtime-production";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "morrow-codex-runtime-")));
  roots.push(root);
  return root;
}

async function app(directory: string, name: string, bundleId = "com.openai.codex") {
  const bundle = join(directory, name);
  const resources = join(bundle, "Contents", "Resources");
  await mkdir(resources, { recursive: true });
  await writeFile(join(bundle, "Contents", "Info.plist"), `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>`);
  await writeFile(join(resources, "codex"), "synthetic native payload");
  return { bundle, executable: await realpath(join(resources, "codex")) };
}

describe("official Codex production runtime resolver", () => {
  it("prefers a current official ChatGPT bundle over a legacy Codex bundle in another application directory", async () => {
    const root = await fixtureRoot();
    const userApps = join(root, "user-apps");
    const systemApps = join(root, "system-apps");
    await mkdir(userApps);
    await mkdir(systemApps);
    await app(userApps, "Codex.app");
    const current = await app(systemApps, "ChatGPT.app");

    await expect(resolveOfficialCodexExecutable({
      applicationDirectories: [userApps, systemApps],
      commandPath: "",
      platform: "darwin",
    })).resolves.toBe(current.executable);
  });

  it("accepts a renamed official bundle by exact product identity and rejects a filename-only impostor", async () => {
    const root = await fixtureRoot();
    const apps = join(root, "apps");
    await mkdir(apps);
    await app(apps, "ChatGPT.app", "com.example.unrelated");
    const renamed = await app(apps, "Morrow Developer Tool.app");

    const executable = await resolveOfficialCodexExecutable({
      applicationDirectories: [apps],
      commandPath: "",
      platform: "darwin",
    });
    expect(executable).toBe(renamed.executable);
    await expect(createOfficialCodexMacOsNativeExecutableResolver({ platform: "darwin" })({
      requestedExecutable: renamed.executable,
      requestedRealpath: renamed.executable,
    })).resolves.toEqual({
      nativeExecutable: renamed.executable,
      invocationIdentityPaths: [join(renamed.bundle, "Contents", "Info.plist"), renamed.executable],
    });
  });

  it("does not accept an unrelated app and resolves only the auth path without reading credentials", async () => {
    const root = await fixtureRoot();
    const apps = join(root, "apps");
    await mkdir(apps);
    await app(apps, "ChatGPT.app", "com.openai.chatgpt.classic");

    await expect(resolveOfficialCodexExecutable({
      applicationDirectories: [apps],
      commandPath: "",
      platform: "darwin",
    })).resolves.toBeUndefined();
    expect(resolveOfficialCodexAuthJson({ codexHome: join(root, "codex-home") }))
      .toBe(join(root, "codex-home", "auth.json"));
  });
});
