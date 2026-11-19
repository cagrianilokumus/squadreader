"""``sqreader diagnose``: can this machine run the reader, and if not, why not.

Built for the case where whoever can run commands on the game server is not
whoever can read the answer: a hosting provider's technician runs ONE command
and sends back ONE file. So it:

* never raises and never stops at the first problem. Every check runs and
  reports OK / WARN / FAIL with its reason, and a check that cannot run says
  what it was waiting on;
* says nothing about anyone else's server. On a shared machine other Squad
  servers are counted, not described: no path, and no command line, since a
  command line can carry a password. Only the ports are parsed out of it;
* is light by default. ``--deep`` adds the expensive part, locating UE's
  global tables (seconds to tens of seconds of one CPU core), and reads one
  snapshot of the match.
"""
from __future__ import annotations

import os
import platform
import shutil
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from . import __version__, config

OK, WARN, FAIL, INFO = "OK", "WARN", "FAIL", "INFO"

#: Command-line keys whose values are ports, the only thing taken from a
#: command line. Matched case-insensitively, with or without a leading -.
_PORT_KEYS = ("port", "queryport", "beaconport", "rconport")

#: Bytes of the server log scanned for kill-feed lines.
_LOG_TAIL_BYTES = 2 << 20


@dataclass
class Report:
    lines: list[str] = field(default_factory=list)
    failures: int = 0
    warnings: int = 0

    def section(self, title: str) -> None:
        self.lines.append("")
        self.lines.append(f"== {title} ==")

    def add(self, status: str, label: str, detail: Any = "") -> None:
        if status == FAIL:
            self.failures += 1
        elif status == WARN:
            self.warnings += 1
        text = f"[{status:<4}] {label}"
        if detail not in ("", None):
            text += f": {detail}"
        self.lines.append(text)

    def check(self, label: str, fn: Callable[[], tuple[str, Any]]) -> None:
        """Run one check; an exception becomes a FAIL that names it."""
        try:
            status, detail = fn()
        except Exception as e:  # noqa: BLE001 - the report must survive anything
            status, detail = FAIL, _describe(e)
        self.add(status, label, detail)

    def text(self) -> str:
        verdict = ("everything needed looks fine" if not self.failures
                   else "see the FAIL lines above")
        return "\n".join(self.lines + [
            "",
            f"Summary: {self.failures} FAIL, {self.warnings} WARN "
            f"({verdict})",
        ]) + "\n"


def _describe(e: BaseException) -> str:
    return f"{type(e).__name__}: {e}"


# -- identity --------------------------------------------------------------------

def _user_of(pid: int) -> str | None:
    if sys.platform == "win32":
        from . import winproc
        return winproc.process_user(pid)
    import pwd
    return pwd.getpwuid(os.stat(f"/proc/{pid}").st_uid).pw_name


def _is_admin() -> bool | None:
    if sys.platform == "win32":
        import ctypes
        try:
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        except Exception:
            return None
    return os.geteuid() == 0


def _same_user(a: str | None, b: str | None) -> bool | None:
    if not a or not b:
        return None
    if sys.platform == "win32":
        return a.lower() == b.lower()
    return a == b


# -- the game process ----------------------------------------------------------

def parse_ports(args: list[str] | None) -> dict[str, int]:
    """``{"Port": 7787, "QueryPort": 27165}`` out of a command line, and
    nothing else from it."""
    out: dict[str, int] = {}
    for a in args or []:
        key, sep, value = a.lstrip("-/").partition("=")
        if sep and key.lower() in _PORT_KEYS and value.isdigit():
            out[key] = int(value)
    return out


def summarize_candidates(
    raw: list[tuple[int, bool, list[str] | None]],
) -> list[tuple[int, str, dict[str, int]]]:
    """``(pid, is game binary, argv)`` → ``(pid, "game" | "launcher", ports)``.

    The argv is reduced to its ports right here, so nothing else from another
    customer's command line can reach the report.
    """
    return [(pid, "game" if is_game else "launcher", parse_ports(args))
            for pid, is_game, args in raw]


def _raw_candidates(proc: str) -> list[tuple[int, bool, list[str] | None]]:
    """Every process carrying the game's name: (pid, is game binary, argv)."""
    out: list[tuple[int, bool, list[str] | None]] = []
    if sys.platform == "win32":
        from . import winproc
        names = (proc.lower(), proc.lower() + ".exe")
        for e in winproc.list_processes():
            if e.exe_name.lower() not in names:
                continue
            image = winproc.image_path(e.pid)
            out.append((e.pid, config._is_game_binary_windows(image, proc),
                        winproc.command_line(e.pid)))
        return out
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/comm") as f:
                if f.read().strip() != proc[:15]:
                    continue
            with open(f"/proc/{entry}/cmdline") as f:
                args = f.read().split("\0")
        except OSError:
            continue
        out.append((int(entry), config._is_game_binary(entry, proc), args))
    return out


# -- the report ------------------------------------------------------------------

