"""Windows counterpart of the ``/proc`` reads the rest of the reader relies on.

On Linux the reader learns everything about the game process from procfs:
``/proc/<pid>/maps`` for the address-space layout, ``/proc/<pid>/mem`` for the
bytes, ``/proc/<pid>/exe`` and ``cmdline`` for which server it is. Windows has
no procfs, so this module asks the kernel directly through the Win32 API:

    /proc/<pid>/mem       ->  OpenProcess + ReadProcessMemory
    /proc/<pid>/maps      ->  VirtualQueryEx (+ EnumProcessModulesEx for names)
    /proc/<pid>/exe       ->  QueryFullProcessImageNameW
    /proc/<pid>/cmdline   ->  NtQueryInformationProcess(ProcessCommandLine)
    /proc listing         ->  CreateToolhelp32Snapshot
    /proc/<pid> exists    ->  OpenProcess + WaitForSingleObject(0)

Read-only by design, exactly like mem.py: the process handle is opened with
PROCESS_VM_READ | PROCESS_QUERY_INFORMATION and nothing else. Without
PROCESS_VM_WRITE / PROCESS_VM_OPERATION the kernel refuses any write through
that handle, so a bug here cannot corrupt a live match.

Every function exists on every platform so callers and type-checkers see one
API; off Windows they raise OSError. The ctypes bindings are built lazily on
first use, so importing this module on Linux costs nothing.
"""
from __future__ import annotations

import errno
import sys
from types import SimpleNamespace
from typing import Any, NamedTuple

# Access rights. Deliberately no PROCESS_VM_WRITE (0x20) / VM_OPERATION (0x08).
PROCESS_VM_READ = 0x0010
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
SYNCHRONIZE = 0x00100000
READ_ACCESS = PROCESS_VM_READ | PROCESS_QUERY_INFORMATION

# VirtualQueryEx MEMORY_BASIC_INFORMATION.State / .Type / .Protect values.
MEM_COMMIT = 0x1000
MEM_PRIVATE = 0x20000
MEM_MAPPED = 0x40000
MEM_IMAGE = 0x1000000
PAGE_GUARD = 0x100

# Win32 error codes this module reacts to.
ERROR_ACCESS_DENIED = 5
ERROR_INVALID_HANDLE = 6
ERROR_INVALID_PARAMETER = 87
ERROR_PARTIAL_COPY = 299

WAIT_TIMEOUT = 0x102
STATUS_INFO_LENGTH_MISMATCH = 0xC0000004
_PROCESS_COMMAND_LINE_INFORMATION = 60      # PROCESSINFOCLASS, Windows 8.1+
_LIST_MODULES_ALL = 0x03
_TH32CS_SNAPPROCESS = 0x00000002

# Highest user-mode address on x64 Windows (0x7FFF'FFFE'FFFF).
_USER_SPACE_END = 0x7FFF_FFFF_0000

#: Protect (low byte) -> the rwx triplet of a /proc/<pid>/maps line.
_PROTECT_PERMS = {
    0x01: "---",    # PAGE_NOACCESS
    0x02: "r--",    # PAGE_READONLY
    0x04: "rw-",    # PAGE_READWRITE
    0x08: "rw-",    # PAGE_WRITECOPY
    0x10: "--x",    # PAGE_EXECUTE
    0x20: "r-x",    # PAGE_EXECUTE_READ
    0x40: "rwx",    # PAGE_EXECUTE_READWRITE
    0x80: "rwx",    # PAGE_EXECUTE_WRITECOPY
}


class ProcEntry(NamedTuple):
    """One row of the process list: what Toolhelp32 knows without a handle."""
    pid: int
    ppid: int
    exe_name: str          # bare file name, e.g. "SquadGameServer.exe"


def _not_windows() -> OSError:
    return OSError(errno.ENOSYS, "winproc is only available on Windows")


_api_cache: Any = None


