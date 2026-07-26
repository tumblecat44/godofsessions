# God of Sessions — launch videos

Two silent-first Remotion cuts: the original 32-second brand film and a
22-second proof cut built from the current app.

## Output

- `out/god-of-sessions-x-launch.mp4`
- `out/god-of-sessions-launch-proof.mp4`
- `out/god-of-sessions-launch-proof-poster.png`
- Both are 1920×1080, 30 fps, H.264, and designed to communicate without audio

The proof cut labels every current-app capture as `REAL APP UI · DEMO DATA`.
It should be the first public product demonstration because it shows the
actual Morrow Watch → recommendation → approval → Morning Review path. The
longer film remains the brand/story asset.

## Brand-film story

1. **Hook:** Six AI tools. One human bottleneck.
2. **Character:** Morrow turns scattered sessions into one system.
3. **Product proof:** Ask one question and get a ranked next move.
4. **Safety proof:** Review the exact night plan and approve once.
5. **Night shift:** Morrow watches bounded runs while the operator sleeps.
6. **Morning payoff:** Wake up to evidence, not open tabs.
7. **Brand:** Every session. One clear next move.

## Edit and render

```sh
npm install
npm run studio
npm run render
npm run render:proof
npm run poster:proof
```

The brand timeline lives in `src/Promo.tsx`; the proof timeline lives in
`src/Proof.tsx`. The visual system is in `src/styles.css`. Generated Morrow
keyframes are under `public/assets/`; redacted current-app captures are under
`public/proof/`.

## Reference-video tooling

The linked X post explicitly attributes the result to Claude Opus 5. Replies
around it identify Claude Code/Codex plus Remotion as the common code-video
workflow. Peekable appears as a separate frame-feedback tool in the replies;
there is no evidence that the original author used Peekable for that exact
video.
