# sqreader findings

Append-only log of what we've learned about the Squad server binary and
its in-memory layout. Each entry is dated; old findings stay even if
superseded so we can see the evolution.

---

## 2026-05-24 — Phase 0: environment, /proc access, and the non-PIE win

### Environment

- Server: Ubuntu 22.04.5 LTS, Linux 5.15.0-177-generic, x86_64
- Target: `squad` SquadGameServer
  - PID at this session: **1234567** (same PID as recorded in the kickoff
    doc — process has not been restarted)
  - Binary: `/path/to/SquadGame/Binaries/Linux/SquadGameServer`
  - **Squad public version: v10.4.1**
  - **UE engine version: 5.7.4 build 604352**
  - `SquadGameServer -version` runtime output: `5.7.4-604352+//Squad/v10.4.1 1018 0`

  - **Two version labels in the binary** — both legit, different things:
    1. **Engine version** (`5.7.4-604352+//Squad/v10.4.1`) — computed at
       runtime from `FEngineVersion` compile-time macros. This is the
       authoritative version for picking which UE source branch to read
       (we want 5.7). Not stored as a single static string in `.rodata`;
       composed from numeric fields.
    2. **Internal build version** (`3.6.0-0-g46c0af68bd248b04df75e4f92d5fb804c3d75340`)
       — a static string in `.rodata`, likely the project's
       `BuildVersion.txt` / git-describe of the Squad source repo (not
       the public marketing version). The kickoff doc captured this
       value as "Squad build version" and confused it for the
       user-facing version. They're decoupled.
  - The `5.7.4` and `v10.4.1` literals do **not** appear as `.rodata`
    strings (verified via `strings -n 8 | grep`). Source-build paths in
    `.rodata` show `D:\jk\wk\08DhZBLnJaOAVvCP1_b1\UnrealEngine\...` —
    Squad uses a Perforce-style build farm with a fixed `UnrealEngine`
    directory (no version in the path), so build-path strings can't tell
    us the engine version either.
  - BuildID: `96be21a280bc1a769c15e23fa6bb1516fab4ee71`
  - Size: 243,238,832 bytes
- `ptrace_scope = 1` (root can attach, normal users cannot)
- `/proc/1234567/mem` is owned `youruser:youruser`, mode `rw-------`. Root
  reads via uid override. Reads work without an explicit `PTRACE_ATTACH`.

### The big surprise: **binary is non-PIE**

```
$ readelf -h SquadGameServer
  Type:                              EXEC (Executable file)
  Entry point address:               0x4b39000
```

This means:

- The binary loads at a **fixed virtual address** (0x00200000) every time
  the process starts. There is no per-run ASLR slide for the executable
  itself.
- All addresses in the binary's `.text`, `.rodata`, `.data`, `.bss` are
  **stable across restarts** — they only change when the binary is
  rebuilt (Squad update).
- We confirmed this empirically: GWorld string file offset `0x11b08ae`
  + load base `0x200000` = runtime addr `0x13b08ae`, exactly matching
  the kickoff doc's reading from a prior session.

Consequence: **the hard problem of "where did GUObjectArray go this run"
is much easier**. Once we find these globals once, we can hard-code their
runtime addresses (per Squad version). We will still resolve dynamically
via pattern scan so the code survives Squad updates, but per-run
re-scanning is unnecessary.

The heap, stack, and shared library mappings are still ASLR'd. Only the
main executable is non-PIE.

### Module map summary (PID 1234567)

| Range | Perms | File offset | Section |
|---|---|---|---|
| `0x00200000–0x04b38000` | `r--p` | `0x00000000` | rodata-heavy (.rodata, .init, .plt) |
| `0x04b39000–0x0e915000` | `r-xp` | `0x04938000` | .text |
| `0x0e915000–0x0e9a4000` | `r--p` | `0x0e713000` | more r/o data |
| `0x0e9a5000–0x0e9fb000` | `rw-p` | `0x0e7a2000` | .data + .bss |
| `[heap]` | `0x34ad9000–0x35ea5000` | | program break heap |
| anon rw  | 912 regions, **5.3 GB total** | | UE allocators (FNamePool, GUObjectArray chunks, actor instances) |

