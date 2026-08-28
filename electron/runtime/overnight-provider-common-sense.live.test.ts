import { describe, expect, it } from "vitest";
import { createCommonSenseOvernightControlPlane } from "./overnight-provider-common-sense";

// Live probe against the real CLIs on this machine. Run manually:
//   npx vitest run electron/runtime/overnight-provider-common-sense.live.test.ts
describe.runIf(process.env.LIVE === "1")("common-sense readiness (live)", () => {
  it("resolves a definite login state for installed CLIs", async () => {
    const plane = createCommonSenseOvernightControlPlane({ providerHostPath: process.execPath }).create();
    const readiness = await plane.readiness.inspectAll();
    console.log(JSON.stringify(readiness.map(({ provider, status, authentication, reason }) => ({ provider, status, authentication, reason })), null, 2));
    expect(readiness.length).toBeGreaterThan(0);
  }, 60_000);
});
