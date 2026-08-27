import { constants } from "node:fs";
import { access, lstat, readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, sep } from "node:path";
import {
  createCodexMacOsNativeExecutableResolver,
} from "./overnight-provider-containment-production";
import type { MacOsNativeExecutableResolver } from "./overnight-provider-containment-macos";

const CODEX_BUNDLE_IDENTIFIER = "com.openai.codex";
const CURRENT_BUNDLE_NAME = "ChatGPT.app";
const LEGACY_BUNDLE_NAME = "Codex.app";

export interface OfficialCodexRuntimeResolutionOptions {
  applicationDirectories?: readonly string[];
  commandPath?: string;
  codexHome?: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
}

/**
 * Resolves the official desktop-bundled runtime first, then a statically
 * validated @openai/codex package selector. It never starts Codex or reads
 * authentication contents.
 */
export async function resolveOfficialCodexExecutable(
  options: OfficialCodexRuntimeResolutionOptions = {},
): Promise<string | undefined> {
  if ((options.platform ?? process.platform) !== "darwin") return undefined;
  const applicationDirectories = options.applicationDirectories ?? [
    join(homedir(), "Applications"),
    "/Applications",
  ];
  const orderedBundles = [CURRENT_BUNDLE_NAME, LEGACY_BUNDLE_NAME]
    .flatMap((name) => applicationDirectories.map((directory) => join(directory, name)));
  const named = new Set(orderedBundles);
  for (const bundle of orderedBundles) {
    const executable = await officialBundleExecutable(bundle);
    if (executable) return executable;
  }

  for (const directory of applicationDirectories) {
    let entries: string[];
    try {
      entries = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
        .map((entry) => join(directory, entry.name))
        .filter((entry) => !named.has(entry))
        .sort();
    } catch {
      continue;
    }
    for (const bundle of entries) {
      const executable = await officialBundleExecutable(bundle);
      if (executable) return executable;
    }
  }

  const packageResolver = createCodexMacOsNativeExecutableResolver({
    platform: options.platform,
    arch: options.arch,
  });
  const commandDirectories = (options.commandPath ?? process.env.PATH ?? "")
    .split(delimiter)
    .filter(isAbsolute);
  for (const directory of [...new Set(commandDirectories)]) {
    const candidate = join(directory, "codex");
    try {
      await access(candidate, constants.X_OK);
      const requestedRealpath = await realpath(candidate);
      if (!(await lstat(requestedRealpath)).isFile()) continue;
      await packageResolver({ requestedExecutable: candidate, requestedRealpath });
      return requestedRealpath;
    } catch {
      // A filename alone is not official runtime evidence.
    }
  }
  return undefined;
}

export function resolveOfficialCodexAuthJson(
  options: OfficialCodexRuntimeResolutionOptions = {},
) {
  const configured = options.codexHome ?? process.env.CODEX_HOME;
  const codexHome = configured && isAbsolute(configured) ? configured : join(homedir(), ".codex");
  return join(codexHome, "auth.json");
}

/**
 * Accepts the exact native payload in an official Codex desktop bundle or the
 * documented package selector. The bundle Info.plist is included in the
 * invocation identity so a product-identity change invalidates attestation.
 */
export function createOfficialCodexMacOsNativeExecutableResolver(
  options: Pick<OfficialCodexRuntimeResolutionOptions, "platform" | "arch"> = {},
): MacOsNativeExecutableResolver {
  const packageResolver = createCodexMacOsNativeExecutableResolver(options);
  return async (input) => {
    const bundle = await officialBundleForExecutable(input.requestedRealpath);
    if (bundle) {
      return {
        nativeExecutable: input.requestedRealpath,
        invocationIdentityPaths: [bundle.infoPlist, input.requestedRealpath],
      };
    }
    return packageResolver(input);
  };
}

async function officialBundleExecutable(bundleInput: string) {
  try {
    const bundle = await realpath(bundleInput);
    if (!(await lstat(bundle)).isDirectory()) return undefined;
    const infoPlist = join(bundle, "Contents", "Info.plist");
    if (await bundleIdentifier(infoPlist) !== CODEX_BUNDLE_IDENTIFIER) return undefined;
    const executable = await realpath(join(bundle, "Contents", "Resources", "codex"));
    if (!(await lstat(executable)).isFile() || !within(bundle, executable)) return undefined;
    return executable;
  } catch {
    return undefined;
  }
}

async function officialBundleForExecutable(executable: string) {
  try {
    const canonicalExecutable = await realpath(executable);
    if (basename(canonicalExecutable) !== "codex"
      || basename(dirname(canonicalExecutable)) !== "Resources"
      || basename(dirname(dirname(canonicalExecutable))) !== "Contents") return undefined;
    const bundle = dirname(dirname(dirname(canonicalExecutable)));
    if (!bundle.endsWith(".app") || !within(bundle, canonicalExecutable)) return undefined;
    const infoPlist = join(bundle, "Contents", "Info.plist");
    if (await bundleIdentifier(infoPlist) !== CODEX_BUNDLE_IDENTIFIER) return undefined;
    return { bundle, infoPlist };
  } catch {
    return undefined;
  }
}

async function bundleIdentifier(infoPlist: string) {
  const contents = await readFile(infoPlist, "utf8");
  if (Buffer.byteLength(contents, "utf8") > 1024 * 1024) return undefined;
  const match = contents.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]{1,256})<\/string>/u);
  return match ? decodeXml(match[1].trim()) : undefined;
}

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

function within(parent: string, child: string) {
  return child === parent || child.startsWith(`${parent}${sep}`);
}