### Key addresses (verified this session)

| Symbol | File offset | Runtime addr | Notes |
|---|---|---|---|
| `GWorld` string | `0x11b08ae` | `0x13b08ae` | ASCII `"GWorld\0"` in .rodata |

`SQVehicle`, `SQSoldier`, etc. are **not** in the binary's .rodata —
they appear only in the runtime FNamePool. This matches UE5's design:
class names from `.uasset` packages are interned into FNamePool at
package load time.

### Tools

Installed on server: gdb, python3 3.10.12 (+ venv 3.10.12 with pyelftools,
capstone), git, nm, objdump, readelf, strings. radare2 not in default
22.04 repo and skipped for now.

### Acceptance: Phase 0 — passed

Run on 2026-05-24 against PID 1234567:

```
[1/4] target squad pid = 1234567
[2/4] SquadGameServer module base = 0x200000
      anon RW regions: 909  total: 5312.4 MiB
[3/4] read_cstring(0x13b08ae) = 'GWorld'  OK
[4/4] SQVehicle hits in anon RW: 16601  (scanned 5312.4 MiB in 1.84s)
  hit @ 0x7f821a06ced0  in [anon] (0x7f821994c000-0x7f821a150000)
  hit @ 0x7f821a06cf0e  in [anon] ...
PHASE 0 OK
```

Notable: the first `SQVehicle` hit at `0x7f821a06ced0` is the **exact**
address recorded in the kickoff doc from a prior session. The squad
process has not been restarted; heap layout is unchanged. 16601 hits
this run vs 16332 in the kickoff — increase is from match progression
(more vehicles spawned/loaded).

Scan throughput: 5.3 GiB in 1.84 s = **~2.9 GB/s** with pure-CPython
`bytes.find` over 1 MiB chunks. Fast enough that anchoring scans can be
re-run on every process attach without measurable latency.

See `scripts/verify_phase0.py` for the exact test.

---

## 2026-05-24 — Phase 1, Part A: FNamePool fully resolved

### Big-picture findings

**The binary has "extended BSS".** /proc/maps shows the rw-p
SquadGameServer mapping ending at `0xe9fb000`, but immediately after it
there is an anonymous rw mapping `0xe9fb000–0xedc8000` (3.8 MiB). The
compiler treats this whole region as static storage and emits absolute
addresses into `.text` that land in it. We verified: the address
`0xea74980` (in the anonymous region) is embedded as a 32-bit immediate
in **33 places** in `.text`, and `0xea749c0` (Blocks[]) in **34 places**.
Combined with non-PIE EXEC, this means those addresses are **stable
across process restarts**.

This was an unexpected layout — the kickoff doc assumed "global pointers
in `.bss`" but UE 5.7 actually places the FNamePool struct itself in
extended-BSS space and accesses it via hardcoded absolute addresses.

### "GWorld string" xref dead-end

LEA-RIP xref scan for `0x13b08ae` returned **0 hits**. The compiler used
the shorter `mov edi, 0x13b08ae` (5-byte non-PIE encoding) instead — 4
hits. All 4 are `FProfilerScope`-style tracing calls (analytics code)
that pass `"GWorld"` as the **scope name**, not real pointer accesses.
Conclusion: string xrefs are useless for finding the GWorld pointer
global. We need a different anchor for that. (Will revisit.)

### FNamePool / FNameEntryAllocator layout (UE 5.7.4)

Empirically derived from heap dumps. Verified by reading 345,049 entries
in 0.37 s and matching the first 16 to the canonical `EName` enum.

```
FNameEntryAllocator (size ~65 KiB):
    +0x00   FRWLock Lock                 (pthread_rwlock_t, 56 bytes)
    +0x38   uint32  CurrentBlock         (newest active block index)
    +0x3C   uint32  CurrentByteCursor    (bytes used in Blocks[Current])
    +0x40   uint8*  Blocks[8192]         (inline array of block bases)
```

Each block is a packed sequence of `FNameEntry`:

```
FNameEntry:
    uint16 Header           (Len << 6) | (Hash << 1) | bIsWide
    char   Name[Len]        ANSI (1 byte/char) or UTF-16 (2 bytes/char)
                            entries are 2-byte aligned; pad zero if needed.
```

Header decoder verified on real entries:
| Header (LE) | bIsWide | Hash | Len | Name |
|---|---|---|---|---|
| `1e 01` | 0 | 15 | 4 | `None` |
| `10 03` | 0 | 8 | 12 | `ByteProperty` |
| `86 03` | 0 | 11 | 14 | `SQVehicleSmoke` |
| `e8 07` | 0 | 20 | 31 | `Default__BP_VehicleSmoke_Proj_C` |

### Two FNamePool instances

We found TWO canonical `Block 0`s in heap with identical reserved-EName
contents at `0x7f86d12a0000` and `0x7f86d19a0000`. The first has 98
active blocks (the main pool, ~345k entries); the second has only 1
block initialised. Likely the comparison vs display pool split (UE
`WITH_CASE_PRESERVING_NAME`); the smaller one may also be the
save-game name table. The discovery picks the larger pool.

### Discovery

We provide two paths in `sqreader/ue/fname.py`:

1. `KNOWN_ALLOCATOR_ADDR_V10_4_1 = 0xea74980` — hardcoded, instant,
   version-locked. Use until next Squad binary update.
2. `find_fname_pool_base(pm)` — heap-scans for the canonical
   `[None][ByteProperty]` block prefix, then searches for the pointer
   to that block; the storage location minus `0x40` is the allocator
   base. ~9.5 s, self-healing across Squad rebuilds.

Verified both paths return `0xea74980`.

### Acceptance: Phase 1 Part A — passed

```
$ scripts/verify_fname_pool.py --use-known
pid = 1234567
using KNOWN address: 0xea74980
  CurrentBlock      = 97
  CurrentByteCursor = 73100  (71.4 KiB)
  active blocks     = 98
  total entries     = 345049
  walk time         = 0.37s
canonical EName check (first 16) = 16/16 OK
PHASE 1 (FNamePool) OK
```

Next milestone: GUObjectArray. The "many UClass CDOs in .bss" candidates
we already collected (273 heap pointers in `.bss`, many with vtable→ro)
are likely UClass pointers — promising starting point.

---

## 2026-05-24 — Phase 1, Part B: GUObjectArray + UObject enumeration

### GUObjectArray located

Scanning extended-bss with a 32-byte structural-signature check
(heap-ptr + null/heap-ptr + int32 quad with `MaxChunks*65536 ≈ MaxElements`)
produced exactly **one** candidate:

```
FUObjectArray   @ 0xeb29978
  ObjFirstGCIndex    = 48007     ← first GC-eligible UObject
  ObjLastNonGCIndex  = 48006     ← last "disregard for GC" (native)
  MaxDisregard       = 48007
  OpenForDisregardForGC = 0

  FChunkedFixedUObjectArray:
    Objects            = 0x7f836eab90a0  (heap; chunk-pointer array)
    PreAllocatedObjects= 0 (modern UE5)
    MaxElements        = 2 162 688
    NumElements        = 227 299   ← live UObject count
    MaxChunks          = 33
    NumChunks          = 4
```

So at this snapshot the live process holds **227 299 UObjects**, with
48 007 native (immortal) and ~179 000 GC-eligible (dynamic). Only 4 of
the 33 reserved chunks are allocated; capacity is ~2.16 M.

### FUObjectItem layout — **changed in UE 5.5+**

The kickoff doc (and most older references like Spuckwaffel/UEDumper)
say `FUObjectItem` starts with `UObject* Object`. **In UE 5.7 this is no
longer true.** Our chunk dump showed:

```
+0x00  uint64  AtomicFlags   high bits = EInternalObjectFlags
                              (0x4000000000000000 = RootSet,
                               0x4200000000000000 = RootSet | Native)
+0x08  UObject*  Object      ← moved here
+0x10  int32   ClusterRootIndex
+0x14  int32   SerialNumber
```

Total: 24 bytes (unchanged). This atomic-flags-first layout was added
in UE 5.5 for thread-safe lockless UObject lookups. Reading `Object`
at offset 0 (the old way) returns a flags value masquerading as a
pointer — that bit us once before we noticed every "pointer" had high
bit 62 (RootSet) set and the low 48 bits were zero.