def _api() -> Any:
    """Bind the handful of kernel32/ntdll/shell32/advapi32 calls used here."""
    global _api_cache
    if sys.platform != "win32":
        raise _not_windows()
    if _api_cache is not None:
        return _api_cache

    import ctypes
    from ctypes import wintypes

    class MEMORY_BASIC_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BaseAddress", ctypes.c_void_p),
            ("AllocationBase", ctypes.c_void_p),
            ("AllocationProtect", wintypes.DWORD),
            ("PartitionId", wintypes.WORD),
            ("RegionSize", ctypes.c_size_t),
            ("State", wintypes.DWORD),
            ("Protect", wintypes.DWORD),
            ("Type", wintypes.DWORD),
        ]

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        ]

    class LUID(ctypes.Structure):
        _fields_ = [("LowPart", wintypes.DWORD), ("HighPart", wintypes.LONG)]

    class TOKEN_PRIVILEGES(ctypes.Structure):
        _fields_ = [
            ("PrivilegeCount", wintypes.DWORD),
            ("Luid", LUID),
            ("Attributes", wintypes.DWORD),
        ]

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    ntdll = ctypes.WinDLL("ntdll")
    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)

    k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k32.OpenProcess.restype = wintypes.HANDLE
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    k32.CloseHandle.restype = wintypes.BOOL
    k32.GetCurrentProcess.argtypes = []
    k32.GetCurrentProcess.restype = wintypes.HANDLE
    k32.ReadProcessMemory.argtypes = [
        wintypes.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_size_t)]
    k32.ReadProcessMemory.restype = wintypes.BOOL
    k32.VirtualQueryEx.argtypes = [
        wintypes.HANDLE, ctypes.c_void_p,
        ctypes.POINTER(MEMORY_BASIC_INFORMATION), ctypes.c_size_t]
    k32.VirtualQueryEx.restype = ctypes.c_size_t
    k32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD)]
    k32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    k32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    k32.WaitForSingleObject.restype = wintypes.DWORD
    k32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    k32.Process32FirstW.argtypes = [
        wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    k32.Process32FirstW.restype = wintypes.BOOL
    k32.Process32NextW.argtypes = [
        wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    k32.Process32NextW.restype = wintypes.BOOL
    k32.K32EnumProcessModulesEx.argtypes = [
        wintypes.HANDLE, ctypes.POINTER(wintypes.HMODULE), wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD), wintypes.DWORD]
    k32.K32EnumProcessModulesEx.restype = wintypes.BOOL
    k32.K32GetModuleFileNameExW.argtypes = [
        wintypes.HANDLE, wintypes.HMODULE, wintypes.LPWSTR, wintypes.DWORD]
    k32.K32GetModuleFileNameExW.restype = wintypes.DWORD
    k32.LocalFree.argtypes = [ctypes.c_void_p]
    k32.LocalFree.restype = ctypes.c_void_p

    ntdll.NtQueryInformationProcess.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.ULONG,
        ctypes.POINTER(wintypes.ULONG)]
    ntdll.NtQueryInformationProcess.restype = ctypes.c_long

    shell32.CommandLineToArgvW.argtypes = [
        wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
    shell32.CommandLineToArgvW.restype = ctypes.POINTER(wintypes.LPWSTR)

    advapi32.OpenProcessToken.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    advapi32.LookupPrivilegeValueW.argtypes = [
        wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.POINTER(LUID)]
    advapi32.LookupPrivilegeValueW.restype = wintypes.BOOL
    advapi32.AdjustTokenPrivileges.argtypes = [
        wintypes.HANDLE, wintypes.BOOL, ctypes.POINTER(TOKEN_PRIVILEGES),
        wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p]
    advapi32.AdjustTokenPrivileges.restype = wintypes.BOOL

    api = SimpleNamespace(
        ctypes=ctypes, wintypes=wintypes,
        k32=k32, ntdll=ntdll, shell32=shell32, advapi32=advapi32,
        MBI=MEMORY_BASIC_INFORMATION, PE32=PROCESSENTRY32W,
        LUID=LUID, TOKEN_PRIVILEGES=TOKEN_PRIVILEGES,
        INVALID_HANDLE=ctypes.c_void_p(-1).value,
    )
    _api_cache = api
    return api


# -- privileges -----------------------------------------------------------------

_debug_privilege_tried = False


def _enable_debug_privilege() -> bool:
    """Turn on SeDebugPrivilege for this process, if the token holds it.

    An elevated administrator (or the LocalSystem service account) holds the
    privilege but has it disabled by default, and without it OpenProcess on a
    game started by ANOTHER user is refused. This only flips the switch on a
    privilege the account already has; it grants nothing new. Tried once.
    """
    global _debug_privilege_tried
    if _debug_privilege_tried:
        return False
    _debug_privilege_tried = True
    a = _api()
    TOKEN_ADJUST_PRIVILEGES, TOKEN_QUERY = 0x0020, 0x0008
    SE_PRIVILEGE_ENABLED = 0x00000002
    token = a.wintypes.HANDLE()
    if not a.advapi32.OpenProcessToken(
            a.k32.GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY,
            a.ctypes.byref(token)):
        return False
    try:
        luid = a.LUID()
        if not a.advapi32.LookupPrivilegeValueW(
                None, "SeDebugPrivilege", a.ctypes.byref(luid)):
            return False
        tp = a.TOKEN_PRIVILEGES(1, luid, SE_PRIVILEGE_ENABLED)
        if not a.advapi32.AdjustTokenPrivileges(
                token, False, a.ctypes.byref(tp), 0, None, None):
            return False
        # AdjustTokenPrivileges "succeeds" with ERROR_NOT_ALL_ASSIGNED (1300)
        # when the token does not hold the privilege at all.
        return a.ctypes.get_last_error() == 0
    finally:
        a.k32.CloseHandle(token)


# -- handles --------------------------------------------------------------------

def _open(pid: int, access: int) -> int:
    a = _api()
    h = a.k32.OpenProcess(access, False, pid)
    if h:
        return int(h)
    err = a.ctypes.get_last_error()
    if err == ERROR_ACCESS_DENIED and _enable_debug_privilege():
        h = a.k32.OpenProcess(access, False, pid)
        if h:
            return int(h)
        err = a.ctypes.get_last_error()
    if err == ERROR_INVALID_PARAMETER:
        raise FileNotFoundError(errno.ENOENT, f"no such process: {pid}")
    if err == ERROR_ACCESS_DENIED:
        raise PermissionError(
            errno.EACCES,
            f"OpenProcess({pid}) refused: run the reader as the same user as "
            f"the game, or as an administrator")
    raise OSError(errno.EIO, f"OpenProcess({pid}) failed: winerror {err}")


def open_for_read(pid: int) -> int:
    """A read-only handle on ``pid``'s address space (see module docstring)."""
    return _open(pid, READ_ACCESS)


def close_handle(handle: int) -> None:
    if sys.platform != "win32":
        raise _not_windows()
    _api().k32.CloseHandle(handle)


# -- memory ---------------------------------------------------------------------

def _query(a: Any, handle: int, addr: int) -> Any:
    mbi = a.MBI()
    got = a.k32.VirtualQueryEx(handle, addr, a.ctypes.byref(mbi),
                               a.ctypes.sizeof(mbi))
    return mbi if got else None


def _readable(mbi: Any) -> bool:
    if mbi.State != MEM_COMMIT or mbi.Protect & PAGE_GUARD:
        return False
    return _PROTECT_PERMS.get(mbi.Protect & 0xFF, "---")[0] == "r"


def read(handle: int, addr: int, size: int) -> bytes:
    """Read ``size`` bytes at ``addr``. Mirrors pread on /proc/<pid>/mem.

    A read that runs off the end of a readable region comes back SHORT, the
    way pread does on Linux, rather than failing outright: ReadProcessMemory
    rejects the whole request with ERROR_PARTIAL_COPY, so it is retried once,
    clamped to the end of the region holding ``addr``. Nothing readable at
    ``addr`` raises OSError, which every caller already treats as "unmapped".
    """
    a = _api()
    buf = a.ctypes.create_string_buffer(size)
    n = a.ctypes.c_size_t(0)
    if a.k32.ReadProcessMemory(handle, addr, buf, size, a.ctypes.byref(n)):
        return buf.raw[:n.value]
    err = a.ctypes.get_last_error()
    if n.value:
        return buf.raw[:n.value]
    if err == ERROR_INVALID_HANDLE:
        raise OSError(errno.EBADF, "process handle is no longer valid")
    if err == ERROR_PARTIAL_COPY:
        mbi = _query(a, handle, addr)
        if mbi is not None and _readable(mbi):
            region_end = (mbi.BaseAddress or 0) + mbi.RegionSize
            want = min(size, region_end - addr)
            if 0 < want < size and a.k32.ReadProcessMemory(
                    handle, addr, buf, want, a.ctypes.byref(n)):
                return buf.raw[:n.value]
    raise OSError(errno.EIO,
                  f"ReadProcessMemory({addr:#x}, {size}) failed: winerror {err}")


def _module_paths(a: Any, handle: int) -> dict[int, str]:
    """{module base: full path} for every module loaded in the process."""
    wt = a.wintypes
    needed = wt.DWORD(0)
    count = 512
    while True:
        mods = (wt.HMODULE * count)()
        if not a.k32.K32EnumProcessModulesEx(
                handle, mods, a.ctypes.sizeof(mods), a.ctypes.byref(needed),
                _LIST_MODULES_ALL):
            return {}
        got = needed.value // a.ctypes.sizeof(wt.HMODULE)
        if got <= count:
            break
        count = got + 64           # modules loaded meanwhile: ask again
    out: dict[int, str] = {}
    name = a.ctypes.create_unicode_buffer(32768)
    for hmod in mods[:got]:
        if not hmod:
            continue
        if a.k32.K32GetModuleFileNameExW(handle, hmod, name, len(name)):
            out[int(hmod)] = name.value
    return out


def query_regions(handle: int) -> list[tuple[int, int, str, int, str, int, str]]:
    """The committed address space as /proc/<pid>/maps-shaped tuples.

    Each tuple is ``(start, end, perms, offset, dev, inode, pathname)``, the
    field order of mem.MapRegion, so the rest of the reader keeps its Linux
    vocabulary:

    * ``MEM_PRIVATE`` (VirtualAlloc'd heaps, where UE's allocators live) gets
      an empty pathname and inode 0, i.e. ``MapRegion.is_anonymous``;
    * ``MEM_IMAGE`` (the .exe and its DLLs) carries the module's full path and
      a non-zero inode, so substring lookups such as "SquadGameServer" find
      it, and ``offset`` is the region's RVA within that image;
    * ``MEM_MAPPED`` (file mappings, shared memory) is labelled ``[mapped]``.

    Reserved and free ranges are left out, as they are absent from maps too.
    """
    a = _api()
    modules = _module_paths(a, handle)
    out: list[tuple[int, int, str, int, str, int, str]] = []
    mbi = a.MBI()
    size = a.ctypes.sizeof(mbi)
    addr = 0
    while addr < _USER_SPACE_END:
        if not a.k32.VirtualQueryEx(handle, addr, a.ctypes.byref(mbi), size):
            break
        base = mbi.BaseAddress or 0
        length = mbi.RegionSize
        if length <= 0:
            break
        if mbi.State == MEM_COMMIT:
            rwx = ("---" if mbi.Protect & PAGE_GUARD
                   else _PROTECT_PERMS.get(mbi.Protect & 0xFF, "---"))
            alloc_base = mbi.AllocationBase or 0
            if mbi.Type == MEM_IMAGE:
                path = modules.get(alloc_base, "[image]")
                out.append((base, base + length, rwx + "p", base - alloc_base,
                            "00:00", 1, path))
            elif mbi.Type == MEM_MAPPED:
                out.append((base, base + length, rwx + "s", 0,
                            "00:00", 1, "[mapped]"))
            else:
                out.append((base, base + length, rwx + "p", 0,
                            "00:00", 0, ""))
        addr = base + length
    return out


# -- process identity -------------------------------------------------------------

def _query_handle(pid: int) -> int | None:
    try:
        return _open(pid, PROCESS_QUERY_LIMITED_INFORMATION)
    except OSError:
        return None


def image_path(pid: int) -> str | None:
    """Full path of the executable ``pid`` runs, or None if unreadable."""
    a = _api()
    h = _query_handle(pid)
    if h is None:
        return None
    try:
        buf = a.ctypes.create_unicode_buffer(32768)
        n = a.wintypes.DWORD(len(buf))
        if not a.k32.QueryFullProcessImageNameW(h, 0, buf, a.ctypes.byref(n)):
            return None
        return buf.value or None
    finally:
        a.k32.CloseHandle(h)


def command_line(pid: int) -> list[str] | None:
    """``pid``'s command line split the way the C runtime splits argv.

    The Windows equivalent of reading /proc/<pid>/cmdline. None when it
    cannot be read (process gone, access refused, Windows older than 8.1).
    """
    a = _api()
    h = _query_handle(pid)
    if h is None:
        return None
    try:
        ret = a.wintypes.ULONG(0)
        status = a.ntdll.NtQueryInformationProcess(
            h, _PROCESS_COMMAND_LINE_INFORMATION, None, 0, a.ctypes.byref(ret))
        if (status & 0xFFFFFFFF) != STATUS_INFO_LENGTH_MISMATCH or not ret.value:
            return None
        buf = a.ctypes.create_string_buffer(ret.value)
        status = a.ntdll.NtQueryInformationProcess(
            h, _PROCESS_COMMAND_LINE_INFORMATION, buf, ret.value,
            a.ctypes.byref(ret))
        if status != 0:
            return None
        # UNICODE_STRING { USHORT Length; USHORT MaximumLength; PWSTR Buffer; }
        length = int.from_bytes(buf.raw[0:2], "little")
        ptr = int.from_bytes(buf.raw[8:16], "little")
        if not ptr or not length:
            return []
        line = a.ctypes.wstring_at(ptr, length // 2)
    finally:
        a.k32.CloseHandle(h)
    argc = a.ctypes.c_int(0)
    argv = a.shell32.CommandLineToArgvW(line, a.ctypes.byref(argc))
    if not argv:
        return line.split()
    try:
        return [argv[i] for i in range(argc.value)]
    finally:
        a.k32.LocalFree(argv)


def is_alive(pid: int) -> bool:
    """True while ``pid`` is a running process (the /proc/<pid> existence test).

    A process the caller may not open at all still exists, so "access denied"
    answers True; only "no such process" or a signalled handle answers False.
    """
    a = _api()
    h = a.k32.OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                          False, pid)
    if not h:
        return a.ctypes.get_last_error() == ERROR_ACCESS_DENIED
    try:
        return a.k32.WaitForSingleObject(h, 0) == WAIT_TIMEOUT
    finally:
        a.k32.CloseHandle(h)


def list_processes() -> list[ProcEntry]:
    """Every process on the machine (the os.listdir('/proc') equivalent)."""
    a = _api()
    snap = a.k32.CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
    if not snap or snap == a.INVALID_HANDLE:
        return []
    out: list[ProcEntry] = []
    try:
        entry = a.PE32()
        entry.dwSize = a.ctypes.sizeof(entry)
        ok = a.k32.Process32FirstW(snap, a.ctypes.byref(entry))
        while ok:
            out.append(ProcEntry(int(entry.th32ProcessID),
                                 int(entry.th32ParentProcessID),
                                 entry.szExeFile))
            ok = a.k32.Process32NextW(snap, a.ctypes.byref(entry))
    finally:
        a.k32.CloseHandle(snap)
    return out


def process_user(pid: int) -> str | None:
    """``DOMAIN\\user`` that ``pid`` runs as, or None if it cannot be read.

    Whether the reader can open the game at all comes down to this: Windows
    grants memory reads to the same account (or an elevated one). Reading the
    owner needs only PROCESS_QUERY_LIMITED_INFORMATION + TOKEN_QUERY.
    """
    if sys.platform != "win32":
        raise _not_windows()
    import ctypes
    from ctypes import wintypes as wt

    a = _api()
    adv = ctypes.WinDLL("advapi32", use_last_error=True)
    adv.OpenProcessToken.argtypes = [wt.HANDLE, wt.DWORD,
                                     ctypes.POINTER(wt.HANDLE)]
    adv.OpenProcessToken.restype = wt.BOOL
    adv.GetTokenInformation.argtypes = [wt.HANDLE, ctypes.c_int,
                                        ctypes.c_void_p, wt.DWORD,
                                        ctypes.POINTER(wt.DWORD)]
    adv.GetTokenInformation.restype = wt.BOOL
    adv.LookupAccountSidW.argtypes = [
        wt.LPCWSTR, ctypes.c_void_p, wt.LPWSTR, ctypes.POINTER(wt.DWORD),
        wt.LPWSTR, ctypes.POINTER(wt.DWORD), ctypes.POINTER(ctypes.c_int)]
    adv.LookupAccountSidW.restype = wt.BOOL

    h = _query_handle(pid)
    if h is None:
        return None
    token = wt.HANDLE()
    try:
        if not adv.OpenProcessToken(h, 0x0008, ctypes.byref(token)):  # QUERY
            return None
    finally:
        a.k32.CloseHandle(h)
    try:
        need = wt.DWORD(0)
        adv.GetTokenInformation(token, 1, None, 0, ctypes.byref(need))  # User
        if not need.value:
            return None
        buf = ctypes.create_string_buffer(need.value)
        if not adv.GetTokenInformation(token, 1, buf, need, ctypes.byref(need)):
            return None
        # TOKEN_USER { SID_AND_ATTRIBUTES User { PSID Sid; DWORD Attributes } }
        sid = ctypes.c_void_p.from_buffer(buf).value
        name = ctypes.create_unicode_buffer(256)
        domain = ctypes.create_unicode_buffer(256)
        n, d = wt.DWORD(len(name)), wt.DWORD(len(domain))
        use = ctypes.c_int(0)
        if not adv.LookupAccountSidW(None, sid, name, ctypes.byref(n), domain,
                                     ctypes.byref(d), ctypes.byref(use)):
            return None
        return f"{domain.value}\\{name.value}" if domain.value else name.value
    finally:
        a.k32.CloseHandle(token)


# -- child lifetime ---------------------------------------------------------------

_job_handle: int | None = None


def kill_with_this_process(pid: int) -> bool:
    """Make the kernel kill ``pid`` when THIS process ends, however it ends.

    The Windows counterpart of a child noticing its parent is gone. On Linux
    the build worker sees its ppid change and stops; Windows never reparents,
    so an orphaned worker would keep building snapshots on the game server
    forever. Instead the child goes into a job object flagged
    KILL_ON_JOB_CLOSE whose only handle this process holds: when this process
    exits — cleanly, by crash, or by TerminateProcess — the handle closes and
    the kernel ends the job's processes. Returns False if that could not be
    arranged (the caller keeps its own liveness check either way).
    """
    global _job_handle
    if sys.platform != "win32":
        raise _not_windows()
    import ctypes
    from ctypes import wintypes as wt

    a = _api()
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class BASIC(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wt.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wt.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wt.DWORD),
            ("SchedulingClass", wt.DWORD),
        ]

    class EXTENDED(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BASIC),
            ("IoInfo", ctypes.c_uint64 * 6),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wt.LPCWSTR]
    k32.CreateJobObjectW.restype = wt.HANDLE
    k32.SetInformationJobObject.argtypes = [
        wt.HANDLE, ctypes.c_int, ctypes.c_void_p, wt.DWORD]
    k32.SetInformationJobObject.restype = wt.BOOL
    k32.AssignProcessToJobObject.argtypes = [wt.HANDLE, wt.HANDLE]
    k32.AssignProcessToJobObject.restype = wt.BOOL

    if _job_handle is None:
        job = k32.CreateJobObjectW(None, None)
        if not job:
            return False
        info = EXTENDED()
        info.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE
        if not k32.SetInformationJobObject(job, 9, ctypes.byref(info),
                                           ctypes.sizeof(info)):
            a.k32.CloseHandle(job)
            return False
        _job_handle = int(job)          # held, never closed, until we exit

    PROCESS_SET_QUOTA, PROCESS_TERMINATE = 0x0100, 0x0001
    h = a.k32.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, False, pid)
    if not h:
        return False
    try:
        return bool(k32.AssignProcessToJobObject(_job_handle, h))
    finally:
        a.k32.CloseHandle(h)


__all__ = [
    "ProcEntry",
    "close_handle",
    "kill_with_this_process",
    "process_user",
    "command_line",
    "image_path",
    "is_alive",
    "list_processes",
    "open_for_read",
    "query_regions",
    "read",
]
