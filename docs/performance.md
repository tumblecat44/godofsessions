# Performance benchmarks

작성 기준일: 2026-08-23

These benchmarks use generated local fixtures only. They do not read, retain,
or report provider transcripts, credentials, or machine-specific paths.

## Reproduce

```sh
npm run bench:performance
npm run bench:startup
```

`bench:performance` runs five measured iterations after one warm-up iteration.
`bench:startup` runs five fresh Electron launches with separate synthetic user
data directories and reports the median, minimum, and maximum. Vitest's
benchmark API is experimental, so this project pins its exact Vitest version.

## Fixture and results

The transcript benchmark uses one 10,000-row current-day Pi JSONL transcript.
The discovery benchmark uses 1,200 one-row historical Claude transcripts. The
startup benchmark uses the same 10,000-row transcript and records both the
first BrowserWindow and the point at which the startup screen is replaced by
the initialized application.

| Scenario | Before median | After median | Change |
| --- | ---: | ---: | ---: |
| Parse 10,000 current transcript rows | 407.78 ms | 47.35 ms | 88.4% less time (8.61x) |
| Scan 1,200 historical transcript files | 65.76 ms | 11.70 ms | 82.2% less time (5.62x) |
| Electron first window | 1,236.96 ms | 781.69 ms | 36.8% less time (1.58x) |
| Electron application ready | 1,348.45 ms | 874.38 ms | 35.2% less time (1.54x) |

Results are directional development-machine measurements rather than release
SLAs. Compare results on the same machine, checkout, power state, and fixture.
The first Electron launch is usually a cold-cache outlier, which is why the
table uses medians and the script retains every sample.

## Bottlenecks and changes

- Date filtering constructed a new `Intl.DateTimeFormat` for every transcript
  row. Formatters are now cached by time zone.
- Historical transcript metadata and accepted transcript reads ran one file at
  a time. All file-transcript providers in one daily-context build now share a
  bounded 32-worker I/O pool, retaining deterministic result order without
  opening all possible files at once. Provider database reads are separate.
- Excerpt normalization created an array entry for every whitespace-delimited
  token, prompt construction repeatedly joined the full prompt, and summary
  selection reversed whole turn arrays. These paths now use linear string and
  index operations.
- Electron did not create a window until all provider runtime and local-session
  initialization finished. Window creation now overlaps initialization, while
  the bootstrap request still waits on the same initialization promise before
  exposing application state.

The file and row limits, redaction, date/time-zone semantics, provider session
formats, Pi `SessionManager` authority, and approval boundaries are unchanged.
