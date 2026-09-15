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

The stubs deserve a word. `sleep` used to be stubbed to exit non-zero so
`set -e` ended the pruner's `while` loop after one pass — but the entrypoint
now has `|| true` on that same call (minor 5: a failing real `sleep` must not
kill the pruner for the container's lifetime), which neutralises that trick.
So the stub logs its call and then really blocks (`exec`s the real `sleep`
binary) instead, which holds the loop at one pass for the test's lifetime.

That blocking is a pause, NOT an exit, so nothing ends the loop on its own —
and nothing waits on it either: the pruner is `( while :; do ...; done ) &`
inside a script that then `exec`s away, so the subshell reparents to init and
runs forever. An earlier version of this file relied on it "self-reaping" and
leaked one permanently-running `sh entrypoint.sh` per pruner-enabled run; 641
had piled up on one developer machine before anyone noticed. The leash is a
process group: the entrypoint is started with `start_new_session=True`, and
`_reap_group` SIGKILLs that whole group — and waits for it to actually die —
before `run_entrypoint` returns. pytest is never in that group, so it cannot
kill itself.

Output goes to a FILE, never a pipe: the pruner is a background subshell
holding the parent's stdout, and a pipe would not close until it exits.

Nothing here asserts an ordering between the `retention` and `serve` calls.
The pruner is backgrounded and `serve` is `exec`ed, so which one reaches the
log first is genuinely undefined — a dry run showed `serve` winning.
"""
from __future__ import annotations

import contextlib
import json
import os
import shutil
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
ENTRYPOINT = REPO / "docker" / "entrypoint.sh"

_SQREADER_STUB = """#!/bin/sh
printf 'sqreader %s\\n' "$*" >> "$STUB_LOG"
printf 'env SQREADER_DATA_DIR=%s\\n' "${SQREADER_DATA_DIR:-unset}" >> "$STUB_LOG"
"""

# The real `sleep`, resolved against the unmodified PATH before run_entrypoint
# ever prepends a stub bindir in front of it — `exec`ing it below is how the
# stub blocks the pruner's `while` loop on its second iteration without
# needing the loop's own `sleep` call to fail (see the module docstring).
_REAL_SLEEP = shutil.which("sleep") or "/bin/sleep"

_SLEEP_STUB = f"""#!/bin/sh
printf 'sleep %s\\n' "$*" >> "$STUB_LOG"
exec {_REAL_SLEEP} 10
"""

# How long to wait for the pruner's backgrounded subshell to catch up with the
# `sh` process we already reaped — see EntrypointRun.
_PRUNER_DEADLINE_SEC = 5.0

# How long to wait for the killed process group to actually disappear.
_REAP_DEADLINE_SEC = 5.0


def _reap_group(pgid: int) -> None:
    """SIGKILL the entrypoint's process group and wait for it to really go.

    Without this the pruner outlives the test forever (see the module
    docstring). Waiting rather than fire-and-forgetting is what makes
    `test_the_pruner_does_not_outlive_its_test` deterministic — SIGKILL is
    asynchronous, and a zombie still counts as a group member until init
    reaps it.
    """
    with contextlib.suppress(ProcessLookupError):
        os.killpg(pgid, signal.SIGKILL)
    deadline = time.monotonic() + _REAP_DEADLINE_SEC
    while time.monotonic() < deadline:
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.01)
    raise AssertionError(f"entrypoint process group {pgid} survived SIGKILL")


@dataclass
class EntrypointRun:
    """What one `run_entrypoint()` call produced."""

    calls: list[str]
    returncode: int
    output: str
    pgid: int


def run_entrypoint(tmp_path: Path, **env: str) -> EntrypointRun:
    """Run the entrypoint with stubbed `sqreader`/`sleep`; return what happened."""
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    for name, body in (("sqreader", _SQREADER_STUB), ("sleep", _SLEEP_STUB)):
        p = bindir / name
        p.write_text(body, encoding="utf-8")
        p.chmod(0o755)

    # Truncate: several tests call this twice with the same tmp_path, and a log
    # that accumulated across runs would show two `serve` calls for one run.
    log = tmp_path / "calls.log"
    log.write_text("", encoding="utf-8")
    stdout = tmp_path / "stdout.txt"
    environ = dict(os.environ)
    environ.update({
        "PATH": f"{bindir}:{environ['PATH']}",
        "STUB_LOG": str(log),
        "SQREADER_STATE_DIR": str(tmp_path / "data"),
    })
    environ.update(env)

    # A FILE, not a pipe — see the module docstring.
    #
    # start_new_session puts the script and everything it forks into a fresh
    # process group whose id is the child's pid, so the backgrounded pruner can
    # be killed as a unit afterwards. pytest stays in its own group.
    with stdout.open("w", encoding="utf-8") as fh:
        proc = subprocess.Popen(["sh", str(ENTRYPOINT)], env=environ,
                                stdout=fh, stderr=subprocess.STDOUT,
                                start_new_session=True)
        pgid = proc.pid
        try:
            returncode = proc.wait(timeout=30)
        except subprocess.TimeoutExpired:
            _reap_group(pgid)
            raise

    # subprocess.run() only waits on the direct `sh` child, which `exec`s into
    # the serve stub and returns immediately — the pruner's backgrounded
    # subshell can still be forking `retention` and `sleep` after that. Under
    # load the final reviewer measured the `retention` line missing in 44/150
    # runs without this wait. Skip it when nothing will ever background (the
    # script errored out before reaching the pruner, or pruning is off).
    interval = environ.get("RETENTION_INTERVAL", "86400")
    try:
        if returncode == 0 and interval != "0":
            deadline = time.monotonic() + _PRUNER_DEADLINE_SEC
            while time.monotonic() < deadline:
                if any(line.startswith("sleep ")
                       for line in log.read_text(encoding="utf-8").splitlines()):
                    break
                time.sleep(0.05)
    finally:
        # In a finally: a failed poll must still not leave the pruner running.
        _reap_group(pgid)

    return EntrypointRun(
        calls=log.read_text(encoding="utf-8").splitlines(),
        returncode=returncode,
        output=stdout.read_text(encoding="utf-8"),
        pgid=pgid,
    )


def serve_call(calls: list[str]) -> str:
    matches = [c for c in calls if c.startswith("sqreader serve")]
    assert len(matches) == 1, f"expected exactly one serve call, got {calls}"
    return matches[0]


def retention_calls(calls: list[str]) -> list[str]:
    return [c for c in calls if c.startswith("sqreader retention")]


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
    assert "--squad-log /squad/SquadGame/Saved/Logs/SquadGame.log" in call
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

_WARNING_TEXT = "is not readable"


def test_a_readable_squad_log_gets_no_warning(tmp_path):
    log = tmp_path / "SquadGame.log"
    log.write_text("", encoding="utf-8")
    result = run_entrypoint(tmp_path, SQREADER_SQUAD_LOG=str(log))
    assert _WARNING_TEXT not in result.output


def test_a_missing_squad_log_warns_instead_of_failing_silently(tmp_path):
    """LogTailer.start() succeeds regardless — the open() happens in its own
    thread — so cmd_serve prints the reassuring 'kill-feed from log -> …' and
    then retries forever with nothing in the log. The entrypoint has to say
    so up front."""
    missing = tmp_path / "does-not-exist" / "SquadGame.log"
    result = run_entrypoint(tmp_path, SQREADER_SQUAD_LOG=str(missing))
    assert _WARNING_TEXT in result.output
    assert str(missing) in result.output
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
    alarm in the log."""
    run_entrypoint(tmp_path)
    assert (tmp_path / "data" / "recordings").is_dir()
    assert (tmp_path / "data" / "stats").is_dir()


def test_the_pruner_does_not_outlive_its_test(tmp_path):
    """The regression that made this file leak processes onto the host.

    The pruner is a backgrounded `while :` loop and the script `exec`s away
    from it, so nothing on earth ends it: it reparents to init and runs until
    the machine does. That went unnoticed through four task reviews and a fix
    wave — 641 orphaned `sh entrypoint.sh` processes had accumulated before a
    reviewer counted them. Asserting the process group is gone is the only
    check that would have failed.
    """
    run = run_entrypoint(tmp_path)
    assert retention_calls(run.calls), "pruner never ran — this proves nothing"
    with pytest.raises(ProcessLookupError):
        os.killpg(run.pgid, 0)


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
    "attach": "SQUAD_PID_MODE=container:my-squad\nSQUAD_APPARMOR=docker-default\nSQUAD_DATA=/srv/squad\n",
    "host":   "SQUAD_PID_MODE=host\nSQUAD_APPARMOR=unconfined\nSQUAD_DATA=/srv/squad\n",
}

