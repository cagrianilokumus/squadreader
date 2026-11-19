"""The Windows memory backend against real processes.

Everything else in the suite drives ProcessMemory through FakeProcessMemory.
These tests are the exception on purpose: the point of winproc is how the
Win32 calls behave, which no fake can say. They read this interpreter and a
child interpreter whose memory holds a known marker, so no game is needed.
Skipped off Windows, where the procfs path is the one in use.
"""
from __future__ import annotations

import ctypes
import os
import subprocess
import sys

import pytest

pytestmark = pytest.mark.skipif(sys.platform != "win32",
                                reason="Windows memory backend")

from sqreader import procinfo, winproc  # noqa: E402
from sqreader.mem import ProcessMemory, parse_maps  # noqa: E402
from sqreader.ue.module import load_module  # noqa: E402

_MARKER = b"sqreader-winproc-probe:\x00\x01\x02\xfe\xff"

# Inside a venv, sys.executable is a redirector that runs the real interpreter
# as ITS child, so the PID Popen returns would not hold the marker. That is the
# launcher-vs-game trap config._is_game_binary_windows guards against, in
# miniature. The child needs nothing but ctypes, so run the base interpreter.
_PYTHON = getattr(sys, "_base_executable", None) or sys.executable

_CHILD = f"""
import ctypes, sys
buf = ctypes.create_string_buffer({_MARKER!r}, {len(_MARKER)})
print(ctypes.addressof(buf), flush=True)
sys.stdin.readline()
"""


@pytest.fixture
def child():
    """A second interpreter parked with the marker in its heap."""
    proc = subprocess.Popen([_PYTHON, "-c", _CHILD, "Port=7787"],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            text=True)
    try:
        addr = int(proc.stdout.readline())
        yield proc, addr
    finally:
        if proc.poll() is None:
            proc.stdin.write("\n")
            proc.stdin.flush()
        proc.wait(timeout=10)


def test_reads_own_process():
    buf = ctypes.create_string_buffer(_MARKER, len(_MARKER))
    with ProcessMemory(os.getpid()) as pm:
        assert pm.read(ctypes.addressof(buf), len(_MARKER)) == _MARKER


def test_reads_another_process(child):
    proc, addr = child
    with ProcessMemory(proc.pid) as pm:
        assert pm.read(addr, len(_MARKER)) == _MARKER
        assert pm.read_u8(addr) == _MARKER[0]
        assert pm.read_cstring(addr) == "sqreader-winproc-probe:"
        assert pm.read_many([(addr, 8), (addr + 8, 8)]) == [
            _MARKER[:8], _MARKER[8:16]]


def test_marker_lives_in_an_anonymous_rw_region(child):
    """UE's allocators hand out MEM_PRIVATE memory; it must read as the
    'anonymous writable' regions the heap scanners walk."""
    proc, addr = child
    with ProcessMemory(proc.pid) as pm:
        r = pm.region_for(addr)
        assert r is not None
        assert r.readable and r.writable and r.is_anonymous
        assert r in pm.writable_anon_regions()


def test_exe_image_is_a_named_module(child):
    proc, _ = child
    exe = os.path.basename(_PYTHON)
    with ProcessMemory(proc.pid) as pm:
        mod = load_module(pm, exe)
        assert mod.path.lower().endswith(exe.lower())
        assert mod.text.executable and mod.text.readable
        assert pm.module_base(exe) == mod.base
        # Image regions are never mistaken for heap.
        assert all(not r.is_anonymous for r in mod.regions)


def test_parse_maps_matches_instance_maps(child):
    proc, _ = child
    with ProcessMemory(proc.pid) as pm:
        mine = {(r.start, r.end) for r in pm.maps}
    theirs = {(r.start, r.end) for r in parse_maps(proc.pid)}
    # Two snapshots of a live process: allow churn, demand near-identity.
    assert len(mine & theirs) >= 0.9 * len(mine)


def test_unmapped_reads_fail_like_procfs():
    with ProcessMemory(os.getpid()) as pm:
        # The bottom 64 KiB of a Windows address space is never mapped.
        assert pm.try_read(0x1000, 8) is None
        with pytest.raises(OSError):
            pm.read(0x1000, 8)


def test_read_across_region_end_comes_back_short():
    """pread stops at the end of a mapping; ReadProcessMemory refuses the whole
    request. The backend must return the readable prefix, as pread would."""
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.VirtualAlloc.restype = ctypes.c_void_p
    k32.VirtualAlloc.argtypes = [ctypes.c_void_p, ctypes.c_size_t,
                                 ctypes.c_uint32, ctypes.c_uint32]
    k32.VirtualProtect.argtypes = [ctypes.c_void_p, ctypes.c_size_t,
                                   ctypes.c_uint32,
                                   ctypes.POINTER(ctypes.c_uint32)]
    k32.VirtualFree.argtypes = [ctypes.c_void_p, ctypes.c_size_t,
                                ctypes.c_uint32]
    page = 0x1000
    base = k32.VirtualAlloc(None, 2 * page, 0x3000, 0x04)  # COMMIT|RESERVE, RW
    assert base
    try:
        old = ctypes.c_uint32(0)
        assert k32.VirtualProtect(base + page, page, 0x01, ctypes.byref(old))
        ctypes.memset(base, 0x5A, page)
        with ProcessMemory(os.getpid()) as pm:
            got = pm.read(base + page - 16, 64)
            assert got == b"\x5a" * 16
            assert pm.try_read(base + page, 8) is None
    finally:
        k32.VirtualFree(base, 0, 0x8000)                   # MEM_RELEASE


def test_process_identity(child):
    proc, _ = child
    img = winproc.image_path(proc.pid)
    assert img and os.path.samefile(img, _PYTHON)
    assert procinfo.exe_path(proc.pid) == img
    args = winproc.command_line(proc.pid)
    assert args is not None and args[-1] == "Port=7787" and "-c" in args
    assert proc.pid in {e.pid for e in winproc.list_processes()}
    assert procinfo.pid_alive(proc.pid)


def test_gone_process_is_reported_gone(child):
    proc, _ = child
    pid = proc.pid
    proc.stdin.write("\n")
    proc.stdin.flush()
    proc.wait(timeout=10)
    assert not procinfo.pid_alive(pid)
    with pytest.raises(FileNotFoundError):
        ProcessMemory(pid)


def test_handle_is_read_only(child):
    """The guarantee the module docstring makes, checked against the kernel:
    a write through the reader's own handle is refused."""
    proc, addr = child
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.WriteProcessMemory.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_size_t)]
    with ProcessMemory(proc.pid) as pm:
        pm.read(addr, 1)                                   # opens the handle
        data = ctypes.create_string_buffer(b"X")
        n = ctypes.c_size_t(0)
        assert not k32.WriteProcessMemory(pm._fd, addr, data, 1,
                                          ctypes.byref(n))
        assert ctypes.get_last_error() == 5                # ACCESS_DENIED
        assert pm.read(addr, len(_MARKER)) == _MARKER
