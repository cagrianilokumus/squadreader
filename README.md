# sqreader

Read a running Squad dedicated server's process memory to produce game
snapshots — players, vehicles, capture zones, deployables, projectiles — then
record whole matches for replay and compute per-player stats and ELO. It is
**read-only**: it never writes to the game.

## Example output

`sqreader snapshot --pretty` prints one JSON snapshot of the live match:

```json
{
  "timestamp": "2026-07-15T18:31:24.082Z",
  "server": "squad",
  "gameState": { "mapName": "Narva RAAS v1", "matchState": "InProgress", "elapsedSec": 842 },
  "teams": [ { "id": 1, "factionId": "USA", "tickets": 640 } ],
  "players": [ { "name": "…", "teamId": 1, "soldier": { "position": { "x": 0, "y": 0 }, "health": 100 } } ],
  "captureZones": [ { "name": "Warehouse", "owningTeam": 1, "capturePercent": 1.0 } ],
  "vehicles": [ { "classShort": "BP_M1A2", "team": 1 } ]
}
```

`sqreader serve` records matches and serves the replay player + stats dashboard
in the browser: a map with every player, vehicle, marker and capture zone
moving in real time, a scrubbable timeline, a kill feed and a scoreboard.

You can watch one without installing anything — the replays at
[squadreader.com/replays](https://squadreader.com/replays) are produced by this
agent and played back by the viewer in `frontend/`.

## Requirements

- **Linux** — the reader depends on `/proc/<pid>/mem`; it does not run on Windows or macOS.
- **Python ≥ 3.10.**
- Permission to read the game process's memory: run as **root**, or grant the Python process `CAP_SYS_PTRACE` (and `CAP_DAC_READ_SEARCH`).
- A running **Squad dedicated server** on the same host. Offsets are reverse-engineered for Squad **v10.4 / SDK v10.4.1**.
- Node ≥ 18 **only** if you want to rebuild the web UI — a prebuilt `frontend/dist` is committed, so normal use needs no Node.

## How a match is recorded

Two tiers, so the replay is smooth without the reader stealing the box:

- a **full snapshot** about once a second — every player, vehicle, deployable,
  marker, capture zone and projectile;
- **position-only frames at 4 Hz** in between, re-reading just where everything
  is, so movement plays back fluidly.

Both go into one `.sqrx` per match (zstd-compressed NDJSON, ~6-10x smaller than
raw). A recording is written once and never edited, and nothing is ever
interpolated: an entity that fails a freshness check is left out of that frame
rather than guessed at.

## Install

```bash
git clone https://github.com/cagrianilokumus/squadreader.git
cd squadreader
pip install -e .

# one-line summary of the current match (quickest sanity check)
sudo sqreader summary

# record matches + serve replays/stats (default http://127.0.0.1:8080)
sudo sqreader serve
```

On a standard single-instance box **no configuration is needed** — the Squad
server is auto-detected by its process name.

## Run in Docker

The reader can run in its own container beside a Squad server you already run,
reading the game's memory across the container boundary. It needs two
capabilities and a shared PID namespace — nothing else, and no changes to the
game's image.

**This stack runs the reader only.** It never starts a Squad server: yours is
expected to exist already, either in a container of your own or natively on the
host. Nothing here downloads the game.

```bash
cp .env.example .env      # uncomment ONE mode block, and set SQUAD_DATA
docker compose up -d
```

`.env` is required, and so are the two values in it. Neither the game process
nor its install directory exists inside this stack, so neither can carry a
default that could be right — running without them names exactly what is
missing.

### Two modes

| Your setup | `SQUAD_PID_MODE` | `SQUAD_APPARMOR` |
|---|---|---|
| A Squad container you already run | `container:<name>` | `docker-default` |
| Squad native on the host (LinuxGSM, bare metal) | `host` | `unconfined` |

Host mode needs `apparmor=unconfined` because Docker's `docker-default` profile
permits ptrace only toward peers under the same profile; an unconfined host
process is refused at `/proc/<pid>/maps`, before the reader reaches any memory.

**In container mode the reader does not survive a game CONTAINER restart.** It
joins the game container's PID namespace as a member, not as that namespace's
init. `stop_grace_period: 30s` and the exec-to-PID-1 design protect a
`docker stop`/SIGTERM of the *reader itself*, and a game PROCESS restart
inside an unchanged container is fine — `_open_pipeline_or_wait` just
re-resolves it. But if the game container restarts (it runs
`restart: unless-stopped`), the kernel SIGKILLs every remaining member of that
PID namespace when its init exits, the reader included, with no chance to run
`finalize_recording` — an in-flight recording is left without its
`.meta.json` sidecar. Host mode is exempt, since there the reader shares the
*host's* PID namespace instead.

**Host mode's authority is broader than "read-only" suggests.** `pid: host` +
`apparmor=unconfined` + `SYS_PTRACE` + running as uid 0 (not user-namespaced)
lets the container ptrace *any* host process, not just the game — that is read
access to all host process memory and, via `PTRACE_ATTACH`, a container-escape
primitive. "The reader is still read-only" (below) describes what the reader's
own code does, not the authority the container holds. Choose host mode only on a
host you already trust at root level; container mode stays bounded to the peer
container, since `docker-default`'s ptrace confinement still applies there.

### Why the reader is privileged

`cap_drop: [ALL]` plus exactly two capabilities:

- `SYS_PTRACE` — `/proc/<pid>/maps` is mode 0444 but gated by the ptrace check;
- `DAC_READ_SEARCH` — `/proc/<pid>/mem` is mode 0600 and owned by the game's
  user, so the DAC check applies on top.

Both are needed. Docker's default capability set appears to work with only
`SYS_PTRACE`, but only because it still carries `DAC_OVERRIDE`. The reader is
still read-only: it never opens the game's memory for writing.

Installing the reader *into* the Squad image does not avoid this. It would be a
sibling of the game process rather than an ancestor, and `ptrace_scope=1` grants
attach to ancestors only — the same capability, plus a forked image and two
lifecycles behind one PID 1.

### What is mounted

| Mount | Why |
|---|---|
| `${SQUAD_DATA}:/squad:ro` | the kill-feed log, and nothing else |
| `sqreader-data:/data` | recordings and `stats/player_stats.db` |

`SQUAD_DATA` is your Squad install root — the directory that *contains*
`SquadGame/`. It is mounted read-only and the reader writes nothing into it; it
reads exactly one file, `SquadGame/Saved/Logs/SquadGame.log`. Point it at the
server you already run (`/home/steam/squad-dedicated` for a `cm2network/squad`
container, `/home/<user>/serverfiles` for LinuxGSM).

The replay UI is published to `127.0.0.1:8080` by default. Put it behind a
reverse proxy rather than setting `SQREADER_BIND=0.0.0.0` on a public box.

### Reverse proxy and TLS

Optional, and off unless you ask for it. `docker-compose.proxy.yml` adds a
Caddy container in front of the replay UI that obtains and renews a Let's
Encrypt certificate on its own — no certbot sidecar, no renewal timer, nothing
to schedule:

```bash
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
```

Omit the second `-f` and no proxy is created; the base compose file is
unchanged either way. Once the proxy *is* running, later commands that leave
the second `-f` off warn about an orphan container, because both services share
one Compose project. Putting
`COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml` in `.env` makes a
plain `docker compose up -d` pick up both files and removes the whole class of
mistake.

One variable picks the mode, because Caddy reads it out of the site address:

| `.env` | What you get |
|---|---|
| `SQREADER_SITE=replays.example.com` | automatic Let's Encrypt certificate, background renewal, `80` → `443` redirect |
| `SQREADER_SITE=:80` | plain HTTP, no ACME at all — for TLS terminated elsewhere, on a load balancer or another machine |

In TLS mode open both `80` and `443`. Caddy will issue over either challenge —
HTTP-01 on port 80 or TLS-ALPN-01 on port 443 — so 443 alone can work, but port
80 is also where the HTTP→HTTPS redirect lives, and closing it throws away the
fallback for whichever challenge fails.

HTTP/3 needs `443/udp` as well, which the compose file publishes alongside the
TCP mapping. Caddy advertises HTTP/3 by default and browsers cache that
advertisement, so an unmapped UDP port shows up later as stalled first loads.

**If the host already runs nginx or Apache on 80/443, you want no proxy
container at all.** Point that webserver at `127.0.0.1:8080`, which the base
stack publishes anyway.
[`deploy/nginx_reverse-proxy.example.conf`](deploy/nginx_reverse-proxy.example.conf)
shows the shape — a single `location ^~ /sqr1/` block that strips the prefix —
but it was written for the systemd unit in `deploy/`, which serves on **8081**,
so its `proxy_pass` points there. Behind the Docker stack, either change that
port to 8080 or set `SQREADER_PORT=8081` in `.env`.

Two things worth checking when the proxy goes in front of an install that was
already reachable. If you ever set `SQREADER_BIND=0.0.0.0`, set it back to
`127.0.0.1`: otherwise port 8080 keeps serving the same pages in plaintext on
every interface, right beside the certificate. And Docker publishes ports by
writing to nat/PREROUTING, which ufw and firewalld INPUT rules never see — the
proxy's 80 and 443 are reachable from the internet the moment it starts,
whatever `ufw status` reports.

The certificates live in the named volume `caddy-data`. Deleting it makes every
restart order a fresh certificate, which walks straight into Let's Encrypt's
per-domain weekly limit; while a domain is still being set up, uncomment the
staging-CA block at the top of [`deploy/Caddyfile`](deploy/Caddyfile) instead.

### Recording retention

Recordings grow by hundreds of MB a day and nothing else deletes them; on a box
that also runs the game, a full disk takes Squad down too. The container runs a
logrotate-style pruner beside the reader, with the same policy as the systemd
timer in `deploy/`:

| Variable | Default | |
|---|---|---|
| `RETENTION_INTERVAL` | `86400` | seconds between passes; `0` disables the pruner |
| `RETENTION_MAX_AGE_DAYS` | `90` | `0` disables this policy |
| `RETENTION_MAX_TOTAL_GB` | `150` | `0` disables this policy |
| `RETENTION_MIN_FREE_GB` | `50` | `0` disables this policy |
| `RETENTION_MIN_KEEP` | `3` | newest N are never pruned |

The match being recorded right now is never touched.

### Troubleshooting

**`required variable SQUAD_PID_MODE is missing a value`** — copy
`.env.example` to `.env` and uncomment one mode block, as the message says.

**`required variable SQUAD_DATA is missing a value`** — set it to your Squad
install root, the directory that *contains* `SquadGame/`. There is deliberately
no default: this stack does not install Squad, so any guess would mount the
wrong directory and cost you the kill feed silently.

**`PermissionError` on `/proc/<pid>/maps`** — in host mode, set
`SQUAD_APPARMOR=unconfined`; without it, AppArmor refuses the ptrace check
before `/proc/<pid>/mem` is ever opened. Otherwise check that `cap_add` still
lists both `SYS_PTRACE` and `DAC_READ_SEARCH`.

**`entrypoint: WARNING: /squad/SquadGame/Saved/Logs/SquadGame.log is not
readable`** — the `/squad` mount is wrong. `SQUAD_DATA` must be the install
root, the directory that *contains* `SquadGame/`. Expected while your server is
still installing or updating; otherwise this degrades quietly — the reader keeps
running and the stats look plausible while undercounting kills.

**`[degraded] cannot read the game (...)`** — the reader re-resolves the game
on every retry, so it simply waits until your server is up. Whether that is
normal is in the parenthesised reason: `(no SquadGameServer process running)`
is expected until the game starts; a `PermissionError` in
that parenthesis is a capability/AppArmor misconfiguration, not a boot delay
— see the entry above.

### Plugins and optional config

Plugins (anti-cheat) and the alert webhook are driven by a
`sqreader.config.json`. Create one from `sqreader.config.example.json` and
uncomment the matching volume line in `docker-compose.yml` — the reader's
working directory is `/app`, so a file mounted at `/app/sqreader.config.json`
is found without setting anything else.

### Not included

The image is built from source, so remote self-update is inert — upgrade by
pulling the repo and running `docker compose build && docker compose up -d`
(`build` alone leaves the old container running). Central push stays off;
it needs `sqreader enroll` and the `push` extra (`pip install .[push]`).

### Testing this setup

The tests for the entrypoint and the compose files live in `docker/tests/`,
outside the normal suite: they shell out to a real daemon, so a plain
`pytest` neither runs nor collects them. After touching anything under
`docker/` or a compose file, run them yourself:

```bash
python -m pytest docker/tests
```

## Configuration

Copy `sqreader.config.example.json` to `sqreader.config.json` (gitignored) and
edit only what your box needs. Resolution order is **CLI flag > config file >
built-in default**, so every value can also be passed on the command line.

| Key | Default | Meaning |
|-----|---------|---------|
| `squad_process_name` | `SquadGameServer` | the Squad server binary name (a Squad constant) |
| `squad_binary_pattern` | `/home/.*/serverfiles/.*SquadGameServer` | pgrep pattern to pick the right instance on a multi-instance box |
| `squad_log_glob` | `/home/*/serverfiles/…/SquadGame.log` | server log the kill-feed reads |
| `server_id` | `squad` | label written into each snapshot and used as the stats-DB partition key |

Output directories are `serve`/`record` flags (`--recordings-dir`, `--stats-db`,
`--icons-dir`, `--sqmaps-dir`, `--frontend-dir`) and default next to the repo.
Example systemd units and an nginx/Caddy reverse-proxy are in [`deploy/`](deploy/).

## What data it collects and where it writes

The reader only observes what the game already holds in memory, and **by
default writes only to local files — nothing is sent anywhere.** The single
opt-in exception is the optional central push: if you run `sqreader enroll`,
*finished* matches (stats + `.sqrx` replays) are pushed to a
central platform you chose. See [`PRIVACY.md`](PRIVACY.md) for exactly what is
sent and how to turn it off.

| Data | Source | Written to |
|------|--------|------------|
| Player names, EOS ids, positions, kills/deaths, roles | game memory | `stats/player_stats.db` (SQLite) + snapshots |
| Steam IDs | RCON (only if you configure it) | `stats/player_stats.db` |
| Full per-tick match capture | game memory | `recordings/*.sqrx` (+ `.meta.json`) |
| Ad-hoc snapshots | `snapshot` / `watch` | `captures/*.ndjson` |

See [PRIVACY.md](PRIVACY.md) for what is stored, how long, and how to delete it.

## Known limitations

- **Linux only** (depends on `/proc/<pid>/mem`).
- **Squad-version-specific.** Memory offsets are reverse-engineered for Squad v10.4 / SDK v10.4.1. A Squad update can move them — `sqreader doctor` re-verifies every offset against the live binary and reports drift, and startup discovery self-heals the two anchor addresses; a larger layout change needs new offsets.
- **Anti-cheat detectors have blind spots.** They flag only memory-verified signals (no guessing), so many cheat classes are simply not detectable this way.
- **One game server per reader instance.**

## Legal

Use this only on a Squad server you **own or are authorized to administer**, and
in accordance with Squad's Terms of Service and EULA. The game art under
`icons/`, `sqmaps/`, and the static data under `data/static/` are the property
of Offworld Industries and their respective sources, bundled for interoperability
only — see [NOTICE](NOTICE).

## Upgrading

Re-run the installer. It is safe to run again: recordings, stats and an existing
enrolment are left alone, and your `sqreader.config.json` is not overwritten.

```
curl -fsSL https://squadreader.com/install.sh | bash
```

A box that is already enrolled needs no token — the installer signs the download
with the agent's own credentials. From 1.3.2 onward the installed unit can apply
a signed release on its own: the agent stages it, waits for a moment when no
match is in progress, and restarts into it, keeping the previous binary beside
it in case the new one will not start.

## Contributing & License

- [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup, tests, and the DCO sign-off.
- [SECURITY.md](SECURITY.md) — reporting a vulnerability.
- **AGPL-3.0-or-later with the Commons Clause** — see [LICENSE](LICENSE).

  In plain terms: read it, run it, change it, share it — including at work.
  Just do not **sell** it, and that includes selling hosting or support whose
  value comes substantially from this tool. Running a game server that happens
  to use sqreader is not selling it, donations and paid whitelists included:
  the value there is the server, not this.

  Everything the AGPL says still holds. If you modify it and let other people
  use it over a network, you owe them your modified source.

  The added condition means sqreader is **source-available, not open source**
  in the Open Source Initiative's sense. That is deliberate.
