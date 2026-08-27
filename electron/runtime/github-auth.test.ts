import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubAuthService, GITHUB_DEVICE_URL } from "./github-auth";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("GitHubAuthService", () => {
  it("completes Device Flow without persisting the plaintext credential", async () => {
    const dataDir = await temporaryDirectory();
    const credential = ["synthetic", "credential", "value"].join("-");
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const responses = [
      json({ device_code: "device-code", user_code: "ABCD-EFGH", verification_uri: GITHUB_DEVICE_URL, expires_in: 900, interval: 5 }),
      json({ error: "authorization_pending" }),
      json({ access_token: credential, token_type: "bearer", scope: "" }),
      json({ id: 42, login: "synthetic-user", email: "must-not-be-stored@example.invalid" }),
    ];
    const openExternal = vi.fn(async () => undefined);
    const service = createService({ dataDir, responses, openExternal, onRequest: (input, init) => requests.push({ input, init }) });

    const authorization = await service.begin();
    expect(authorization.userCode).toBe("ABCD-EFGH");
    expect(openExternal).toHaveBeenCalledWith(GITHUB_DEVICE_URL);
    expect(String(requests[0]?.init?.body)).not.toContain("scope=");

    await expect(service.complete()).resolves.toEqual({
      status: "authenticated",
      profile: { id: 42, login: "synthetic-user" },
    });
    const stored = await readFile(join(dataDir, "github-auth.json"), "utf8");
    expect(stored).not.toContain(credential);
    expect(stored).not.toContain("must-not-be-stored");
  });

  it("uses an encrypted cached identity when GitHub is temporarily unavailable", async () => {
    const dataDir = await temporaryDirectory();
    const credential = ["cached", "synthetic", "credential"].join("-");
    const first = createService({
      dataDir,
      responses: [
        json({ device_code: "device-code", user_code: "ABCD-EFGH", verification_uri: GITHUB_DEVICE_URL, expires_in: 900, interval: 5 }),
        json({ access_token: credential }),
        json({ id: 7, login: "offline-user" }),
      ],
    });
    await first.begin();
    await first.complete();

    const offline = new GitHubAuthService({
      dataDir,
      clientId: "Ov23syntheticClientId",
      encryptToken: encrypt,
      decryptToken: decrypt,
      fetcher: vi.fn(async () => { throw new Error("offline"); }),
      wait: async () => undefined,
    });

    await expect(offline.initialize()).resolves.toEqual({
      status: "authenticated",
      profile: { id: 7, login: "offline-user" },
      offline: true,
    });
    expect(() => offline.requireAuthenticated()).not.toThrow();
  });

  it("fails closed and removes a cached credential rejected by GitHub", async () => {
    const dataDir = await temporaryDirectory();
    const first = createService({
      dataDir,
      responses: [
        json({ device_code: "device-code", user_code: "ABCD-EFGH", verification_uri: GITHUB_DEVICE_URL, expires_in: 900, interval: 5 }),
        json({ access_token: ["rejected", "credential"].join("-") }),
        json({ id: 9, login: "revoked-user" }),
      ],
    });
    await first.begin();
    await first.complete();

    const rejected = new GitHubAuthService({
      dataDir,
      clientId: "Ov23syntheticClientId",
      encryptToken: encrypt,
      decryptToken: decrypt,
      fetcher: vi.fn(async () => json({ message: "Bad credentials" }, 401)),
      wait: async () => undefined,
    });

    await expect(rejected.initialize()).resolves.toEqual({ status: "unauthenticated" });
    expect(() => rejected.requireAuthenticated()).toThrow(/Sign in with GitHub/);
    await expect(readFile(join(dataDir, "github-auth.json"), "utf8")).rejects.toThrow();
  });

  it("rejects unexpected verification destinations", async () => {
    const dataDir = await temporaryDirectory();
    const service = createService({
      dataDir,
      responses: [json({ device_code: "device-code", user_code: "ABCD-EFGH", verification_uri: "https://example.invalid/device", expires_in: 900, interval: 5 })],
    });
    await expect(service.begin()).rejects.toThrow(/unexpected verification URL/);
  });
});

function createService({ dataDir, responses, openExternal = async () => undefined, onRequest }: { dataDir: string; responses: Response[]; openExternal?: (url: string) => Promise<void>; onRequest?: (input: RequestInfo | URL, init?: RequestInit) => void }) {
  return new GitHubAuthService({
    dataDir,
    clientId: "Ov23syntheticClientId",
    encryptToken: encrypt,
    decryptToken: decrypt,
    fetcher: vi.fn(async (input, init) => {
      onRequest?.(input, init);
      const response = responses.shift();
      if (!response) throw new Error("Unexpected synthetic request.");
      return response;
    }),
    openExternal,
    wait: async () => undefined,
  });
}

function encrypt(value: string) {
  return Buffer.from(value, "utf8").toString("base64");
}

function decrypt(value: string) {
  return Buffer.from(value, "base64").toString("utf8");
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "morrow-github-auth-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
