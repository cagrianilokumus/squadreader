"""
Pattern scanning over a target process's memory.

Used for:
- Locating known FName strings (e.g. "SQVehicle") in the heap to anchor
  FNamePool discovery.
- Future: locating IDA-style byte signatures in .text to find code that
  references global symbols like GUObjectArray.

Performance notes:
- bytes.find on a 1 MiB chunk is ~1 GB/s in CPython; the 5 GB Squad server RW
  footprint scans in ~5–6 seconds. Fast enough for one-shot anchoring;
  too slow for per-snapshot use. Anchoring happens once at startup.
"""
from __future__ import annotations

import struct
from collections.abc import Iterable
from typing import NamedTuple

from .mem import MapRegion, ProcessMemory


class Hit(NamedTuple):
    addr: int
    region: MapRegion


def find_in_regions(
    pm: ProcessMemory,
    needle: bytes,
    regions: Iterable[MapRegion],
    *,
    max_hits: int | None = None,
    chunk: int = 1 << 20,
) -> list[Hit]:
    """
    Scan `regions` for every occurrence of `needle`.

    Uses overlapping chunks so matches that straddle a chunk boundary aren't
    missed: we re-read (len(needle)-1) bytes into the next chunk.
    """
    if not needle:
        raise ValueError("needle must be non-empty")
    n = len(needle)
    overlap = n - 1
    hits: list[Hit] = []

    for region in regions:
        carry = b""
        carry_addr = region.start
        for addr, data in pm.iter_region_bytes(region, chunk=chunk):
            if carry:
                if addr == carry_addr + len(carry):
                    buf = carry + data
                    base = carry_addr
                else:
                    # gap: drop carry, start fresh
                    buf = data
                    base = addr
            else:
                buf = data
                base = addr

            pos = 0
            while True:
                i = buf.find(needle, pos)
                if i < 0:
                    break
                hits.append(Hit(base + i, region))
                if max_hits is not None and len(hits) >= max_hits:
                    return hits
                pos = i + 1

            # keep the tail in case the needle spans into the next chunk
            if len(buf) >= overlap:
                carry = buf[-overlap:] if overlap > 0 else b""
                carry_addr = base + len(buf) - len(carry)
            else:
                carry = buf
                carry_addr = base

    return hits


def find_ascii(
    pm: ProcessMemory,
    text: str,
    *,
    region_filter: str = "anon_rw",
    max_hits: int | None = None,
) -> list[Hit]:
    """
    Convenience: scan for an ASCII string in the chosen region set.

    region_filter:
      "anon_rw"  — anonymous writable regions (heap, FName pool, etc.)
      "all_r"    — every readable region
      "module"   — file-backed mappings (binary + .so files)
    """
    needle = text.encode("ascii")
    match region_filter:
        case "anon_rw":
            regions = pm.writable_anon_regions()
        case "all_r":
            regions = [r for r in pm.maps if r.readable]
        case "module":
            regions = [r for r in pm.maps if r.readable and r.inode != 0]
        case _:
            raise ValueError(f"unknown region_filter: {region_filter}")
    return find_in_regions(pm, needle, regions, max_hits=max_hits)


def find_lea_rip_xrefs(
    pm: ProcessMemory,
    text_region: MapRegion,
    target_addr: int,
) -> list[int]:
    """
    Locate every `LEA r64, [rip + disp32]` instruction inside `text_region`
    whose effective address resolves to `target_addr`.

    Returns the runtime addresses of the LEA instructions themselves
    (so the caller can disassemble around them).

    Encodings matched:
        48 8D /r [RIP+disp32]   — REX.W LEA, destination is RAX..RDI
        4C 8D /r [RIP+disp32]   — REX.W+REX.R LEA, destination is R8..R15

    The ModR/M byte for `[RIP + disp32]` always has mod=00, rm=101.
    We accept any reg field (the destination register doesn't matter for
    locating the xref).
    """
    text = pm.read(text_region.start, text_region.size)
    out: list[int] = []
    for rex_byte in (0x48, 0x4C):
        pat = bytes([rex_byte, 0x8D])
        pos = 0
        while True:
            i = text.find(pat, pos)
            if i < 0:
                break
            pos = i + 1
            if i + 7 > len(text):
                break
            modrm = text[i + 2]
            if modrm & 0xC7 != 0x05:
                continue
            disp = struct.unpack_from("<i", text, i + 3)[0]
            ip = text_region.start + i
            if ip + 7 + disp == target_addr:
                out.append(ip)
    return out


