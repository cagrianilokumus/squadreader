# sqreader for Windows: technical summary

For the administrator reviewing what this package runs on a game-server
machine. Source code: https://github.com/cagrianilokumus/squadreader
(Windows support on the `feat/windows-support` branch).

## What it does

It reads the memory of ONE running Squad dedicated server
(`SquadGameServer.exe`) about twice a second, recognises players, vehicles,
capture zones, deployables and markers in Unreal Engine's object tables, and
writes each match to a compressed replay file (`recordings\*.sqrx`) plus a
SQLite statistics database (`stats\player_stats.db`). It also follows the
server's own log (`SquadGame\Saved\Logs\SquadGame.log`) for the kill feed.
A small viewer for those replays is served on 127.0.0.1 only.

## What it does not do

- **No writes to the game.** The game process is opened with
  `PROCESS_VM_READ | PROCESS_QUERY_INFORMATION` only. Without
  `PROCESS_VM_WRITE` / `PROCESS_VM_OPERATION` Windows refuses any write
  through that handle; the package's test suite checks exactly that.
- No code injection, no DLL loading into the game, no hooks, no debugger
  attach, no RCON or console commands to the server.
- No changes to the game's files. From the game folder it reads exactly one
  file, the server log, opened with full sharing so the server can still
  rotate it (rename to `SquadGame-backup-*.log`) at restart.
- Nothing installed system-wide: no services, drivers, registry changes or
  PATH changes. The only footprint outside its folder is two scheduled tasks
  (and a small address cache in the service account's profile,
  `.cache\sqreader\addresses.json`).

## Which server it reads

`sqreader.config.json` holds the game port (`squad_port`). The reader attaches
only to the `SquadGameServer.exe` whose command line has `Port=<that port>`,
and only to the real server under `SquadGame\Binaries\Win64\`, not the
launcher in the install root. If that server is not running it waits; it
never falls back to another instance. Other servers on the machine are not
opened, and `diagnose` reports them only as a count.

## Account and privileges

The tasks run as the account that runs the game server (detected at install),
with a limited token, "run whether the user is logged on or not" without a
stored password (S4U). Reading one's own processes needs no administrator
rights. If the game runs elevated, the installer detects the refusal and uses
the highest token of that same account instead. Administrator rights are used
only by the installer, to register the tasks and set folder permissions.

## Processes and resources

```
Task Scheduler
  python.exe -m sqreader.cli supervise ...     restarts, logs, job object
    python.exe -m sqreader.cli serve ...       the reader
```

- Both run at **below-normal priority** and inside one Windows **job object**
  with a hard CPU cap of **50% of one core** in total (the same limit the
  Linux service runs under). Ending the task ends both: the job object closes
  with the supervisor, so nothing is ever left running.
- Measured on Squad v10.6.3 (the same build this machine runs), empty server,
  257,000 game objects: the reader used **about 22% of one core and 141 MB of
  RAM**, the supervisor 19 MB. A full server has more objects; the cap holds
  either way.
- Disk: recordings grow by up to a few hundred MB per day on a busy server.
  The daily retention task keeps them under 50 GB, deletes files older than 90
  days, and frees space when the disk drops under 20 GB (all configurable).
  Logs are capped at 6 x 20 MB.

## Network

- Listens on **127.0.0.1:8081 only** (configurable): the replay viewer and its
  JSON API, read-only. Nothing is exposed to the network. Note that on a
  shared machine other local processes could reach that port; it serves only
  finished replays and statistics.
- Outbound: **none by default.** Only when enrolled with squadreader.com
  (`-EnrollToken`) AND publishing is switched on (`-Push`, or `push_enabled`
  in `sqreader.config.json`), finished matches (statistics and the replay
  file) are sent there over HTTPS (443) after each round, plus a periodic
  health check-in. Nothing is sent live. Enrolled but NOT publishing, it
  contacts squadreader.com only while it cannot read the game (for example
  during the server's daily restart): a health check-in saying so, and a
  request for a signed offset update. Without enrolment it never connects
  anywhere.

## Stopping and removal

- `sqreaderctl.ps1 stop` asks the reader to stop through a file in `state\`:
  it closes the current recording and exits within seconds. If it does not,
  the task is ended after 90 s.
- `uninstall.ps1` stops it and removes both tasks; `-Purge` also deletes the
  data folders.

## Integrity

- The bundled Python is the official CPython embeddable distribution,
  `python.exe` and `python313.dll` signed by the Python Software Foundation
  (the build verifies signature and SHA-256).
- Libraries (zstandard, cryptography, cffi, pycparser, numpy) are installed
  from PyPI wheels pinned by version **and** SHA-256.
- `MANIFEST-SHA256.txt` lists the hash of every file in the package;
  `VERSION.txt` names the exact source commit.
