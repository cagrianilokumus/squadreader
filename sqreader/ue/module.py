"""
Wrapper for a binary module (executable or shared library) loaded in a
target process.

A `Module` bundles the file-backed mappings of one ELF in /proc/<pid>/maps
and exposes the standard segment views (text / rodata / data+bss).

We're targeting a non-PIE EXEC binary (Squad's SquadGameServer), so the
mappings appear in a deterministic order: one r--p (rodata-heavy), one
r-xp (.text), optionally another r--p (read-only relro), one rw-p
(.data+.bss). For shared libraries the same shape holds.
"""
from __future__ import annotations

import ntpath
import sys
from dataclasses import dataclass

from ..mem import MapRegion, ProcessMemory


@dataclass(frozen=True, slots=True)
class Module:
    """A loaded binary module identified by a substring of its pathname."""
    path: str
    base: int
    regions: tuple[MapRegion, ...]

    @property
    def text(self) -> MapRegion:
        """The (single) r-x mapping — the .text segment."""
        for r in self.regions:
            if r.executable and r.readable:
                return r
        raise RuntimeError(f"{self.path}: no executable region")

    @property
    def rodata_regions(self) -> tuple[MapRegion, ...]:
        """All r-- (read-only, non-exec) mappings — rodata, relro, etc."""
        return tuple(r for r in self.regions
                     if r.readable and not r.writable and not r.executable)

    @property
    def rw_region(self) -> MapRegion:
        """The rw-p mapping — .data + .bss live here for a non-PIE EXEC."""
        for r in self.regions:
            if r.writable and r.readable:
                return r
        raise RuntimeError(f"{self.path}: no writable region")

    def contains(self, addr: int) -> bool:
        return any(r.start <= addr < r.end for r in self.regions)

    def __repr__(self) -> str:
        return (f"Module({self.path!s} base={self.base:#x} "
                f"regions={len(self.regions)})")


def _windows_name_match(pathname: str, name: str) -> bool:
    """``name`` is the module's file name, with or without .exe/.dll."""
    base = ntpath.basename(pathname).lower()
    want = name.lower()
    return base in (want, want + ".exe", want + ".dll")


def load_module(pm: ProcessMemory, path_suffix: str) -> Module:
    """Build a Module from all /proc/<pid>/maps lines matching path_suffix.

    On Windows a bare name is matched against each image's FILE name first:
    every DLL a server loads sits under the install folder, and a folder that
    happens to be called ``SquadGameServer`` would otherwise drag all of them
    into the game module. The substring match remains the fallback.
    """
    regs: tuple[MapRegion, ...] = ()
    if sys.platform == "win32" and "\\" not in path_suffix and "/" not in path_suffix:
        regs = tuple(sorted(
            (r for r in pm.maps
             if r.inode != 0 and _windows_name_match(r.pathname, path_suffix)),
            key=lambda r: r.start,
        ))
    if not regs:
        regs = tuple(sorted(
            (r for r in pm.maps if path_suffix in r.pathname),
            key=lambda r: r.start,
        ))
    if not regs:
        raise RuntimeError(f"no mappings found for module {path_suffix!r}")
    return Module(path=regs[0].pathname, base=regs[0].start, regions=regs)


__all__ = ["Module", "load_module"]