def run(pid: int | None = None, *, deep: bool = False) -> Report:
    """Build the whole report. Never raises."""
    r = Report()
    r.lines.append("sqreader diagnose")
    r.lines.append(datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"))
    proc = str(config.get("squad_process_name"))

    _environment(r)
    _configuration(r)
    pid = _game_process(r, proc, pid)
    pm = _memory_access(r, proc, pid)
    _game_build(r, pid)
    _server_log(r, pid)
    if deep:
        _deep(r, pid, pm)
    else:
        r.section("Game internals")
        r.add(INFO, "skipped", "run with --deep to locate UE's tables and read "
                                "one snapshot (uses one CPU core for a while)")
    return r


def _environment(r: Report) -> None:
    r.section("Environment")
    from .cli import _is_compiled
    r.add(INFO, "sqreader", f"{__version__} "
                            f"({'compiled' if _is_compiled() else 'from source'})")
    r.add(INFO, "python", f"{platform.python_version()} "
                          f"({platform.architecture()[0]})")
    r.add(INFO, "os", platform.platform())
    r.check("reader runs as", lambda: (INFO, _user_of(os.getpid()) or "unknown"))
    admin = _is_admin()
    r.add(INFO, "administrator" if sys.platform == "win32" else "root",
          {True: "yes", False: "no", None: "unknown"}[admin])

    def disk() -> tuple[str, Any]:
        free_gb = shutil.disk_usage(Path.cwd()).free / 1e9
        status = WARN if free_gb < 20 else OK
        return status, f"{free_gb:.0f} GB free where it runs ({Path.cwd()})"
    r.check("disk", disk)


def _configuration(r: Report) -> None:
    r.section("Configuration")
    env = os.environ.get("SQREADER_CONFIG")
    path = Path(env) if env else Path.cwd() / "sqreader.config.json"
    r.add(INFO, "config file",
          f"{path} ({'found' if path.is_file() else 'not found, using defaults'})")
    r.add(INFO, "squad_process_name", config.get("squad_process_name"))
    port = config.get("squad_port")
    r.add(INFO, "squad_port", port if port else "not set (only safe with "
                                                "a single Squad server)")
    r.add(INFO, "server_id", config.get("server_id"))
    r.add(INFO, "push",
          f"{'on' if config.get('push_enabled') else 'off'}, central "
          f"{'set' if config.get('central_url') else 'not set'}")


def _game_process(r: Report, proc: str, pid: int | None) -> int | None:
    r.section("Game process")
    try:
        cands = summarize_candidates(_raw_candidates(proc))
    except Exception as e:  # noqa: BLE001
        cands = []
        r.add(WARN, "process list", _describe(e))
    games = [c for c in cands if c[1] == "game"]
    launchers = [c for c in cands if c[1] == "launcher"]
    r.add(INFO, f"{proc} processes",
          f"{len(games)} game server(s), {len(launchers)} launcher(s)/other")
    if len(games) > 1 and not config.get("squad_port") and pid is None:
        r.add(WARN, "several game servers",
              "set squad_port to our server's game port, or the reader may "
              "attach to someone else's")

    if pid is None:
        try:
            pid = config.find_squad_server_pid()
        except SystemExit as e:
            r.add(FAIL, "our game server", str(e) or "not found")
            return None
        except Exception as e:  # noqa: BLE001
            r.add(FAIL, "our game server", _describe(e))
            return None
    ports = next((c[2] for c in cands if c[0] == pid), {})
    r.add(OK, "our game server",
          f"pid {pid}" + (f", ports {ports}" if ports else ""))

    me = None
    try:
        me = _user_of(os.getpid())
    except Exception:  # noqa: BLE001
        pass
    try:
        owner = _user_of(pid)
    except Exception as e:  # noqa: BLE001
        owner = None
        r.add(WARN, "game runs as", _describe(e))
    else:
        same = _same_user(me, owner)
        if same:
            r.add(OK, "game runs as", f"{owner} (same account as the reader)")
        elif _is_admin():
            r.add(OK, "game runs as",
                  f"{owner or 'unknown'} (reader is elevated, so it may read it)")
        else:
            r.add(WARN, "game runs as",
                  f"{owner or 'unknown (not visible to this account)'}; the "
                  f"reader runs as {me}. Windows only lets the same account "
                  f"or an administrator read the game's memory"
                  if sys.platform == "win32" else
                  f"{owner or 'unknown'}; the reader runs as {me} without root")
    return pid


def _memory_access(r: Report, proc: str, pid: int | None) -> Any:
    r.section("Memory access")
    if pid is None:
        r.add(INFO, "skipped", "no game server to open")
        return None
    from .mem import ProcessMemory
    from .ue.module import load_module
    try:
        pm = ProcessMemory(pid)
        maps = pm.maps
    except PermissionError as e:
        r.add(FAIL, "open the game", f"{_describe(e)}. Run the reader under "
                                      f"the game's account or as administrator")
        return None
    except Exception as e:  # noqa: BLE001
        r.add(FAIL, "open the game", _describe(e))
        return None
    committed = sum(m.size for m in maps) / 1e9
    r.add(OK, "open the game", f"{len(maps)} memory regions, "
                               f"{committed:.1f} GB committed")

    def module() -> tuple[str, Any]:
        mod = load_module(pm, proc)
        size = max(m.end for m in mod.regions) - mod.base
        rw = sum(m.size for m in mod.regions if m.writable)
        head = pm.read(mod.base, 4)
        want = b"MZ" if sys.platform == "win32" else b"\x7fELF"
        if not head.startswith(want):
            return FAIL, (f"{mod.path} at {mod.base:#x}: header {head!r} is "
                          f"not {want!r}")
        return OK, (f"{Path(mod.path).name} at {mod.base:#x}, {size / 1e6:.0f} "
                    f"MB image, {rw / 1e6:.1f} MB writable, header readable")
    r.check("game module", module)
    return pm


def _game_build(r: Report, pid: int | None) -> None:
    r.section("Game build")
    if pid is None:
        r.add(INFO, "skipped", "no game server")
        return
    from . import squad_build
    from .procinfo import exe_path

    def exe() -> tuple[str, Any]:
        link = exe_path(pid)
        if link is None:
            return WARN, "executable path not readable"
        real = os.path.realpath(link)
        st = os.stat(real)
        when = datetime.fromtimestamp(st.st_mtime, timezone.utc)
        return INFO, (f"{real} ({st.st_size / 1e6:.0f} MB, modified "
                      f"{when:%Y-%m-%d %H:%M} UTC)")
    r.check("executable", exe)

    def sha() -> tuple[str, Any]:
        t0 = time.perf_counter()
        digest = squad_build.build_sha256(pid)
        if digest is None:
            return WARN, "could not hash the executable"
        return INFO, f"sha256 {digest[:16]}... ({time.perf_counter() - t0:.1f}s)"
    r.check("build", sha)


def _server_log(r: Report, pid: int | None) -> None:
    r.section("Server log")
    from .squad import logtail
    path = logtail.find_squad_log(pid)
    if path is None:
        r.add(WARN, "SquadGame.log", "not found or not readable: the reader "
                                     "works, but kills are undercounted")
        return

    def log() -> tuple[str, Any]:
        st = os.stat(path)
        age = time.time() - st.st_mtime
        with open(path, "rb") as f:
            f.seek(max(0, st.st_size - _LOG_TAIL_BYTES))
            tail = f.read().decode("utf-8", errors="replace")
        hits = sum(len(rx.findall(tail)) for rx in
                   (logtail._ACTUAL_RE, logtail._WOUND_RE, logtail._DIE_RE))
        detail = (f"{path} ({st.st_size / 1e6:.1f} MB, last written "
                  f"{age:.0f}s ago, {hits} kill-feed lines in the last "
                  f"{_LOG_TAIL_BYTES >> 20} MB)")
        return OK, detail
    r.check("SquadGame.log", log)


def _deep(r: Report, pid: int | None, pm: Any) -> None:
    r.section("Game internals (--deep)")
    if pid is None or pm is None:
        r.add(INFO, "skipped", "the game could not be opened")
        return
    from . import addrcache
    from .cli import _resolve_fname_pool, _resolve_gobjects
    binary_id = addrcache.binary_identity(pid)
    found: dict[str, Any] = {}

    def gobjects() -> tuple[str, Any]:
        t0 = time.perf_counter()
        arr = _resolve_gobjects(pm, binary_id)
        found["arr"] = arr
        return OK, (f"at {arr.base:#x}, {arr.num_elements} objects "
                    f"({time.perf_counter() - t0:.1f}s)")
    r.check("GUObjectArray", gobjects)

    def fnames() -> tuple[str, Any]:
        t0 = time.perf_counter()
        alloc = _resolve_fname_pool(pm, binary_id)
        found["alloc"] = alloc
        return OK, (f"at {alloc.base:#x}, {alloc.current_block + 1} blocks "
                    f"({time.perf_counter() - t0:.1f}s)")
    r.check("FNamePool", fnames)
    if "arr" not in found or "alloc" not in found:
        r.add(INFO, "snapshot", "skipped: the tables above are needed first")
        return

    def paths() -> tuple[str, Any]:
        from .squad.snapshot import resolve_paths
        found["paths"] = resolve_paths(pm, found["arr"], found["alloc"])
        return OK, "every class the reader needs was found"
    r.check("classes", paths)
    if "paths" not in found:
        return

    def snapshot() -> tuple[str, Any]:
        from .squad.metadata import Metadata
        from .squad.snapshot import build_snapshot
        t0 = time.perf_counter()
        try:
            meta = Metadata.load()
        except Exception:  # noqa: BLE001 - metadata only adds labels
            meta = None
        snap = build_snapshot(pm, found["arr"], found["alloc"],
                              paths=found["paths"], metadata=meta)
        gs = snap.get("gameState") or {}
        return OK, (f"map {gs.get('mapName')!r}, state {gs.get('matchState')}, "
                    f"{len(snap.get('players') or [])} players, "
                    f"{len(snap.get('vehicles') or [])} vehicles "
                    f"({time.perf_counter() - t0:.1f}s)")
    r.check("snapshot", snapshot)


__all__ = ["Report", "parse_ports", "run", "summarize_candidates"]
