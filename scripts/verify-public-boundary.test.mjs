import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatReport,
  scanPaths,
  shouldSkipTreePath,
} from "./verify-public-boundary.mjs";

async function withFixture(files, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "gos-public-boundary-"));

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const destination = path.join(root, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }

    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("accepts synthetic paths used by public fixtures", async () => {
  await withFixture(
    {
      "fixtures/example.txt": [
        "/Users/example/projects/sample",
        "/Users/test/projects/sample",
        "/Users/you/projects/sample",
        "C:\\Users\\example\\projects\\sample",
      ].join("\n"),
    },
    async (root) => {
      const report = await scanPaths({
        root,
        paths: ["fixtures/example.txt"],
      });

      assert.equal(report.errors.length, 0);
      assert.equal(report.warnings.length, 0);
      assert.equal(report.scannedFiles, 1);
    },
  );
});

test("blocks private-only repository paths", async () => {
  await withFixture(
    {
      "docs/dogfood/cycle.md": "private evaluation notes",
      "src/index.ts": "export const ready = true;\n",
    },
    async (root) => {
      const report = await scanPaths({
        root,
        paths: ["docs/dogfood/cycle.md", "src/index.ts"],
      });

      assert.deepEqual(
        report.errors.map((finding) => finding.rule),
        ["private-path"],
      );
      assert.equal(report.errors[0].path, "docs/dogfood/cycle.md");
    },
  );
});

test("blocks generated deployment configuration even without credentials", async () => {
  await withFixture(
    {
      "wrangler.generated.json": JSON.stringify({
        database_id: "synthetic-id",
      }),
    },
    async (root) => {
      const report = await scanPaths({
        root,
        paths: ["wrangler.generated.json"],
      });

      assert.equal(report.errors.length, 1);
      assert.equal(report.errors[0].rule, "private-path");
      assert.equal(report.errors[0].path, "wrangler.generated.json");
    },
  );
});

test("internal mode allows only declared audit exceptions", async () => {
  await withFixture(
    {
      ".env.production": "SAFE_PLACEHOLDER=true\n",
      "docs/dogfood/cycle.md": "private evaluation notes",
      "src/index.ts": "export const ready = true;\n",
    },
    async (root) => {
      const report = await scanPaths({
        root,
        paths: [
          ".env.production",
          "docs/dogfood/cycle.md",
          "src/index.ts",
        ],
        allowInternalExceptions: true,
      });

      assert.equal(report.errors.length, 1);
      assert.equal(report.errors[0].rule, "private-path");
      assert.equal(report.errors[0].path, ".env.production");
      assert.equal(report.scannedFiles, 2);
    },
  );
});

test("internal mode still scans declared exceptions for credentials", async () => {
  const credential = `github_pat_${"a".repeat(82)}`;

  await withFixture(
    {
      "docs/dogfood/cycle.md": `token=${credential}\n`,
    },
    async (root) => {
      const report = await scanPaths({
        root,
        paths: ["docs/dogfood/cycle.md"],
        allowInternalExceptions: true,
      });
      const output = formatReport(report, "text");

      assert.equal(report.errors.length, 1);
      assert.equal(report.errors[0].rule, "credential-pattern");
      assert.doesNotMatch(output, new RegExp(credential));
    },
  );
});

test("internal credential baselines require an exact whole-file digest", async () => {
  const credential = `github_pat_${"a".repeat(82)}`;
  const content = `token=${credential}\n`;
  const candidatePath = "docs/dogfood/cycle.md";
  const digest = createHash("sha256").update(content).digest("hex");

  await withFixture(
    {
      [candidatePath]: content,
    },
    async (root) => {
      const baseline = new Map([[candidatePath, digest]]);
      const acceptedReport = await scanPaths({
        root,
        paths: [candidatePath],
        allowInternalExceptions: true,
        internalCredentialBaselines: baseline,
      });

      assert.equal(acceptedReport.errors.length, 0);

      await writeFile(
        path.join(root, candidatePath),
        `${content}changed=true\n`,
      );
      const changedReport = await scanPaths({
        root,
        paths: [candidatePath],
        allowInternalExceptions: true,
        internalCredentialBaselines: baseline,
      });

      assert.equal(changedReport.errors.length, 1);
      assert.equal(changedReport.errors[0].rule, "credential-pattern");
    },
  );
});

test("internal mode fails closed on oversized declared exceptions", async () => {
  const candidatePath = "docs/dogfood/large.txt";
  const oversizedContent = `${"x".repeat(2 * 1024 * 1024)}\n`;

  await withFixture(
    {
      [candidatePath]: oversizedContent,
    },
    async (root) => {
      const report = await scanPaths({
        root,
        paths: [candidatePath],
        allowInternalExceptions: true,
      });

      assert.equal(report.errors.length, 1);
      assert.equal(report.errors[0].rule, "internal-large-file");
      assert.equal(report.warnings.length, 1);
      assert.equal(report.warnings[0].rule, "large-file-review");
    },
  );
});

