import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCommonSenseOvernightControlPlane } from "./overnight-provider-common-sense";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("common-sense Overnight control plane", () => {
  it("checks the pi terminal CLI on PATH but keeps Overnight dispatch gated", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gos-common-sense-"));
    tempDirs.push(dir);
    const hostPath = join(dir, "overnight-provider-host.js");
    const piBin = join(dir, "pi");
    await writeFile(hostPath, "export {}\n");
    await writeFile(piBin, "ok\n");
    await chmod(piBin, 0o755);
    const plane = createCommonSenseOvernightControlPlane({
      providerHostPath: hostPath,
      resolveExecutable: async (provider) => provider === "pi" ? piBin : undefined,
    }).create();

    await expect(plane.readiness.inspect("pi")).resolves.toMatchObject({
      provider: "pi",
      status: "blocked",
      reason: expect.stringMatching(/not wired up yet/i),
      checks: { installation: "verified" },
    });
    await expect(plane.containmentControl.prepareApprovedLaunch({
      planId: "plan",
      runId: "run",
      itemId: "item",
      provider: "pi",
      approvalClaimSha256: "a".repeat(64),
      fixedRoot: dir,
      worktreeKey: "root",
      runtimeDirectory: dir,
      writeScopes: [dir],
    })).resolves.toMatchObject({
      status: "blocked",
      provider: "pi",
    });
  });

  it("reports a missing pi terminal CLI as setup_required", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gos-common-sense-"));
    tempDirs.push(dir);
    const hostPath = join(dir, "overnight-provider-host.js");
    await writeFile(hostPath, "export {}\n");
    const plane = createCommonSenseOvernightControlPlane({
      providerHostPath: hostPath,
      resolveExecutable: async () => undefined,
    }).create();

    await expect(plane.readiness.inspect("pi")).resolves.toMatchObject({
      provider: "pi",
      status: "setup_required",
      checks: { installation: "missing" },
    });
  });

  it("records official login state without treating PATH as signed in", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gos-common-sense-"));
    tempDirs.push(dir);
    const hostPath = join(dir, "overnight-provider-host.js");
    const bin = join(dir, "worker");
    await writeFile(hostPath, "export {}\n");
    await writeFile(bin, "ok\n");
    await chmod(bin, 0o755);
    const plane = createCommonSenseOvernightControlPlane({
      providerHostPath: hostPath,
      resolveExecutable: async (provider) => provider === "pi" ? undefined : bin,
      probeLogin: async ({ provider }) => provider === "codex" ? "signed_out" : "signed_in",
    }).create();

    await expect(plane.readiness.inspect("claude")).resolves.toMatchObject({
      status: "ready",
      authentication: "signed_in",
      checks: { installation: "verified", authentication: "verified" },
    });
    await expect(plane.readiness.inspect("codex")).resolves.toMatchObject({
      status: "ready",
      authentication: "signed_out",
      checks: { installation: "verified", authentication: "missing" },
    });
  });
});
