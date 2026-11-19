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
  PATH changes, and it writes nothing outside its own folder (its address
  cache is `state\addresses.json`). Run from a hosting panel there is no
  footprint outside the folder at all; with `install.ps1` there is one
  scheduled task.

## Which server it reads

`sqreader.config.json` holds the game port (`squad_port`). The reader attaches
only to the `SquadGameServer.exe` whose command line has `Port=<that port>`,
and only to the real server under `SquadGame\Binaries\Win64\`, not the
launcher in the install root. If that server is not running it waits; it
never falls back to another instance. Other servers on the machine are not
opened for reading, and `diagnose` reports them only as a count.

To find it, the reader lists the machine's processes by name
(`CreateToolhelp32Snapshot`) and, for each `SquadGameServer.exe` only, reads
its image path and command line with `PROCESS_QUERY_LIMITED_INFORMATION`.
Only the one whose port matches is opened with `PROCESS_VM_READ`.

## Account and privileges

When it runs from a hosting panel, it needs exactly one thing: to run as the
account that runs `SquadGameServer.exe` (or one with `PROCESS_VM_READ` on
it). No administrator rights.

If opening the game is refused, the reader tries once to switch on
`SeDebugPrivilege` **if the account already holds it** (only administrators
and LocalSystem do; a normal account does not, and nothing is granted). That
is how an administrator could read a game started by another user. Under a
normal account this attempt does nothing.

With `install.ps1`, the task runs as the account that runs the game server
(detected at install), with a limited token, "run whether the user is logged
on or not" without a stored password (S4U). Reading one's own processes needs no administrator
rights. If the game runs elevated, the installer detects the refusal and uses
the highest token of that same account instead. Administrator rights are used
only by the installer, to register the task and set folder permissions.

## Processes and resources

```
hosting panel, or Task Scheduler
  python.exe -m sqreader.cli supervise ...     restarts, logs, job object,
                                               daily retention (a thread)
    python.exe -m sqreader.cli serve ...       the reader
```

- Both run at **below-normal priority** and inside one Windows **job object**
  with a hard CPU cap of **50% of one core** in total (the same limit the
  Linux service runs under). Ending the supervisor ends both: the job object
  closes with it, so nothing is ever left running.
- Measured on Squad v10.6.3 (the same build this machine runs), empty server,
  257,000 game objects: the reader used **about 22% of one core and 141 MB of
  RAM**, the supervisor 19 MB. A full server has more objects; the cap holds
  either way.
- Disk: recordings grow by up to a few hundred MB per day on a busy server.
  A thread of the supervisor prunes them once a day (first 5 minutes after
  start): it keeps them under 50 GB, deletes files older than 90 days, and
  frees space when the disk drops under 20 GB (all configurable). It never
  touches the match being recorded, and always keeps the newest 3.
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

## Control files

`state\enroll-token.txt` (enrol at the next start), `state\sqreader.restart`
(restart cleanly) and `state\sqreader.stop` (stop) let whoever can write to
the folder manage the reader without running anything on the machine. They
grant nothing beyond what write access to the folder already gives: the
config file in it decides what the reader does anyway.

## Stopping and removal

- Creating `state\sqreader.stop`, or Ctrl+C / Ctrl+Break to the supervisor,
  stops it cleanly: it closes the current recording and exits within
  seconds. `sqreaderctl.ps1 stop` does the same, and ends the task if it has
  not stopped after 90 s.
- `uninstall.ps1` stops it and removes the task; `-Purge` also deletes the
  data folders. Without the installer, deleting the folder removes
  everything.

## Integrity

- The bundled Python is the official CPython embeddable distribution,
  `python.exe` and `python313.dll` signed by the Python Software Foundation
  (the build verifies signature and SHA-256).
- Libraries (zstandard, cryptography, cffi, pycparser, numpy) are installed
  from PyPI wheels pinned by version **and** SHA-256.
- `MANIFEST-SHA256.txt` lists the hash of every file in the package;
  `VERSION.txt` names the exact source commit.
