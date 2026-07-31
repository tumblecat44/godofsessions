import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createCloudflareConfig,
  writeCloudflareConfig,
} from "./create-cloudflare-config.mjs";

const deployment = {
  workerName: "sessions-example",
  customDomain: "sessions.example.com",
  macosDownloadUrl:
    "https://github.com/example/sessions/releases/latest/download/Sessions_universal.dmg",
};

test("creates a Worker and static-assets configuration without credentials", () => {
  const config = createCloudflareConfig(deployment);

  assert.equal(config.name, deployment.workerName);
  assert.equal(config.main, "landing/deploy-worker.js");
  assert.deepEqual(config.routes, [
    {
      pattern: deployment.customDomain,
      custom_domain: true,
    },
  ]);
  assert.equal("d1_databases" in config, false);
  assert.deepEqual(config.assets.run_worker_first, [
    "/download/*",
    "/downloads/God-of-Sessions_0.1.0_aarch64.dmg",
  ]);
  assert.deepEqual(config.vars, {
    MACOS_DOWNLOAD_URL: deployment.macosDownloadUrl,
  });
  assert.doesNotMatch(JSON.stringify(config), /token|account_id|password/i);
});

test("fails closed when deployment identifiers are missing or malformed", () => {
  assert.throws(
    () =>
      createCloudflareConfig({
        ...deployment,
        macosDownloadUrl: "http://downloads.example.com/app.dmg",
      }),
    /MACOS_DOWNLOAD_URL/,
  );
  assert.throws(
    () =>
      createCloudflareConfig({
        ...deployment,
        customDomain: "https://sessions.example.com/path",
      }),
    /CLOUDFLARE_CUSTOM_DOMAIN/,
  );
  assert.throws(
    () =>
      createCloudflareConfig({
        ...deployment,
        workerName: "sessions-example\nunsafe",
      }),
    /CLOUDFLARE_WORKER_NAME/,
  );
});

test("writes the generated config with owner-only permissions", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "god-of-sessions-cloudflare-"),
  );
  const outputPath = path.join(root, "wrangler.generated.json");

  try {
    await writeCloudflareConfig(outputPath, deployment);

    const parsed = JSON.parse(await readFile(outputPath, "utf8"));
    const metadata = await stat(outputPath);
    assert.equal(parsed.name, deployment.workerName);
    assert.equal(metadata.mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
