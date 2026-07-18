# Contributing to sqreader

Thanks for helping — sqreader is a community tool and issues/PRs are welcome.

## Dev setup

```bash
git clone https://github.com/cagrianilokumus/squadreader.git
cd sqreader
pip install -e ".[dev]"
```

Real data needs a live Squad server on Linux, but the **test suite runs
anywhere** — it uses fixtures, not a live process.

## Before opening a PR

Run the same gate CI runs:

```bash
python -m pytest           # unit tests
python -m ruff check .     # lint
python -m mypy sqreader    # types
# only if you touched the web UI:
cd frontend && npm ci && npm run build
```

Please keep the project conventions:

- **English code and identifiers; docs may be Turkish.**
- **No-guess policy** — attribution (killer, placer, spotter, …) shows only
  data verified from memory. If it isn't certain, leave the field blank; no
  heuristics or "nearest player" guesses.
- **No new runtime dependencies** without discussion (the reader ships with one:
  `zstandard`).
- Add a test for any new pure-logic helper.

## Sign off your commits (DCO)

Contributions are accepted under the [Developer Certificate of
Origin](https://developercertificate.org/). Sign off each commit:

```bash
git commit -s -m "your message"
```

The sign-off certifies you wrote the change (or may submit it) under the
project's license. It also keeps the copyright provenance clean so the project
can be relicensed or dual-licensed in the future if the community decides to.

## Reverse-engineered offsets

Memory offsets target a specific Squad build. If a Squad update breaks reads,
`sqreader doctor` reports which offsets drifted; `docs/offsets.md`
explains how they were derived.
