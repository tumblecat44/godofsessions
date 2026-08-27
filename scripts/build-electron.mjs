import { build } from "esbuild";

await build({
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  external: ["electron"],
});

await build({
  entryPoints: ["electron/preload.ts"],
  outfile: "dist-electron/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
  external: ["electron"],
});

await build({
  entryPoints: ["electron/overnight-worker.ts"],
  outfile: "dist-electron/overnight-worker.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
});

await build({
  entryPoints: ["electron/overnight-provider-host.ts"],
  outfile: "dist-electron/overnight-provider-host.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
});
