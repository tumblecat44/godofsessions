import { describe, expect, it } from "vitest";
import { signInError } from "./GitHubLogin";

describe("signInError", () => {
  it("shows the cancel message for cancelled sign-in", () => {
    expect(signInError(new Error("cancelled"), false)).toContain("cancelled");
    expect(signInError(new Error("sign-in was cancelled"), true)).toContain("취소");
  });

  it("shows the expired message for expired codes", () => {
    expect(signInError(new Error("expired token"), false)).toContain("expired");
    expect(signInError(new Error("code expired"), true)).toContain("만료");
  });

  it("surfaces Keychain/storage errors instead of claiming internet problems", () => {
    const keychainError = new Error("macOS Keychain is unavailable, so GitHub sign-in cannot be saved safely.");
    const result = signInError(keychainError, false);
    expect(result).not.toContain("internet");
    expect(result).toContain("Keychain");
  });

  it("surfaces encryption errors instead of claiming internet problems", () => {
    const encryptionError = new Error("GitHub sign-in could not be saved safely.");
    const result = signInError(encryptionError, false);
    expect(result).not.toContain("internet");
    expect(result).toContain("saved");
  });

  it("shows the generic internet message only for actual network errors", () => {
    const networkError = new Error("fetch failed");
    expect(signInError(networkError, false)).toContain("internet");
    expect(signInError(networkError, true)).toContain("인터넷");
  });
});