### FName index packing — verified

The FName ComparisonIndex (uint32) splits as:
- Block index = high 16 bits
- Offset (in 2-byte units) = low 16 bits
- Number = separate uint32 right after ComparisonIndex (8-byte FName)

Empirical confirmation by resolving the first 40 UObjects:

```
[ 0]  Package -> /Script/CoreUObject     [13]  Class -> Actor
[ 1]  Class   -> Object                  [14]  Class -> HUD
[ 2]  Package -> /Script/Engine          [32]  Class -> ByteProperty
[ 3]  Class   -> MaterialExpression      [33]  Class -> Int8Property
[ 4]  Class   -> MaterialExpressionCustomOutput
[ 5-12] Class -> MaterialExpression* (custom output variants)
...
```

This is exactly the order UE registers built-in classes during startup.
The Material expression classes appear before Actor because they're
registered by the static reflection registrar in alphabetical order
within `/Script/Engine`.

### `WITH_CASE_PRESERVING_NAME=0` confirmed

The UObject candidate scan voted 66544–0 in favor of 8-byte FName
(comparison-only) over 12-byte FName (comparison + display). So our
`FName = {uint32 cmp_idx; uint32 number}` decoder is correct.

The two FNamePool instances we observed earlier are NOT the
case-preserving split — they're likely something else (savegame names?
networking pool?). For now the smaller pool is unused for normal
resolution.

### Throughput

- `arr.iter_object_addrs()` over 227 299 slots: **0.03 s** (7.5 M obj/s)
- Walking every object AND resolving its name+class: **1.63 s**
- `find_gobjects_base()` auto-discovery: **4.4 s**
- `find_fname_pool_base()` auto-discovery: **9.5 s**

### Squad classes are reachable

Searching all UObjects for names containing "SQ" returned 26 088 matches.
Top classes: `BP_SQAvailability_Role_C` (8595), `BP_SQAvailability_Deployable_C`
(4766), `BP_SQAvailability_Vehicle_C` (2609), `SQSoldierInventoryItem_C` (365),
`SQCoreStateComponent` (340), `BP_SQVehicleSettings_C` (329). All Squad
runtime classes (`SQVehicle`, `SQSoldier`, `SQPlayerState`, vehicle/water
subsystems, online services) are discoverable. Phase 3 snapshot data is
now plumbable end-to-end.

### Acceptance: Phase 1 Part B — passed

```
$ scripts/verify_gobjects.py --use-known --count 50
PHASE 1B (GUObjectArray) OK

$ scripts/verify_gobjects.py --walk-all
live: 151344  null: 75955  total: 227299
walk time: 0.03s (7510210 obj/s)
PHASE 1B (GUObjectArray) OK
```

Next: Phase 2 — UClass + FProperty walking. With UObject enumeration
done, we can locate any UClass (e.g. ASQSoldier — interned as
`SQSoldier`), read its `SuperStruct`+`ChildProperties` linked lists,
and produce a `{field_name: offset}` map per class. That map drives
Phase 3, the snapshot producer.

---

## 2026-05-24 — Phase 2: UStruct + FProperty walking

### Layouts reverse-engineered (Squad v10.4.1 / UE 5.7.4 / Linux x86_64)

**UStruct** (UClass extends UStruct extends UField extends UObject):

| Offset | Type | Field | Note |
|---|---|---|---|
| 0x00 | void* | Vtable | UObject base |
| 0x08 | uint32+int32 | ObjectFlags + InternalIndex | |
| 0x10 | UClass* | ClassPrivate | |
| 0x18 | FName | NamePrivate | |
| 0x20 | UObject* | OuterPrivate | |
| 0x28 | UField* | Next | (UField base — null for UClasses) |
| 0x30 | (void*, int32) | _UE 5.7 internal cache_ | unknown but present |
| 0x40 | UStruct* | **SuperStruct** | |
| 0x48 | UField* | **Children** | UFunction linked list |
| 0x50 | FField* | **ChildProperties** | FProperty linked list |
| 0x58 | int32 | **PropertiesSize** | sizeof(instance) |
| 0x5C | int32 | MinAlignment | |

