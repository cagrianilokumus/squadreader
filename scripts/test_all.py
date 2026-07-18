#!/usr/bin/env python3
"""
End-to-end regression test for everything we've built so far.

Runs the acceptance check for every phase in sequence against the live
squad process, and prints a PASS/FAIL summary. Exit code is 0 only if
ALL phases pass.

Phase 0 — /proc/<pid>/mem read of GWorld string + SQVehicle heap scan.
Phase 1A — FNamePool discovery + canonical EName sequence.
Phase 1B — GUObjectArray discovery + first 40 UObjects match UE startup order.
Phase 2  — UStruct/FProperty walker on SQSoldier with expected fields.

Designed to be safe to run repeatedly. Total wall time ~ 8 s on a quiet
server (most of it is the auto-discovery scans, which we run to keep
this an "honest" end-to-end test).
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
_VENV_PY = SCRIPT_DIR.parent / ".venv" / "bin" / "python"
PY = str(_VENV_PY.resolve()) if _VENV_PY.exists() else sys.executable


def run(name: str, args: list[str]) -> tuple[bool, float, str, str]:
    t0 = time.time()
    # Inherit the parent environment fully — the inherited PYTHONPATH and
    # standard locale vars matter, and our previous stripped-env approach
    # broke FName-resolution heuristics with utf-8 output.
    import os
    env = os.environ.copy()
    env["PYTHONPATH"] = str(SCRIPT_DIR.parent)
    r = subprocess.run(
        [PY, str(SCRIPT_DIR / args[0])] + args[1:],
        capture_output=True, text=True, cwd=str(SCRIPT_DIR.parent),
        env=env,
    )
    dt = time.time() - t0
    ok = r.returncode == 0
    tail = next(
        (line for line in reversed(r.stdout.splitlines()) if line.strip()),
        "(no output)",
    )
    stderr_tail = next(
        (line for line in reversed(r.stderr.splitlines()) if line.strip()),
        "",
    )
    return ok, dt, tail, stderr_tail


PHASES = [
    ("Phase 0  — mem.py + GWorld + SQVehicle scan",
     ["verify_phase0.py", "--scan"]),
    ("Phase 1A — FNamePool discovery + canonical ENames",
     ["verify_fname_pool.py", "--show-entries", "0"]),
    ("Phase 1B — GUObjectArray discovery + first 40 UObjects",
     ["verify_gobjects.py", "--count", "5"]),
    ("Phase 2  — UStruct + FProperty walker on SQSoldier",
     ["verify_reflection.py", "--class-name", "SQSoldier",
      "--max-per-level", "0"]),
    ("Phase 2  — same walker on SQVehicle (bonus)",
     ["verify_reflection.py", "--class-name", "SQVehicle",
      "--max-per-level", "0",
      "--expect", "Health", "MaxHealth", "LastDamageInstigator"]),
    ("Phase 3+4 — live snapshot schema (gameState/teams/players/vehicles)",
     ["verify_snapshot.py"]),
]


def main() -> int:
    print("running test_all.py against the live squad process\n")
    print(f"{'phase':<58}  {'time':>6}  result")
    print(f"{'-'*58}  {'-'*6}  {'-'*30}")
    results = []
    for label, args in PHASES:
        ok, dt, tail, stderr_tail = run(label, args)
        results.append((label, ok, dt, tail, stderr_tail))
        flag = "PASS" if ok else "FAIL"
        print(f"  {label:<56}  {dt:5.2f}s  {flag}  {tail}")
        if not ok and stderr_tail:
            print(f"    stderr: {stderr_tail}")

    passed = sum(1 for _, ok, *_rest in results if ok)
    total = len(results)
    print(f"\n{passed}/{total} phases passed.")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
