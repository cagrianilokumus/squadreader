"""Tick-loop profiler. Inert unless SQREADER_PROFILE is set in the env.

Splits each build_snapshot() call into the two costs that decide whether the
mem layer is worth rewriting in Rust: time spent inside the mem syscalls
(pread / process_vm_readv) versus everything else, plus how much of the tick
is the GUObjectArray walk. A per-call line goes to stderr.
"""
from __future__ import annotations

import os
import sys
import time

ENABLED = bool(os.environ.get("SQREADER_PROFILE"))

_perf = time.perf_counter_ns


class _Stats:
    __slots__ = ("t_build", "walk_ns", "read_ns", "read_n",
                 "read_bytes", "syscall_n", "region_n")

    def __init__(self) -> None:
        self._zero()

    def _zero(self) -> None:
        self.t_build = 0
        self.walk_ns = 0
        self.read_ns = 0
        self.read_n = 0
        self.read_bytes = 0
        self.syscall_n = 0
        self.region_n = 0


STATS = _Stats()


def begin() -> None:
    STATS._zero()
    STATS.t_build = _perf()


def start() -> int:
    return _perf()


def add_walk(t0: int) -> None:
    STATS.walk_ns += _perf() - t0


def add_read(t0: int, nbytes: int, regions: int = 1) -> None:
    s = STATS
    s.read_ns += _perf() - t0
    s.read_n += 1
    s.read_bytes += nbytes
    s.region_n += regions
    s.syscall_n += 1


def emit() -> None:
    s = STATS
    build_ms = (_perf() - s.t_build) / 1e6
    mem_ms = s.read_ns / 1e6
    walk_ms = s.walk_ns / 1e6
    rest_ms = build_ms - walk_ms
    pct_mem = (mem_ms / build_ms * 100) if build_ms else 0.0
    pct_walk = (walk_ms / build_ms * 100) if build_ms else 0.0
    ns_per_call = s.read_ns / s.syscall_n if s.syscall_n else 0.0
    print(
        f"[prof] build={build_ms:6.1f}ms | "
        f"walk={walk_ms:6.1f}ms ({pct_walk:4.1f}%) rest={rest_ms:6.1f}ms | "
        f"mem={mem_ms:6.1f}ms ({pct_mem:4.1f}%) "
        f"syscalls={s.syscall_n} regions={s.region_n} "
        f"bytes={s.read_bytes / 1024:.0f}KiB "
        f"{ns_per_call:.0f}ns/syscall",
        file=sys.stderr,
    )
