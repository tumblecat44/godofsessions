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

function parseCargoVersion(source) {
  const packageSection = source.match(
    /(?:^|\n)\[package\][ \t]*\n([\s\S]*?)(?=\n\[[^\]]+\]|$)/,
  );
  const version = packageSection?.[1].match(
    /^[ \t]*version[ \t]*=[ \t]*"([^"]+)"/m,
  )?.[1];

  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error("src-tauri/Cargo.toml does not contain a valid version.");
  }
  return version;
}

export function verifyReleaseVersion({
  tag,
  packageJson,
  tauriConfig,
  cargoToml,
}) {
  if (typeof tag !== "string" || !tag.startsWith("v")) {
    throw new Error("Release tags must use vMAJOR.MINOR.PATCH.");
  }

  const version = tag.slice(1);
  if (!SEMVER.test(version)) {
    throw new Error("Release tags must use vMAJOR.MINOR.PATCH.");
  }

  const versions = [
    ["package.json", parseJsonVersion(packageJson, "package.json")],
    [
      "src-tauri/tauri.conf.json",
      parseJsonVersion(tauriConfig, "src-tauri/tauri.conf.json"),
    ],
    ["src-tauri/Cargo.toml", parseCargoVersion(cargoToml)],
  ];

  for (const [label, candidate] of versions) {
    if (candidate !== version) {
      throw new Error(
        `Release tag ${tag} expects ${version}, but ${label} has ${candidate}.`,
      );
    }
  }

  return version;
}

async function main() {
  const root = process.cwd();
  const [packageJson, tauriConfig, cargoToml] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8"),
    readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
    readFile(path.join(root, "src-tauri/Cargo.toml"), "utf8"),
  ]);

  const version = verifyReleaseVersion({
    tag: process.env.RELEASE_TAG,
    packageJson,
    tauriConfig,
    cargoToml,
  });
  process.stdout.write(`Release version verified: ${version}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";

if (import.meta.url === invokedPath) {
  await main();
}