needs_docker = pytest.mark.skipif(
    shutil.which("docker") is None, reason="docker not installed")


def compose_config(tmp_path: Path, mode: str) -> dict:
    env_file = tmp_path / f"{mode}.env"
    env_file.write_text(MODES[mode], encoding="utf-8")
    proc = subprocess.run(
        ["docker", "compose", "--env-file", str(env_file),
         "-f", str(COMPOSE), "config", "--format", "json"],
        capture_output=True, text=True, timeout=120, cwd=REPO)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)


@needs_docker
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


@needs_docker
def test_host_mode_is_the_only_one_that_unconfines_apparmor(tmp_path):
    for mode, want in (("attach", "apparmor=docker-default"),
                       ("host", "apparmor=unconfined")):
        opts = compose_config(tmp_path, mode)["services"]["sqreader"]["security_opt"]
        assert opts == [want], f"{mode}: {opts}"


@needs_docker
@pytest.mark.parametrize("mode", list(MODES))
def test_every_mode_grants_both_capabilities_and_no_others(tmp_path, mode):
    """SYS_PTRACE alone opens /proc/<pid>/maps but not /proc/<pid>/mem."""
    svc = compose_config(tmp_path, mode)["services"]["sqreader"]
    assert svc["cap_drop"] == ["ALL"]
    assert sorted(svc["cap_add"]) == ["DAC_READ_SEARCH", "SYS_PTRACE"]


@needs_docker
@pytest.mark.parametrize("mode", list(MODES))
def test_every_mode_mounts_squad_read_only_with_a_graceful_stop(tmp_path, mode):
    """The reader never writes to /squad, and needs room to write the .sqrx
    footer on SIGTERM instead of being SIGKILLed mid-write (cli.py:1285ff)."""
    svc = compose_config(tmp_path, mode)["services"]["sqreader"]
    squad_mount = next(v for v in svc["volumes"] if v["target"] == "/squad")
    assert squad_mount["read_only"] is True
    assert svc["stop_grace_period"] == "30s"


@needs_docker
def test_the_replay_ui_is_not_published_to_the_world_by_default(tmp_path):
    port = compose_config(tmp_path, "attach")["services"]["sqreader"]["ports"][0]
    assert port["host_ip"] == "127.0.0.1"


@needs_docker
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


@needs_docker
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