The `+0x30..+0x40` block is something UE 5.7 inserts that's not in the
public UE source layout — possibly cluster/streaming metadata. We
verified the SuperStruct/Children/ChildProperties offsets by dumping
"Object" UClass (null Super, null ChildProperties, PropertiesSize=40 =
sizeof(UObject)) and "Actor" UClass (Super=Object UClass, ChildProperties
non-null, PropertiesSize=696).

**FField** (base for all reflected fields):

| Offset | Type | Field |
|---|---|---|
| 0x00 | void* | Vtable (compiler-generated per FProperty subclass) |
| 0x08 | FFieldClass* | **ClassPrivate** (per-type singleton in extended-bss) |
| 0x10 | uint64 | Owner (tagged pointer; low bit set ⇒ UObject*) |
| 0x18 | FField* | **Next** (linked-list next; null ends the chain) |
| 0x20 | FName | **NamePrivate** (the field name) |
| 0x28 | uint32 | FlagsPrivate (+ 4B pad) |

> ⚠ The kickoff doc (and most older UE refs) places `ClassPrivate` at
> offset 0. **In UE 5.7 offset 0 is the compiler-generated vtable.**
> ClassPrivate moved to offset 8. We initially had this wrong and saw
> every property type as `<?>` until we dumped a real FField and
> matched the offsets.

**FProperty** (extends FField, additional members starting at +0x30):

| Offset | Type | Field |
|---|---|---|
| 0x30 | int32 | ArrayDim |
| 0x34 | int32 | ElementSize |
| 0x38 | uint64 | PropertyFlags |
| 0x40 | uint16+uint8+pad | RepIndex + BlueprintReplicationCondition |
| 0x44 | int32 | **Offset_Internal** ← THE field byte-offset within instances |
| 0x48 | FName | RepNotifyFunc |
| 0x50 | FProperty* | PropertyLinkNext |

**FFieldClass** (per-type singleton; identifies property kind):

The first 8 bytes are an `FName Name` (cmp_idx + number). We resolve
it via FNamePool to get the type label ("BoolProperty", "FloatProperty",
"ObjectProperty", "WeakObjectProperty", etc.).

### Bitfield bool packing (verified)

Multiple bool properties share the same byte offset; e.g. AActor has 7
bools at offset 0x58, another 8 at 0x59, etc. UE's FBoolProperty
records the byte offset in Offset_Internal and the bit mask in
type-specific trailing bytes (FieldSize/ByteOffset/ByteMask/FieldMask
after the FProperty header — we don't need them yet for read-only
snapshotting).

### Verified class hierarchies

**SQSoldier** (12 448 bytes per instance):

```
SQSoldier (314 own props)  →  Character (40)  →  Pawn (20)  →  Actor (83)  →  Object (0)
```

**SQVehicle** (2 800 bytes per instance):

```
SQVehicle (124)  →  SQVehicleSeat (21)  →  SQPawn (11)  →  Pawn (20)  →  Actor (83)  →  Object (0)
```

So in Squad, every vehicle IS-A vehicle-seat IS-A SQPawn — a clean
model where each crewable position is itself a Pawn.

### Squad field-name corrections (kickoff guesses vs reality)

The kickoff doc named expected fields based on UE conventions. Squad
actually uses different names — discovered via substring search of the
merged layout:

| Kickoff guess | SQSoldier actual | Offset | Type |
|---|---|---|---|
| `Health` | `Health` ✓ | 0x269c | FloatProperty |
| `MaxHealth` | (not on SQSoldier; constant) | — | — |
| `Stamina` | `BreathHoldStamina` | 0x2710 | FloatProperty (only used for ADS breath-hold!) |
| `CurrentWeapon` | `CurrentHeldWeapon` | 0x307c | WeakObjectProperty |
| `PlayerState` | `PlayerState` ✓ (inherited from APawn) | 0x02d8 | ObjectProperty |
| `CurrentRole` | (not on Soldier; role lives in PlayerState/inventory) | — | — |
| `LastHitBy` | `LastHitBy` ✓ (inherited from APawn) | 0x02e0 | ObjectProperty |
| `Controller` | `Controller` ✓ (inherited from APawn) | 0x02e8 | ObjectProperty |

