"""Where the game's executable is, and whether the game is still running.

Two questions several modules ask about the target process. On Linux the
answers are procfs paths, and they stay exactly what the callers always used:
``/proc/<pid>/exe`` is a symlink that ``open``, ``os.stat`` and
``os.path.realpath`` all follow to the real binary. On Windows the same
answers come from the Win32 API through sqreader.winproc.
"""
from __future__ import annotations

import os
import sys

from . import winproc


def exe_path(pid: int) -> str | None:
    """A path that opens, stats and resolves to ``pid``'s executable.

    None when it cannot be determined (Windows only; on Linux the procfs link
    is returned as is, and a gone process surfaces as OSError at the caller's
    open/stat, which every caller already handles).
    """
    if sys.platform == "win32":
        return winproc.image_path(pid)
    return f"/proc/{pid}/exe"


def pid_alive(pid: int) -> bool:
    """True while ``pid`` is still a running process."""
    if sys.platform == "win32":
        return winproc.is_alive(pid)
    return os.path.exists(f"/proc/{pid}")


__all__ = ["exe_path", "pid_alive"]
