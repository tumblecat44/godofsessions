import { resolve } from "node:path";

export function resolveExecutionRoot(input: {
  envRoot?: string;
  home: string;
}): string {
  const override = input.envRoot?.trim();
  const candidate = resolve(override || input.home);
  return candidate === "/" ? resolve(input.home) : candidate;
}

export function isHomeExecutionRoot(root: string, home: string): boolean {
  return resolve(root) === resolve(home);
}
