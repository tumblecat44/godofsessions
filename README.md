# God of Sessions (v2)

Morrow talks through Pi. Overnight is a seat.

## Run

```bash
pnpm install
pnpm test
pnpm tauri dev
```

Requires Node ≥ 22.19. If `pnpm -v` stays on 9 after corepack, Homebrew/global pnpm is winning PATH. Use the pin directly:

```bash
corepack pnpm install
corepack pnpm tauri dev
```

Or `npx pnpm@10.33.3 install` / `npx pnpm@10.33.3 tauri dev`. The window spawns `node node_modules/@earendil-works/pi-coding-agent/dist/cli.js --mode rpc`. Auth stays in Pi. This repo does not store provider tokens.

`pnpm dev` is the Vite UI with mock IPC. It is not Pi.
