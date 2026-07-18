#!/usr/bin/env python3
"""
Phase 3+4 acceptance test — generate a live snapshot and assert that
the schema is complete (all expected top-level blocks present, players
have all sub-fields, etc.). Exits non-zero on any missing piece.
"""
from __future__ import annotations

import subprocess
import sys
import time

from sqreader.mem import ProcessMemory
from sqreader.ue.fname import FNameEntryAllocator, KNOWN_ALLOCATOR_ADDR_V10_4_1
from sqreader.ue.uobject import GUObjectArray, KNOWN_GOBJECTS_ADDR_V10_4_1
from sqreader.squad.metadata import Metadata
from sqreader.squad.snapshot import build_snapshot, resolve_paths


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


def assert_eq(label, got, want):
    if got == want:
        print(f"  OK   {label}: {got!r}")
        return True
    print(f"  FAIL {label}: got {got!r}, want {want!r}")
    return False


def assert_truthy(label, got):
    if got:
        print(f"  OK   {label}: {got!r}")
        return True
    print(f"  FAIL {label}: falsy ({got!r})")
    return False


def assert_ge(label, got, threshold):
    if got is not None and got >= threshold:
        print(f"  OK   {label}: {got}")
        return True
    print(f"  FAIL {label}: {got} < {threshold}")
    return False


def main() -> int:
    pid = find_squad_pid()
    pm = ProcessMemory(pid)
    arr = GUObjectArray(pm, KNOWN_GOBJECTS_ADDR_V10_4_1)
    alloc = FNameEntryAllocator(pm, KNOWN_ALLOCATOR_ADDR_V10_4_1)
    print(f"pid = {pid}")

    paths = resolve_paths(pm, arr, alloc)
    meta = Metadata.load()

    t0 = time.time()
    snap = build_snapshot(pm, arr, alloc, server_id="squad",
                          paths=paths, metadata=meta)
    dt = time.time() - t0
    print(f"snapshot built in {dt*1000:.0f}ms\n")

    ok = True

    print("== top-level keys ==")
    for k in ["timestamp", "server", "schemaVersion", "counts",
              "gameState", "teams", "squads", "players", "vehicles"]:
        ok &= assert_truthy(f"key {k}", k in snap)

    print("\n== gameState fields ==")
    gs = snap.get("gameState") or {}
    for k in ["serverName", "matchState", "elapsedSec", "tickRate",
              "gameModeId", "mapName", "layer"]:
        ok &= assert_truthy(f"gameState.{k}", k in gs and gs[k] is not None)
    ok &= assert_truthy("gameState.layer.bounds",
                        (gs.get("layer") or {}).get("topLeft") is not None)

    print("\n== teams (expect 2) ==")
    teams = snap.get("teams") or []
    ok &= assert_eq("len(teams)", len(teams), 2)
    if teams:
        for t in teams:
            for k in ["id", "tickets", "score", "kills", "factionId"]:
                ok &= assert_truthy(f"team[{t.get('id')}].{k}", t.get(k) is not None)

    print("\n== players ==")
    players = snap.get("players") or []
    # 0 players is a valid live state (empty server / lobby) — only
    # validate the schema on the first one IF any are present.
    print(f"  INFO len(players) = {len(players)}")
    if players:
        p = players[0]
        for k in ["name", "eosId", "teamId", "roleId", "score", "ping",
                  "stats", "soldier"]:
            ok &= assert_truthy(f"player[0].{k}", k in p and p[k] is not None)
        # stats subblock
        stats = p.get("stats") or {}
        for k in ["kills", "deaths", "teamKills", "teamWorkScore",
                  "objectiveScore", "fireTeamIndex"]:
            ok &= assert_truthy(f"player[0].stats.{k}", k in stats)
        # soldier subblock
        soldier = p.get("soldier") or {}
        for k in ["addr", "classShort", "health"]:
            ok &= assert_truthy(f"player[0].soldier.{k}", k in soldier)
        # position is optional (might be attached)
        if "position" in soldier:
            pos = soldier["position"]
            ok &= assert_truthy("player[0].soldier.position.x",
                                pos and "x" in pos)

    print("\n== dedupe (no two players share eosId) ==")
    eos_ids = [p.get("eosId") for p in players if p.get("eosId")]
    ok &= assert_eq("len(eosIds) == len(set(eosIds))",
                    len(eos_ids), len(set(eos_ids)))

    print("\n== vehicles ==")
    vehicles = snap.get("vehicles") or []
    print(f"  INFO len(vehicles) = {len(vehicles)}")
    if vehicles:
        v = vehicles[0]
        for k in ["id", "classShort", "team", "health", "position"]:
            ok &= assert_truthy(f"vehicle[0].{k}", k in v and v[k] is not None)

    print("\n== squads (may be 0 if no one is squadded) ==")
    squads = snap.get("squads") or []
    print(f"  INFO len(squads) = {len(squads)}")

    print("\n== damageEvents key exists ==")
    ok &= assert_truthy("damageEvents in snap", "damageEvents" in snap)

    print(f"\n{'PASS' if ok else 'FAIL'}: snapshot schema check")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