For SQVehicle: `Health` 0x9b8, `MaxHealth` 0x9bc, `LastDamageInstigator`
0x9d8 — all match kickoff schema references.

### Performance

- `find_by_name("SQSoldier", class_name="Class")`: **0.04 s** (one walk
  through GUObjectArray with FName resolve)
- `get_class_layout(soldier_class_addr)`: **<10 ms** (linked-list walks)

So fetching the full property layout for any class is essentially free —
we can keep a per-snapshot cache.

### Acceptance: Phase 2 — passed

```
$ scripts/verify_reflection.py --class-name SQSoldier
  Health             +0x269c  FloatProperty       OK
  BreathHoldStamina  +0x2710  FloatProperty       OK
  CurrentHeldWeapon  +0x307c  WeakObjectProperty  OK
  PlayerState        +0x02d8  ObjectProperty      OK
  LastHitBy          +0x02e0  ObjectProperty      OK
  Controller         +0x02e8  ObjectProperty      OK
PHASE 2 (reflection) OK

$ scripts/verify_reflection.py --class-name SQVehicle --expect Health MaxHealth LastDamageInstigator
  Health                +0x09b8  FloatProperty    OK
  MaxHealth             +0x09bc  FloatProperty    OK
  LastDamageInstigator  +0x09d8  ObjectProperty   OK
PHASE 2 (reflection) OK
```

Next: Phase 3 — first snapshot. We have everything we need:

1. Walk GUObjectArray for live UObjects whose class is `SQPlayerState`.
2. For each, read fields by offset using `get_class_layout(player_state_class)`.
3. Follow `PawnPrivate` → `ASQSoldier*`, read Health/Stamina/Position.
4. For vehicles: enumerate UObjects with class=`SQVehicle*`, read Health/team/Position/turret yaw.
5. Emit one NDJSON line — first end-to-end snapshot.

Position reading will need a small new piece: `USceneComponent.RelativeLocation`
(a FVector at some offset within USceneComponent). The kickoff edge
case about vehicle-seat-relative coords still applies.

---

## 2026-05-24 — Phase 3 first cut: NDJSON snapshot with real player data

### Acceptance criterion met

Kickoff:
> Run `sqreader snapshot --pid 1234567 --once` and get one line of JSON
> containing real player names from the active server

`scripts/snapshot_once.py --pretty` emits a working snapshot in **~540 ms**
containing 5 live players with real names ("Akreal", "WOZZY",
"GENERAL-LEE", "zeropYpac", "ÜMİT ÖZDAĞ 06" — Turkish chars
round-tripped via UTF-16-LE), EOS UUIDs, team/role, score/ping, and
per-soldier Health + BreathHoldStamina.

Snapshot caught a real damage event: ÜMİT ÖZDAĞ's Health was 69.28
when the snapshot was taken — confirming we're reading live state.

### Field discoveries on SQPlayerState

The 41 own-properties of SQPlayerState include (offset relative to instance):

| Offset | Type | Field | Notes |
|---|---|---|---|
| 0x158 | ObjectProperty | Owner | → BP_PlayerController_C |
| 0x308 | StrProperty | SavedNetworkAddress | client IP (PII — handle carefully) |
| 0x338 | ObjectProperty | PawnPrivate | → soldier actor |
| 0x350 | StrProperty | **PlayerNamePrivate** | display name |
| 0x500 | IntProperty | **TeamId** | 1=USMC, 2=ADF (verified) |
| 0x504 | IntProperty | LastTeamChangeTime | |
| 0x728 | StructProperty (128B) | PlayerStateData | likely holds Kills/Deaths — TBD |
| 0x7c8 | StrProperty | **OnlineUserId** | EOS UUID |
| 0x7d8 | ObjectProperty | TeamState | → SQTeamState |
| 0x7e0 | ObjectProperty | SquadState | → SQSquadState |
| 0x7e8 | ObjectProperty | Soldier | → live SQSoldier subclass |
| 0x7f0 | ObjectProperty | CurrentPawn | mirror of Soldier |
| 0x7f8 | NameProperty | **CurrentRoleId** | e.g. "USMC_LAT_01" |
| 0x800 | NameProperty | DeployRoleId | |
| 0x808 | ObjectProperty | CurrentRole | → BP_SQRoleSettings_C |
| 0x810 | ObjectProperty | DeployRole | |

