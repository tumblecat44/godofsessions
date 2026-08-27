import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GitHubAuthState, GitHubDeviceAuthorization, GitHubProfile } from "../../src/shared/contracts";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
export const GITHUB_DEVICE_URL = "https://github.com/login/device";

interface PendingAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  cancelled: boolean;
}

interface StoredAuthorization {
  version: 1;
  encryptedToken: string;
  profile: GitHubProfile;
  validatedAt: string;
}

interface GitHubAuthServiceOptions {
  dataDir: string;
  clientId: string;
  encryptToken(token: string): string;
  decryptToken(value: string): string;
  fetcher?: typeof fetch;
  openExternal?(url: string): Promise<void>;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
}

export class GitHubAuthService {
  private readonly authPath: string;
  private readonly clientId: string;
  private readonly encryptToken: (token: string) => string;
  private readonly decryptToken: (value: string) => string;
  private readonly fetcher: typeof fetch;
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly now: () => Date;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private token?: string;
  private profile?: GitHubProfile;
  private offline = false;
  private localVerify = false;
  private pending?: PendingAuthorization;

  constructor(options: GitHubAuthServiceOptions) {
    if (!/^[A-Za-z0-9]{10,100}$/.test(options.clientId)) throw new Error("GitHub OAuth Client ID is not configured.");
    this.authPath = join(options.dataDir, "github-auth.json");
    this.clientId = options.clientId;
    this.encryptToken = options.encryptToken;
    this.decryptToken = options.decryptToken;
    this.fetcher = options.fetcher ?? fetch;
    this.openExternal = options.openExternal ?? (async () => undefined);
    this.now = options.now ?? (() => new Date());
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async initialize(): Promise<GitHubAuthState> {
    let stored: StoredAuthorization;
    try {
      stored = parseStoredAuthorization(JSON.parse(await readFile(this.authPath, "utf8")));
      this.token = this.decryptToken(stored.encryptedToken);
      this.profile = stored.profile;
    } catch {
      await this.clearStoredAuthorization();
      return this.state();
    }

    try {
      const profile = await this.fetchProfile(this.token);
      this.profile = profile;
      this.offline = false;
      await this.persist();
    } catch (reason) {
      if (reason instanceof InvalidGitHubCredentialError) {
        await this.logout();
      } else {
        this.offline = true;
      }
    }
    return this.state();
  }

  state(): GitHubAuthState {
    return this.token && this.profile
      ? { status: "authenticated", profile: { ...this.profile }, offline: this.offline || undefined }
      : { status: "unauthenticated" };
  }

  requireAuthenticated() {
    if (!this.token || !this.profile) throw new Error("Sign in with GitHub before opening Morrow.");
  }

  adoptLocalVerifyIdentity(): GitHubAuthState {
    this.localVerify = true;
    this.token = "local-verify";
    this.profile = { id: 1, login: "local-verify" };
    this.offline = true;
    return this.state();
  }

  async begin(): Promise<GitHubDeviceAuthorization> {
    this.cancel();
    const response = await this.fetcher(DEVICE_CODE_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "God-of-Sessions",
      },
      body: new URLSearchParams({ client_id: this.clientId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("GitHub did not start the sign-in request.");
    const value = await response.json() as Record<string, unknown>;
    const deviceCode = requiredString(value.device_code, "device code", 200);
    const userCode = requiredString(value.user_code, "user code", 32);
    const verificationUri = requiredString(value.verification_uri, "verification URL", 200);
    if (verificationUri !== GITHUB_DEVICE_URL) throw new Error("GitHub returned an unexpected verification URL.");
    const expiresIn = boundedNumber(value.expires_in, 60, 1_800, "expiration");
    const interval = boundedNumber(value.interval, 1, 60, "poll interval");
    const expiresAt = this.now().getTime() + expiresIn * 1_000;
    this.pending = { deviceCode, userCode, verificationUri, expiresAt, intervalMs: interval * 1_000, cancelled: false };
    await this.openExternal(GITHUB_DEVICE_URL);
    return { userCode, verificationUri, expiresAt: new Date(expiresAt).toISOString() };
  }

  async complete(): Promise<GitHubAuthState> {
    const pending = this.pending;
    if (!pending) throw new Error("Start GitHub sign-in again.");
    while (!pending.cancelled && this.now().getTime() < pending.expiresAt) {
      await this.wait(pending.intervalMs);
      if (pending.cancelled) break;
      const response = await this.fetcher(ACCESS_TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "God-of-Sessions",
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          device_code: pending.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("GitHub sign-in could not be checked.");
      const value = await response.json() as Record<string, unknown>;
      if (typeof value.access_token === "string" && value.access_token) {
        const profile = await this.fetchProfile(value.access_token);
        await this.persistAuthorization(value.access_token, profile);
        this.token = value.access_token;
        this.profile = profile;
        this.offline = false;
        this.pending = undefined;
        return this.state();
      }
      if (value.error === "authorization_pending") continue;
      if (value.error === "slow_down") {
        pending.intervalMs += 5_000;
        continue;
      }
      this.pending = undefined;
      if (value.error === "access_denied") throw new Error("GitHub sign-in was cancelled.");
      if (value.error === "expired_token") throw new Error("The GitHub sign-in code expired. Start again.");
      throw new Error("GitHub sign-in could not be completed.");
    }
    this.pending = undefined;
    if (pending.cancelled) throw new Error("GitHub sign-in was cancelled.");
    throw new Error("The GitHub sign-in code expired. Start again.");
  }

  cancel() {
    if (this.pending) this.pending.cancelled = true;
    this.pending = undefined;
  }

  async logout(): Promise<GitHubAuthState> {
    this.cancel();
    this.token = undefined;
    this.profile = undefined;
    this.offline = false;
    await this.clearStoredAuthorization();
    return this.state();
  }

  async openDevicePage() {
    await this.openExternal(GITHUB_DEVICE_URL);
  }

  async openConnectionSettings() {
    await this.openExternal(`https://github.com/settings/connections/applications/${this.clientId}`);
  }

  private async fetchProfile(token: string): Promise<GitHubProfile> {
    let response: Response;
    try {
      response = await this.fetcher(USER_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "God-of-Sessions",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new GitHubUnavailableError();
    }
    if (response.status === 401) throw new InvalidGitHubCredentialError();
    if (!response.ok) throw new GitHubUnavailableError();
    const value = await response.json() as Record<string, unknown>;
    if (!Number.isSafeInteger(value.id) || Number(value.id) <= 0 || typeof value.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(value.login)) {
      throw new Error("GitHub returned an invalid user profile.");
    }
    return { id: Number(value.id), login: value.login.slice(0, 100) };
  }

  private async persist() {
    if (this.localVerify || !this.token || !this.profile) return;
    await this.persistAuthorization(this.token, this.profile);
  }

  private async persistAuthorization(token: string, profile: GitHubProfile) {
    const directory = dirname(this.authPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.authPath}.tmp`;
    const stored: StoredAuthorization = {
      version: 1,
      encryptedToken: this.encryptToken(token),
      profile,
      validatedAt: this.now().toISOString(),
    };
    await writeFile(temporaryPath, JSON.stringify(stored), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.authPath);
  }

  private async clearStoredAuthorization() {
    await rm(this.authPath, { force: true }).catch(() => undefined);
    await rm(`${this.authPath}.tmp`, { force: true }).catch(() => undefined);
  }
}

function parseStoredAuthorization(value: unknown): StoredAuthorization {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid stored GitHub authorization.");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.encryptedToken !== "string" || typeof record.validatedAt !== "string") {
    throw new Error("Invalid stored GitHub authorization.");
  }
  const profile = record.profile as Record<string, unknown> | undefined;
  if (!profile || !Number.isSafeInteger(profile.id) || typeof profile.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(profile.login)) {
    throw new Error("Invalid stored GitHub authorization.");
  }
  return {
    version: 1,
    encryptedToken: record.encryptedToken,
    profile: { id: Number(profile.id), login: profile.login.slice(0, 100) },
    validatedAt: record.validatedAt,
  };
}

function requiredString(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value || value.length > max) throw new Error(`GitHub returned an invalid ${label}.`);
  return value;
}

function boundedNumber(value: unknown, minimum: number, maximum: number, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`GitHub returned an invalid ${label}.`);
  return number;
}

class InvalidGitHubCredentialError extends Error {}
class GitHubUnavailableError extends Error {}
