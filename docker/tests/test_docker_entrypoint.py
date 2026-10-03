"""What the container actually runs.

The reader itself is unchanged by the Docker work; this file is the whole of
the new logic. It pins the things that are quiet when they break: that the
reader is started WITHOUT --pid (so it re-resolves the game on every retry
instead of freezing a stale one), that the retention pruner can be switched
off and configured rather than being a hardcoded policy, that an operator
typo in an interval produces a sentence instead of a shell error, that
metadata.py's static-data directory is exported before exec (a pip install
leaves data/static out of site-packages, and a miss there loads every map/
capzone/vehicle-faction table empty with nothing in the log to explain it),
and that a missing kill-feed log warns instead of retrying forever in silence.

The script runs IN A CONTAINER. The two paths it needs — /data and /squad —
exist in exactly one place, and carrying an override in the production script
so that a test could point them somewhere else was the wrong trade: the
override read as operator configuration, was documented nowhere, and served
nothing but this file. `docker run` bind-mounts a tmp_path onto each path
instead, and hands the script a clean environment for free — so nothing a
developer happens to have exported can quietly change what these tests assert.

`returncode` is the script's exit status, and reaching `exec sqreader serve`
counts as 0: in production that exec is the container's steady state, not an
exit.

The stubs deserve a word. `sleep` logs its call and then really blocks
(`exec`s /bin/sleep), which holds the pruner's `while` loop at one pass for
the test's lifetime; the entrypoint's `|| true` on that same call (minor 5: a
failing real `sleep` must not kill the pruner for the container's lifetime)
rules out the older trick of having the stub exit non-zero. The `sqreader`
stub blocks the same way in the `serve` case, for a sharper reason: serve is
PID 1, and were it to return, Docker would tear down the pid namespace with
the backgrounded pruner still inside it — before it had logged a single pass.

So nothing ends on its own, and nothing needs to: run_entrypoint waits for the
log to show steady state, then removes the container. An earlier host-side
version of this file had no such leash — the pruner reparented to init and ran
until the machine did, and 641 orphaned `sh entrypoint.sh` processes had piled
up on one developer machine before anyone counted them. The container is the
leash now: `--rm`, a `docker rm -f` in a `finally`, and a module teardown that
asserts no labelled container survived.

Output goes to a FILE, never a pipe. That is the docker client's stdout now,
and the pruner inside the container holds the far end of it exactly as it held
the script's, so a pipe still would not close until it exits.

Nothing here asserts an ordering between the `retention` and `serve` calls.
The pruner is backgrounded and `serve` is `exec`ed, so which one reaches the
log first is genuinely undefined — a dry run showed `serve` winning.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import pytest

# Not collected by a plain `pytest` — pyproject's testpaths is tests/, and this
# tree is not it. Run it deliberately, on a box with a daemon:
#     pytest docker/tests
REPO = Path(__file__).resolve().parents[2]
ENTRYPOINT = REPO / "docker" / "entrypoint.sh"

# The base the entrypoint will actually run under, read from the Dockerfile so
# the two cannot drift. Nothing is built: the script needs `sh` and `mkdir`,
# and the base already supplies the same /bin/sh (dash) the real image has.
IMAGE = next(line.split()[1] for line
             in (REPO / "docker" / "Dockerfile").read_text(encoding="utf-8").splitlines()
             if line.startswith("FROM "))

# On every container this file starts, so the teardown can prove none survived.
LABEL = "sqreader-entrypoint-test"

# What the entrypoint hardcodes — and therefore what the /squad mount has to
# hold for the kill-feed log to be found.
SQUAD_LOG = "/squad/SquadGame/Saved/Logs/SquadGame.log"

# How long a container gets to reach steady state, or to exit on its own.
_SETTLE_DEADLINE_SEC = 30.0

_SQREADER_STUB = """#!/bin/sh
printf 'sqreader %s\\n' "$*" >> "$STUB_LOG"
printf 'env SQREADER_DATA_DIR=%s\\n' "${SQREADER_DATA_DIR:-unset}" >> "$STUB_LOG"
# serve is PID 1 and never returns in production. If it returned here the
# container would die with the backgrounded pruner still inside it, before
# that subshell had run a single pass.
case "${1:-}" in serve) exec /bin/sleep 300 ;; esac
"""

_SLEEP_STUB = """#!/bin/sh
printf 'sleep %s\\n' "$*" >> "$STUB_LOG"
exec /bin/sleep 300
"""


@pytest.fixture(scope="module", autouse=True)
def _image():
    """Pull once, outside any single test's deadline; then prove nothing leaked.

    The leak assert is what survives of an earlier
    `test_the_pruner_does_not_outlive_its_test`: the container is the leash
    now, so the one way left to strand a pruner is for run_entrypoint's
    `finally` to stop firing. This catches exactly that, and nothing else.
    """
    if subprocess.run(["docker", "image", "inspect", IMAGE],
                      capture_output=True).returncode:
        subprocess.run(["docker", "pull", IMAGE], check=True, timeout=600)
    yield
    left = subprocess.run(["docker", "ps", "-aq", "--filter", f"label={LABEL}"],
                          capture_output=True, text=True).stdout.split()
    assert not left, f"leaked containers: {left}"


@dataclass
class EntrypointRun:
    """What one `run_entrypoint()` call produced."""

    calls: list[str]
    returncode: int
    output: str


def run_entrypoint(tmp_path: Path, *args: str, **env: str) -> EntrypointRun:
    """Run the entrypoint in a container; return what happened.

    Positional `args` are what `docker compose run sqreader <args>` passes.
    Keyword `env` is the container's entire environment beyond PATH and
    STUB_LOG — nothing is inherited from the developer's shell.
    """
    bindir, data, squad = tmp_path / "bin", tmp_path / "data", tmp_path / "squad"
    for d in (bindir, data, squad):
        d.mkdir(exist_ok=True)
    for name, body in (("sqreader", _SQREADER_STUB), ("sleep", _SLEEP_STUB)):
        p = bindir / name
        p.write_text(body, encoding="utf-8")
        p.chmod(0o755)

    # Truncate: several tests call this twice with the same tmp_path, and a log
    # that accumulated across runs would show two `serve` calls for one run.
    log = data / "calls.log"
    log.write_text("", encoding="utf-8")
    stdout = tmp_path / "stdout.txt"

    container = f"sqreader-test-{uuid.uuid4().hex[:12]}"
    argv = ["docker", "run", "--rm", "--name", container, "--label", LABEL,
            # Nothing in here talks to anything — a stubbed sqreader least of all.
            "--network", "none",
            # So the directories the script creates under /data belong to the
            # invoking user and pytest can still clean up its own tmp_path.
            #
            # ponytail: assumes rootful Docker, which is what CI and this
            # repo's dev boxes run. Under rootless Docker drop --user — there
            # the container's root already maps to the invoking user.
            "--user", f"{os.getuid()}:{os.getgid()}",
            "-v", f"{ENTRYPOINT}:/entrypoint.sh:ro",
            "-v", f"{bindir}:/stub:ro",
            "-v", f"{data}:/data",
            "-v", f"{squad}:/squad:ro",
            "-e", "PATH=/stub:/usr/local/bin:/usr/bin:/bin",
            "-e", "STUB_LOG=/data/calls.log"]
    for key, value in env.items():
        argv += ["-e", f"{key}={value}"]
    argv += [IMAGE, "sh", "/entrypoint.sh", *args]

    # A FILE, not a pipe — see the module docstring.
    with stdout.open("w", encoding="utf-8") as fh:
        proc = subprocess.Popen(argv, stdout=fh, stderr=subprocess.STDOUT)
        try:
            returncode = _settle(proc, log, env)
        finally:
            # In a finally: a failed settle must still not leave a container —
            # and with it a pruner — running.
            subprocess.run(["docker", "rm", "-f", container],
                           capture_output=True, timeout=30)
            proc.wait(timeout=30)

    return EntrypointRun(
        calls=log.read_text(encoding="utf-8").splitlines(),
        returncode=returncode,
        output=stdout.read_text(encoding="utf-8"),
    )


def _settle(proc: subprocess.Popen, log: Path, env: dict[str, str]) -> int:
    """The script's exit code if it ended, or 0 once it reached steady state.

    Steady state is `serve` up and — when pruning is on — the pruner's first
    pass done. Waiting for that rather than for the container to exit is what
    keeps the `retention` line from being a race: the pruner is a backgrounded
    subshell and Docker kills it the instant PID 1 goes. An earlier host-side
    version without this wait lost the line in 44 of 150 runs under load.
    """
    pruning = env.get("RETENTION_INTERVAL", "86400") != "0"
    deadline = time.monotonic() + _SETTLE_DEADLINE_SEC
    while time.monotonic() < deadline:
        returncode = proc.poll()
        if returncode is not None:
            return returncode       # a one-shot subcommand, or the set -e path
        calls = log.read_text(encoding="utf-8").splitlines()
        if (any(c.startswith("sqreader serve") for c in calls)
                and (not pruning or any(c.startswith("sleep ") for c in calls))):
            return 0
        time.sleep(0.05)
    raise AssertionError(
        f"entrypoint never settled in {_SETTLE_DEADLINE_SEC}s; "
        f"log: {log.read_text(encoding='utf-8')!r}")


def serve_call(calls: list[str]) -> str:
    matches = [c for c in calls if c.startswith("sqreader serve")]
    assert len(matches) == 1, f"expected exactly one serve call, got {calls}"
    return matches[0]


def retention_calls(calls: list[str]) -> list[str]:
    return [c for c in calls if c.startswith("sqreader retention")]


# --- one-shot subcommands --------------------------------------------------

def test_an_argument_runs_that_subcommand_instead_of_a_second_serve(tmp_path):
    """`docker compose run sqreader doctor` has to run doctor. The entrypoint
    clears its positional params before assembling the serve line, so an
    argument that is not consumed FIRST is discarded in silence — and the
    container then starts a second `serve` writing into the same /data as the
    one already running, which is a corrupted .sqrx, not an error message."""
    run = run_entrypoint(tmp_path, "doctor")
    assert "sqreader doctor" in run.calls
    assert not [c for c in run.calls if c.startswith("sqreader serve")], \
        "a maintenance command must not also bring up the reader"


def test_a_one_shot_subcommand_keeps_its_own_flags(tmp_path):
    run = run_entrypoint(tmp_path, "retention", "--dry-run")
    assert "sqreader retention --dry-run" in run.calls


def test_a_one_shot_subcommand_does_not_fork_the_pruner(tmp_path):
    """Pruning is the long-running container's job. A `docker compose run`
    that deletes recordings as a side effect of asking a question would be a
    genuine surprise."""
    run = run_entrypoint(tmp_path, "doctor", RETENTION_INTERVAL="86400")
    assert retention_calls(run.calls) == []


def test_a_one_shot_subcommand_still_gets_the_static_metadata_dir(tmp_path):
    """Exported above the exec, not just above the serve line — `doctor` reads
    the same map/capzone tables `serve` does."""
    assert "env SQREADER_DATA_DIR=/app/data/static" in \
        run_entrypoint(tmp_path, "doctor").calls


# --- the reader ------------------------------------------------------------

def test_the_reader_is_started_without_a_pid(tmp_path):
    """--pid would freeze whichever process existed at boot. Leaving it off is
    what lets _open_pipeline_or_wait sit through the game server's own startup or
    update and survive a game restart, so this is the assertion that matters most."""
    call = serve_call(run_entrypoint(tmp_path).calls)
    assert "--pid" not in call


def test_the_reader_binds_all_interfaces_inside_the_container(tmp_path):
    """It has to: a published port cannot reach a 127.0.0.1 bind. The host-side
    narrowing is the compose file's job, not this one's."""
    call = serve_call(run_entrypoint(tmp_path).calls)
    assert "--host 0.0.0.0 --port 8080" in call


def test_the_reader_is_pointed_at_the_mounted_log_and_assets(tmp_path):
    call = serve_call(run_entrypoint(tmp_path).calls)
    assert f"--squad-log {SQUAD_LOG}" in call
    assert "--icons-dir /app/icons" in call
    assert "--sqmaps-dir /app/sqmaps" in call
    assert "--frontend-dir /app/frontend/dist" in call


def test_the_entrypoint_exports_the_static_metadata_dir_before_exec(tmp_path):
    """metadata.py already owns SQREADER_DATA_DIR for the directory it loads
    map bounds, capzones and vehicle factions from. A pip install leaves
    data/static out of site-packages, so `_default_data_dir()` falls through
    to a site-packages path that does not exist and every one of those tables
    loads empty — silently. This survived three task reviews; it deserves a
    test. Retention is off so the one sqreader invocation is unambiguously
    `serve`, the process that actually reads this variable."""
    calls = run_entrypoint(tmp_path, RETENTION_INTERVAL="0").calls
    assert "env SQREADER_DATA_DIR=/app/data/static" in calls


def test_the_tick_rate_follows_the_production_unit_not_argparse(tmp_path):
    """deploy/sqreader-prod.service runs 0.5 Hz; argparse defaults to 3.0."""
    assert "--hz 0.5" in serve_call(run_entrypoint(tmp_path).calls)
    assert "--hz 2" in serve_call(run_entrypoint(tmp_path, SQREADER_HZ="2").calls)


def test_two_tier_recording_is_off_unless_asked_for(tmp_path):
    assert "--record-hz" not in serve_call(run_entrypoint(tmp_path).calls)
    assert "--record-hz 4" in serve_call(run_entrypoint(tmp_path, RECORD_HZ="4").calls)


def test_the_server_id_is_settable(tmp_path):
    assert "--server-id squad" in serve_call(run_entrypoint(tmp_path).calls)
    assert "--server-id eu-1" in serve_call(run_entrypoint(tmp_path, SERVER_ID="eu-1").calls)


# --- the squad-log readability warning (I2) ---------------------------------
#
# find_squad_log(pid) is never used — cmd_serve prefers the explicit
# --squad-log the entrypoint always passes, and that derivation would read the
# GAME's mount namespace anyway, which is wrong here. So the entrypoint has to
# warn for itself when the mount is missing/wrong, or the warning cli.py:581
# would otherwise print is simply unreachable inside the container.
#
# These two are the reason the whole file moved into a container: the path is
# hardcoded, so the only way to hand the script a log that is there — or one
# that is not — is to own what /squad contains.

_WARNING_TEXT = "is not readable"


def test_a_readable_squad_log_gets_no_warning(tmp_path):
    log = tmp_path / "squad" / "SquadGame" / "Saved" / "Logs" / "SquadGame.log"
    log.parent.mkdir(parents=True)
    log.write_text("", encoding="utf-8")        # lands under the /squad mount
    assert _WARNING_TEXT not in run_entrypoint(tmp_path).output


def test_a_missing_squad_log_warns_instead_of_failing_silently(tmp_path):
    """LogTailer.start() succeeds regardless — the open() happens in its own
    thread — so cmd_serve prints the reassuring 'kill-feed from log -> …' and
    then retries forever with nothing in the log. The entrypoint has to say
    so up front."""
    result = run_entrypoint(tmp_path)           # /squad is mounted, and empty
    assert _WARNING_TEXT in result.output
    assert SQUAD_LOG in result.output
    assert result.returncode == 0          # a warning, not a failure


# --- the pruner ------------------------------------------------------------

def test_the_pruner_runs_once_with_the_units_policy(tmp_path):
    """Defaults are deploy/sqreader-retention.service, verbatim."""
    calls = retention_calls(run_entrypoint(tmp_path).calls)
    assert len(calls) == 1
    assert "--max-age-days 90" in calls[0]
    assert "--max-total-gb 150" in calls[0]
    assert "--min-free-gb 50" in calls[0]
    assert "--min-keep 3" in calls[0]


def test_the_pruner_can_be_switched_off_entirely(tmp_path):
    calls = run_entrypoint(tmp_path, RETENTION_INTERVAL="0").calls
    assert retention_calls(calls) == []
    assert serve_call(calls)          # the reader still starts


def test_each_policy_can_be_disabled_on_its_own(tmp_path):
    """cmd_retention guards every policy on truthiness, so 0 is a real off
    switch — the loop can be neutered without being removed."""
    calls = retention_calls(run_entrypoint(
        tmp_path, RETENTION_MAX_AGE_DAYS="0", RETENTION_MAX_TOTAL_GB="0",
        RETENTION_MIN_FREE_GB="0").calls)
    assert "--max-age-days 0" in calls[0]
    assert "--max-total-gb 0" in calls[0]
    assert "--min-free-gb 0" in calls[0]


def test_the_pruner_sleeps_for_the_configured_interval(tmp_path):
    calls = run_entrypoint(tmp_path, RETENTION_INTERVAL="900").calls
    assert "sleep 900" in calls


def test_the_data_directories_exist_before_the_pruner_looks(tmp_path):
    """serve creates them itself, but the pruner runs first and cmd_retention
    returns 1 on a missing directory — a fresh volume would open with a false
    alarm in the log.

    Doubles as the proof that /data really is the bind mount: the script only
    ever names /data, so these directories can only appear here if the mount
    is wired the way every other test in this file assumes."""
    run_entrypoint(tmp_path)
    assert (tmp_path / "data" / "recordings").is_dir()
    assert (tmp_path / "data" / "stats").is_dir()


def test_a_mistyped_interval_is_a_sentence_not_a_shell_error(tmp_path):
    """`[ -gt ]` on a non-number fails under `set -eu` and kills the container
    at boot with nothing an operator can act on."""
    result = run_entrypoint(tmp_path, RETENTION_INTERVAL="abends")
    assert result.returncode == 1
    assert "RETENTION_INTERVAL" in result.output
    assert "abends" in result.output


# --- shell hygiene ---------------------------------------------------------

@pytest.mark.skipif(shutil.which("dash") is None, reason="dash not installed")
def test_the_entrypoint_is_portable_posix_shell(tmp_path):
    """The image has no bash guarantee, and the shebang says /bin/sh."""
    assert subprocess.run(["dash", "-n", str(ENTRYPOINT)]).returncode == 0


# --- the compose modes -----------------------------------------------------
#
# Host mode broke while this was being designed, because AppArmor refuses a peer
# it does not confine. And the whole file defines the READER ONLY: the game
# server is the operator's, running outside this repo, so `docker compose up`
# must never bring a second one into existence. Those are the regressions worth
# pinning.
#
# `json` is imported at the TOP of this file, with the others — ruff selects the
# full `E` set, so a mid-file import here would trip E402.

COMPOSE = REPO / "docker-compose.yml"

MODES = {
    "attach": ("SQUAD_PID_MODE=container:my-squad\n"
               "SQUAD_APPARMOR=docker-default\nSQUAD_DATA=/srv/squad\n"),
    "host":   "SQUAD_PID_MODE=host\nSQUAD_APPARMOR=unconfined\nSQUAD_DATA=/srv/squad\n",
}


def compose_config(tmp_path: Path, mode: str) -> dict:
    env_file = tmp_path / f"{mode}.env"
    env_file.write_text(MODES[mode], encoding="utf-8")
    proc = subprocess.run(
        ["docker", "compose", "--env-file", str(env_file),
         "-f", str(COMPOSE), "config", "--format", "json"],
        capture_output=True, text=True, timeout=120, cwd=REPO)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


@pytest.mark.parametrize("mode,pid", [
    ("attach", "container:my-squad"),
    ("host", "host"),
])
def test_no_mode_ever_defines_a_game_service(tmp_path, mode, pid):
    """This stack reads a Squad server; it never runs one. Starting a second
    game server for someone who already has one — colliding on 7787/27165/21114
    and pulling ~27 GB through SteamCMD — would be a very expensive surprise."""
    cfg = compose_config(tmp_path, mode)
    assert list(cfg["services"]) == ["sqreader"]
    assert cfg["services"]["sqreader"]["pid"] == pid


def test_host_mode_is_the_only_one_that_unconfines_apparmor(tmp_path):
    for mode, want in (("attach", "apparmor=docker-default"),
                       ("host", "apparmor=unconfined")):
        opts = compose_config(tmp_path, mode)["services"]["sqreader"]["security_opt"]
        assert opts == [want], f"{mode}: {opts}"


@pytest.mark.parametrize("mode", list(MODES))
def test_every_mode_grants_both_capabilities_and_no_others(tmp_path, mode):
    """SYS_PTRACE alone opens /proc/<pid>/maps but not /proc/<pid>/mem."""
    svc = compose_config(tmp_path, mode)["services"]["sqreader"]
    assert svc["cap_drop"] == ["ALL"]
    assert sorted(svc["cap_add"]) == ["DAC_READ_SEARCH", "SYS_PTRACE"]


@pytest.mark.parametrize("mode", list(MODES))
def test_every_mode_mounts_squad_read_only_with_a_graceful_stop(tmp_path, mode):
    """The reader never writes to /squad, and needs room to write the .sqrx
    footer on SIGTERM instead of being SIGKILLed mid-write (cli.py:1285ff)."""
    svc = compose_config(tmp_path, mode)["services"]["sqreader"]
    squad_mount = next(v for v in svc["volumes"] if v["target"] == "/squad")
    assert squad_mount["read_only"] is True
    assert svc["stop_grace_period"] == "30s"


def test_the_replay_ui_is_not_published_to_the_world_by_default(tmp_path):
    port = compose_config(tmp_path, "attach")["services"]["sqreader"]["ports"][0]
    assert port["host_ip"] == "127.0.0.1"


def test_a_missing_env_file_names_both_things_it_cannot_guess(tmp_path):
    """The fresh-clone case. Neither the game process nor its install directory
    exists inside this stack, so neither can carry a default — say which is
    missing instead of attaching to whatever happens to be there."""
    empty = tmp_path / "empty.env"
    empty.write_text("", encoding="utf-8")
    proc = subprocess.run(
        ["docker", "compose", "--env-file", str(empty), "-f", str(COMPOSE), "config"],
        capture_output=True, text=True, timeout=120, cwd=REPO)
    assert proc.returncode != 0
    assert "SQUAD_PID_MODE" in proc.stderr
    assert "SQUAD_DATA" in proc.stderr
    assert "cp .env.example .env" in proc.stderr


def test_a_mode_without_an_install_path_is_refused_before_anything_starts(tmp_path):
    """Defaulting SQUAD_DATA would mount an empty directory: the reader would
    start, look healthy, and undercount kills for the rest of the match."""
    bad = tmp_path / "bad.env"
    bad.write_text("SQUAD_PID_MODE=host\n", encoding="utf-8")
    proc = subprocess.run(
        ["docker", "compose", "--env-file", str(bad), "-f", str(COMPOSE), "config"],
        capture_output=True, text=True, timeout=120, cwd=REPO)
    assert proc.returncode != 0
    assert "SQUAD_DATA" in proc.stderr
    assert "contains SquadGame/" in proc.stderr
