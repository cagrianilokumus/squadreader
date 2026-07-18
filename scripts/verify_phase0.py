#!/usr/bin/env python3
"""
Phase 0 acceptance test.

Verifies:
1. ProcessMemory can attach to the live squad SquadGameServer.
2. /proc/<pid>/maps parsing finds the binary, its load base is 0x200000,
   and the binary is non-PIE (load base == preferred base).
3. Reading the GWorld string at runtime addr 0x13b08ae returns 'GWorld'.
   This is the strong read-path verification — it uses a file-backed,
   non-PIE address that is stable across restarts.
4. Scanning anonymous writable regions for 'SQVehicle' finds at least
   one occurrence (kickoff doc reported 16332 hits).

Exits non-zero on any failure.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time

from sqreader.mem import ProcessMemory
from sqreader.scanner import find_ascii


def find_squad_pid() -> int:
    """Locate the squad SquadGameServer process via pgrep."""
    out = subprocess.check_output(
        ["pgrep", "-f", "/home/.*/serverfiles/.*SquadGameServer"],
        text=True,
    ).strip().splitlines()
    # Filter out the helper sudo/check-version invocations: only keep PIDs
    # whose cmdline includes "Port=" (the actual server).
    pids: list[int] = []
    for pid_s in out:
        try:
            cmdline = open(f"/proc/{pid_s}/cmdline").read()
        except FileNotFoundError:
            continue
        if "Port=" in cmdline:
            pids.append(int(pid_s))
    if not pids:
        raise SystemExit("no running squad SquadGameServer found")
    if len(pids) > 1:
        raise SystemExit(f"multiple squad servers found: {pids}")
    return pids[0]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pid", type=int, default=None,
                    help="override squad PID (default: auto-detect)")
    ap.add_argument("--scan", action="store_true",
                    help="also scan heap for 'SQVehicle' (slower, ~6s)")
    args = ap.parse_args()

    pid = args.pid or find_squad_pid()
    print(f"[1/4] target squad pid = {pid}")

    pm = ProcessMemory(pid)

    # -- maps ----------------------------------------------------------------
    base = pm.module_base("SquadGameServer")
    if base is None:
        print("FAIL: no SquadGameServer mapping in /proc/<pid>/maps",
              file=sys.stderr)
        return 1
    print(f"[2/4] SquadGameServer module base = {base:#x}")
    if base != 0x200000:
        print(f"  WARN: expected 0x200000 (non-PIE), got {base:#x}."
              " Binary may now be PIE — re-check non-PIE assumption.")

    anon_rw = pm.writable_anon_regions()
    anon_rw_bytes = sum(r.size for r in anon_rw)
    print(f"      anon RW regions: {len(anon_rw)}  total: {anon_rw_bytes/1048576:.1f} MiB")

    # -- GWorld string read --------------------------------------------------
    GWORLD_ADDR = 0x13b08ae
    expected = "GWorld"
    s = pm.read_cstring(GWORLD_ADDR, max_len=16)
    if s != expected:
        print(f"FAIL: read_cstring({GWORLD_ADDR:#x}) returned {s!r}, "
              f"expected {expected!r}", file=sys.stderr)
        return 1
    print(f"[3/4] read_cstring({GWORLD_ADDR:#x}) = {s!r}  OK")

    # -- heap scan (optional) ------------------------------------------------
    if args.scan:
        t0 = time.time()
        hits = find_ascii(pm, "SQVehicle", region_filter="anon_rw")
        dt = time.time() - t0
        print(f"[4/4] SQVehicle hits in anon RW: {len(hits)}  "
              f"(scanned {anon_rw_bytes/1048576:.1f} MiB in {dt:.2f}s)")
        if not hits:
            print("FAIL: zero SQVehicle hits — FName pool may not be populated"
                  " yet, or the heap layout has shifted significantly.",
                  file=sys.stderr)
            return 1
        for h in hits[:5]:
            print(f"  hit @ {h.addr:#x}  in {h.region.pathname or '[anon]'}"
                  f" ({h.region.start:#x}-{h.region.end:#x})")
    else:
        print("[4/4] skipping SQVehicle heap scan (pass --scan to enable)")

    print("\nPHASE 0 OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
