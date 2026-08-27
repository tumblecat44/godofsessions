import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOvernightToolBroker,
  resolveOvernightVerificationInvocation,
  runMacOsProofBoundRead,
  type OvernightToolBroker,
  type OvernightMutationExecutionRequest,
  type OvernightReadExecutionRequest,
  type OvernightToolBrokerOptions,
} from "./overnight-tool-broker";

let base: string;
let root: string;
let verificationExecutable: string;
let brokers: OvernightToolBroker[];

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "morrow-tool-broker-test-"));
  root = join(base, "root");
  await mkdir(join(root, "src"), { recursive: true });
  verificationExecutable = join(root, "synthetic-verifier");
  await writeFile(verificationExecutable, "#!/bin/sh\nexit 0\n");
  await chmod(verificationExecutable, 0o700);
  brokers = [];
});

afterEach(async () => {
  await Promise.all(brokers.map((broker) => broker.close()));
  await rm(base, { recursive: true, force: true });
});

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const defaultVerificationCommand = () => `${verificationExecutable} test -- src`;

async function broker(
  overrides: Partial<Parameters<typeof createOvernightToolBroker>[0]> = {},
  options: OvernightToolBrokerOptions = {},
) {
  const syntheticMutationRunner = async (request: OvernightMutationExecutionRequest) => {
    if (request.signal.aborted) throw request.signal.reason;
    const parent = await lstat(request.parentPath);
    if (Number(parent.dev) !== request.parentDevice || Number(parent.ino) !== request.parentInode) {
      throw new Error("synthetic parent identity changed");
    }
    await writeFile(request.targetPath, request.content, { mode: request.mode });
    return {
      filesystemPolicy: "root-write-scopes-only" as const,
      parentIdentity: "matched" as const,
      processGroup: "exited" as const,
    };
  };
  const syntheticReadRunner = async (request: OvernightReadExecutionRequest) => {
    if (request.signal.aborted) throw request.signal.reason;
    const value = await readFile(request.targetPath);
    return {
      bytes: value.subarray(0, request.maxBytes),
      byteLength: value.length,
      filesystemPolicy: "fixed-root-read-only" as const,
      policyBindingSha256: request.policyBindingSha256,
      processGroup: "exited" as const,
    };
  };
  const created = await createOvernightToolBroker({
    runId: "run-synthetic",
    itemId: "item-synthetic",
    root,
    writeScopes: ["src"],
    verification: defaultVerificationCommand(),
    verificationCommand: defaultVerificationCommand(),
    outcome: "The synthetic source is correct.",
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  }, { mutationRunner: syntheticMutationRunner, readRunner: syntheticReadRunner, ...options });
  brokers.push(created);
  return created;
}

async function rpc(
  created: OvernightToolBroker,
  method: string,
  params: Record<string, unknown> = {},
  options: { token?: string; id?: number } = {},
) {
  return fetch(created.endpoint.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.token ?? created.endpoint.bearerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: options.id ?? 1, method, params }),
  });
}

async function call(
  created: OvernightToolBroker,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await rpc(created, "tools/call", { name, arguments: args });
  return response.json() as Promise<{
    result: {
      isError?: boolean;
      structuredContent: {
        error?: string;
        output?: string;
        byteLength?: number;
        truncated?: boolean;
        matches?: { path: string; line: number; preview: string }[];
        receipt: { receiptId: string; status: string };
      };
    };
    error?: { message: string };
  }>;
}

