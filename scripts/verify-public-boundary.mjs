#!/usr/bin/env node

import { lstat, opendir, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

const SKIPPED_TREE_SEGMENTS = new Set([".git", "node_modules"]);

const SKIPPED_TREE_PATHS = [
  "dist",
  "landing/dist",
  "promo-video/out",
  "src-tauri/target",
  "coverage",
  "test-results",
  "playwright-report",
];

const MANUAL_REVIEW_EXTENSIONS = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp4",
  ".otf",
  ".png",
  ".svg",
  ".ttf",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
]);

const TEXT_MEDIA_EXTENSIONS = new Set([".svg"]);

const BLOCKED_FILE_EXTENSIONS = new Set([
  ".db",
  ".dmg",
  ".key",
  ".mobileprovision",
  ".p12",
  ".pem",
  ".pfx",
  ".provisionprofile",
  ".sqlite",
  ".sqlite3",
]);

const SYNTHETIC_HOME_NAMES = new Set([
  "alice",
  "example",
  "name",
  "sample",
  "test",
  "user",
  "you",
]);

const PRIVATE_PATH_PREFIXES = [
  "docs/dogfood/",
  "landing/public/downloads/",
];

const PRIVATE_EXACT_PATHS = new Set([
  "docs/launch/install-readiness.md",
  "docs/launch/x-launch-package.md",
  "wrangler.generated.json",
  "wrangler.jsonc",
]);

const INTERNAL_CREDENTIAL_BASELINES = new Map();

const CREDENTIAL_PATTERNS = [
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /gh[pousr]_[A-Za-z0-9]{36,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /xox[baprs]-[0-9A-Za-z-]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /ya29\.[0-9A-Za-z_-]{20,}/g,
  new RegExp(
    ["-{5}BEGIN", "(?:RSA |EC |OPENSSH )?PRIVATE", "KEY-{5}"].join(" "),
    "g",
  ),
];

function normalizeRelativePath(relativePath) {
  return relativePath.split(path.sep).join("/").replace(/^\.\//, "");
}

function finding(severity, rule, relativePath, message, line) {
  return {
    severity,
    rule,
    path: normalizeRelativePath(relativePath),
    message,
    ...(line === undefined ? {} : { line }),
  };
}

function lineNumberAt(content, index) {
  let line = 1;

  for (let cursor = 0; cursor < index; cursor += 1) {
    if (content.charCodeAt(cursor) === 10) {
      line += 1;
    }
  }

  return line;
}

function isEnvironmentFile(relativePath) {
  const base = path.posix.basename(relativePath);
  if (!base.startsWith(".env")) {
    return false;
  }

  return ![".env.example", ".env.sample", ".env.template"].includes(base);
}

function isLocalAgentSettings(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  return (
    normalized === ".claude/settings.local.json" ||
    normalized.startsWith(".claude/settings.local.") ||
    normalized.startsWith(".agents/settings.local.")
  );
}

function isDeclaredInternalException(relativePath) {
  const normalized = normalizeRelativePath(relativePath);

  return (
    PRIVATE_PATH_PREFIXES.some(
      (prefix) =>
        normalized === prefix.slice(0, -1) || normalized.startsWith(prefix),
    ) || PRIVATE_EXACT_PATHS.has(normalized)
  );
}

export function blockedPathReason(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const lower = normalized.toLowerCase();
  const extension = path.posix.extname(lower);

  if (isDeclaredInternalException(normalized)) {
    return "This path is private by the repository's open-source boundary.";
  }

  if (isEnvironmentFile(normalized)) {
    return "Environment files may contain credentials; publish only a synthetic example.";
  }

  if (isLocalAgentSettings(normalized)) {
    return "Machine-local agent settings must remain private.";
  }

  if (BLOCKED_FILE_EXTENSIONS.has(extension)) {
    return "Credential, database, or installer artifacts must not be tracked as public source.";
  }

  if (
    lower.endsWith(".log") ||
    lower.includes(".log.") ||
    path.posix.basename(lower).startsWith("prod-release-scan-")
  ) {
    return "Logs and local release scan output must remain private.";
  }

  return undefined;
}

export function shouldSkipTreePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const segments = normalized.split("/");

  return (
    segments.some((segment) => SKIPPED_TREE_SEGMENTS.has(segment)) ||
    SKIPPED_TREE_PATHS.some(
      (skippedPath) =>
        normalized === skippedPath || normalized.startsWith(`${skippedPath}/`),
    )
  );
}

async function discoverTreePaths(root) {
  const paths = [];

  async function visit(relativeDirectory) {
    const absoluteDirectory = path.join(root, relativeDirectory);
    const directory = await opendir(absoluteDirectory);

    for await (const entry of directory) {
      const relativePath = normalizeRelativePath(
        path.join(relativeDirectory, entry.name),
      );

      if (shouldSkipTreePath(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        await visit(relativePath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        paths.push(relativePath);
      }
    }
  }

  await visit("");
  return paths.sort();
}

function discoverTrackedPaths(root) {
  const result = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "buffer",
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString("utf8").trim();
    throw new Error(stderr || "git ls-files failed");
  }

  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalizeRelativePath)
    .sort();
}

function firstNonSyntheticHomePath(content) {
  const patterns = [
    /(?:^|[^A-Za-z0-9._/-])\/Users\/([A-Za-z0-9._-]+)/g,
    /(?:^|[^A-Za-z0-9._/-])\/home\/([A-Za-z0-9._-]+)/g,
    /[A-Za-z]:\\Users\\([A-Za-z0-9._-]+)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const homeName = match[1].toLowerCase();
      if (!SYNTHETIC_HOME_NAMES.has(homeName)) {
        return { index: match.index };
      }
    }
  }

  return undefined;
}

