# sqreader for Windows: installation

sqreader records Squad matches as replays and player statistics by **reading**
the memory of a running Squad dedicated server on the same machine. It never
writes to the game, injects nothing, hooks nothing and sends the server no
commands. See `TECHNICAL-SUMMARY.md` for exactly what it does.

This package is self-contained: it brings its own Python and every library.
Nothing is installed system-wide. There are two ways to run it:

- **from your own process manager / hosting panel** as one long-running
  process. No installer, no scheduled task, nothing outside this folder. See
  [Running from a hosting panel](#running-from-a-hosting-panel);
- **with `install.ps1`**, which registers one scheduled task (below).

## Running from a hosting panel

The whole reader is one command, run with **this folder as the working
directory**:

```
python\python.exe -m sqreader.cli supervise --log-file logs\sqreader.log --stop-file state\sqreader.stop --cpu-limit 50 --retention-dir recordings -- serve --host 127.0.0.1 --port 8081 --hz 2 --recordings-dir recordings --stats-db stats\player_stats.db --icons-dir icons --sqmaps-dir sqmaps --frontend-dir frontend\dist
```

Before the first start, put a `sqreader.config.json` in this folder with the
game port of the server to read (its `Port=` argument):

```json
{ "squad_port": 11271, "server_id": "bluefang" }
```

What the panel needs to know:

| | |
|---|---|
| Account | the process must run as the **same Windows account as `SquadGameServer.exe`** (or one with `PROCESS_VM_READ` on it): it reads that process's memory, read-only. Nothing else needs special rights |
| Folder access | read the game's `SquadGame\Saved\Logs\SquadGame.log`; write this folder (`recordings\`, `stats\`, `logs\`, `state\`) |
| Lifetime | runs until stopped. It waits on its own while the game server is down or restarting, and restarts its reader child after a crash, so the panel need not restart it (doing so is harmless) |
| Stopping | Ctrl+C / Ctrl+Break to the process, or creating `state\sqreader.stop`, stops it cleanly within seconds (the current recording is closed). A hard kill also ends everything it started, but leaves that recording unclosed |
| Scheduling | none needed: old recordings are cleaned up by a thread of this process, 5 minutes after start and then every 24 hours (older than 90 days, beyond 50 GB in total, or when the disk drops under 20 GB free; the newest 3 are always kept). Tune with `--retention-max-age-days`, `--retention-max-total-gb`, `--retention-min-free-gb`, `--retention-every-hours` |
| Resources | below-normal priority; `--cpu-limit 50` caps it at 50% of one core |
| Output | everything goes to `logs\sqreader.log` (rotated at 20 MB, 5 kept). Leave out `--log-file` to have it on stdout for the panel instead |
| Network | listens on 127.0.0.1:8081 only (`--port` to change). No outbound connection unless publishing to squadreader.com is switched on |

To check that it can read the game, run once from the same folder, as the
same account, while the server is up:

```
python\python.exe -m sqreader.cli diagnose --deep
```

The `install.ps1` / `sqreaderctl.ps1` / `uninstall.ps1` scripts are not used
in this mode. The control files in `state\` (see below) work the same.

## Requirements

- Windows Server 2016 or later (x64), or Windows 10/11
- The Squad server to be read is **running** on this machine, and you know its
  game port (its `Port=` argument, e.g. `Port=11271`)
- An elevated PowerShell (Run as administrator), for registering the tasks
- About 150 MB for the package, plus the recordings budget (default cap 50 GB)

## Install

1. Unzip the package to a folder of its own, ideally without spaces, e.g.
   `C:\sqreader\<server-name>\`. That folder **is** the installation: logs,
   recordings and the config live in it.
2. Open **PowerShell as administrator** in that folder.
3. Run, with the game port of the server to read:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1 -SquadPort 11271 -ServerId bluefang
   ```

The installer stops at the first problem, and changes nothing until its
checks pass. It:

1. runs the bundled Python's `version` and `selftest`;
2. writes `sqreader.config.json` with the game port (this is what makes it
   read *this* server and no other one on a shared machine);
3. finds the Windows account the Squad server runs as. The reader runs as the
   **same account**: Windows lets an account read its own processes' memory,
   so no administrator rights are needed;
4. lets that account write this folder (`recordings\`, `stats\`, `logs\`,
   `state\`, and its enrolment file);
5. runs `diagnose --deep` **as that account** and saves the result to
   `diagnose-install.txt`. This proves the reader can see the game before
   anything is registered;
6. registers the scheduled task `sqreader-<ServerId>`: starts at boot,
   below-normal priority, CPU capped at 50% of one core, restarts on its own
   after a game-server restart or crash. Once a day it also deletes old
   recordings (older than 90 days, or beyond 50 GB in total, or when the disk
   drops under 20 GB free; the newest 3 are always kept);
7. starts the reader and prints its first log lines.

Expected end of the output:

```
[sqreader] diagnose: all checks passed (saved to diagnose-install.txt)
[sqreader] registered task sqreader-bluefang (runs at boot as <account>, Limited)
[sqreader] retention runs inside the reader: daily, older than 90 days, ...
[sqreader] started; waiting for it to attach to the game (up to 2 minutes)
    ... serving on http://127.0.0.1:8081 ...
[sqreader] running. Viewer on this machine: http://127.0.0.1:8081/
```

### Options

| Option | Default | Meaning |
|---|---|---|
| `-SquadPort` | (required) | game port of the Squad server to read |
| `-ServerId` | `squad` | name of this instance; task names use it |
| `-User` | the game's account | account to run the reader as, if it cannot be detected |
| `-UserPassword` | none | only if the account may not run "whether logged on or not" without a stored password |
| `-HttpPort` | `8081` | local port of the viewer, on 127.0.0.1 only |
| `-CpuLimit` | `50` | CPU cap, in percent of ONE core |
| `-RetentionMaxAgeDays` / `-RetentionMaxTotalGB` / `-RetentionMinFreeGB` | `90` / `50` / `20` | recording clean-up policy |
| `-EnrollToken` | none | register with squadreader.com; does **not** publish anything yet |
| `-Push` | off | publish finished matches to squadreader.com (also: `"push_enabled": true` in `sqreader.config.json`, read at the reader's next restart) |
| `-SkipCheck` | off | do not run the diagnose step (not recommended) |

## Check it

```powershell
powershell -ExecutionPolicy Bypass -File .\sqreaderctl.ps1 status
```

shows the task state, the recordings and the last log lines. The full log is
`logs\sqreader.log` (timestamped UTC, rotated at 20 MB, 5 kept).

## One request after installing

During a **full match** (60+ players), please run once:

```powershell
powershell -ExecutionPolicy Bypass -File .\sqreaderctl.ps1 doctor
```

and send us `doctor-latest.txt` (or leave it in the folder; we can collect it
over FTP). It checks the parts of the game's memory that only exist while
players are on the server. On an empty server some of its checks fail by
design.

## Day to day

| Command (`.\sqreaderctl.ps1 <command>`) | |
|---|---|
| `status` | task state, recordings, last log lines |
| `stop` | stops cleanly: the current recording is closed first (a few seconds) |
| `start` / `restart` | |
| `diagnose` | re-runs the install check as the reader's account, saves `diagnose-latest.txt` |
| `doctor` | the full-match check above, saves `doctor-latest.txt` |
| `logs` | last 40 log lines |

Ending the task in Task Scheduler also works; it is just not clean (the match
in progress is kept, but its recording is not closed). Everything the reader
started ends with it.

## Control files (for the server owner, e.g. over FTP)

Three files in `state\` act as switches, so the owner can manage the reader
without anyone running a command on the machine:

| Put this file in `state\` | Effect |
|---|---|
| `enroll-token.txt` (containing the token) | the reader enrols with squadreader.com at its next start, then deletes the file (`.failed` if it did not work) |
| `sqreader.restart` | the reader restarts cleanly within seconds (to pick up a config change or an enrolment) |
| `sqreader.stop` | the reader stops cleanly and the task ends (start it again with `sqreaderctl.ps1 start`) |

## Update

1. `.\sqreaderctl.ps1 stop`
2. delete the `python\` and `app\` folders
3. unzip the new package over this folder (config, recordings, stats and logs
   are kept)
4. run `install.ps1` again with the same options

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1          # keeps recordings/stats/logs
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -Purge   # deletes them too
```

then delete the folder.

## If the install check fails

The installer prints the full report; it is also in `diagnose-install.txt`.

| The report says | What to do |
|---|---|
| `our game server: no SquadGameServer running with -Port=...` | the server is down, or `-SquadPort` is not its `Port=` |
| `open the game: PermissionError` | the reader cannot read the game as that account; the installer already retries elevated. Pass `-User` with the account that runs `SquadGameServer.exe` |
| `game runs as: ... the reader runs as ...` | the two accounts differ; pass `-User` |
| `127.0.0.1:8081 is already in use` | pick another port with `-HttpPort` |
| anything else | send us `diagnose-install.txt` and `logs\sqreader.log` |

If security software blocks one process from reading another's memory, an
exclusion for this folder's `python\python.exe` is what is needed.
