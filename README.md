# God of Sessions (v2)

Morrow talks through Pi. Overnight is a seat.

## Run

```bash
pnpm install
pnpm test
pnpm tauri dev
```

Requires Node ≥ 22.19. pnpm 10 is pinned (`packageManager`); pnpm 9 can still install. To use the pin: `corepack enable && corepack prepare pnpm@10.33.3 --activate`. The window spawns `node node_modules/@earendil-works/pi-coding-agent/dist/cli.js --mode rpc`. Auth stays in Pi. This repo does not store provider tokens.

`pnpm dev` is the Vite UI with mock IPC. It is not Pi.
