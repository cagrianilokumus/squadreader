#!/usr/bin/env python3
"""
Ground-truth cross-check: Squad RCON `ListPlayers` vs a sqreader snapshot.

The game server's own RCON is the authority on who is connected, which
team/squad they're in, and who leads a squad. This script asks RCON and
asks sqreader (one `sqreader snapshot`, a direct memory read — this build
has no live HTTP snapshot endpoint), matches players by EOS id, and prints
every disagreement:

  - roster: players RCON reports that the snapshot is missing (the A5
    "vanishing entity" symptom at the player level), and vice-versa
  - team id mismatches
  - squad id / squad-leader (SL) disagreements  (validates the frontend
    leaderStateAddr-based SL detection)

Ping is NOT part of Squad's ListPlayers output, so this script does not
validate ping — use probe_ping.py for that.

Run it ON THE SERVER so it can read the RCON password locally and reach
both RCON and the reader over loopback; the password is never printed.

    sudo python3 rcon_diff.py \
        --config /path/to/SquadGame/ServerConfig/Rcon.cfg

Exit code 0 if rosters match with no team/SL disagreements, else 1.
"""
from __future__ import annotations

import argparse
import json
import re
import shlex
import socket
import struct
import subprocess
import sys

# ---- Source RCON (Valve protocol; Squad speaks it) ----------------------
SERVERDATA_AUTH = 3
SERVERDATA_AUTH_RESPONSE = 2
SERVERDATA_EXECCOMMAND = 2
SERVERDATA_RESPONSE_VALUE = 0


