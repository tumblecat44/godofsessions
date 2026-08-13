# God of Sessions (v2)

Morrow talks through Pi. Overnight is a seat.

## Run

```bash
npm install
npm test
npm run tauri dev
```

Requires Node ≥ 22.19. The window spawns `node node_modules/@earendil-works/pi-coding-agent/dist/cli.js --mode rpc`. Auth stays in Pi. This repo does not store provider tokens.

`npm run dev` is the Vite UI with mock IPC. It is not Pi.
