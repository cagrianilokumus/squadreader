# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/).

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