function firstCredential(content) {
  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(content);
    if (match) {
      return { index: match.index };
    }
  }

  return undefined;
}

function matchesInternalCredentialBaseline(
  relativePath,
  bytes,
  internalCredentialBaselines,
) {
  const expectedDigest = internalCredentialBaselines.get(relativePath);
  if (!expectedDigest) {
    return false;
  }

  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  return actualDigest === expectedDigest;
}

function configuredPrivateTerms() {
  return (process.env.PUBLIC_BOUNDARY_DENY_TERMS ?? "")
    .split("\n")
    .map((term) => term.trim())
    .filter(Boolean);
}

function firstPrivateTerm(content, privateTerms) {
  for (const term of privateTerms) {
    const index = content.indexOf(term);
    if (index !== -1) {
      return { index };
    }
  }

  return undefined;
}

export async function scanPaths({
  root,
  paths,
  privateTerms = configuredPrivateTerms(),
  allowInternalExceptions = false,
  internalCredentialBaselines = INTERNAL_CREDENTIAL_BASELINES,
}) {
  const report = {
    errors: [],
    warnings: [],
    scannedFiles: 0,
  };

  for (const candidatePath of [...new Set(paths.map(normalizeRelativePath))].sort()) {
    const privatePathTerm = firstPrivateTerm(candidatePath, privateTerms);
    if (privatePathTerm) {
      report.errors.push(
        finding(
          "error",
          "private-term-path",
          "[redacted path]",
          "A maintainer-configured private term is present in a path. The path is intentionally redacted.",
        ),
      );
      continue;
    }

    const allowedInternalException =
      allowInternalExceptions && isDeclaredInternalException(candidatePath);

    const pathReason = blockedPathReason(candidatePath);
    if (pathReason && !allowedInternalException) {
      report.errors.push(
        finding("error", "private-path", candidatePath, pathReason),
      );
      continue;
    }

    const extension = path.posix.extname(candidatePath).toLowerCase();
    if (MANUAL_REVIEW_EXTENSIONS.has(extension)) {
      report.warnings.push(
        finding(
          "warning",
          "asset-provenance",
          candidatePath,
          "Confirm authorship, redistribution rights, metadata, and visible content before publication.",
        ),
      );
    }

    const absolutePath = path.resolve(root, candidatePath);
    let fileStat;

    try {
      fileStat = await lstat(absolutePath);
    } catch {
      report.errors.push(
        finding(
          "error",
          "missing-tracked-file",
          candidatePath,
          "The tracked path is missing from the working tree.",
        ),
      );
      continue;
    }

    if (fileStat.isSymbolicLink()) {
      report.warnings.push(
        finding(
          "warning",
          "symlink-review",
          candidatePath,
          "Symbolic links are not followed; confirm that the public checkout resolves them safely.",
        ),
      );
      continue;
    }

    if (!fileStat.isFile()) {
      continue;
    }

    report.scannedFiles += 1;

    if (
      fileStat.size > MAX_TEXT_FILE_BYTES &&
      !TEXT_MEDIA_EXTENSIONS.has(extension)
    ) {
      report.warnings.push(
        finding(
          "warning",
          "large-file-review",
          candidatePath,
          "Large files are not content-scanned; review them manually before publication.",
        ),
      );

      if (allowedInternalException) {
        report.errors.push(
          finding(
            "error",
            "internal-large-file",
            candidatePath,
            "A declared internal exception is too large for content scanning and must be reviewed or split before CI can pass.",
          ),
        );
      }

      continue;
    }

    if (
      MANUAL_REVIEW_EXTENSIONS.has(extension) &&
      !TEXT_MEDIA_EXTENSIONS.has(extension)
    ) {
      continue;
    }

    const bytes = await readFile(absolutePath);
    if (bytes.includes(0)) {
      report.warnings.push(
        finding(
          "warning",
          "binary-file-review",
          candidatePath,
          "Binary files are not content-scanned; review them manually before publication.",
        ),
      );
      continue;
    }

    const content = bytes.toString("utf8");
    const homePath = firstNonSyntheticHomePath(content);
    if (homePath && !allowedInternalException) {
      report.errors.push(
        finding(
          "error",
          "absolute-home-path",
          candidatePath,
          "A non-synthetic absolute home path is present; replace it with an approved example.",
          lineNumberAt(content, homePath.index),
        ),
      );
    }

    const credential = firstCredential(content);
    const credentialIsBaselined =
      credential &&
      allowedInternalException &&
      matchesInternalCredentialBaseline(
        candidatePath,
        bytes,
        internalCredentialBaselines,
      );

    if (credential && !credentialIsBaselined) {
      report.errors.push(
        finding(
          "error",
          "credential-pattern",
          candidatePath,
          "Credential-shaped content is present. The matched value is intentionally redacted.",
          lineNumberAt(content, credential.index),
        ),
      );
    }

    const privateTerm = firstPrivateTerm(content, privateTerms);
    if (privateTerm && !allowedInternalException) {
      report.errors.push(
        finding(
          "error",
          "private-term",
          candidatePath,
          "A maintainer-configured private term is present. The matched value is intentionally redacted.",
          lineNumberAt(content, privateTerm.index),
        ),
      );
    }
  }

  return report;
}

