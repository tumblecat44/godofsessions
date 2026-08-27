import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  publicDir: resolve(root, "public"),
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 4174,
    strictPort: true,
  },
});