### Value-type readers added (`sqreader/ue/value.py`)

- `read_fstring(pm, addr)` — TArray<TCHAR> with UCS-2 chars, count
  includes NUL terminator; returns `""` for empty FString
- `read_fvector(pm, addr)` — 24-byte FVector3d (UE 5.x doubles)
- `read_frotator(pm, addr)` — 24-byte FRotator3d (pitch, yaw, roll)
- `read_tarray_header(pm, addr)` / `iter_tarray_pointers(...)` — for
  arrays of UObject\*
- `read_fweak_object_ptr(pm, addr)` — `(ObjectIndex, SerialNumber)`
  pair; resolve via GUObjectArray

### Known issues from this first cut

1. **Bool bitfield packing** — `bIsABot` and 5 other bools share byte
   0x2c2. We currently read the byte and AND with 1, which only checks
   the FIRST bit. So our `isBot` output is wrong for users where
   `bIsABot` is at bit ≥ 1. Fix: read FBoolProperty's `ByteMask` from
   the property trailing bytes (FieldSize/ByteOffset/ByteMask/FieldMask
   live right after the FProperty header for bool properties).
2. **Kills/Deaths missing** — these live inside `PlayerStateData`
   (StructProperty, 128 bytes). Need to walk that struct's own
   FProperty chain.
3. **No position yet** — soldier's location requires reading its
   RootComponent (an ObjectProperty inherited from AActor) and then
   the RelativeLocation FVector inside that component.
4. **No vehicle table** — easy follow-up: walk GUObjectArray for
   classes containing "Vehicle", read Health/Team/RootComponent.
5. **No map / ticket info** — needs SQGameState walk; layout TBD.

### Acceptance: Phase 3 first cut — passed

```
$ scripts/snapshot_once.py --pretty
{
  "timestamp": "2026-05-24T20:54:11.314+00:00",
  "server": "squad",
  "counts": {
    "playerStatesNonCDO": 5, "soldiersLive": 1, "vehicleSeatsLive": 1,
    "totalUObjects": 227299
  },
  "players": [ ... 5 entries with names, roles, EOS IDs, soldier health ... ]
}
# snapshot built in 540ms
```

---

## 2026-05-24 — Phase 3-C: game/team state + positions + vehicles

Within a single push the snapshot grew from "5 players with names" to a
full per-tick frame:

### gameState (subclass-aware)

The live SQGameState is a Blueprint subclass (`BP_GameStateSquad_Seed_C`
on the current server), not the bare SQGameState. Added
`find_subclass_instance` + `_is_subclass_of` helpers that cache the
super-chain walk, so we can locate any UE Blueprint singleton.

Fields read (offsets on SQGameState base layout):

| Field | Offset | Notes |
|---|---|---|
| `ServerName` (FString) | 0x488 | e.g. `'[TR] Example Community \| AC \| discord.gg/example'` |
| `MessageOfTheDay` (FString) | 0x498 | ~1.5 KiB MOTD in Turkish; gated behind `--with-motd` |
| `MaxPlayers` (int32) | 0x480 | 100 |
| `ServerTickRate` (float) | 0x414 | 63.62 (≈ FIXEDMAXTICKRATE=64 launch arg) |
| `MatchID` (FString) | 0x380 | UUID4 per match |
| `MatchState` (FName) | 0x30c | `'InProgress'`, `'WaitingPostMatch'`, etc. |
| `ElapsedTime` (int32) | 0x31c | seconds since match start |
| `bIsTicketBasedGame` (bool) | 0x359 | (bitfield bug for now — see issues) |
| `GameModeId` (FName) | 0x428 | `'BP_GameMode_Seed_C'` etc. |
| `AuthorityNumTeams` (int32) | 0x400 | 2 |
| `MaxFireTeamCount` / `Size` | 0x460 / 0x464 | 4 / 9 |
| `TimeOfCompletion` (float) | 0x4b0 | match time target |
| `ServerStartTimeStamp` (int32) | 0x4c8 | Unix seconds |
| `ReplicatedWorldTimeSecondsDouble` | 0x2e8 | server world time |
| `TeamStates` (TArray) | 0x3e0 | array of SQTeamState\* |

