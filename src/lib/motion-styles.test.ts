import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function keyframes(name: string) {
  const marker = `@keyframes ${name}`;
  const start = styles.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${marker}`);

  const openingBrace = styles.indexOf("{", start);
  let depth = 0;
  for (let index = openingBrace; index < styles.length; index += 1) {
    if (styles[index] === "{") depth += 1;
    if (styles[index] === "}") depth -= 1;
    if (depth === 0) return styles.slice(start, index + 1);
  }

  throw new Error(`Unclosed ${marker}`);
}

describe("workspace view-transition motion", () => {
  it("keeps full-view captures sharp so their paint bounds cannot clip a blur", () => {
    expect(keyframes("morrow-view-enter")).not.toContain("filter:");
    expect(keyframes("morrow-view-exit")).not.toContain("filter:");
  });
});
