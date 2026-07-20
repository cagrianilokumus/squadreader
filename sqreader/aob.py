"""
AOB (Array-Of-Bytes) pattern scanner with wildcards.

Complements scanner.py: that module scans for concrete needles and
known-address xrefs (find_lea_rip_xrefs, find_movabs32_xrefs, ...),
this one scans for byte patterns with wildcards ("48 8B 1D ?? ?? ??
?? 90"). Useful when we know the *shape* of an instruction but not
the address it loads — the pre-condition for runtime offset drift
discovery when the signed offset-pack channel is unreachable.

Not wired into any live discovery path yet: this commit introduces
the primitives + tests only. A later commit will thread AOB scans
into the GObjects / FNamePool discovery fallbacks.

Pattern syntax:
    "48 8B 1D ?? ?? ?? ?? 90"   ← hex bytes; "??" or "?" = wildcard
    Spaces optional but recommended for readability.

Cross-project note: mirrors the API of
SQUAD-RECORDER/companion/reader/lib/aob_scanner.py so patterns
authored against that project port here without translation.
"""
from __future__ import annotations

import re
import struct
from dataclasses import dataclass
from typing import Iterator

from .mem import MapRegion, ProcessMemory


@dataclass(frozen=True, slots=True)
class Pattern:
    """Byte pattern with optional wildcards.

    bytes_: raw byte values; positions where the mask entry is False
            are ignored during matching (the byte value at those
            positions is arbitrary — 0x00 by convention).
    mask:   same length as bytes_; True = must-match, False = wildcard.
    name:   human label for debug / logging.
    """
    bytes_: bytes
    mask: tuple[bool, ...]
    name: str = ""

    def __len__(self) -> int:
        return len(self.bytes_)

    @classmethod
    def parse(cls, spec: str, name: str = "") -> "Pattern":
        """Parse a string like ``"48 8B 1D ?? ?? ?? ?? 90"`` into a Pattern.

        Whitespace-separated tokens; each token is either ``??`` / ``?``
        (wildcard) or a two-digit hex byte. Any other token raises
        ValueError; an empty spec is also rejected so a typo can't
        produce a match-anything pattern.
        """
        tokens = spec.replace("\t", " ").split()
        bs = bytearray()
        mask: list[bool] = []
        for tok in tokens:
            t = tok.strip()
            if t in ("?", "??"):
                bs.append(0x00)
                mask.append(False)
            elif re.fullmatch(r"[0-9A-Fa-f]{2}", t):
                bs.append(int(t, 16))
                mask.append(True)
            else:
                raise ValueError(f"bad pattern token {tok!r} in {spec!r}")
        if not bs:
            raise ValueError(f"empty pattern: {spec!r}")
        return cls(bytes(bs), tuple(mask), name)


# -- pure-bytes match helpers -------------------------------------------------

def match_at(haystack: bytes, offset: int, pattern: Pattern) -> bool:
    """Test whether pattern matches haystack at byte offset."""
    end = offset + len(pattern)
    if offset < 0 or end > len(haystack):
        return False
    pb = pattern.bytes_
    pm = pattern.mask
    for i in range(len(pattern)):
        if pm[i] and haystack[offset + i] != pb[i]:
            return False
    return True


def find_all(
    haystack: bytes, pattern: Pattern,
    start: int = 0, end: int | None = None,
) -> Iterator[int]:
    """Yield every offset in haystack[start:end] where pattern matches."""
    if end is None:
        end = len(haystack)
    plen = len(pattern)
    if plen == 0 or end - start < plen:
        return
    pb = pattern.bytes_
    pm = pattern.mask
    # First non-wildcard byte anchors a cheap pre-check so we skip most
    # positions without paying for the full mask loop.
    anchor_idx = next((i for i, m in enumerate(pm) if m), 0)
    anchor_byte = pb[anchor_idx]
    i = start
    while i + plen <= end:
        if haystack[i + anchor_idx] != anchor_byte:
            i += 1
            continue
        ok = True
        for j in range(plen):
            if pm[j] and haystack[i + j] != pb[j]:
                ok = False
                break
        if ok:
            yield i
        i += 1


def find_first(
    haystack: bytes, pattern: Pattern,
    start: int = 0, end: int | None = None,
) -> int | None:
    for off in find_all(haystack, pattern, start, end):
        return off
    return None


# -- RIP-relative resolution --------------------------------------------------

def resolve_rip_relative(
    instr_vma: int, instr_length: int, disp_bytes: bytes,
) -> int:
    """Compute the absolute target of an x86-64 RIP-relative instruction.

    Example — ``LEA rax, [rip + 0x12345678]`` encoded as
    ``48 8D 05 78 56 34 12`` (7 bytes total): instr_vma is the address
    of byte ``0x48``, instr_length is 7, disp_bytes is
    ``b"\\x78\\x56\\x34\\x12"`` (the 4-byte signed displacement).

    Returns ``instr_vma + instr_length + displacement_i32``.
    """
    if len(disp_bytes) != 4:
        raise ValueError(
            f"expected 4 displacement bytes, got {len(disp_bytes)}")
    disp = struct.unpack("<i", disp_bytes)[0]
    return instr_vma + instr_length + disp


# -- process-level scan helpers -----------------------------------------------

def scan_region(
    pm: ProcessMemory, region: MapRegion, pattern: Pattern,
    *, chunk_size: int = 1 << 20,
) -> Iterator[int]:
    """Yield absolute VMAs where pattern matches anywhere in region.

    Reads the region in ``chunk_size`` slices with a ``len(pattern)-1``
    overlap so a pattern straddling a chunk boundary still matches.
    Unreadable chunks are silently skipped — mirrors the behavior of
    ``ProcessMemory.iter_region_bytes``.
    """
    overlap = max(len(pattern) - 1, 0)
    pos = region.start
    end = region.end
    while pos < end:
        size = min(chunk_size + overlap, end - pos)
        try:
            chunk = pm.read(pos, size)
        except (OSError, OverflowError, ValueError):
            pos += chunk_size
            continue
        for rel in find_all(chunk, pattern):
            yield pos + rel
        pos += chunk_size


def scan_process(
    pm: ProcessMemory, pattern: Pattern, *,
    executable_only: bool = True,
    module_name: str | None = "SquadGameServer",
) -> Iterator[int]:
    """Yield every VMA in the process where pattern matches.

    Args:
      executable_only: limit to maps with 'x' permission (typical for
        code patterns). Set to False to scan .rodata or the heap.
      module_name: substring filter on ``region.pathname``. None
        disables the filter and scans every readable region — very
        slow (5s+ on a full server heap); use only for cold discovery.
    """
    for region in pm.maps:
        if not region.readable:
            continue
        if executable_only and not region.executable:
            continue
        if module_name is not None and module_name not in region.pathname:
            continue
        yield from scan_region(pm, region, pattern)


def find_first_in_process(
    pm: ProcessMemory, pattern: Pattern, **kwargs,
) -> int | None:
    for vma in scan_process(pm, pattern, **kwargs):
        return vma
    return None


__all__ = [
    "Pattern",
    "find_all",
    "find_first",
    "find_first_in_process",
    "match_at",
    "resolve_rip_relative",
    "scan_process",
    "scan_region",
]
