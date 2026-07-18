# sqreader offsets

Authoritative table of discovered offsets and signatures. Keep this in
sync with `sqreader/squad/classes.py` and the pattern scanners in
`sqreader/scanner.py`. **Every entry must list the Squad version it was
discovered against** — Squad updates rebuild the binary and shuffle
offsets.

---

## Squad v10.4.1 / UE 5.7.4 build 604352 (BuildID `96be21a280bc1a769c15e23fa6bb1516fab4ee71`)

> The kickoff doc originally labelled this as "Squad 3.6.0 / UE 5.3" but
> the binary's actual self-reported version is `5.7.4-604352+//Squad/v10.4.1`.
> See `docs/findings.md` for the version-correction note.
>

### Binary layout

| Item | Value |
|---|---|
| Binary type | `EXEC` (non-PIE) |
| Load base | `0x00200000` |
| `.text` runtime range | `0x04b39000–0x0e915000` |
| `.data + .bss` runtime range | `0x0e9a5000–0x0e9fb000` |
| Entry point | `0x04b39000` |

### Known strings in `.rodata`

| String | File offset | Runtime addr | Used for |
|---|---|---|---|
| `GWorld` | `0x11b08ae` | `0x13b08ae` | Locating `GWorld` global pointer via LEA-rip+disp scan in `.text` |

### "Extended BSS" region (compiler-emitted absolute storage)

| Range | Notes |
|---|---|
| `0x0e9fb000–0x0edc8000` (3.8 MiB) | Anonymous rw mapping immediately after the binary's rw-p region. Holds UE5 static-like globals (FNamePool, presumably more). Address is **stable across restarts** because the binary is non-PIE EXEC and the compiler hardcodes addresses into this range as 32-bit immediates. |

### UE globals — runtime addresses

| Global | Runtime addr | How resolved | Confidence |
|---|---|---|---|
| `FNameEntryAllocator` (main / comparison pool) | `0xea74980` | (a) hardcoded after empirical discovery, (b) heap scan for canonical `[None][ByteProperty]` Block 0 prefix → pointer back-search → subtract `FNEA_BLOCKS_OFFSET` | **verified** (16/16 canonical ENames, 345 049 entries walked) |
| `FNameEntryAllocator` (secondary / display pool?) | `0x...` (Blocks[0] = `0x7f86d19a0000`) | same as above, picks the smaller pool | tentative |
| `GWorld` (pointer) | TBD | LEA/MOV-imm32 xref to "GWorld" string is a dead end (4 hits, all logging/profiler scope calls). Next try: walk GUObjectArray, filter UObjects with class=`World`. | not yet |
| `GUObjectArray` (FUObjectArray) | `0xeb29978` | Single 32-byte signature match in extended-bss for `FChunkedFixedUObjectArray` (heap-ptr + null + `MaxChunks*65536 ≈ MaxElements`). Header 16 B before is `ObjFirstGCIndex/LastNonGCIndex/MaxDisregard/Open`. | **verified** (227 299 UObjects enumerated, first 40 match UE startup order; SQ* classes reachable) |

### FNameEntryAllocator layout (UE 5.7.4 on Linux x86_64)

| Offset | Type | Field |
|---|---|---|
| `0x00` | pthread_rwlock_t (56 B) | `Lock` |
| `0x38` | uint32 | `CurrentBlock` |
| `0x3C` | uint32 | `CurrentByteCursor` |
| `0x40` | uint8\*[8192] | `Blocks[]` |

Total size: 64 + 8192*8 = 65 600 bytes (~64 KiB).

### FNameEntry layout

| Offset | Type | Field |
|---|---|---|
| `0x00` | uint16 | `Header = (Len<<6) \| (Hash<<1) \| bIsWide` |
| `0x02` | char or wchar | `Name[Len]` |

Entries are 2-byte aligned; if `Len` is odd, the trailing byte after the
name is zero padding.

### FUObjectArray layout (UE 5.7 / Squad v10.4.1)

| Offset | Type | Field |
|---|---|---|
| `0x00` | int32 | `ObjFirstGCIndex` |
| `0x04` | int32 | `ObjLastNonGCIndex` |
| `0x08` | int32 | `MaxObjectsNotConsideredByGC` |
| `0x0C` | uint32 (bool, padded) | `OpenForDisregardForGC` |
| `0x10` | FChunkedFixedUObjectArray | `ObjObjects` |

`FChunkedFixedUObjectArray` (at `0x10` within `FUObjectArray`):

| Offset (rel) | Type | Field |
|---|---|---|
| `0x00` | void\* | `Objects` (heap pointer to chunk-pointer array) |
| `0x08` | void\* | `PreAllocatedObjects` (null in modern UE5) |
| `0x10` | int32 | `MaxElements` |
| `0x14` | int32 | `NumElements` |
| `0x18` | int32 | `MaxChunks` |
| `0x1C` | int32 | `NumChunks` |