### teams[] (via SQGameState.TeamStates TArray walk)

Walks `iter_tarray_pointers` over `TeamStates`. Each `SQTeamState`:

| Field | Offset | Live value (ADF team) |
|---|---|---|
| `ID` (int32) | 0x2e8 | 2 |
| `Tickets` (int32) | 0x2b8 | 100 |
| `Score` (float) | 0x2ec | 1920.0 |
| `ObjectiveScore` (float) | 0x2f4 | 1920.0 |
| `NumKills` (int32) | 0x2fc | 70 |
| `NumDeaths` (int32) | 0x304 | 6 |
| `NumWoundeds` (int32) | 0x308 | 9 |
| `FactionSetupId` (FName) | 0x3d8 | `'ADF_S_CombinedArms_Seed'` |
| `PlayerStates` TArray | 0x3c0 | TArray count of assigned players |
| `IndexedSquadStates` TArray | 0x340 | |
| `RoleAvailabilities` TArray | 0x4d0 | (RoleAvailability slots per faction) |
| `VehicleAvailabilities` TArray | 0x4f0 | |

### Positions via Pawn→RootComponent→RelativeLocation

| Class.Field | Offset | Notes |
|---|---|---|
| `AActor.RootComponent` | 0x1c0 | inherited by SQSoldier and SQVehicle |
| `USceneComponent.RelativeLocation` | 0x140 | FVector3d (24 B / 3 doubles) |
| `USceneComponent.RelativeRotation` | 0x158 | FRotator3d |
| `USceneComponent.AttachParent` | 0x0c8 | non-null => actor is attached; world pos requires ComponentToWorld decode |

Live read: each of 5 players reported a sensible world position in UE
units (cm), in a `(140 000-160 000, 50 000-130 000, 1 000-4 100)`
range — consistent with one Squad map.

### vehicles[] (subclass-aware)

`_is_subclass_of(SQVehicle)` cache during the same GUObjectArray walk
catches all 27 SQVehicle-derived classes in this build. Snapshot
emitted 12 non-CDO vehicles on the live server (USMC + ADF transport
and logi trucks; no combat vehicles in Seed mode). Per vehicle:
`classShort`, `health`, `maxHealth`, `team` (from `SQPawn.Team` byte @ +0x343),
`position`, `yaw`, `lastDamager` (resolved UObject name + class).

### Soldier stale-pointer guard

When a player dies, `SQPlayerState.PawnPrivate` briefly points to freed
memory. Without guards, we'd report `health=-300.0` (garbage). The
`_read_soldier` helper now:
1. Re-reads the soldier's `ClassPrivate` — if null, soldier is gone.
2. Sanity-checks `Health` and `BreathHoldStamina` against `[-10, 1000]`
   bounds. Out-of-range values become `null` + `stale: true`.

### Continuous mode

`scripts/snapshot_watch.py` — at 2 Hz target, achieved **1.6 Hz**
effective (build time dominates at ~626 ms/tick). One NDJSON line per
tick, fsync'd. Captured 25 ticks (152 KiB) in 15.6 s. Stable across
multiple ticks; `elapsedSec` increments monotonically.

Pre-resolved `SnapshotPaths` (the 8 UClass layouts) saved 150 ms/tick
vs resolving fresh each iteration.

### Roadmap to 3 Hz

Identified bottleneck: the full GUObjectArray walk costs ~500 ms because
we resolve each unique class's name. Two ways forward, both deferred:
1. Cache `class_addr -> name` across snapshots (most classes don't
   change). Should drop per-tick cost dramatically.
2. Detect changed objects only — diff InternalIndex set against last tick.

For now 1.6 Hz produces a useful capture.
