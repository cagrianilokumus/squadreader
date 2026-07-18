#!/usr/bin/env python3
"""
Phase 1 acceptance: verify that we can locate FNamePool and enumerate FNames.

Steps:
1. Open the live process, locate FNameEntryAllocator via the heap scan
   (`find_fname_pool_base`). Cross-check against the known stable address
   `KNOWN_ALLOCATOR_ADDR_V10_4_1`.
2. Read CurrentBlock and CurrentByteCursor.
3. Walk the first block and assert the first N entries match the canonical
   EName order ("None", "ByteProperty", "IntProperty", ...).
4. Print the active block count, total entry count, and the first 32 entries
   of Block 0 plus a sample from Blocks[1..3].
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time

from sqreader.mem import ProcessMemory
from sqreader.ue.fname import (
    CANONICAL_RESERVED_NAMES,
    KNOWN_ALLOCATOR_ADDR_V10_4_1,
    FNameEntryAllocator,
    find_fname_pool_base,
)


def find_squad_pid() -> int:
    for s in subprocess.check_output(
        ["pgrep", "-f", "/home/.*/serverfiles/.*SquadGameServer"],
        text=True,
    ).strip().splitlines():
        try:
            if "Port=" in open(f"/proc/{s}/cmdline").read():
                return int(s)
        except FileNotFoundError:
            pass
    raise SystemExit("no squad server")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pid", type=int, default=None)
    ap.add_argument("--use-known", action="store_true",
                    help="skip discovery; use KNOWN_ALLOCATOR_ADDR_V10_4_1")
    ap.add_argument("--show-entries", type=int, default=32)
    args = ap.parse_args()

    pid = args.pid or find_squad_pid()
    pm = ProcessMemory(pid)
    print(f"pid = {pid}")

    if args.use_known:
        base = KNOWN_ALLOCATOR_ADDR_V10_4_1
        print(f"using KNOWN address: {base:#x}")
    else:
        t0 = time.time()
        base = find_fname_pool_base(pm)
        dt = time.time() - t0
        print(f"discovered FNameEntryAllocator @ {base:#x}  (in {dt:.2f}s)")
        if base != KNOWN_ALLOCATOR_ADDR_V10_4_1:
            print(f"  WARN: differs from known {KNOWN_ALLOCATOR_ADDR_V10_4_1:#x}"
                  " — Squad binary may have changed")

    alloc = FNameEntryAllocator(pm, base)
    cb = alloc.current_block
    cc = alloc.current_cursor
    print(f"  CurrentBlock      = {cb}")
    print(f"  CurrentByteCursor = {cc}  ({cc/1024:.1f} KiB)")
    print(f"  active blocks     = {cb + 1}")

    blocks = alloc.block_addrs()
    print(f"  Blocks[0..{min(8, len(blocks))-1}]:")
    for i, b in enumerate(blocks[:8]):
        print(f"    Blocks[{i:3d}] = {b:#x}")

    # Canonical sequence check
    print(f"\n=== canonical EName sequence check (first {len(CANONICAL_RESERVED_NAMES)}) ===")
    actual = []
    for _off, entry in alloc.iter_block_entries(0):
        actual.append(entry.text)
        if len(actual) >= len(CANONICAL_RESERVED_NAMES):
            break

    ok = True
    for i, (want, got) in enumerate(
            zip(CANONICAL_RESERVED_NAMES, actual, strict=False)):
        flag = "OK" if want == got else "FAIL"
        if want != got:
            ok = False
        print(f"  [{i:3d}] want={want!r:25s} got={got!r:25s} {flag}")
    if not ok:
        print("FAIL: canonical EName sequence mismatch")
        return 1

    # Show first N entries from Block 0
    print(f"\n=== Block 0 — first {args.show_entries} entries ===")
    for i, (off, entry) in enumerate(alloc.iter_block_entries(0)):
        if i >= args.show_entries:
            break
        kind = "WIDE" if entry.wide else "ANSI"
        print(f"  [#{i:4d}] off={off:#06x}  len={entry.length:3d} {kind}  "
              f"hash={entry.hash:2d}  {entry.text!r}")

    # Sample from Block 1, 2, 3
    print("\n=== sample from Blocks[1..3] (first 5 entries each) ===")
    for b in (1, 2, 3):
        print(f"  Block {b} @ {alloc.block_addr(b):#x}:")
        for i, (off, entry) in enumerate(alloc.iter_block_entries(b)):
            if i >= 5:
                break
            print(f"    off={off:#06x}  len={entry.length:3d}  {entry.text!r}")

    # Total entries summary
    print("\n=== total entry count across all active blocks ===")
    total = 0
    t0 = time.time()
    for _ in alloc.iter_all_entries():
        total += 1
    dt = time.time() - t0
    print(f"  total entries: {total}")
    print(f"  walk time: {dt:.2f}s")
    print("\nPHASE 1 (FNamePool) OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
