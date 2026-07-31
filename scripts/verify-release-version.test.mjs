import assert from "node:assert/strict";
import test from "node:test";

import { verifyReleaseVersion } from "./verify-release-version.mjs";

const release = {
  tag: "v1.2.3",
  packageJson: JSON.stringify({ version: "1.2.3" }),
  tauriConfig: JSON.stringify({ version: "1.2.3" }),
  cargoToml: `[package]
name = "god-of-sessions"
version = "1.2.3"

[dependencies]
serde = "1"
`,
};

test("accepts a release tag that matches every package version", () => {
  assert.equal(verifyReleaseVersion(release), "1.2.3");
});

test("accepts a semver prerelease tag", () => {
  const prerelease = {
    tag: "v1.2.3-rc.1",
    packageJson: JSON.stringify({ version: "1.2.3-rc.1" }),
    tauriConfig: JSON.stringify({ version: "1.2.3-rc.1" }),
    cargoToml: `[package]\nversion = "1.2.3-rc.1"\n`,
  };

  assert.equal(verifyReleaseVersion(prerelease), "1.2.3-rc.1");
});

test("rejects malformed release tags", () => {
  assert.throws(
    () => verifyReleaseVersion({ ...release, tag: "release-1.2.3" }),
    /vMAJOR\.MINOR\.PATCH/,
  );
});

test("rejects a mismatch before any release is created", () => {
  assert.throws(
    () =>
      verifyReleaseVersion({
        ...release,
        tauriConfig: JSON.stringify({ version: "1.2.4" }),
      }),
    /tauri\.conf\.json has 1\.2\.4/,
  );
});
