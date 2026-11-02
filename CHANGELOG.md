# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.10] - 2026-10-18

### Added
- The agent tells central about the match being played right now: map, mode,
  elapsed time, players, factions, tickets, and whether a replay is being
  written. squadreader.com showed "Playing now" for one server only, because
  this was never part of the agent everyone installs. It rides a light
  check-in every minute; the full one with health and the Squad build stays
  on five minutes, so the cost per hour does not change.
- `leaderboard_public: false` hides the leaderboards: `/api/leaderboard`
  answers 404, the Stats dialog drops its leaderboard tabs and Home its Top
  Players panel. Profiles, search, weapons, match lists and heatmaps stay
  public, and an enrolled agent still sends its matches to central, which
  ranks them on its own boards (#11, r4b2).
- The replay timeline folds down to its seek bar and controls with a caret
  beside them, so the moments above the track stop covering the map (#12,
  r4b2).
- The home footer links to the GitHub repository (#13, r4b2).

### Fixed
- A torn read of the team-kill counter latched into a match total for good.
  The shared sanity ceiling for counter stats is 5000, which is nowhere near
  what a round of Squad can produce: measured over 97,902 rounds with at least
  one team kill, the counts run 1, 2, 3 ... 14, 18, 26, 33, 36, 37 and then
  stop, and the next values on record are 84, 281, 464 (four times), 2304 and
  4738 - the same adjacent-int32 junk band that already has `vehicle_kills` on
  its own ceiling. Because counters are kept with MAX, one bad tick fixed the
  figure for the rest of the match. `team_kills` now has its own ceiling in the
  empty gap between a griefer and a garbage read.
- A single team kill could erase a whole match from a player's rating. The two
  penalties were absolute totals while every component they are subtracted from
  is a rate per minute, so they grew with the length of the round - the median
  penalty of a 35-minute player was twice a 25-minute one's for the same
  standard of play - and one team kill at 0.25 outweighed the entire median
  performance of 0.282. The score was then floored at zero, which looked like a
  safety net and was an eraser: measured over a live archive it was collapsing
  23.6% of all rated player-matches, 94,514 of them and not one with a raw score
  of zero, into a single tie at exactly 0.0 that the percentile could not break,
  and 67.5% of every round containing one team kill landed there, level with
  players who never left main. One player won a forty-minute round, scored 1820
  on the objective, and the rating moved him nothing: his penalty came to 0.5000
  against a raw score of 0.4995, which dropped him from the 89th percentile of
  that match to the 9th. The penalties are rates now and there is no floor -
  only the order of these scores is ever read, and a ruinous round has to be
  allowed to sort below a blank one. A team kill still costs what eight deaths
  do, as it always did. Removing the floor exposed what it had been hiding:
  both counters are read out of the game and both tear, one round on record
  claiming 4738 team kills and another 461 deaths, so each is now capped at a
  rate above the 99.9th percentile of real play. Run `stats-elo-recalc` after
  updating; live ELO cannot revise matches it has already applied.
- On a map change the reader could read memory that no longer held what it
  had held a moment before, and wrote it down: player rows with empty ids,
  names of stray characters and teams in the millions, markers of type "None"
  with squads such as 5017313, nameless projectiles, and a vehicle sitting at
  exactly (0, 0, 0). The viewer drew them as a ZU-23 in the middle of Fallujah
  with a passenger whose name filled the tooltip. Those rows are left out now,
  role ids and vehicle classes must look like identifiers, and a position at
  exactly x = 0, y = 0 counts as no position. The viewer cleans the same rows
  out of recordings made before this release.
- Fast-forwarding a dense recording could grow the tab to 2.4 GB and end on
  Chrome's out-of-memory page: every `ctx.save()` cost 772 bytes of Blink
  heap, a few hundred times a frame. The map keeps that state itself now.
- A recording with no layer block and one garbage coordinate (x ~ 5e151)
  framed the map so wide that drawing the grid never finished (#9, r4b2).
- The Docker image served the viewer as last committed, months old; it now
  builds the frontend itself (#10, r4b2).
- A replay link mounted the home page for one render first, which fetched
  the recording list and the leaderboard for a page nobody saw. It opens
  straight into the replay now.

### Removed
- The viewer's squadreader.com stats mode: `/stats` in the `build:apple`
  bundle, `theme-site.css`, its server picker and the FOB/HAB heatmap kinds.
  squadreader.com serves /stats as pages of its own now. The agent's own Stats
  dialog, its Top Players panel and `leaderboard_public` are unchanged.

## [1.4.9] - 2026-10-11

### Added
- The local replay server can start a recording part-way through
  (`?from=<epoch ms>`), so the viewer plays a replay while it downloads and
  jumps ahead without waiting for the download to get there.
- Viewer: incaps are listed in the kill feed as they happen, with the death
  that follows as a short row ("Show incaps" in the settings); each objective
  shows how many players of each team stand on it ("Players on objectives");
  a team view shows one side's own map; the timeline marks the moments that
  decided the round; frames can be stepped one at a time.
- The reader can run in its own container beside a Squad server you already
  run, reading the game's memory across the container boundary. Getting there
  by hand is a research project - the game process lives in another PID
  namespace or on the host, `/proc/<pid>/maps` is gated by ptrace and
  `/proc/<pid>/mem` by DAC on top of it, and AppArmor's `docker-default`
  refuses ptrace toward anything not under the same profile. `docker compose
  up -d` after `cp .env.example .env`; the stack never starts a game server,
  and the two things it cannot guess - which process to attach to, and where
  the install lives - are required rather than defaulted, so a wrong guess
  cannot quietly cost you half the kill feed.
- The container prunes its own recordings on the same policy as the systemd
  timer in `deploy/`. Recordings grow by hundreds of MB a day, nothing else
  deletes them, and on a box that also runs the game a full disk takes Squad
  down with it - so the valve sits next to the thing that opens it rather than
  in a second container somebody forgets to start.
- An optional reverse proxy in front of the replay UI, with the certificate
  handled for you. `docker compose -f docker-compose.yml -f
  docker-compose.proxy.yml up -d` adds a Caddy container that obtains and
  renews a Let's Encrypt certificate on its own - no certbot sidecar, no
  renewal timer, nothing to schedule. It lives in its own compose file because
  a reverse proxy is the one piece of a deployment somebody usually already
  has; without the second `-f` nothing about the stack changes. `SQREADER_SITE`
  picks the mode by its shape - a hostname turns on automatic HTTPS and the
  HTTP->HTTPS redirect, a bare `:80` turns ACME off entirely for a host where
  TLS is terminated elsewhere. `LETSENCRYPT_EMAIL`, `PROXY_HTTP_PORT` and
  `PROXY_HTTPS_PORT` cover the account e-mail and a host that already owns
  80/443.

### Fixed
- A replay that failed to upload was sent again, whole, on every flush -
  about every 30 seconds - for as long as the failure lasted. An operator
  whose uploads were being refused saw the same 88 replays re-sent that way
  until about 20 TiB had gone out (#5). A failed replay now waits before it
  is tried again, a minute at first and four times longer after each failure
  up to six hours, and is set aside after the eighth failure, about 18 hours
  on: a central that is down overnight still receives it, a refusal that
  never changes costs eight uploads. A refusal no retry can change - HTTP 413,
  or a file over central's 2 GiB limit - sets it aside at once, before a byte
  is sent. The match's stats go up separately and are not affected. A
  recording that never turns up is no longer waited for after a day, and the
  `[push]` log line counts what was set aside as `skipped`.
- Replays over 90 MiB could not be published through a proxy that caps the
  request size (Cloudflare's cap is 100 MiB, answered with a 413), which a
  full 100-player match always exceeds. They now go up in 64 MiB parts that
  central reassembles and checks against the whole file's SHA-256 before it
  takes the replay; the agent also checks central's answer to the last part
  before retiring it from the queue. Needs a central that accepts parts, as
  squadreader.com does.
- Publishing to central ran inside the reading loop, so a large upload froze
  the live map and the recording for as long as it took - 70 seconds were
  measured for one replay. It runs beside the loop now, one flush at a time.
- Squad renamed `FireTeamIndex` to `FireteamIndex`. The reader matched field
  names exactly, lost the fire-team index, and squad leaders' map markers
  showed as "offline / unresolved". Field names are now matched without
  regard to case.
- Invasion objectives are read as capture zones; the map showed raw actor
  names such as `BP_CaptureZoneCluster_C_13` in their place.
- A player stuck reconnecting has two player states, neither with an EOS id,
  and both were kept: the kill feed printed a death for that player on every
  tick. One row per player is kept now.
- On a two-tier recording the viewer discarded every 4 Hz position update. The
  compact format wraps those lines so they are never diffed, and the browser's
  decoder had no branch for them at all, so each one came back as a copy of the
  previous full snapshot - the replay played at the full-frame rate while a
  quarter of the download was thrown away on arrival. Nothing compared the two
  decoders against each other, which is why it survived; they now are.
- A recording whose layer the reader could not identify drew a bare grid. The
  layer lookup is keyed on the exact display name, so a community that names
  its scrim layer after itself missed it and the frames carried no map at all.
  The viewer now falls back to the map name, which those frames do carry.
- Non-finite coordinates could reach a 4 Hz position frame. The sanity gate was
  a magnitude test, and `abs(NaN) > limit` is false, so a torn read passed
  straight through; `z` came from the same struct and was never checked at all.
- The admin free-camera is no longer drawn on the map. It is not a player,
  nobody in the match can see it, and it moved wherever whoever was spectating
  happened to look.
- Direction and Frontline markers are drawn as the strokes they are, with the
  placing squad in a disc at the point the drag began.

### Changed
- Replay decoding in the browser is about twice as fast: guarding every field
  against one awkward key cost more than half the time, and only that key
  needs it.

## [1.4.8] - 2026-09-11

### Fixed
- The replay download sent `Transfer-Encoding: chunked` to every client,
  including ones answered with an HTTP/1.0 status line - and HTTP/1.0 has
  no chunked encoding. Browsers tolerate the contradiction; a strict
  reverse proxy does not, and reads the hex chunk lengths as part of the
  recording. The framing now follows the version the client actually
  spoke: HTTP/1.1 gets a 1.1 status line and chunked (its terminator is
  how a client knows the download finished rather than died), HTTP/1.0
  gets the body bare, delimited by the connection close. Reported by a
  deployment sitting behind such a proxy.

## [1.4.7] - 2026-09-08

Same agent code as 1.4.6, which was tagged but never produced a binary: the
build broke on the day Debian 11 went end-of-life. 1.4.6 has no release
assets; use this one.

### Fixed
- The build image could no longer be built. `bullseye-security`'s Release
  file passed its Valid-Until when Debian 11 reached end of life, and apt
  refuses the entire update over it. Only the freshness check is relaxed -
  signatures are still verified - because the alternative, moving to
  bookworm, raises the glibc floor from 2.31 to 2.36 and would kill the
  binary on the older boxes this base exists to support.
- `packaging/build.sh` built the image with `-q` and its output redirected to
  `/dev/null`, so the failure above reached CI as a bare "exit code: 100"
  with nothing else. It now stays quiet on success and prints the docker
  output on failure.

## [1.4.6] - 2026-09-08

### Fixed
- The world-transform self-check added in 1.4.5 only ran in the process
  that builds full snapshots. In the two-tier recorder that is a separate
  process from the 4 Hz position sampler, so when Squad moved
  ComponentToWorld again the full frames were corrected and the position
  frames were not. The sampler read 0x10 early, which lands in the
  FTransform's quaternion: positions came out as `x=0.38, y=0.93` with the
  real x pushed into z, so every entity jumped to the world origin for one
  frame and back. In the viewer that renders as players teleporting into a
  vehicle near the middle of the map - one tank showing nineteen passengers
  drawn from both teams. The sampler now runs the same check, against the
  vehicles it already has, once per process.

## [1.4.5] - 2026-09-01

### Fixed
- Squad v10.5.3 moved most of the struct fields the reader's hardcoded
  offsets point at, and the reader did not notice. It kept running, kept
  reporting itself healthy, and kept recording - writing matches in which
  every position was `{x: junk, y: 0, z: 1}`. Rally points, vehicle and
  seat health, turret magazines, and deployable placer attribution were
  wrong in the same way. Anyone on 1.4.3 or 1.4.4 with Squad v10.5.3 has
  recordings from that window that cannot be repaired; new ones are
  correct from the moment this version starts.
- Offsets are now re-derived from the running binary instead of being
  read out of a table. Most of the fields involved are UPROPERTYs, so the
  binary was carrying their real offsets all along; `resolve_paths` reads
  them at startup and prints what it corrected. The few that reflection
  cannot see move with a reflected neighbour rather than being left
  behind.
- ComponentToWorld - the one that ruined the positions - has neither
  reflection nor a neighbour to anchor to, so the snapshot now recognises
  it instead: on a component with no attach parent the world transform is
  the relative one, which reflection does resolve. The offset is checked
  against live actors before it is used, and searched for only if the
  check fails. A split vote keeps the old value; a wrong coordinate in an
  archive is permanent, a stale one is not.
- `doctor` resolves paths before it judges them, so it reports on the
  offsets the reader will actually use rather than on the constants in
  the source. Cap-zone geometry matching recovers with the positions.

## [1.4.4] - 2026-08-19

### Added
- Plugin alerts can be sent to a Discord webhook. Detection already worked
  and every alert already landed in the database, but nothing ever read that
  table - so the only way to learn about a cheater was to open SQLite, which
  means nobody learned about anything. Set `alert_webhook` in the config.
  Alerts carry the evidence the detector based its call on and a link to the
  replay they came from.
- Plugins can be switched on from the config file (`plugins_config`), not only
  from the command line. On a deployment whose start command belongs to an
  image or a unit file somebody else manages, the detectors could not be
  enabled at all - which is why they had never run anywhere.
- `scripts/plugin_replay.py` runs the detectors over recorded matches offline.
  A detector is an accusation generator, and until now the only way to find
  out what its thresholds did on your server was to switch it on and watch a
  channel fill with names. Now it can be measured against the archive instead.

### Fixed
- Cheat detection measured "sustained for N ticks", which only meant what it
  says at one tick rate. The inherited value meant 16 seconds at 0.5 Hz and
  2.7 seconds at 3 Hz - and a parachute landing or a bail from a moving
  vehicle lasts about that long, which is a false accusation waiting for a
  config nobody thought to rescale. Durations are now measured in seconds from
  the game's own clock and mean the same thing at any rate.
- The 4 Hz position sampler could write a non-finite coordinate. Its gate was
  a magnitude test, and `abs(nan) > 5e6` is false by IEEE rules, so a torn
  read passed straight through into the recording; `z` was never checked at
  all.
- A recording whose layer the recorder could not identify - a scrim layer a
  community named after itself - now draws its map instead of a bare grid.

## [1.4.3] - 2026-08-13

### Fixed
- Direction and Frontline markers were drawn as a spotted infantryman. They are
  not points: a squad leader drags them across the map, and the game records how
  far and in which direction - two numbers this reader had recorded as unused
  padding. With no geometry to draw, the viewer fell back to the generic
  infantry glyph, so an order spanning half the map appeared as one soldier
  standing where the drag began, indistinguishable from a spotted enemy. Both
  are now read and drawn as the strokes they are, and a point of interest is a
  diamond rather than a third thing wearing the same soldier icon.
- Recordings made before this carry no such geometry and never will. Those
  markers are drawn as a plain point rather than an arrow aimed at a guess.
- A locked squad is now recorded and shown as locked on the scoreboard.

## [1.4.2] - 2026-08-10

### Fixed
- Servers not installed through LinuxGSM lost most of their kill feed without
  being told. The agent looked for the game's log in one fixed place - the
  layout LinuxGSM happens to use - so a server installed anywhere else found
  nothing, quietly fell back to sampling kills from memory, and produced
  statistics that looked reasonable and undercounted. It now asks the running
  game where its own log is, which is correct wherever the server was
  installed, and says so plainly when it still cannot find one.

## [1.4.1] - 2026-08-10

### Fixed
- An agent that could not read the game gave up instead of asking for help. If
  the Squad server was not running yet, or a game update moved the things the
  reader looks for, it stopped before it had said anything to anyone - and then
  did the same on every restart, quietly, forever. That is the one fault that
  arrives on every server at the same moment, and it disabled the only channel
  that could have delivered a fix.
- It now keeps trying, and keeps reporting itself while it does. A server in
  that state is visible as down, with the reason, and can still receive a
  corrected set of memory offsets or a new version - so recovering from a Squad
  update does not involve logging into anyone's machine.

## [1.4.0] - 2026-08-10

### Changed
- The project is free software again, under the GNU Affero General Public
  License v3. Run it, change it, host it; if you host a changed version for
  other people, publish your changes. The previous release was proprietary and
  tied the right to use it to enrolment with one particular central - that is
  now gone. Releases distributed under the AGPL before the proprietary period
  were always still AGPL; this puts everything back on one licence.
- Internal deployment runbooks are no longer part of this repository. They
  described one specific set of servers and were of no use to anyone else.

## [1.3.3] - 2026-08-09

No functional change. Published so that a server already running 1.3.2 would be
asked to install it, unattended, and be watched doing so - the one part of
remote updating that cannot be proven anywhere except on a live server.

## [1.3.2] - 2026-08-09

### Fixed
- The self-updating added in 1.3.1 could never actually run. The agent
  recognised a genuine installation as if it were a developer's source
  checkout, decided there was nothing to replace, and threw the update away -
  quietly, on every server. Found by running the real 1.3.1 build on a Linux
  box rather than trusting the tests, which cannot reproduce the packaged form
  of the program.

## [1.3.1] - 2026-08-09

Remote updates now actually install themselves. Until this release the agent
downloaded and verified a new version and then sat on it: nothing ever applied
it, so every upgrade was a manual visit to the server.

### Added
- The agent installs a verified release on its own. It waits for a moment with
  no match in progress, exits, and comes back on the new version - the restart
  is what performs the swap, so no recording is ever cut in half by an upgrade.
- An upgrade that will not run is undone by itself. The incoming binary has to
  start and report its version before it is allowed to take over, the previous
  one is kept next to it, and a version that cannot get through startup twice
  is put back. A bad release is then remembered as bad and never offered to
  that server again.

### Fixed
- A fresh install could download the map-and-viewer archive and install it as
  though it were the agent, depending only on the order the release listing
  happened to be written in.

## [1.3.0] - 2026-08-09

Required for everyone: until now a match that simply stopped being watched was
published with a made-up result.

### Fixed
- Matches that the agent never saw end were recorded as if they had, with
  whatever the score happened to be at the moment it stopped looking, and a
  winner worked out from that score. One torn read of the game's match state was
  enough to trigger it. Verified against a recording: one match was stored as
  "273-203, team 1 won" while its own replay shows the game still being played
  at the final frame. Across the archive, 123 of 821 matches carried a result
  nobody observed, and those results had been counted into ELO.
- The agent now waits for the same confirmation the replay recorder has always
  used before accepting that a match is over, and takes the score from the
  frame that carries the ending rather than the last one before it. A match it
  did not see end keeps its last known score, states that the result is unknown,
  is left out of match lists, and is not rated. Its statistics are unaffected -
  the scoreboard really was observed; only the outcome was not.
- Ticket counts now have their own sanity bound. They were sharing one tuned for
  player counters, which let an implausible reading through as a final score.

## [1.2.0] - 2026-08-08

Required on any server without an OWI license - which is most clan servers.
Before this, such a server recorded nothing at all while the agent reported
itself perfectly healthy.

### Added
- Matches on unlicensed servers are now recorded. A server with no license key
  never opens a session with Squad's backend, so the game leaves its match id
  empty for the whole match. The agent read that correctly and, having no id to
  file anything under, wrote no replay and no stats - silently, because a match
  with no id is indistinguishable from no match at all. It now derives a stable
  id for those servers instead. Licensed servers are unaffected: an id supplied
  by the game is always used as-is.
- A line on startup naming the derived id the first time one is used, so an
  operator can tell at a glance which mode their server is in.

### Notes
- The derived id is anchored on the community central assigned at enrollment,
  so two unlicensed servers can never produce the same one.
- A match that spans an agent restart keeps its id and stays one match.
- Squad restarting mid-match starts a new one, which is the same behaviour a
  licensed server has.

## [1.1.9] - 2026-08-08

Required on any machine running more than one Squad server: before this, a
second agent could not be told which game to read.

### Fixed
- An agent on a box with several Squad servers picked one by process name,
  which is the same for all of them, so which game it read came down to start
  order - and a second agent installed alongside the first read the same game.
  A `squad_port` setting now names Squad's `-Port=` and the agent resolves its
  target from that. The installer refuses to guess when more than one server is
  running, and names every path and unit after the instance so installs add up
  instead of overwriting each other.
- Under LinuxGSM the agent could crash-loop on startup. The launcher script and
  the game binary report the same 15-byte process name and the same `-Port=`,
  so the agent attached to the shell, found no game mapped, exited, and was
  restarted into the same wall.

## [1.1.8] - 2026-08-08

Recommended for every operator: restarting the agent during a live match
corrupted that match in the archive.

### Fixed
- Restarting the agent mid-match published the match early. It was written to
  central with only the duration that had elapsed - showing up as a very short
  "draw" - and the partially written recording the reader had just closed was
  accepted as that match's replay, so the archive offered "Watch" on a game
  that was still being played. The match is now left open and published once,
  when it actually ends, with its true duration.

## [1.1.7] - 2026-07-25

Recommended for every operator: the first fix below caused finished matches to
go completely unrecorded, with no error anywhere.

### Fixed
- Matches could be played, finished, and never written to disk. The recorder
  required strictly consecutive frame ids and discarded the buffer it builds
  while waiting to open a recording whenever one was missing — but two-tier
  recording produces full frames in a separate process and the reader keeps
  only the newest, dropping the rest by design. Under load those gaps reset the
  buffer faster than it could fill, so the recording never opened at all.
- A failed build-worker spawn no longer takes the agent down, and repeated
  spawn failures back off instead of forking in a tight loop.
- Upgrades now restart the service. `systemctl enable --now` is a no-op on a
  running unit, so an upgrade previously left the OLD binary running while
  reporting success.
- The installer can be re-run with no token to upgrade an enrolled server, and
  authenticates that download with the agent's own credentials.
- Recording retention stops deleting when its free-space target cannot be met
  by pruning recordings at all, and always keeps the newest few (`--min-keep`,
  default 3). It could previously empty the archive chasing space that
  something else on the disk was using.

### Added
- Logging is configured, so the recorder's decisions reach the journal
  (`SQREADER_LOG_LEVEL` to change the level). Nothing configured it before, so
  every explanation the recorder produced was discarded unread.
- A watchdog warns when a match stays in progress with no recording open.
- `retention`, `version`, `selftest` and `download-auth` subcommands.
- One-command install via `install.sh`, and a compiled single-file build.

## [1.0.0]

First public release.

### Added
- Read-only Squad game-state reader from `/proc/<pid>/mem`: players, vehicles,
  capture zones, deployables, projectiles, markers, squads, lanes.
- Match recording and replay in the `.sqrx` format.
- Per-player stats and ELO in SQLite, with a stats API and web dashboard.
- Static SquadCalc capture-zone geometry layer (shape + position).
- Anti-cheat detectors — all memory-verified, no-guess.
- `sqreader doctor` to re-verify every memory offset against the live binary.
- Machine-specific settings extracted to `sqreader.config.json`
  (`sqreader.config.example.json` template); zero-config on standard boxes.