class Rcon:
    def __init__(self, host: str, port: int, password: str, timeout: float = 8.0):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        self._id = 0
        self._auth(password)

    def _send(self, ptype: int, body: str) -> int:
        self._id += 1
        pid = self._id
        payload = struct.pack("<ii", pid, ptype) + body.encode("utf-8") + b"\x00\x00"
        self.sock.sendall(struct.pack("<i", len(payload)) + payload)
        return pid

    def _recvn(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("RCON socket closed")
            buf += chunk
        return buf

    def _recv_pkt(self):
        (length,) = struct.unpack("<i", self._recvn(4))
        data = self._recvn(length)
        pid, ptype = struct.unpack("<ii", data[:8])
        return pid, ptype, data[8:-2].decode("utf-8", "replace")

    def _auth(self, password: str) -> None:
        self._send(SERVERDATA_AUTH, password)
        while True:
            pid, ptype, _ = self._recv_pkt()
            if ptype == SERVERDATA_AUTH_RESPONSE:
                if pid == -1:
                    raise PermissionError("RCON auth failed (bad password?)")
                return

    def command(self, cmd: str) -> str:
        pid = self._send(SERVERDATA_EXECCOMMAND, cmd)
        sentinel = self._send(SERVERDATA_RESPONSE_VALUE, "")
        out = []
        while True:
            rid, _ptype, body = self._recv_pkt()
            if rid == sentinel:
                break
            if rid == pid:
                out.append(body)
        return "".join(out)

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


# ---- config + parsing ---------------------------------------------------
def read_rcon_config(path: str) -> tuple[int, str]:
    """Parse Squad's Rcon.cfg for Port + Password. Password stays local."""
    port, password = None, None
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith(("#", "//")):
                continue
            if "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip().lower()
            v = v.strip()
            if k == "port":
                try:
                    port = int(v)
                except ValueError:
                    pass
            elif k == "password":
                password = v
    if port is None or not password:
        raise ValueError(f"Rcon.cfg missing Port/Password ({path})")
    return port, password


# ID: 0 | Online IDs: EOS: 0002abc... steam: 76561... | Name: Foo |
#   Team ID: 1 | Squad ID: 2 | Is Leader: True | Role: INS_Rifleman_01
_ACTIVE_RE = re.compile(
    r"ID:\s*(?P<id>\d+)\s*\|\s*Online IDs:(?P<ids>.*?)\|\s*Name:\s*(?P<name>.*?)\s*\|"
    r"\s*Team ID:\s*(?P<team>\d+)\s*\|\s*Squad ID:\s*(?P<squad>\S+)\s*\|"
    r"\s*Is Leader:\s*(?P<leader>\w+)\s*\|\s*Role:\s*(?P<role>\S*)"
)
# Recently Disconnected: ID: 5 | Online IDs: ... | Since Disconnect: 03m.44s | Name: Baz
_DISC_RE = re.compile(r"ID:\s*(?P<id>\d+)\s*\|\s*Online IDs:(?P<ids>.*?)\|.*?Name:\s*(?P<name>.*)")
_EOS_RE = re.compile(r"EOS:\s*([0-9a-fA-F]+)")


def _norm_name(s: str) -> str:
    # RCON pads some names with leading spaces; collapse whitespace + casefold
    # so "  AVCI06" and "AVCI06" match.
    return " ".join(str(s or "").split()).casefold()


def parse_listplayers(text: str) -> tuple[list[dict], list[dict]]:
    """Return (active, disconnected)."""
    active, disconnected = [], []
    in_disc = False
    for line in text.splitlines():
        if "Recently Disconnected" in line:
            in_disc = True
            continue
        if not in_disc:
            m = _ACTIVE_RE.search(line)
            if not m:
                continue
            eos_m = _EOS_RE.search(m.group("ids"))
            squad_raw = m.group("squad")
            active.append({
                "name": m.group("name").strip(),
                "nkey": _norm_name(m.group("name")),
                "eosId": (eos_m.group(1) if eos_m else "").lower(),
                "teamId": int(m.group("team")),
                "squadId": None if squad_raw.upper() in ("N/A", "NONE") else int(squad_raw),
                "isLeader": m.group("leader").strip().lower() == "true",
            })
        else:
            m = _DISC_RE.search(line)
            if m:
                disconnected.append({"name": m.group("name").strip(),
                                     "nkey": _norm_name(m.group("name"))})
    return active, disconnected


def fetch_snapshot(cmd: list[str]) -> dict:
    """One live snapshot straight from the reader. This build serves no HTTP
    snapshot endpoint, so we run `sqreader snapshot` (a one-shot memory read)
    and parse its JSON stdout. Run as root so it can read the game process."""
    out = subprocess.run(cmd, capture_output=True, text=True,
                         timeout=30, check=True).stdout
    return json.loads(out)


# ---- matching -----------------------------------------------------------
def match_players(snap_players: list[dict], rcon_players: list[dict]):
    """Pair snapshot players to RCON players. sqreader splits the clan tag
    off the name ("[owL] Foo" -> clanTag/"Foo") while RCON keeps the full
    name, so we match exact-name first, then fall back to a UNIQUE suffix
    match (RCON full name ends with the snapshot's bare name — clan tags are
    always a prefix). Returns (pairs, snap_only, rcon_only)."""
    used = set()
    pairs, snap_only = [], []
    rcon_by_name: dict[str, list] = {}
    for r in rcon_players:
        rcon_by_name.setdefault(r["nkey"], []).append(r)

    for s in snap_players:
        sk = _norm_name(s.get("name"))
        cands = [r for r in rcon_by_name.get(sk, []) if id(r) not in used]
        if cands:
            pairs.append((s, cands[0]))
            used.add(id(cands[0]))
        else:
            snap_only.append(s)

    remaining = [r for r in rcon_players if id(r) not in used]
    still: list[dict] = []
    for s in snap_only:
        sk = _norm_name(s.get("name"))
        if len(sk) < 3:
            still.append(s)
            continue
        cands = [r for r in remaining if id(r) not in used and r["nkey"].endswith(sk)]
        if len(cands) == 1:
            pairs.append((s, cands[0]))
            used.add(id(cands[0]))
        else:
            still.append(s)

    rcon_only = [r for r in rcon_players if id(r) not in used]
    return pairs, still, rcon_only


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, help="path to Rcon.cfg")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--snap-cmd", default="sqreader snapshot",
                    help="command that prints one JSON snapshot to stdout "
                         "(default %(default)r)")
    ap.add_argument("--show-raw-header", action="store_true",
                    help="print the first lines of ListPlayers to inspect format")
    args = ap.parse_args()

    port, password = read_rcon_config(args.config)
    rc = Rcon(args.host, port, password)
    try:
        raw = rc.command("ListPlayers")
    finally:
        rc.close()

    if args.show_raw_header:
        print("----- raw ListPlayers (first 8 lines) -----")
        for ln in raw.splitlines()[:8]:
            print("  " + ln[:160])
        print("-------------------------------------------")

    rcon_players, rcon_disc = parse_listplayers(raw)
    snap = fetch_snapshot(shlex.split(args.snap_cmd))
    snap_players = snap.get("players", [])
    disc_names = {d["nkey"] for d in rcon_disc}

    # SL ground truth from the snapshot: a player leads iff their _addr is
    # some squad's leaderStateAddr (exactly the frontend's derivation).
    leader_addrs = {sq.get("leaderStateAddr") for sq in snap.get("squads", [])
                    if sq.get("leaderStateAddr")}

    pairs, snap_only, rcon_only = match_players(snap_players, rcon_players)

    print(f"RCON: {len(rcon_players)} active (+{len(rcon_disc)} recently disconnected) | "
          f"snapshot(tick {snap.get('tick')}): {len(snap_players)} players | "
          f"matched: {len(pairs)}")

    print(f"\n[roster] RCON-only (snapshot MISSING these): {len(rcon_only)}")
    for r in sorted(rcon_only, key=lambda x: x["name"])[:25]:
        print(f"    - {r['name']}  (team {r['teamId']})")
    print(f"[roster] snapshot-only (not matched to RCON active): {len(snap_only)}")
    stale = 0
    for s in sorted(snap_only, key=lambda x: str(x.get("name")))[:40]:
        is_stale = _norm_name(s.get("name")) in disc_names
        stale += is_stale
        tag = " [RCON-disconnected → STALE]" if is_stale else ""
        print(f"    + {s.get('name')}{tag}")
    print(f"    ({stale} snapshot-only players are RCON-disconnected → stale PlayerStates)")

    team_mism, squad_mism, sl_mism = [], [], []
    for s, r in pairs:
        if r["teamId"] != s.get("teamId"):
            team_mism.append((r["name"], r["teamId"], s.get("teamId")))
        s_sq = s.get("squadId")
        s_sq = None if (s_sq in (0, None) or (isinstance(s_sq, int) and s_sq < 1)) else s_sq
        if r["squadId"] != s_sq:
            squad_mism.append((r["name"], r["squadId"], s_sq))
        snap_is_sl = s.get("_addr") in leader_addrs
        if r["isLeader"] != snap_is_sl:
            sl_mism.append((r["name"], r["isLeader"], snap_is_sl))

    print(f"\n[team]  mismatches: {len(team_mism)}")
    for name, rt, st in team_mism[:25]:
        print(f"    {name}: RCON team {rt} vs snapshot {st}")
    print(f"[squad] mismatches: {len(squad_mism)}")
    for name, rs, ss in squad_mism[:25]:
        print(f"    {name}: RCON squad {rs} vs snapshot {ss}")
    print(f"[SL]    mismatches: {len(sl_mism)}")
    for name, rl, sl in sl_mism[:25]:
        print(f"    {name}: RCON leader={rl} vs snapshot={sl}")

    n = len(pairs) or 1
    print(f"\nmatched: {len(pairs)} | team-ok: {len(pairs)-len(team_mism)} | "
          f"squad-ok: {len(pairs)-len(squad_mism)} | SL-ok: {len(pairs)-len(sl_mism)} "
          f"({100*(n-len(sl_mism))//n}%)")

    # eosId format observation (informational — not a match key)
    sample_snap_eos = next((p.get("eosId") for p in snap_players if p.get("eosId")), None)
    sample_rcon_eos = next((p["eosId"] for p in rcon_players if p["eosId"]), None)
    print(f"\n[eosId] snapshot sample: {sample_snap_eos!r}")
    print(f"[eosId] RCON     sample: {sample_rcon_eos!r}")
    print("[eosId] NOTE: snapshot emits Squad's dashed OnlineUserId, not the EOS PUID.")

    ok = not rcon_only and not team_mism and not squad_mism and not sl_mism
    print("\nRESULT:", "OK" if ok else "MISMATCH")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
