#!/usr/bin/env python3
"""
Phase 1B acceptance test — enumerate UObjects from GUObjectArray and
print the first N with class + name (resolved via FNamePool).
"""
from __future__ import annotations

import argparse
import struct
import subprocess
import sys
import time

from sqreader.mem import ProcessMemory
from sqreader.ue.fname import FNameEntryAllocator, KNOWN_ALLOCATOR_ADDR_V10_4_1
from sqreader.ue.uobject import (
    GUObjectArray,
    KNOWN_GOBJECTS_ADDR_V10_4_1,
    UOBJ_NAME_PRIVATE,
    find_gobjects_base,
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
    ap.add_argument("--use-known", action="store_true")
    ap.add_argument("--count", type=int, default=100)
    ap.add_argument("--from-index", type=int, default=0)
    ap.add_argument("--walk-all", action="store_true",
                    help="walk every UObject and time it (no per-obj print)")
    args = ap.parse_args()

    pid = args.pid or find_squad_pid()
    pm = ProcessMemory(pid)
    print(f"pid = {pid}")

    if args.use_known:
        base = KNOWN_GOBJECTS_ADDR_V10_4_1
        print(f"using KNOWN GUObjectArray addr: {base:#x}")
    else:
        t0 = time.time()
        base = find_gobjects_base(pm)
        dt = time.time() - t0
        print(f"discovered GUObjectArray @ {base:#x}  (in {dt:.2f}s)")
        if base != KNOWN_GOBJECTS_ADDR_V10_4_1:
            print(f"  WARN: differs from known {KNOWN_GOBJECTS_ADDR_V10_4_1:#x}")

    arr = GUObjectArray(pm, base)
    alloc = FNameEntryAllocator(pm, KNOWN_ALLOCATOR_ADDR_V10_4_1)

    print("\nFUObjectArray header:")
    print(f"  ObjFirstGCIndex      = {arr.first_gc_index}")
    print(f"  ObjLastNonGCIndex    = {arr.last_non_gc_index}")
    print(f"  MaxDisregard         = {arr.max_disregard}")
    print(f"  NumElements          = {arr.num_elements}")
    print(f"  MaxElements          = {arr.max_elements}")
    print(f"  NumChunks            = {arr.num_chunks}")
    print(f"  MaxChunks            = {arr.max_chunks}")
    print(f"  ChunksArray addr     = {arr.chunks_array_addr:#x}")

    # Resolve a name helper that also fetches class name
    def get_name(obj_addr: int) -> str | None:
        if obj_addr == 0:
            return None
        nm = pm.try_read(obj_addr + UOBJ_NAME_PRIVATE, 8)
        if nm is None or len(nm) < 8:
            return None
        cmp_idx, number = struct.unpack("<II", nm)
        return alloc.fname_to_str(cmp_idx, number)

    print(f"\n=== first {args.count} UObjects starting at index {args.from_index} ===")
    print(f"{'idx':>7}  {'uobj':>14}  {'class':>14}  class.name -> name")

    null_count = 0
    for idx, obj_addr in arr.iter_object_addrs(start=args.from_index,
                                                end=args.from_index + args.count):
        if obj_addr == 0:
            null_count += 1
            if null_count < 5:
                print(f"  {idx:7d}  <null slot>")
            continue
        obj = arr.get(idx)
        if obj is None:
            print(f"  {idx:7d}  {obj_addr:#014x}  <unreadable>")
            continue
        name = get_name(obj.addr)
        class_name = get_name(obj.class_addr) if obj.class_addr else None
        print(f"  {idx:7d}  {obj.addr:#014x}  {obj.class_addr:#014x}  "
              f"{class_name!r:>22} -> {name!r}")

    if null_count >= 5:
        print(f"  ... ({null_count} total null slots in window)")

    # Optional: walk every slot
    if args.walk_all:
        print(f"\n=== walking all {arr.num_elements} UObjects ===")
        t0 = time.time()
        live = 0
        nullc = 0
        for _idx, obj_addr in arr.iter_object_addrs():
            if obj_addr == 0:
                nullc += 1
            else:
                live += 1
        dt = time.time() - t0
        print(f"  live: {live}  null: {nullc}  total: {live + nullc}")
        print(f"  walk time: {dt:.2f}s ({(live + nullc) / dt:.0f} obj/s)")

    print("\nPHASE 1B (GUObjectArray) OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
