import { describe, expect, it } from "vitest";
import {
  overnightCliAuthArgs,
  overnightCliLoginStateFromOutput,
  probeOvernightCliLogin,
} from "./overnight-cli-auth";

describe("Overnight CLI login status", () => {
  it("uses official status commands and none for Pi Agent", () => {
    expect(overnightCliAuthArgs("claude")).toEqual(["auth", "status", "--json"]);
    expect(overnightCliAuthArgs("codex")).toEqual(["login", "status"]);
    expect(overnightCliAuthArgs("grok")).toEqual(["models"]);
    expect(overnightCliAuthArgs("pi")).toBeUndefined();
  });

  it("reads only Claude loggedIn and drops account fields", () => {
    const stdout = JSON.stringify({
      loggedIn: true,
      email: "secret@example.com",
      orgId: "should-not-leak",
    });
    expect(overnightCliLoginStateFromOutput({
      provider: "claude",
      stdout,
      stderr: "",
      exitCode: 0,
    })).toBe("signed_in");
    expect(overnightCliLoginStateFromOutput({
      provider: "claude",
      stdout: JSON.stringify({ loggedIn: false, email: "secret@example.com" }),
      stderr: "",
      exitCode: 0,
    })).toBe("signed_out");
  });

  it("reads Codex and Grok login phrases without storing the rest", () => {
    expect(overnightCliLoginStateFromOutput({
      provider: "codex",
      stdout: "Logged in using ChatGPT",
      stderr: "",
      exitCode: 0,
    })).toBe("signed_in");
    expect(overnightCliLoginStateFromOutput({
      provider: "codex",
      stdout: "",
      stderr: "Logged in using ChatGPT",
      exitCode: 0,
    })).toBe("signed_in");
    expect(overnightCliLoginStateFromOutput({
      provider: "codex",
      stdout: "Not logged in",
      stderr: "",
      exitCode: 1,
    })).toBe("signed_out");
    expect(overnightCliLoginStateFromOutput({
      provider: "grok",
      stdout: "You are logged in with grok.com.\nDefault model: grok-4.6",
      stderr: "",
      exitCode: 0,
    })).toBe("signed_in");
    expect(overnightCliLoginStateFromOutput({
      provider: "grok",
      stdout: "",
      stderr: "Please sign in with grok login",
      exitCode: 1,
    })).toBe("signed_out");
  });

  it("treats a timed-out probe as unknown, not signed out", () => {
    expect(overnightCliLoginStateFromOutput({
      provider: "grok",
      stdout: "",
      stderr: "",
      exitCode: 1,
      timedOut: true,
    })).toBe("unknown");
  });

  it("probes through the injected runner and never returns account text", async () => {
    const state = await probeOvernightCliLogin({
      provider: "claude",
      executable: "/synthetic/claude",
      run: async () => ({
        stdout: JSON.stringify({ loggedIn: true, email: "secret@example.com" }),
        stderr: "",
        exitCode: 0,
        timedOut: false,
      }),
    });
    expect(state).toBe("signed_in");
    expect(await probeOvernightCliLogin({ provider: "pi", executable: "/synthetic/pi" })).toBe("unknown");
    expect(await probeOvernightCliLogin({ provider: "codex" })).toBe("unknown");
  });

  it("retries an inconclusive probe instead of asking the operator to confirm", async () => {
    let calls = 0;
    const state = await probeOvernightCliLogin({
      provider: "codex",
      executable: "/synthetic/codex",
      run: async () => {
        calls += 1;
        if (calls === 1) return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
        return { stdout: "", stderr: "Logged in using ChatGPT", exitCode: 0, timedOut: false };
      },
    });
    expect(calls).toBe(2);
    expect(state).toBe("signed_in");
  });
});