Chunks hold `65 536` `FUObjectItem`s each.

### FUObjectItem layout (UE 5.5+)

| Offset | Type | Field |
|---|---|---|
| `0x00` | uint64 (atomic) | `AtomicFlags` — high bits = `EInternalObjectFlags` (`RootSet`=bit 62, `Native`=bit 57) |
| `0x08` | `UObject*` | `Object` |
| `0x10` | int32 | `ClusterRootIndex` |
| `0x14` | int32 | `SerialNumber` |

24 bytes total. **The Object pointer moved from offset 0 (UE 5.4 and
earlier) to offset 8 in UE 5.5+.** Reading at offset 0 returns the
flags-as-pointer (we saw `0x4000000000000000` everywhere before we
caught this).

### UObject layout (8-byte FName, since WCPN=0)

| Offset | Type | Field |
|---|---|---|
| `0x00` | void\* | `Vtable` |
| `0x08` | uint32 | `ObjectFlags` |
| `0x0C` | int32 | `InternalIndex` |
| `0x10` | UClass\* | `ClassPrivate` |
| `0x18` | FName | `NamePrivate` (uint32 ComparisonIndex, uint32 Number) |
| `0x20` | UObject\* | `OuterPrivate` |

FName decoding: ComparisonIndex's high 16 bits = block index in
FNamePool, low 16 bits = offset within block in 2-byte units. Number is
1-based suffix (`Foo_0` is stored as Number=1).

### UStruct layout (UE 5.7 / Squad v10.4.1)

| Offset | Type | Field |
|---|---|---|
| `0x28` | UField\* | `Next` (UField base; null for UClasses) |
| `0x30` | (8B + 8B) | UE 5.7 internal cache (unknown, not needed) |
| `0x40` | UStruct\* | `SuperStruct` |
| `0x48` | UField\* | `Children` (UFunction linked list) |
| `0x50` | FField\* | `ChildProperties` (FProperty linked list) |
| `0x58` | int32 | `PropertiesSize` (sizeof instance) |
| `0x5C` | int32 | `MinAlignment` |

### FField layout (base for FProperty)

| Offset | Type | Field |
|---|---|---|
| `0x00` | void\* | Vtable (compiler-generated; varies per FProperty subclass) |
| `0x08` | FFieldClass\* | `ClassPrivate` (per-type singleton in extended-bss) |
| `0x10` | uint64 | `Owner` (tagged ptr; low bit ⇒ UObject\*) |
| `0x18` | FField\* | `Next` |
| `0x20` | FName | `NamePrivate` |
| `0x28` | uint32 | `FlagsPrivate` (+4 pad) |

### FProperty layout (extends FField, +0x30 onwards)

| Offset | Type | Field |
|---|---|---|
| `0x30` | int32 | `ArrayDim` |
| `0x34` | int32 | `ElementSize` |
| `0x38` | uint64 | `PropertyFlags` |
| `0x40` | u16+u8+pad | `RepIndex`+`BlueprintReplicationCondition` |
| `0x44` | int32 | **`Offset_Internal`** (byte offset within owner instance) |
| `0x48` | FName | `RepNotifyFunc` |
| `0x50` | FProperty\* | `PropertyLinkNext` |

### FFieldClass layout

`+0x00` is an `FName Name` (cmp_idx + number) — resolves to the property
type label (`"BoolProperty"`, `"FloatProperty"`, `"ObjectProperty"`,
`"WeakObjectProperty"`, etc.).

### Class field offsets (SQSoldier sample, Squad v10.4.1)

Full layout walks via `scripts/verify_reflection.py`. Selected fields:

| Class | Field | Offset | Type | Note |
|---|---|---|---|---|
| Actor | PrimaryActorTick | 0x028 | StructProperty | First reflected field after UObject header |
| Actor | bHidden | 0x058 | BoolProperty | one of 7 bools packed at this byte |
| Pawn | PlayerState | 0x2d8 | ObjectProperty | UObject* to APlayerState |
| Pawn | LastHitBy | 0x2e0 | ObjectProperty | for damage attribution |
| Pawn | Controller | 0x2e8 | ObjectProperty | |
| SQPawn | Team | 0x343 | EnumProperty | uint8 (player team) |
| SQSoldier | Health | 0x269c | FloatProperty | |
| SQSoldier | BreathHoldStamina | 0x2710 | FloatProperty | Squad's "stamina" is breath-hold for ADS |
| SQSoldier | CurrentHeldWeapon | 0x307c | WeakObjectProperty | |
| SQVehicle | Health | 0x9b8 | FloatProperty | |
| SQVehicle | MaxHealth | 0x9bc | FloatProperty | |
| SQVehicle | LastDamageInstigator | 0x9d8 | ObjectProperty | for vehicle kill attribution |

---

(New Squad version → new section. Do not edit old sections.)
