#!/usr/bin/env python3
"""
Phase 2 acceptance: walk a class's SuperStruct chain, list every
reflected property at every inheritance level, then dump the merged
{name: (offset, type)} map.

Defaults to SQSoldier, the canonical Squad player-pawn class. Expected
property names per the kickoff doc: Health, MaxHealth, Stamina,
CurrentWeapon, TeamState, PlayerState, CurrentRole.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time

from sqreader.mem import ProcessMemory
from sqreader.ue.fname import FNameEntryAllocator, KNOWN_ALLOCATOR_ADDR_V10_4_1
from sqreader.ue.reflection import describe_class, get_class_layout
from sqreader.ue.uobject import GUObjectArray, KNOWN_GOBJECTS_ADDR_V10_4_1


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
    ap.add_argument("--class-name", default="SQSoldier")
    ap.add_argument("--max-per-level", type=int, default=30)
    ap.add_argument("--show-merged", action="store_true",
                    help="also dump the merged inherited-field map")
    # Default expected set is what SQUAD v10.4.1 actually has on SQSoldier
    # (NOT the kickoff doc's guesses — see findings.md for the mapping).
    ap.add_argument("--expect", nargs="*", default=[
        "Health",               # +0x269c  FloatProperty
        "BreathHoldStamina",    # +0x2710  FloatProperty (Squad's stamina is breath-hold)
        "CurrentHeldWeapon",    # +0x307c  WeakObjectProperty (kickoff called it CurrentWeapon)
        "PlayerState",          # +0x02d8  ObjectProperty (inherited from APawn)
        "LastHitBy",            # +0x02e0  ObjectProperty (inherited from APawn — damage attrib)
        "Controller",           # +0x02e8  ObjectProperty (inherited from APawn)
    ])
    args = ap.parse_args()

    pm = ProcessMemory(args.pid or find_squad_pid())
    arr = GUObjectArray(pm, KNOWN_GOBJECTS_ADDR_V10_4_1)
    alloc = FNameEntryAllocator(pm, KNOWN_ALLOCATOR_ADDR_V10_4_1)

    t0 = time.time()
    hits = arr.find_by_name(args.class_name, class_name="Class",
                            alloc=alloc, limit=1)
    dt = time.time() - t0
    if not hits:
        print(f"class {args.class_name!r} not found")
        return 1
    idx, addr = hits[0]
    print(f"UClass '{args.class_name}'  idx={idx}  addr={addr:#x}  (lookup {dt:.2f}s)")

    levels = describe_class(pm, addr, alloc)
    print(f"\nSuperStruct chain ({len(levels)} levels):")
    for info, props in levels:
        print(f"  {info.addr:#x}  {info.name:>32s}  "
              f"size={info.properties_size:5d}  align={info.min_alignment}  "
              f"own_props={len(props)}")

    print("\n=== own properties per class (top→root) ===")
    for info, props in levels:
        print(f"\n  --- {info.name} ({len(props)} own props, "
              f"PropertiesSize={info.properties_size}) ---")
        for p in props[: args.max_per_level]:
            print(f"    +{p.offset:#06x}  {p.type_name:>22s}  {p.name}"
                  + (f"   (size={p.element_size}, dim={p.array_dim})"
                     if p.array_dim != 1 or p.element_size > 64
                     else ""))
        if len(props) > args.max_per_level:
            print(f"    ... and {len(props) - args.max_per_level} more")

    merged = get_class_layout(pm, addr, alloc)
    print(f"\n=== merged layout: {len(merged)} unique field names ===")

    found_expected = []
    missing_expected = []
    for want in args.expect:
        if want in merged:
            p = merged[want]
            found_expected.append((want, p))
        else:
            missing_expected.append(want)

    print("\nexpected fields:")
    for name, p in found_expected:
        print(f"  OK   {name:>20s}  +{p.offset:#06x}  {p.type_name}")
    for name in missing_expected:
        print(f"  MISS {name}")

    if args.show_merged:
        print("\n=== full merged layout (sorted by offset) ===")
        for p in sorted(merged.values(), key=lambda p: p.offset):
            print(f"  +{p.offset:#06x}  {p.type_name:>22s}  {p.name}")

    if missing_expected:
        # Many expected fields may exist with a slightly different name in
        # Squad's source (e.g. "MaxHealth" → "SoldierMaxHealth"). Print
        # substring matches to help identify them.
        print("\n=== substring searches for missing expected fields ===")
        for want in missing_expected:
            short = want.replace("Max", "").replace("Current", "")
            print(f"\n  fields containing {short!r}:")
            hits = [p for n, p in merged.items() if short.lower() in n.lower()]
            for p in sorted(hits, key=lambda p: p.offset)[:20]:
                print(f"    +{p.offset:#06x}  {p.type_name:>22s}  {p.name}")
            if not hits:
                print("    (none)")

        print(f"\nFAIL: {len(missing_expected)} expected fields not found")
        return 1
    print("\nPHASE 2 (reflection) OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
