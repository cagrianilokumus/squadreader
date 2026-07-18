#!/usr/bin/env python3
"""
Walk any UStruct (UClass, UScriptStruct, ...) by name or address; print
its SuperStruct chain + per-level own properties. Unlike
verify_reflection.py, accepts ScriptStructs (or any UStruct-derived).
"""
from __future__ import annotations

import argparse
import struct
import subprocess
import sys

from sqreader.mem import ProcessMemory
from sqreader.ue.fname import FNameEntryAllocator, KNOWN_ALLOCATOR_ADDR_V10_4_1
from sqreader.ue.reflection import describe_class
from sqreader.ue.uobject import (
    GUObjectArray, KNOWN_GOBJECTS_ADDR_V10_4_1,
    UOBJ_CLASS_PRIVATE, UOBJ_NAME_PRIVATE,
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
    ap.add_argument("--addr", type=lambda s: int(s, 0), default=None,
                    help="UStruct address (overrides --name lookup)")
    ap.add_argument("--name", default=None,
                    help="name to look up in GUObjectArray (any class)")
    args = ap.parse_args()

    pm = ProcessMemory(args.pid or find_squad_pid())
    arr = GUObjectArray(pm, KNOWN_GOBJECTS_ADDR_V10_4_1)
    alloc = FNameEntryAllocator(pm, KNOWN_ALLOCATOR_ADDR_V10_4_1)

    if args.addr:
        addr = args.addr
    elif args.name:
        # Find any UObject with this name (don't filter by class)
        for _idx, obj_addr in arr.iter_object_addrs():
            if obj_addr == 0:
                continue
            nm = pm.try_read(obj_addr + UOBJ_NAME_PRIVATE, 8)
            if not nm:
                continue
            ci, num = struct.unpack("<II", nm)
            n = alloc.fname_to_str(ci, num)
            if n == args.name:
                # also resolve its class to confirm what we found
                cp = pm.try_read(obj_addr + UOBJ_CLASS_PRIVATE, 8)
                ca = struct.unpack("<Q", cp)[0] if cp else 0
                nm2 = pm.try_read(ca + UOBJ_NAME_PRIVATE, 8) if ca else None
                cn = alloc.fname_to_str(*struct.unpack("<II", nm2)) if nm2 else "?"
                print(f"# matched UObject @ {obj_addr:#x}  name={n!r}  class={cn!r}")
                addr = obj_addr
                break
        else:
            print(f"name {args.name!r} not found")
            return 1
    else:
        ap.error("provide --addr or --name")

    levels = describe_class(pm, addr, alloc)
    print(f"\nSuperStruct chain ({len(levels)} levels):")
    for info, props in levels:
        print(f"  {info.addr:#x}  {info.name:>32s}  "
              f"size={info.properties_size:5d}  own_props={len(props)}")
    for info, props in levels:
        print(f"\n--- {info.name} ({len(props)} props) ---")
        for p in sorted(props, key=lambda p: p.offset):
            print(f"  +{p.offset:#06x}  {p.type_name:>22s}  {p.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