def find_movabs32_xrefs(
    pm: ProcessMemory,
    text_region: MapRegion,
    target_addr: int,
) -> list[int]:
    """
    Locate every `MOV r32, imm32` (or with REX.B prefix for R8d..R15d) inside
    `text_region` where the 32-bit immediate equals `target_addr & 0xFFFFFFFF`.

    Why this exists: in non-PIE x86_64 binaries the compiler prefers this
    5-byte encoding (zero-extended to 64 bits) over the 7-byte LEA-RIP form
    when the target address fits in 32 bits. Squad's binary is non-PIE and
    every static .rodata address is < 4 GB, so MOST address loads use this
    encoding, not LEA-RIP.

    Encodings matched:
        B8+r imm32      — MOV EAX..EDI, imm32                 (5 bytes)
        41 B8+r imm32   — MOV R8D..R15D, imm32 (with REX.B)   (6 bytes)

    Returns the runtime address of the MOV instruction itself.
    """
    text = pm.read(text_region.start, text_region.size)
    target_le = struct.pack("<I", target_addr & 0xFFFFFFFF)
    out: list[int] = []

    # No-REX: opcode is in [0xB8..0xBF], imm32 immediately follows.
    pos = 0
    while True:
        i = text.find(target_le, pos)
        if i < 0:
            break
        pos = i + 1
        if i < 1:
            continue
        op = text[i - 1]
        if 0xB8 <= op <= 0xBF:
            # 5-byte MOV r32, imm32
            ip = text_region.start + i - 1
            # Distinguish from REX.B prefix case below: only count when prev
            # byte is NOT 0x41 (otherwise the REX.B branch will catch it).
            if i < 2 or text[i - 2] != 0x41:
                out.append(ip)

    # REX.B (0x41): opcode 0xB8..0xBF means R8D..R15D.
    pos = 0
    while True:
        i = text.find(target_le, pos)
        if i < 0:
            break
        pos = i + 1
        if i < 2:
            continue
        if text[i - 2] == 0x41 and 0xB8 <= text[i - 1] <= 0xBF:
            ip = text_region.start + i - 2
            out.append(ip)

    return out


def find_mov_rip_xrefs(
    pm: ProcessMemory,
    text_region: MapRegion,
    target_addr: int,
) -> list[int]:
    """
    Locate every `MOV r64, [rip + disp32]` (load) or
    `MOV [rip + disp32], r64` (store) whose target resolves to `target_addr`.

    Encodings matched:
        48 8B /r [RIP+disp32]   — load: MOV r64, [mem]
        48 89 /r [RIP+disp32]   — store: MOV [mem], r64
        4C 8B / 4C 89           — same but for R8..R15
    """
    text = pm.read(text_region.start, text_region.size)
    out: list[int] = []
    for rex_byte in (0x48, 0x4C):
        for opcode in (0x8B, 0x89):
            pat = bytes([rex_byte, opcode])
            pos = 0
            while True:
                i = text.find(pat, pos)
                if i < 0:
                    break
                pos = i + 1
                if i + 7 > len(text):
                    break
                modrm = text[i + 2]
                if modrm & 0xC7 != 0x05:
                    continue
                disp = struct.unpack_from("<i", text, i + 3)[0]
                ip = text_region.start + i
                if ip + 7 + disp == target_addr:
                    out.append(ip)
    return out


__all__ = [
    "Hit",
    "find_ascii",
    "find_in_regions",
    "find_lea_rip_xrefs",
    "find_movabs32_xrefs",
    "find_mov_rip_xrefs",
]