describe("proof-bound Overnight tool broker", () => {
  it("exposes only an authenticated loopback MCP endpoint bound to the exact authority digests", async () => {
    await writeFile(join(root, "src", "fixture.ts"), "export const proof = 'bounded';\n");
    const created = await broker();

    const endpoint = new URL(created.endpoint.url);
    expect(endpoint.hostname).toBe("127.0.0.1");
    expect(Number(endpoint.port)).toBeGreaterThan(0);
    expect(created.endpoint.bearerToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(created.endpoint.authorityDigests).toMatchObject({
      runSha256: digest("run-synthetic"),
      itemSha256: digest("item-synthetic"),
      verificationSha256: digest(defaultVerificationCommand()),
      outcomeSha256: digest("The synthetic source is correct."),
    });
    expect(created.endpoint.authorityDigests.rootSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(created.endpoint.authorityDigests.writeScopesSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(created.endpoint.policyBinding).toMatchObject({
      brokerProcess: "separate-sandbox-sibling-required",
      providerFileAccess: "fixed-root-read-only",
      brokerFileWrite: "approved-write-scopes-only",
      verificationInvocation: "frozen-argv",
      verificationNetwork: "deny-all",
      authoritySha256: created.endpoint.authorityDigests.authoritySha256,
    });
    expect(created.endpoint.policyBinding.bindingSha256).toMatch(/^[a-f0-9]{64}$/u);

    const unauthorized = await rpc(created, "tools/list", {}, { token: "wrong" });
    expect(unauthorized.status).toBe(401);

    const initialized = await rpc(created, "initialize", { protocolVersion: "2024-11-05" });
    await expect(initialized.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      result: { capabilities: { tools: { listChanged: false } } },
    });

    const listed = await rpc(created, "tools/list");
    const listedBody = await listed.json() as { result: { tools: { name: string }[] } };
    expect(listedBody.result.tools.map((tool) => tool.name)).toEqual([
      "read_file",
      "search_files",
      "write_file",
      "apply_patch",
      "verify_exact",
    ]);

    const read = await rpc(created, "tools/call", {
      name: "read_file",
      arguments: { callId: "read-1", path: "src/fixture.ts" },
    });
    const readBody = await read.json() as {
      result: { structuredContent: { output: string; receipt: { receiptId: string } } };
    };
    expect(readBody.result.structuredContent.output).toContain("proof = 'bounded'");
    expect(created.receipt(readBody.result.structuredContent.receipt.receiptId)).toEqual(
      readBody.result.structuredContent.receipt,
    );
  });

  it("denies outside reads, outside writes, and a symlink escape without mutating the outside file", async () => {
    const outside = join(base, "outside.txt");
    await writeFile(outside, "outside-secret");
    await symlink(outside, join(root, "src", "escape.txt"));
    const created = await broker();

    const outsideRead = await call(created, "read_file", {
      callId: "outside-read",
      path: "../outside.txt",
    });
    const symlinkRead = await call(created, "read_file", {
      callId: "symlink-read",
      path: "src/escape.txt",
    });
    const outsideWrite = await call(created, "write_file", {
      callId: "outside-write",
      path: "../outside.txt",
      content: "changed",
    });
    const absoluteWrite = await call(created, "write_file", {
      callId: "absolute-write",
      path: outside,
      content: "changed",
    });
    await mkdir(join(root, ".git"));
    const gitWrite = await call(created, "write_file", {
      callId: "git-write",
      path: ".git/config",
      content: "changed",
    });

    for (const denied of [outsideRead, symlinkRead, outsideWrite, absoluteWrite, gitWrite]) {
      expect(denied.result.isError).toBe(true);
      expect(denied.result.structuredContent.receipt.status).toBe("denied");
    }
    expect(outsideRead.result.structuredContent.error).toBe("path_outside_root");
    expect(symlinkRead.result.structuredContent.error).toBe("symlink_escape");
    expect(outsideWrite.result.structuredContent.error).toBe("path_outside_root");
    await expect(readFile(outside, "utf8")).resolves.toBe("outside-secret");
  });

  it("bounds reads and supports scoped atomic write, exact patch, and bounded fixed-string search", async () => {
    await writeFile(join(root, "src", "large.txt"), "x".repeat(70 * 1_024));
    const created = await broker();

    const boundedRead = await call(created, "read_file", {
      callId: "bounded-read",
      path: "src/large.txt",
    });
    expect(boundedRead.result.structuredContent.byteLength).toBe(70 * 1_024);
    expect(boundedRead.result.structuredContent.truncated).toBe(true);
    expect(Buffer.byteLength(boundedRead.result.structuredContent.output ?? "")).toBe(64 * 1_024);

    const written = await call(created, "write_file", {
      callId: "write-allowed",
      path: "src/generated.ts",
      content: "export const state = 'before';\n",
    });
    expect(written.result.structuredContent.receipt.status).toBe("succeeded");

    const patched = await call(created, "apply_patch", {
      callId: "patch-allowed",
      path: "src/generated.ts",
      oldText: "'before'",
      newText: "'after'",
    });
    expect(patched.result.structuredContent.receipt.status).toBe("succeeded");
    await expect(readFile(join(root, "src", "generated.ts"), "utf8"))
      .resolves.toBe("export const state = 'after';\n");

    const searched = await call(created, "search_files", {
      callId: "search-allowed",
      path: "src",
      query: "state = 'after'",
    });
    expect(searched.result.structuredContent.matches).toEqual([
      { path: "src/generated.ts", line: 1, preview: "export const state = 'after';" },
    ]);

    const outsideScope = await call(created, "write_file", {
      callId: "write-wrong-scope",
      path: "other.txt",
      content: "not allowed",
    });
    expect(outsideScope.result.structuredContent).toMatchObject({
      error: "scope_denied",
      receipt: { status: "denied" },
    });
  });

  it.runIf(process.platform === "darwin")("commits a default mutation through a write-scope-only child", async () => {
    const created = await createOvernightToolBroker({
      runId: "run-default-mutation",
      itemId: "item-default-mutation",
      root,
      writeScopes: ["src"],
      verification: "/bin/echo verified",
      verificationCommand: "/bin/echo verified",
      outcome: "The scoped file exists.",
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    });
    brokers.push(created);

    const written = await call(created, "write_file", {
      callId: "default-mutation",
      path: "src/default.txt",
      content: "proof-bound write",
    });

    expect(written.result.structuredContent).toMatchObject({
      filesystemPolicy: "root-write-scopes-only",
      parentIdentity: "matched",
      processGroup: "exited",
      receipt: { status: "succeeded" },
    });
    await expect(readFile(join(root, "src", "default.txt"), "utf8")).resolves.toBe("proof-bound write");
  });

  it.runIf(process.platform === "darwin")("does not create an outside target or temp during a parent-component symlink swap", async () => {
    const parent = join(root, "src", "swap");
    const parked = join(root, "src", "swap-parked");
    const outside = join(base, "outside-swap");
    await mkdir(parent);
    await mkdir(outside);
    const created = await createOvernightToolBroker({
      runId: "run-swap",
      itemId: "item-swap",
      root,
      writeScopes: ["src/swap"],
      verification: "/bin/echo verified",
      verificationCommand: "/bin/echo verified",
      outcome: "No outside mutation occurs.",
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    });
    brokers.push(created);
    const writing = call(created, "write_file", {
      callId: "swap-write",
      path: "src/swap/result.txt",
      content: "x".repeat(256 * 1_024),
    });

    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        await rename(parent, parked);
        await symlink(outside, parent);
        await new Promise((resolvePromise) => setImmediate(resolvePromise));
        await unlink(parent);
        await rename(parked, parent);
      } catch {
        await unlink(parent).catch(() => undefined);
        await rename(parked, parent).catch(() => undefined);
      }
    }
    await writing;

    expect(await readdir(outside)).toEqual([]);
  });

  it.runIf(process.platform === "darwin")("never observes outside bytes during read and search parent-component swaps", async () => {
    const parent = join(root, "src", "read-swap");
    const parked = join(root, "src", "read-swap-parked");
    const outside = join(base, "outside-read-swap");
    const sentinel = `outside-sentinel-${Date.now()}-${"z".repeat(128)}`;
    const sentinelSha256 = digest(sentinel);
    await mkdir(parent);
    await mkdir(outside);
    await writeFile(join(parent, "target.txt"), "inside-safe-content");
    await writeFile(join(outside, "target.txt"), sentinel);
    let runnerCalls = 0;
    const adversarialReadRunner = async (request: OvernightReadExecutionRequest) => {
      runnerCalls += 1;
      await rename(parent, parked);
      await symlink(outside, parent);
      try {
        return await runMacOsProofBoundRead(request);
      } finally {
        await unlink(parent).catch(() => undefined);
        await rename(parked, parent).catch(() => undefined);
      }
    };
    const created = await createOvernightToolBroker({
      runId: "run-read-swap",
      itemId: "item-read-swap",
      root,
      writeScopes: ["src"],
      verification: defaultVerificationCommand(),
      verificationCommand: defaultVerificationCommand(),
      outcome: "Outside bytes remain unobserved.",
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    }, { readRunner: adversarialReadRunner });
    brokers.push(created);

    const read = await call(created, "read_file", {
      callId: "read-parent-swap",
      path: "src/read-swap/target.txt",
    });
    const searched = await call(created, "search_files", {
      callId: "search-parent-swap",
      path: "src/read-swap",
      query: "outside-sentinel",
    });

    expect(runnerCalls).toBeGreaterThanOrEqual(2);
    for (const result of [read, searched]) {
      expect(result.result.structuredContent.receipt.status).toBe("failed");
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(sentinel);
      expect(serialized).not.toContain(sentinelSha256);
      const receipt = created.receipt(result.result.structuredContent.receipt.receiptId)!;
      expect(JSON.stringify(receipt)).not.toContain(sentinel);
      expect(JSON.stringify(receipt)).not.toContain(sentinelSha256);
    }
  });

  it("rejects a verification command mismatch and runs the exact command only through a deny-all network runner", async () => {
    const executions: { command: string; cwd: string; networkPolicy: string }[] = [];
    const created = await broker({}, {
      verificationRunner: async (request) => {
        executions.push(request);
        return {
          exitCode: 0,
          stdout: "synthetic verification passed\n",
          stderr: "",
          networkPolicy: "deny-all",
          filesystemPolicy: "root-write-scopes-only",
          processGroup: "exited",
        };
      },
    });

    const mismatch = await call(created, "verify_exact", {
      callId: "verify-mismatch",
      command: `${verificationExecutable} test -- other`,
    });
    expect(mismatch.result.structuredContent).toMatchObject({
      error: "verification_command_mismatch",
      receipt: { status: "denied" },
    });
    expect(executions).toHaveLength(0);

    const exact = await call(created, "verify_exact", {
      callId: "verify-exact",
      command: defaultVerificationCommand(),
    });
    expect(exact.result.structuredContent).toMatchObject({
      exitCode: 0,
      output: "synthetic verification passed\n",
      networkPolicy: "deny-all",
      receipt: { status: "succeeded" },
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      command: defaultVerificationCommand(),
      cwd: await realpath(root),
      networkPolicy: "deny-all",
    });
  });

  it("blocks relative verification and binds a canonical absolute executable identity into receipts", async () => {
    await expect(resolveOvernightVerificationInvocation("npm run check")).resolves.toEqual({
      status: "blocked",
      reason: "verification_absolute_executable_required",
    });
    await expect(broker({ verification: "npm run check", verificationCommand: "npm run check" }))
      .rejects.toThrow("verification_absolute_executable_required");

    const resolved = await resolveOvernightVerificationInvocation(defaultVerificationCommand());
    expect(resolved).toMatchObject({
      status: "ready",
      argv: [await realpath(verificationExecutable), "test", "--", "src"],
      executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      invocationSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    if (resolved.status !== "ready") throw new Error("synthetic verifier did not resolve");
    await writeFile(join(root, "src", "identity.txt"), "identity");
    const created = await broker();
    const observed = await call(created, "read_file", {
      callId: "identity-receipt",
      path: "src/identity.txt",
    });
    const receipt = created.receipt(observed.result.structuredContent.receipt.receiptId)!;
    expect(receipt.authority).toMatchObject({
      verificationExecutableSha256: resolved.executableSha256,
      verificationInvocationSha256: resolved.invocationSha256,
    });
  });

  it.runIf(process.platform === "darwin")("executes one simple absolute frozen argv in the default proof-bound verifier", async () => {
    const command = "/bin/echo verified";
    const created = await broker({ verification: command, verificationCommand: command });

    const verified = await call(created, "verify_exact", { callId: "default-verifier", command });

    expect(verified.result.structuredContent).toMatchObject({
      exitCode: 0,
      output: "verified\n",
      networkPolicy: "deny-all",
      filesystemPolicy: "root-write-scopes-only",
      processGroup: "exited",
      receipt: { status: "succeeded" },
    });
  });

  it("fails a verification network attempt closed without reaching a loopback sink", async () => {
    let connections = 0;
    const sink = createTcpServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    sink.listen(0, "127.0.0.1");
    await once(sink, "listening");
    const address = sink.address();
    if (!address || typeof address === "string") throw new Error("test sink did not bind");
    const command = `/usr/bin/nc -w 1 127.0.0.1 ${address.port}`;
    const created = await broker({ verification: command, verificationCommand: command });
    try {
      const attempted = await call(created, "verify_exact", {
        callId: "verify-network-attempt",
        command,
      });
      expect(attempted.result.isError).toBe(true);
      expect(attempted.result.structuredContent.receipt.status).toBe("failed");
      expect(connections).toBe(0);
    } finally {
      sink.close();
      await once(sink, "close");
    }
  });

  it.runIf(process.platform === "darwin")("keeps verifier writes out of adjacent, auth, git, and private-temp locations", async () => {
    await mkdir(join(root, ".git"));
    await writeFile(join(root, "src", "source.txt"), "bounded source");
    const authMarker = join(base, "auth-marker.txt");
    await writeFile(authMarker, "synthetic auth secret");
    const outsideWrite = join(base, "outside-write.txt");
    const authLeak = join(root, "src", "auth-leak.txt");
    const gitWrite = join(root, ".git", "broker-marker.txt");
    const privateTemp = join("/private/tmp", `morrow-broker-${process.pid}-${Date.now()}.txt`);
    await rm(privateTemp, { force: true });
    const attempts = [
      { command: `/bin/cp src/source.txt ${outsideWrite}`, absent: outsideWrite },
      { command: `/bin/cp ${authMarker} src/auth-leak.txt`, absent: authLeak },
      { command: "/bin/cp src/source.txt .git/broker-marker.txt", absent: gitWrite },
      { command: `/bin/cp src/source.txt ${privateTemp}`, absent: privateTemp },
    ];

    try {
      for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        const created = await broker({
          verification: attempt.command,
          verificationCommand: attempt.command,
        });
        const result = await call(created, "verify_exact", {
          callId: `contained-${index}`,
          command: attempt.command,
        });
        expect(result.result.structuredContent.receipt.status).toBe("failed");
        await expect(access(attempt.absent)).rejects.toThrow();
      }
    } finally {
      await rm(privateTemp, { force: true });
    }
  });

  it("rejects shell chaining, substitution, and redirection before opening an endpoint", async () => {
    const unsafe = [
      "/bin/echo ok && /bin/echo second",
      "/bin/echo $(pwd)",
      "/bin/echo ok > src/result.txt",
      "/bin/echo ok | /usr/bin/tee src/result.txt",
      "/bin/echo `pwd`",
    ];
    for (const command of unsafe) {
      await expect(broker({ verification: command, verificationCommand: command }))
        .rejects.toThrow("verification_command_not_frozen_argv");
    }
  });

  it("rejects unknown tool arguments without consuming the call id or mutating a file", async () => {
    const created = await broker();
    const invalid = await rpc(created, "tools/call", {
      name: "write_file",
      arguments: {
        callId: "unknown-property",
        path: "src/unknown.txt",
        content: "invalid",
        overwriteAnything: true,
      },
    });
    await expect(invalid.json()).resolves.toMatchObject({ error: { message: "invalid_tool_arguments" } });
    await expect(access(join(root, "src", "unknown.txt"))).rejects.toThrow();

    const valid = await call(created, "write_file", {
      callId: "unknown-property",
      path: "src/unknown.txt",
      content: "valid",
    });
    expect(valid.result.structuredContent.receipt.status).toBe("succeeded");
  });

  it("rejects replay and accepts a genuine out-of-band receipt exactly once while rejecting a forgery", async () => {
    await writeFile(join(root, "src", "receipt.txt"), "receipt fixture");
    const created = await broker();
    const first = await call(created, "read_file", {
      callId: "single-use-call",
      path: "src/receipt.txt",
    });
    const receipt = created.receipt(first.result.structuredContent.receipt.receiptId)!;

    expect(receipt.signature).toMatch(/^[a-f0-9]{64}$/u);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain(created.endpoint.bearerToken);
    expect(serialized).not.toContain("src/receipt.txt");
    const forged = { ...receipt, resultSha256: "0".repeat(64) };
    const expectation = {
      tool: receipt.tool,
      status: receipt.status,
      callSha256: receipt.callSha256,
      resultSha256: receipt.resultSha256,
    };
    expect(created.consumeReceipt(forged, expectation)).toBe(false);
    expect(created.consumeReceipt(receipt, { ...expectation, tool: "verify_exact" })).toBe(false);
    expect(created.consumeReceipt(receipt, expectation)).toBe(true);
    expect(created.consumeReceipt(receipt, expectation)).toBe(false);

    const replayed = await rpc(created, "tools/call", {
      name: "read_file",
      arguments: { callId: "single-use-call", path: "src/receipt.txt" },
    }, { id: 2 });
    await expect(replayed.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      error: { message: "call_replayed" },
    });
  });

  it("claims a call id before asynchronous work so concurrent duplicates cannot execute", async () => {
    let markStarted!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolvePromise) => { markStarted = resolvePromise; });
    const completion = new Promise<void>((resolvePromise) => { finish = resolvePromise; });
    let executions = 0;
    const created = await broker({}, {
      verificationRunner: async () => {
        executions += 1;
        markStarted();
        await completion;
        return {
          exitCode: 0,
          stdout: "passed",
          stderr: "",
          networkPolicy: "deny-all",
          filesystemPolicy: "root-write-scopes-only",
          processGroup: "exited",
        };
      },
    });

    const first = call(created, "verify_exact", {
      callId: "concurrent-call",
      command: defaultVerificationCommand(),
    });
    await started;
    const duplicate = await rpc(created, "tools/call", {
      name: "verify_exact",
      arguments: { callId: "concurrent-call", command: defaultVerificationCommand() },
    }, { id: 3 });
    await expect(duplicate.json()).resolves.toMatchObject({ error: { message: "call_replayed" } });
    expect(executions).toBe(1);
    finish();
    await expect(first).resolves.toMatchObject({
      result: { structuredContent: { receipt: { status: "succeeded" } } },
    });
  });

  it("cancels an active verification and never accepts its late success", async () => {
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolvePromise) => { markStarted = resolvePromise; });
    const created = await broker({}, {
      signal: controller.signal,
      verificationRunner: (request) => new Promise((resolvePromise) => {
        markStarted();
        request.signal.addEventListener("abort", () => {
          setTimeout(() => resolvePromise({
            exitCode: 0,
            stdout: "late success must not count",
            stderr: "",
            networkPolicy: "deny-all",
            filesystemPolicy: "root-write-scopes-only",
            processGroup: "exited",
          }), 5);
        }, { once: true });
      }),
    });
    const running = call(created, "verify_exact", {
      callId: "cancelled-call",
      command: defaultVerificationCommand(),
    });
    await started;

    controller.abort();

    await expect(running).resolves.toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          error: "cancelled",
          receipt: { status: "cancelled" },
        },
      },
    });
  });

  it("ends an active verification at the absolute deadline with distinct evidence", async () => {
    let markStarted!: () => void;
    const started = new Promise<void>((resolvePromise) => { markStarted = resolvePromise; });
    const created = await broker({ deadlineAt: new Date(Date.now() + 100).toISOString() }, {
      verificationRunner: (request) => new Promise((_resolve, reject) => {
        markStarted();
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
      }),
    });
    const running = call(created, "verify_exact", {
      callId: "deadline-call",
      command: defaultVerificationCommand(),
    });
    await started;

    await expect(running).resolves.toMatchObject({
      result: {
        isError: true,
        structuredContent: {
          error: "deadline",
          receipt: { status: "deadline" },
        },
      },
    });
  });

  it.runIf(process.platform === "darwin")("close terminates the default verifier process group before resolving", async () => {
    const command = "/bin/sleep 30";
    const created = await broker({ verification: command, verificationCommand: command });
    const running = call(created, "verify_exact", { callId: "close-child", command });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    const startedAt = Date.now();

    await created.close();
    const result = await running;

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result.result.structuredContent).toMatchObject({
      error: "cancelled",
      processGroup: "exited",
      receipt: { status: "cancelled" },
    });
  });
});
