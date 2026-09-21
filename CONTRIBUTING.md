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

## Sign off your commits (DCO + licence grant)

Contributions are accepted under the [Developer Certificate of
Origin](https://developercertificate.org/). Sign off each commit:

```bash
git commit -s -m "your message"
```

The sign-off certifies you wrote the change, or otherwise have the right to
submit it. **You keep the copyright in what you write** — this is a licence,
not a hand-over.

By signing off you also grant the project's maintainer a perpetual,
irrevocable, worldwide, royalty-free licence to use your contribution and to
distribute it **under the project's current licence and under any later licence
the project adopts**, including a commercial one.

Why the second paragraph exists, plainly: this project is
[AGPL + Commons Clause](LICENSE), so the only party who may sell it is the
copyright holder. Without that grant, changing the licence later — or offering
anyone a commercial exception — would require tracking down and getting written
agreement from every past contributor. A plain DCO does **not** give it: a DCO
certifies where code came from and nothing more. That has already cost this
project a stalled licence change once, which is why it is spelled out here
rather than assumed.

If you are not willing to grant that, say so in the pull request. A change can
still be taken as a suggestion and reimplemented, or simply declined — that is
a better outcome for both of us than a contribution nobody can safely build on
later.

## Reverse-engineered offsets

Memory offsets target a specific Squad build. If a Squad update breaks reads,
`sqreader doctor` reports which offsets drifted; `docs/offsets.md`
explains how they were derived.
