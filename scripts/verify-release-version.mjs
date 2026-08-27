import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseJsonVersion(source, label) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }

  if (typeof parsed.version !== "string" || !SEMVER.test(parsed.version)) {
    throw new Error(`${label} does not contain a valid version.`);
  }
  return parsed.version;
}

export function verifyReleaseVersion({ tag, packageJson }) {
  if (typeof tag !== "string" || !tag.startsWith("v")) {
    throw new Error("Release tags must use vMAJOR.MINOR.PATCH.");
  }

  const version = tag.slice(1);
  if (!SEMVER.test(version)) {
    throw new Error("Release tags must use vMAJOR.MINOR.PATCH.");
  }

  const packageVersion = parseJsonVersion(packageJson, "package.json");
  if (packageVersion !== version) {
    throw new Error(
      `Release tag ${tag} expects ${version}, but package.json has ${packageVersion}.`,
    );
  }

  return version;
}

async function main() {
  const root = process.cwd();
  const packageJson = await readFile(path.join(root, "package.json"), "utf8");

  const version = verifyReleaseVersion({
    tag: process.env.RELEASE_TAG,
    packageJson,
  });
  process.stdout.write(`Release version verified: ${version}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === invokedPath) {
  await main();
}
