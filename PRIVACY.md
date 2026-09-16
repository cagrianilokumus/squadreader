# Privacy

sqreader processes player-identifying data from your Squad server. This note is
for the operator who installs it — so you know exactly what is handled and how
to remove it.

## What is processed

- **In-game player names** and **EOS ids** (Epic Online Services account ids),
  read from game memory every tick.
- **Steam IDs** — only if you configure RCON; they are mapped to EOS ids.
- **Player positions, kills/deaths, roles, scores** from game memory.

This is the same data your Squad server already holds. sqreader adds no external
tracking, and **by default sends nothing anywhere** — every output is a local
file. The one exception is opt-in and explicit: if you run `sqreader enroll`
(see "Optional central push" below), finished matches are pushed to a central
platform that you chose.

## Where it is stored and for how long

| Store | Contains | Retention |
|-------|----------|-----------|
| `stats/player_stats.db` (SQLite) | names, EOS/Steam ids, per-match stats, ELO | until you delete it (grows indefinitely) |
| `recordings/*.sqrx` (+ `.meta.json`) | full per-tick match capture (positions, names) | until pruned by `deploy/cleanup_recordings.sh` (default 90 days) or manually |
| `captures/*.ndjson` | ad-hoc snapshots you take | until you delete them |
| `docker compose logs proxy` (optional Caddy proxy only) | replay-UI access log: client IP, **full request URI — which for some paths contains player identifiers** (below), user agent, timestamp | rotated by Docker, 5 × 10 MB (`docker-compose.proxy.yml`) |

The reader's own HTTP server keeps no access log (`_H.log_message` is a
deliberate no-op). The proxy's exists because it is then the only place a
request is ever recorded, which matters after an incident.

**Read this before enabling the proxy.** Caddy's `log` directive records the
request URI, and three of the reader's API paths carry player identifiers in
that URI:

| Path | What ends up in the log |
|------|-------------------------|
| `/api/players/<eosId>` | an EOS account id |
| `/api/players?q=<name>` | an in-game player name |
| `/api/match/<id>` | a match id, which resolves to a full scoreboard |

The replay UI calls these as you click through it, so a normal browsing session
writes them. That makes the proxy log the first and only place in this stack
where a **player identifier is correlated with a viewer's IP address** — a
different kind of record from the match data itself, and one nothing else here
produces. Under GDPR both sides of that pairing are personal data.

It is not on by default: it exists only if you deploy
`docker-compose.proxy.yml`. To keep the proxy and drop the log, comment out the
`log` directive in `deploy/Caddyfile`; you lose the post-incident trail. To keep
it, the only retention control is Docker's rotation above (5 × 10 MB, roughly a
few hundred thousand requests) — there is no time-based expiry, so set your own
if your policy needs one.

## Optional central push (opt-in, off by default)

sqreader can report **finished** matches to a central platform — for example a
community website that aggregates several servers' match history and stats. This
is **off unless you deliberately turn it on**, in two explicit steps:

1. `sqreader enroll <token>` — redeem a one-time token from that platform. It
   writes credentials to a `0600` `.env.agent` and binds them to this host.
2. `sqreader serve --push` (or set `push_enabled: true` in `sqreader.config.json`).

A fresh install that never runs `enroll` makes **zero** outbound requests.

**What is pushed, per finished match:** the same match-history + player data your
local stats DB already holds — the match summary + full scoreboard, per-player
stats and ELO, kill events (including positions), and vehicle-usage sessions —
and, unless you disable it (`push_replay: false`), the match's `.sqrx` replay.
**The live real-time map is never pushed** — no positions of an in-progress
match leave the box; only completed matches are sent.

**How it is sent:** each match is gzipped, encrypted with AES-256-GCM (a key
derived from your per-host enrollment secret), and POSTed over HTTPS. A central
only accepts matches from agents it enrolled.

**To stop:** delete `.env.agent` (un-enrolls this host), or drop `--push` /
set `push_enabled: false`. Data you already pushed lives on the central
platform — deleting it there is that operator's responsibility; ask them.

## How to delete data

- **One match:** delete its `.sqrx` and `.meta.json` under `recordings/`.
- **One player from the stats DB:**
  ```sql
  DELETE FROM players        WHERE eos_id = '<eos-id>';
  DELETE FROM player_matches WHERE eos_id = '<eos-id>';
  DELETE FROM kill_events    WHERE attacker_eos = '<eos-id>' OR victim_eos = '<eos-id>';
  ```
- **Everything:** stop the reader and delete the `stats/`, `recordings/`, and
  `captures/` directories.

## Your responsibility

You run sqreader on your own server. Whether you must inform players or honor
deletion requests depends on your community's rules and the law that applies to
you (for example, the GDPR if you operate in the EU). sqreader gives you the
tools to delete data; the policy is yours to set.
