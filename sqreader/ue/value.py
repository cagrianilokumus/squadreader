"""
Typed-read helpers for the UE5 value types we need when materialising
fields out of a UObject instance.

Each helper takes a `ProcessMemory` and an absolute address, and returns
a Python value (or None on read failure / empty). They never raise on
unmapped memory — they return None and the caller decides whether that
field is omitted from the snapshot (no-guess policy).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Iterator

from ..mem import ProcessMemory


# ----- FVector (3 * double on UE5+ — used to be 3 * float in UE4) -----------
#
# UE 5.x changed FVector to double precision (FVector3d). Squad v10.4.1
# is on UE 5.7 so we use double. The legacy float form lives on as
# FVector3f for shader/visual code, but reflection still hands us the
# default FVector which is double-precision on 5.x.

FVECTOR_SIZE = 24


@dataclass(slots=True)
class FVector:
    x: float
    y: float
    z: float

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "z": self.z}


def read_fvector(pm: ProcessMemory, addr: int) -> FVector | None:
    data = pm.try_read(addr, FVECTOR_SIZE)
    if data is None or len(data) < FVECTOR_SIZE:
        return None
    x, y, z = struct.unpack("<ddd", data)
    return FVector(x, y, z)


# ----- FRotator (3 * double — Pitch, Yaw, Roll) -----------------------------

FROTATOR_SIZE = 24


@dataclass(slots=True)
class FRotator:
    pitch: float
    yaw: float
    roll: float


def read_frotator(pm: ProcessMemory, addr: int) -> FRotator | None:
    data = pm.try_read(addr, FROTATOR_SIZE)
    if data is None or len(data) < FROTATOR_SIZE:
        return None
    p, y, r = struct.unpack("<ddd", data)
    return FRotator(p, y, r)


# ----- FString (TArray<TCHAR>; TCHAR is UCS-2 on UE) ------------------------
#
# In-memory layout of FString:
#   +0   TCHAR* Data         (heap pointer; null if empty)
#   +8   int32  ArrayNum     (char count INCLUDING null terminator; 0 if empty)
#   +12  int32  ArrayMax     (capacity)
#
# When ArrayNum > 0 the buffer holds ArrayNum UCS-2 characters; the last
# is L'\0' so the visible string length is ArrayNum - 1.

FSTRING_SIZE = 16


def read_fstring(pm: ProcessMemory, addr: int,
                 *, max_chars: int = 256) -> str | None:
    """
    Read an FString value sitting at `addr`. Returns None on read failure;
    returns "" (empty string) for a properly empty FString.

    Hardening (2026-05-26 after SEGV in build_snapshot during a memory-
    pressure spike): the count field is parsed as a **signed** int32
    because Squad's UE5 builds occasionally hand us garbage from freed
    FString slots that decode as negative when read signed but as huge
    positive when read unsigned. The unsigned path would happily request
    a few-GB read attempt — fine in isolation, but on a populated server
    repeating that across 100+ player slots per tick walks glibc's heap
    arena and can null a Python object's tp_* slot, producing a SEGV at
    PC=0 several frames later in completely unrelated code. Conservative
    cap (max_chars=256) keeps the per-read budget bounded.
    """
    head = pm.try_read(addr, FSTRING_SIZE)
    if head is None or len(head) < FSTRING_SIZE:
        return None
    # signed int32 for ArrayNum — see docstring
    data_ptr, count, capacity = struct.unpack("<Qii", head)
    if count < 0 or count > 16384 or (count > 0 and data_ptr == 0):
        # Negative/huge count, or a claim of content with no backing
        # buffer, is freed-slot garbage — return null (no-guess), NOT "".
        # 16384 = 32 KB UTF-16, bigger than any legit Squad string field.
        return None
    if count == 0:
        return ""  # a genuinely empty string (distinct from unreadable)
    n = min(count, max_chars)
    raw = pm.try_read(data_ptr, n * 2)
    if raw is None:
        return None
    # strip the trailing NUL (ArrayNum includes it)
    try:
        text = raw.decode("utf-16-le", errors="replace").rstrip("\x00")
    except (UnicodeError, ValueError):
        return None
    return text


# ----- TArray<T> ------------------------------------------------------------
#
# Layout matches FString's buffer header — 16 bytes:
#   +0   T*    Data
#   +8   int32 ArrayNum
#   +12  int32 ArrayMax
#
# We don't decode T here; the caller knows the element size and decodes.

TARRAY_HEADER_SIZE = 16


@dataclass(slots=True)
class TArrayHeader:
    data_ptr: int
    count: int
    capacity: int


def read_tarray_header(pm: ProcessMemory, addr: int) -> TArrayHeader | None:
    head = pm.try_read(addr, TARRAY_HEADER_SIZE)
    if head is None or len(head) < TARRAY_HEADER_SIZE:
        return None
    data_ptr, count, capacity = struct.unpack("<QII", head)
    # Plausibility gate (no-guess): a freed/torn header can decode to a huge
    # count (read unsigned) which callers would otherwise show verbatim as a
    # ~4-billion playerCount/slotCount. No Squad array is anywhere near 1M.
    if count > 1_000_000 or capacity < count:
        return None
    return TArrayHeader(data_ptr, count, capacity)


def iter_tarray_pointers(pm: ProcessMemory, addr: int) -> Iterator[int]:
    """
    Iterate a TArray<UObject*> (or any TArray of 8-byte pointers).
    Yields each pointer value. Skips reads that fail.
    """
    hdr = read_tarray_header(pm, addr)
    if hdr is None or hdr.count <= 0 or hdr.data_ptr == 0:
        return
    raw = pm.try_read(hdr.data_ptr, hdr.count * 8)
    if raw is None:
        return
    # A read straddling a mapping boundary comes back SHORT (os.pread returns
    # the mapped prefix); clamp to the bytes we actually got so unpack_from
    # can't run past the buffer and raise struct.error up an unguarded caller.
    n = min(hdr.count, len(raw) // 8)
    for i in range(n):
        yield struct.unpack_from("<Q", raw, i * 8)[0]


# ----- FWeakObjectPtr -------------------------------------------------------
#
# In memory:
#   +0  int32 ObjectIndex
#   +4  int32 ObjectSerialNumber
#
# To dereference: look up FUObjectItem at ObjectIndex; if its SerialNumber
# matches, the Object pointer is still valid. (Otherwise the original
# pointee was GC'd and the index now refers to a different object.)

FWEAKOBJECTPTR_SIZE = 8


@dataclass(slots=True)
class FWeakObjectPtr:
    object_index: int
    serial_number: int


def read_fweak_object_ptr(pm: ProcessMemory, addr: int) -> FWeakObjectPtr | None:
    data = pm.try_read(addr, FWEAKOBJECTPTR_SIZE)
    if data is None or len(data) < FWEAKOBJECTPTR_SIZE:
        return None
    idx, serial = struct.unpack("<ii", data)
    return FWeakObjectPtr(idx, serial)


# ----- FText ----------------------------------------------------------------
#
# FText in UE 5.x:
#   class FText {
#       TSharedRef<ITextData, ESPMode::ThreadSafe> TextData;  // 16 bytes
#       int32 Flags;
#   };
#
# TextData (8 bytes at +0) points to an FTextData subclass. The concrete
# layout varies by FTextHistory type, but for FTextHistory_Base — the
# common "simple string set on the server" case — there is an FString
# member ("TextSource") at +0x20 of FTextData. Empirically verified on
# SQGameState.MapName which holds e.g. "PacificProvingGrounds Seed v1".
#
# We return None if the layout doesn't match (no-guess policy). Other
# FText subclasses (Format, NamedFormat, AsCurrency, ...) need their own
# decode and aren't supported here yet.

FTEXT_SIZE = 24
FTEXTDATA_TEXTSOURCE_OFFSET = 0x20


def read_ftext(pm: ProcessMemory, addr: int,
               *, ftextdata_offset: int = FTEXTDATA_TEXTSOURCE_OFFSET
               ) -> str | None:
    """
    Read an FText sitting at `addr`. Returns the underlying display
    string for FTextHistory_Base instances, or None for unsupported
    FText variants / unreadable memory.
    """
    head = pm.try_read(addr, 8)
    if head is None or len(head) < 8:
        return None
    text_data_ptr = struct.unpack("<Q", head)[0]
    if text_data_ptr == 0:
        return None
    # The FString TextSource lives at +0x20 within FTextData for the
    # common FTextHistory_Base layout. Try reading; if the values look
    # implausible, give up rather than guess.
    return read_fstring(pm, text_data_ptr + ftextdata_offset)


__all__ = [
    "FVector", "read_fvector", "FVECTOR_SIZE",
    "FRotator", "read_frotator", "FROTATOR_SIZE",
    "read_fstring", "FSTRING_SIZE",
    "read_ftext", "FTEXT_SIZE", "FTEXTDATA_TEXTSOURCE_OFFSET",
    "TArrayHeader", "read_tarray_header", "iter_tarray_pointers", "TARRAY_HEADER_SIZE",
    "FWeakObjectPtr", "read_fweak_object_ptr", "FWEAKOBJECTPTR_SIZE",
]
