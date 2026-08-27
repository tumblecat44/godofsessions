import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJsonPath = join(repositoryRoot, "package.json");
const hostBundle = "dist-electron/overnight-provider-host.js";
const hostSourceMap = `${hostBundle}.map`;

async function readPackageJson() {
  return JSON.parse(await readFile(packageJsonPath, "utf8"));
}

test("builds the provider host and stages only its JavaScript bundle as a flat Resource", async () => {
  const result = spawnSync(process.execPath, ["scripts/build-electron.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const artifact = await stat(join(repositoryRoot, hostBundle));
  assert.equal(artifact.isFile(), true);
  assert.ok(artifact.size > 0, "provider host bundle must not be empty");

  const packageJson = await readPackageJson();
  const resources = packageJson.build?.extraResources ?? [];
  const hostResources = resources.filter(
    (resource) => typeof resource === "object" && resource?.from === hostBundle,
  );

  assert.deepEqual(hostResources, [
    {
      from: hostBundle,
      to: "overnight-provider-host.js",
    },
  ]);
  assert.equal(
    resources.some(
      (resource) =>
        typeof resource === "object" &&
        (resource?.from === hostSourceMap || resource?.to === "overnight-provider-host.js.map"),
    ),
    false,
    "the provider host source map must not be copied outside app.asar",
  );

  assert.ok(packageJson.build.files.includes(`!${hostBundle}`));
  assert.ok(packageJson.build.files.includes(`!${hostSourceMap}`));
});