export function formatReport(report, format = "text") {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  const lines = [
    `Public-boundary scan: ${report.errors.length} error(s), ${report.warnings.length} warning(s), ${report.scannedFiles} file(s) inspected.`,
  ];

  for (const issue of [...report.errors, ...report.warnings]) {
    const location = issue.line ? `${issue.path}:${issue.line}` : issue.path;
    lines.push(
      `${issue.severity.toUpperCase()} ${issue.rule} — ${location} — ${issue.message}`,
    );
  }

  if (report.warnings.length > 0) {
    lines.push(
      "Warnings require a human provenance/privacy review before a public release.",
    );
  }

  return `${lines.join("\n")}\n`;
}

function parseArguments(argv) {
  const options = {
    root: process.cwd(),
    mode: "tracked",
    format: "text",
    failOnWarnings: false,
    allowInternalExceptions: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--root requires a path");
      }
      options.root = path.resolve(value);
      index += 1;
    } else if (argument === "--tree") {
      options.mode = "tree";
    } else if (argument === "--tracked") {
      options.mode = "tracked";
    } else if (argument === "--json") {
      options.format = "json";
    } else if (argument === "--fail-on-warnings") {
      options.failOnWarnings = true;
    } else if (argument === "--internal-checkout") {
      options.allowInternalExceptions = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function usage() {
  return `Usage: node scripts/verify-public-boundary.mjs [options]

Options:
  --root <path>        Repository or export root (default: current directory)
  --tracked            Scan paths reported by git ls-files (default)
  --tree               Scan the filesystem tree, excluding build/dependency output
  --json               Emit machine-readable JSON
  --fail-on-warnings   Treat manual-review warnings as a failed gate
  --internal-checkout  Allow only the repository's declared private audit exceptions
  -h, --help           Show this help

Set PUBLIC_BOUNDARY_DENY_TERMS to newline-separated private project or account
names for a local, non-committed release audit. Matched values are never printed.

Never use --internal-checkout for a public export or public repository. It
exists only so this private working repository can scan all non-exception paths.
`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const paths =
    options.mode === "tree"
      ? await discoverTreePaths(options.root)
      : discoverTrackedPaths(options.root);
  const report = await scanPaths({
    root: options.root,
    paths,
    allowInternalExceptions: options.allowInternalExceptions,
  });

  process.stdout.write(formatReport(report, options.format));
  if (
    report.errors.length > 0 ||
    (options.failOnWarnings && report.warnings.length > 0)
  ) {
    process.exitCode = 1;
  }
}

function isDirectInvocation() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return (
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  main().catch((error) => {
    process.stderr.write(`Public-boundary scan failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