test("detects non-synthetic absolute home paths without echoing their values", async () => {
  const nonSyntheticHomePath = [
    "/Users",
    "private-person",
    "projects",
    "sample",
  ].join("/");

  await withFixture(
    {
      "docs/example.md": `Observed at ${nonSyntheticHomePath}\n`,
    },
    async (root) => {
      const report = await scanPaths({
        root,
        paths: ["docs/example.md"],
      });
      const output = formatReport(report, "text");

      assert.equal(report.errors.length, 1);
      assert.equal(report.errors[0].rule, "absolute-home-path");
      assert.equal(report.errors[0].line, 1);
      assert.doesNotMatch(output, /private-person/);
    },
  );
});

test("detects credential-shaped content and redacts the matched value", async () => {
  const credential = `github_pat_${"a".repeat(82)}`;

  await withFixture(
    {
      "notes.txt": `token=${credential}\n`,
    },
    async (root) => {
      const report = await scanPaths({
        root,
        paths: ["notes.txt"],
      });
      const output = formatReport(report, "text");

      assert.equal(report.errors.length, 1);
      assert.equal(report.errors[0].rule, "credential-pattern");
      assert.doesNotMatch(output, new RegExp(credential));
    },
  );
});

test("detects configured private terms in paths without echoing the path", async () => {
  const privateTerm = ["private", "repository"].join("-");
  const candidatePath = `docs/${privateTerm}-notes.md`;

  await withFixture(
    {
      [candidatePath]: "No private content is needed for this fixture.\n",
    },
    async (root) => {
      const report = await scanPaths({
        root,
        paths: [candidatePath],
        privateTerms: [privateTerm],
      });
      const output = formatReport(report, "text");

      assert.equal(report.errors.length, 1);
      assert.equal(report.errors[0].rule, "private-term-path");
      assert.equal(report.errors[0].path, "[redacted path]");
      assert.doesNotMatch(output, new RegExp(privateTerm));
    },
  );
});

test("marks redistributable media for manual provenance review", async () => {
  await withFixture(
    {
      "assets/preview.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    },
    async (root) => {
      const report = await scanPaths({
        root,
        paths: ["assets/preview.png"],
      });

      assert.equal(report.errors.length, 0);
      assert.equal(report.warnings.length, 1);
      assert.equal(report.warnings[0].rule, "asset-provenance");
    },
  );
});

test("does not follow symlinks outside the candidate tree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gos-public-boundary-"));
  const outsideRoot = await mkdtemp(
    path.join(os.tmpdir(), "gos-public-boundary-outside-"),
  );

  try {
    const outsideFile = path.join(outsideRoot, "private.txt");
    const nonSyntheticHomePath = [
      "/Users",
      "private-person",
      "projects",
      "sample",
    ].join("/");
    await writeFile(
      outsideFile,
      `Observed at ${nonSyntheticHomePath}\n`,
    );
    await symlink(outsideFile, path.join(root, "linked.txt"));

    const report = await scanPaths({
      root,
      paths: ["linked.txt"],
    });

    assert.equal(report.errors.length, 0);
    assert.equal(report.scannedFiles, 0);
    assert.deepEqual(
      report.warnings.map((finding) => finding.rule),
      ["symlink-review"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("runs the CLI when the script itself is reached through a symlink", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gos-public-boundary-cli-"));
  const scannerPath = fileURLToPath(
    new URL("./verify-public-boundary.mjs", import.meta.url),
  );
  const linkedScannerPath = path.join(root, "linked-scanner.mjs");

  try {
    await symlink(scannerPath, linkedScannerPath);
    await mkdir(path.join(root, "docs", "dogfood"), { recursive: true });
    await writeFile(
      path.join(root, "docs", "dogfood", "cycle.md"),
      "private evaluation notes\n",
    );

    const result = spawnSync(
      process.execPath,
      [linkedScannerPath, "--tree", "--root", root],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Public-boundary scan:/);
    assert.match(result.stdout, /private-path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tree discovery skips dependency and build output directories", () => {
  assert.equal(shouldSkipTreePath("node_modules/pkg/index.js"), true);
  assert.equal(shouldSkipTreePath("src-tauri/target/release/app"), true);
  assert.equal(shouldSkipTreePath("landing/dist/index.html"), true);
  assert.equal(shouldSkipTreePath("promo-video/out/video.mp4"), true);
  assert.equal(shouldSkipTreePath("src/build/release-notes.md"), false);
  assert.equal(shouldSkipTreePath("release/private-record.txt"), false);
  assert.equal(shouldSkipTreePath("src/index.ts"), false);
});
