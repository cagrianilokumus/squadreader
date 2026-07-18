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
in the browser:

<!-- Add a screenshot at docs/screenshot.png -->
![replay + stats](docs/screenshot.png)

## Requirements

- **Linux** — the reader depends on `/proc/<pid>/mem`; it does not run on Windows or macOS.
- **Python ≥ 3.10.**
- Permission to read the game process's memory: run as **root**, or grant the Python process `CAP_SYS_PTRACE` (and `CAP_DAC_READ_SEARCH`).
- A running **Squad dedicated server** on the same host. Offsets are reverse-engineered for Squad **v10.4 / SDK v10.4.1**.
- Node ≥ 18 **only** if you want to rebuild the web UI — a prebuilt `frontend/dist` is committed, so normal use needs no Node.

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
Example systemd units and an nginx reverse-proxy are in [`deploy/`](deploy/).

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

## Contributing & License

- [CONTRIBUTING.md](CONTRIBUTING.md) — dev setup, tests, and the DCO sign-off.
- [SECURITY.md](SECURITY.md) — reporting a vulnerability.
- Licensed under **AGPL-3.0** — see [LICENSE](LICENSE).
