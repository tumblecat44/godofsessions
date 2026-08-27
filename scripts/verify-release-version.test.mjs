import assert from "node:assert/strict";
import test from "node:test";

import { verifyReleaseVersion } from "./verify-release-version.mjs";

const release = {
  tag: "v1.2.3",
  packageJson: JSON.stringify({ version: "1.2.3" }),
};

test("accepts a release tag that matches the Electron package version", () => {
  assert.equal(verifyReleaseVersion(release), "1.2.3");
});

test("accepts a semver prerelease tag", () => {
  const prerelease = {
    tag: "v1.2.3-rc.1",
    packageJson: JSON.stringify({ version: "1.2.3-rc.1" }),
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
        packageJson: JSON.stringify({ version: "1.2.4" }),
      }),
    /package\.json has 1\.2\.4/,
  );
});

test("rejects an invalid package version", () => {
  assert.throws(
    () =>
      verifyReleaseVersion({
        ...release,
        packageJson: JSON.stringify({ version: "1.2" }),
      }),
    /package\.json does not contain a valid version/,
  );
});
