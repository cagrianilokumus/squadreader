# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

sqreader reads a running Squad dedicated server's process memory (`/proc/<pid>/mem`) to produce
game-state snapshots (players, vehicles, capture zones, deployables, projectiles), records whole
matches for replay, and computes per-player stats/ELO. It is **read-only** — it never writes to
the game. Linux-only at runtime; the offsets are reverse-engineered for a specific Squad build
(currently v10.4 / SDK v10.4.1) and drift is checked via `sqreader doctor`.

Backend: Python ≥3.10 package (`sqreader/`), console script `sqreader` (`sqreader.cli:main`).
Frontend: React + Vite + Zustand SPA (`frontend/`) — a replay viewer; a prebuilt `frontend/dist`
is committed, so normal backend use needs no Node.

Licensed AGPL-3.0-or-later **with the Commons Clause** (source-available, not OSI open source —
see `LICENSE`): selling the tool, or hosting/support whose value comes substantially from it, is
prohibited; running a game server that happens to use it is fine.

## Commands

Backend (repo root) — this is the same gate CI (`.github/workflows/ci.yml`) runs:
```sh
pip install -e ".[dev]"
python -m pytest           # unit tests
python -m ruff check .     # lint
python -m mypy sqreader    # types
```
Single test: `pytest tests/test_elo.py::test_name` or `pytest tests/test_elo.py -k pattern`.

The test suite runs anywhere (no live Squad server or Linux needed) — `tests/conftest.py`
provides a `FakeProcessMemory` fixture that mirrors `mem.ProcessMemory`'s read interface without
touching real `/proc/<pid>/mem`.

There is also `sqreader test` (→ `scripts/test_all.py`), a separate regression suite distinct
from pytest — not run as part of normal dev iteration.

Frontend (`cd frontend`):
```sh
npm ci
npm run build       # tsc --noEmit && vite build — what CI runs
npm run dev          # vite dev server
npm test             # runs every src/**/*.test.mts via scripts/run-tests.mjs
```
`run-tests.mjs` *discovers* test files dynamically rather than using a hand-maintained list —
per its own comment, this was fixed after CI once silently ran only one of eight suites. Keep
that property when adding test infra; don't reintroduce a hand-listed suite. Individual suites
also have npm scripts (`test:kf`, `test:cap`, `test:tickets`, `test:recon`, `test:unpack`,
`test:markers`, `test:crosslang`, `test:mapfallback`, `test:ruler`), each esbuild-bundling one
`*.test.mts` and running it with `node`.

Packaging (compiled Nuitka binary, only relevant when touching `packaging/`):
```sh
cp packaging/entitlements.env.example packaging/entitlements.env   # once
./packaging/build.sh
```
Builds in Docker against `python:3.11-bullseye`, pinned specifically for its glibc 2.31 floor so
the binary runs on old game-server boxes — don't casually bump the base image.

## Architecture

Tick-driven data flow: `sqreader serve` attaches to the Squad server PID → `mem.py`
(`ProcessMemory`) does read-only `/proc/<pid>/mem` reads via a persistent fd + `pread` → `ue/`
resolves generic UE5 reflection structures (`GUObjectArray`, FNames) from those reads →
`squad/snapshot.py` (the largest file in the repo) walks those structures each tick into a full
JSON snapshot; `squad/walkdelta.py` does a cheaper incremental diff walk for position-only ticks
(numpy-vectorized if the `fast` extra is installed, else a pure-Python fallback with identical
output). Each tick fans out to:
- `recorder.py` — a match-lifecycle state machine that writes one `.sqrx` per match via `sqrx.py`
  (zstd-compressed NDJSON; written once, never edited, never interpolated — an entity failing a
  freshness check is dropped from that frame rather than guessed at)
- `stats.py` — SQLite-backed per-player stats, feeding `elo.py`
- `plugins/` — cheat detection (`cheat_detect.py`, memory-verified signals only — see "no-guess
  policy" below) and alerting (`notify.py`), run inside the tick loop under a hard time budget
  (`_PLUGIN_BUDGET_MS` in `cli.py`) so a slow plugin can't stall the reader
- `httpsrv.py` — a stdlib-only HTTP server (no Flask/FastAPI) serving finalized recordings + stats
  to the `frontend/` SPA, which decodes `.sqrx` (`state/replayUnpack.ts` →
  `state/replayReconstruct.ts`) and renders it via `canvas/` (`MapCanvas.tsx`, `draw.ts`,
  `worldToScreen.ts`, `interpolation.ts`)

Two-tier recording model (see README's "How a match is recorded"): ~1 full snapshot/sec plus
position-only frames at 4 Hz in between, run via an internal `build-worker` subprocess spawned by
`serve`.

Other load-bearing modules: `config.py` (resolution order: CLI flag > `sqreader.config.json` >
built-in default), `addrcache.py` (caches resolved memory addresses like the `GUObjectArray` base
across restarts so re-attach skips a ~30s signature scan), `recording_lifecycle.py` (match-state
constants shared by `recorder.py` and `stats.py`).

`cli.py` is the single argparse entry point for every subcommand (`snapshot`, `summary`, `watch`,
`serve`, `stats-backfill`, `stats-elo-recalc`, `test`, `doctor`, `enroll`, `retention`, plus a few
internal-only ones spawned by other subcommands). `__main__.py` deliberately uses an absolute
import (`from sqreader.cli import main`) rather than a relative one — Nuitka compiles this file as
a real top-level `__main__` with no parent package, and a relative import would build fine but
crash at runtime.

Central push (`sqreader enroll`, optional `push` extra) is the one opt-in path that sends data off
the box — `crypto_envelope.py`/`agent_creds.py`/`hwfp.py` handle enrollment identity/signing,
`ingest_client.py`/`offset_client.py` are the HTTP clients. Everything else is local-only by
default (see `PRIVACY.md`).

## Conventions (from CONTRIBUTING.md)

- **No-guess policy**: attribution (killer, placer, spotter, …) must come from data verified in
  memory. If it isn't certain, leave the field blank — no heuristics or "nearest player" guessing.
  This applies to `plugins/cheat_detect.py` and anything in `squad/` doing attribution.
- **No new runtime dependencies** without discussion — the base install intentionally ships with
  only `zstandard`.
- English code/identifiers; docs may be Turkish.
- Add a test for any new pure-logic helper.
- Commits are DCO sign-off'd (`git commit -s`).
