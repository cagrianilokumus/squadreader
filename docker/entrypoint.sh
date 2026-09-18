#!/bin/sh
#
# Two things run in this container: the reader, and a logrotate-style pruner
# for the recordings it writes. The pruner is a background loop rather than a
# second container because a full disk takes the GAME down, not just us — the
# valve belongs next to the thing that opens it.
set -eu

# Where docker-compose.yml mounts the sqreader-data volume. Not overridable:
# an operator who wants the recordings somewhere else moves the HOST side of
# that mount, which is the only side they can move without editing the image.
# (Not SQREADER_DATA_DIR — metadata.py already owns that name for the
# static-metadata directory; see the export just below.)
DATA_DIR=/data

# `serve` creates these itself (cli.py:642, stats.py:592), but the pruner runs
# first and `cmd_retention` returns 1 on a missing directory — so on a fresh
# volume the very first log line would be a spurious "recordings dir not found".
mkdir -p "$DATA_DIR/recordings" "$DATA_DIR/stats"

# The package is pip-installed, so metadata.py's source-relative guess lands
# in site-packages, where data/static does not exist — every map, capture
# zone and vehicle-faction table would load empty, silently. COPY put the
# real one at /app/data/static; point the reader at it.
#
# Exported HERE, above everything that forks or execs, so the pruner subshell
# and a one-shot subcommand both inherit it.
export SQREADER_DATA_DIR=/app/data/static

# One-shot subcommand: `docker compose run sqreader doctor`, `... retention
# --dry-run`, `... enroll <token>`. Handled before anything else starts,
# because a maintenance command has no business forking the pruner — and
# because the `set --` further down would otherwise DISCARD these arguments
# and silently bring up a second `serve` writing into the same $DATA_DIR as
# the container already running.
if [ "$#" -gt 0 ]; then
  exec sqreader "$@"
fi

# An operator typo here would otherwise make `-gt` fail under `set -e` and kill
# the container at boot with nothing but a shell error to go on.
RETENTION_INTERVAL="${RETENTION_INTERVAL:-86400}"
case "$RETENTION_INTERVAL" in
  ''|*[!0-9]*)
    echo "entrypoint: RETENTION_INTERVAL must be a whole number of seconds" \
         "(got '$RETENTION_INTERVAL'); use 0 to disable pruning" >&2
    exit 1 ;;
esac

# Prune immediately, then on the interval: a container restarting onto an
# already-full disk must not wait a day for the safety valve. Repeat passes are
# harmless — the policies are idempotent and cmd_retention never touches a file
# younger than --in-progress-min.
if [ "$RETENTION_INTERVAL" -gt 0 ]; then
  (
    while :; do
      sqreader retention \
        --recordings-dir "$DATA_DIR/recordings" \
        --max-age-days   "${RETENTION_MAX_AGE_DAYS:-90}" \
        --max-total-gb   "${RETENTION_MAX_TOTAL_GB:-150}" \
        --min-free-gb    "${RETENTION_MIN_FREE_GB:-50}" \
        --min-keep       "${RETENTION_MIN_KEEP:-3}" || true
      sleep "$RETENTION_INTERVAL" || true
    done
  ) &
fi

# Optional two-tier recording, assembled positionally rather than with
# `${RECORD_HZ:+--record-hz "$RECORD_HZ"}` — that expansion's quoting behaviour
# is subtle enough to be a liability in a file nobody reads twice.
#
# Safe to clear the positional params here: a `docker compose run` argument
# was already exec'd as a one-shot subcommand above, so anything still in $@
# at this point is nothing we were asked to forward.
set --
if [ -n "${RECORD_HZ:-}" ]; then
  set -- --record-hz "$RECORD_HZ"
fi

# Inside the container the install root is always /squad — the compose file
# binds SQUAD_DATA there. Same as $DATA_DIR above: the host side of the mount
# is the knob, not this path.
SQUAD_LOG=/squad/SquadGame/Saved/Logs/SquadGame.log
if [ ! -r "$SQUAD_LOG" ]; then
  echo "entrypoint: WARNING: $SQUAD_LOG is not readable — the kill feed will be" \
       "INCOMPLETE. SQUAD_DATA must be the install root that CONTAINS SquadGame/." \
       "(Expected while your server is still installing or updating.)" >&2
fi

# `exec`, so the reader is PID 1 and gets Docker's SIGTERM directly: it installs
# a handler (cli.py:1022) and its `finally` writes the .sqrx footer for an
# in-flight recording (cli.py:1285ff). Behind a shell it would be SIGKILLed.
#
# No --pid on purpose. _open_pipeline_or_wait (cli.py:174) re-resolves the game
# on every retry and stays alive when it is absent, so the reader can be brought
# up before the game server is, and a game restart needs no wrapper.
#
# --squad-log is always passed (rather than left for find_squad_log(pid) to
# derive) because that derivation reads the GAME's mount namespace, which is
# wrong here; see the readability check above for the warning this forgoes.
exec sqreader serve \
  --host 0.0.0.0 --port 8080 \
  --hz "${SQREADER_HZ:-0.5}" \
  --server-id "${SERVER_ID:-squad}" \
  --recordings-dir "$DATA_DIR/recordings" \
  --stats-db "$DATA_DIR/stats/player_stats.db" \
  --icons-dir /app/icons \
  --sqmaps-dir /app/sqmaps \
  --frontend-dir /app/frontend/dist \
  --squad-log "$SQUAD_LOG" \
  "$@"
