import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isHomeExecutionRoot, resolveExecutionRoot } from "./execution-root";

describe("resolveExecutionRoot", () => {
  const home = "/Users/installer";

  it("defaults to the installer home", () => {
    expect(resolveExecutionRoot({ home })).toBe(home);
    expect(resolveExecutionRoot({ envRoot: "", home })).toBe(home);
    expect(resolveExecutionRoot({ envRoot: "   ", home })).toBe(home);
  });

  it("keeps an isolated MORROW_ROOT override", () => {
    expect(resolveExecutionRoot({ envRoot: "/tmp/morrow-verify-root", home })).toBe("/tmp/morrow-verify-root");
  });

  it("resolves a relative override against the process working directory", () => {
    expect(resolveExecutionRoot({ envRoot: "isolated-root", home })).toBe(resolve("isolated-root"));
  });

  it("does not use filesystem root as the write boundary", () => {
    expect(resolveExecutionRoot({ envRoot: "/", home })).toBe(home);
  });
});

describe("isHomeExecutionRoot", () => {
  it("treats the installer home as home even with a trailing slash", () => {
    expect(isHomeExecutionRoot("/Users/installer", "/Users/installer")).toBe(true);
    expect(isHomeExecutionRoot("/Users/installer/", "/Users/installer")).toBe(true);
  });

  it("does not treat a checkout or sandbox as home", () => {
    expect(isHomeExecutionRoot("/Users/installer/godofsessions", "/Users/installer")).toBe(false);
    expect(isHomeExecutionRoot("/tmp/morrow-verify-root", "/Users/installer")).toBe(false);
  });
});
