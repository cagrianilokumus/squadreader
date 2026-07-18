"""
UStruct + FProperty walker for UE 5.7 (Squad v10.4.1).

WHAT WE BUILT
-------------
Empirically-verified reflection metadata reader. Given a UClass pointer
(obtained via the GUObjectArray enumerator), produces an ordered list of
its reflected properties — each property's name, type, offset within an
instance, element size, and array dim. Walks the SuperStruct chain so
inherited fields are included.

This is the foundation for Phase 3: once we have `{field_name: offset}`
per class, reading actual game state is just typed reads at known
offsets relative to a UObject instance.

LAYOUT (UE 5.7 on Linux x86_64, verified by dumping Object/Actor)
-----------------------------------------------------------------

UStruct extends UField extends UObject. The first reflection-relevant
field within a UClass is at +0x40 (SuperStruct), not the +0x30 that the
naive UE source layout would suggest — UE 5.x inserted ~16 bytes of
internal members between UField.Next (+0x28) and UStruct.SuperStruct.

  UStruct (UClass-relative offsets):
    +0x28   UField.Next                 (null for top-level reflection objects)
    +0x40   UStruct* SuperStruct        (null = root, e.g. UObject's UClass)
    +0x48   UField*  Children           (UFunction linked list — method metadata)
    +0x50   FField*  ChildProperties    (FProperty linked list — THE field list)
    +0x58   int32    PropertiesSize     (sizeof(instance), e.g. 40 for UObject, 696 for AActor)
    +0x5c   int32    MinAlignment

  FField (base for FProperty):
    +0x00   void*        Vtable          (compiler-generated; varies per FProperty type)
    +0x08   FFieldClass* ClassPrivate    (per-type singleton in extended-bss)
    +0x10   uint64       Owner           (tagged pointer; low bit set => UObject*)
    +0x18   FField*      Next            (linked-list next; null = end)
    +0x20   FName        NamePrivate     (the property's name)
    +0x28   uint32       FlagsPrivate    (+ 4B pad)

  FProperty (extends FField):
    +0x30   int32    ArrayDim
    +0x34   int32    ElementSize
    +0x38   uint64   PropertyFlags
    +0x40   uint16   RepIndex (+ 1B BlueprintReplicationCondition + 5B pad)
    +0x44   int32    Offset_Internal     <<< THE FIELD WE NEED
    +0x48   FName    RepNotifyFunc
    +0x50   FProperty* PropertyLinkNext
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

from ..mem import ProcessMemory
from .fname import FNameEntryAllocator
from .uobject import UOBJ_NAME_PRIVATE

# ----- UStruct offsets -------------------------------------------------------

USTRUCT_SUPER_STRUCT = 0x40
USTRUCT_CHILDREN = 0x48
USTRUCT_CHILD_PROPERTIES = 0x50
USTRUCT_PROPERTIES_SIZE = 0x58
USTRUCT_MIN_ALIGNMENT = 0x5C

# ----- FField offsets --------------------------------------------------------

FFIELD_VTABLE = 0x00
FFIELD_CLASS_PRIVATE = 0x08         # FFieldClass* — was 0 in older UE; +0 is vtable in UE 5.7
FFIELD_OWNER = 0x10
FFIELD_NEXT = 0x18
FFIELD_NAME_PRIVATE = 0x20
FFIELD_FLAGS_PRIVATE = 0x28

# ----- FProperty offsets -----------------------------------------------------

FPROPERTY_ARRAY_DIM = 0x30
FPROPERTY_ELEMENT_SIZE = 0x34
FPROPERTY_FLAGS = 0x38
FPROPERTY_REP_INDEX = 0x40
FPROPERTY_OFFSET_INTERNAL = 0x44
FPROPERTY_REP_NOTIFY_FUNC = 0x48
FPROPERTY_LINK_NEXT = 0x50

# FStructProperty.Struct (UScriptStruct*) — extends FProperty.
# Verified empirically on AActor.PrimaryActorTick (→ ActorTickFunction)
# and SQPlayerState.PlayerStateData (→ PlayerStateDataObject).
FSTRUCTPROPERTY_STRUCT_OFFSET = 0x70

# FBoolProperty trailing 4 bytes — same slot as FStructProperty.Struct
# (different subclass, same +0x70 location):
#   +0x70  uint8 FieldSize    (size of the underlying integer, usually 1)
#   +0x71  uint8 ByteOffset   (extra offset on top of Offset_Internal)
#   +0x72  uint8 ByteMask     (bit set inside the byte that this bool owns)
#   +0x73  uint8 FieldMask    (typically equals ByteMask for non-bitfields,
#                              == 0xFF for own-byte bools)
FBOOLPROPERTY_FIELDSIZE_OFFSET = 0x70
FBOOLPROPERTY_BYTEOFFSET_OFFSET = 0x71
FBOOLPROPERTY_BYTEMASK_OFFSET = 0x72
FBOOLPROPERTY_FIELDMASK_OFFSET = 0x73

# FFieldClass starts with FName Name (its first member is the type name).
FFIELDCLASS_NAME = 0x00


# ----- data classes ----------------------------------------------------------

@dataclass(slots=True)
class FPropertyInfo:
    addr: int
    name: str
    type_name: str          # e.g. "FloatProperty", "BoolProperty", "ObjectProperty"
    offset: int             # Offset_Internal within owner instance
    element_size: int
    array_dim: int
    flags: int              # EPropertyFlags (uint64)

    def __repr__(self) -> str:
        return (f"<{self.name}: {self.type_name} @ +{self.offset:#x}"
                f"  size={self.element_size}  dim={self.array_dim}>")


@dataclass(slots=True)
class UStructInfo:
    addr: int
    name: str
    super_addr: int
    properties_size: int
    min_alignment: int


# ----- low-level readers ----------------------------------------------------

def _read_fname_at(pm: ProcessMemory, addr: int,
                   alloc: FNameEntryAllocator) -> str | None:
    """Resolve an FName stored as 8 bytes at `addr`."""
    nm = pm.try_read(addr, 8)
    if nm is None or len(nm) < 8:
        return None
    cmp_idx, number = struct.unpack("<II", nm)
    return alloc.fname_to_str(cmp_idx, number)


def read_field_class_name(pm: ProcessMemory, ffield_class_addr: int,
                          alloc: FNameEntryAllocator) -> str | None:
    """Resolve the property type name (FName at offset 0 of FFieldClass)."""
    return _read_fname_at(pm, ffield_class_addr + FFIELDCLASS_NAME, alloc)


def read_fproperty(pm: ProcessMemory, field_addr: int,
                   alloc: FNameEntryAllocator) -> FPropertyInfo | None:
    """Read one FProperty header. Returns None on read failure."""
    data = pm.try_read(field_addr, FPROPERTY_LINK_NEXT)  # 0x50 bytes is enough
    if data is None or len(data) < FPROPERTY_OFFSET_INTERNAL + 4:
        return None
    class_private = struct.unpack_from("<Q", data, FFIELD_CLASS_PRIVATE)[0]
    name = _read_fname_at(pm, field_addr + FFIELD_NAME_PRIVATE, alloc) or "<?>"
    type_name = (read_field_class_name(pm, class_private, alloc)
                 if class_private else None) or "<?>"
    array_dim = struct.unpack_from("<i", data, FPROPERTY_ARRAY_DIM)[0]
    element_size = struct.unpack_from("<i", data, FPROPERTY_ELEMENT_SIZE)[0]
    flags = struct.unpack_from("<Q", data, FPROPERTY_FLAGS)[0]
    offset = struct.unpack_from("<i", data, FPROPERTY_OFFSET_INTERNAL)[0]
    return FPropertyInfo(
        addr=field_addr,
        name=name,
        type_name=type_name,
        offset=offset,
        element_size=element_size,
        array_dim=array_dim,
        flags=flags,
    )


def read_ustruct_header(pm: ProcessMemory, struct_addr: int,
                        alloc: FNameEntryAllocator) -> UStructInfo:
    """Read a UStruct's reflection header (Name + Super + sizes).

    Defensive against garbage `struct_addr` (transient class pointer
    reuse after EIO): VA-cap check up front, every read wrapped. On
    failure returns an info with `super_addr=0`, `properties_size=0`
    so downstream walkers terminate cleanly instead of raising
    OverflowError mid-snapshot.
    """
    if struct_addr <= 0 or struct_addr > 0x0000_7fff_ffff_ffff:
        return UStructInfo(addr=struct_addr, name="<?>", super_addr=0,
                           properties_size=0, min_alignment=0)
    name = _read_fname_at(pm, struct_addr + UOBJ_NAME_PRIVATE, alloc) or "<?>"
    try:
        super_addr = pm.read_u64(struct_addr + USTRUCT_SUPER_STRUCT)
    except (OverflowError, OSError, ValueError):
        super_addr = 0
    try:
        props_size = pm.read_i32(struct_addr + USTRUCT_PROPERTIES_SIZE)
    except (OverflowError, OSError, ValueError):
        props_size = 0
    try:
        min_align = pm.read_i32(struct_addr + USTRUCT_MIN_ALIGNMENT)
    except (OverflowError, OSError, ValueError):
        min_align = 0
    return UStructInfo(
        addr=struct_addr,
        name=name,
        super_addr=super_addr,
        properties_size=props_size,
        min_alignment=min_align,
    )


# ----- walkers ---------------------------------------------------------------

def walk_properties(pm: ProcessMemory, struct_addr: int,
                    alloc: FNameEntryAllocator,
                    *, max_props: int = 4096) -> list[FPropertyInfo]:
    """Walk a UStruct's ChildProperties linked list (just this level).

    Defensive against garbage `struct_addr` and corrupt Next pointers
    mid-walk: VA-cap check up front, each pm.read_u64 wrapped. Same
    rationale as walk_super_chain — a single bad UClass walked through
    the snapshot scanner used to crash the whole tick with
    OverflowError. Now: return what we have so far, caller (cache
    layer) sees a short / empty list and treats it as a miss.
    """
    if struct_addr <= 0 or struct_addr > 0x0000_7fff_ffff_ffff:
        return []
    try:
        head = pm.read_u64(struct_addr + USTRUCT_CHILD_PROPERTIES)
    except (OverflowError, OSError, ValueError):
        return []
    out: list[FPropertyInfo] = []
    visited: set[int] = set()
    cur = head
    while cur != 0 and cur not in visited and len(out) < max_props:
        if cur < 0 or cur > 0x0000_7fff_ffff_ffff:
            break
        visited.add(cur)
        prop = read_fproperty(pm, cur, alloc)
        if prop is None:
            break
        out.append(prop)
        try:
            cur = pm.read_u64(cur + FFIELD_NEXT)
        except (OverflowError, OSError, ValueError):
            break
    return out


def walk_super_chain(pm: ProcessMemory, struct_addr: int) -> list[int]:
    """Return [struct_addr, super_addr, super_super_addr, ...] up to root.

    Defensive: a garbage `cur` (uobject_class_private read picked up a
    transient bad pointer after an EIO or freed slot reuse) can push
    `cur + USTRUCT_SUPER_STRUCT` past the 64-bit user-mode address
    range, OR force pm.read_u64's lseek to overflow C long. Either
    way, we stop the walk and return what we've got — the caller's
    `_is_subclass_of` sees a short chain, doesn't cache the result,
    and re-checks next tick when the address has hopefully settled.
    Without this, a single bad UObject in the 187 k-entry GUObjectArray
    would crash the whole snapshot build and starve the SSE stream.
    """
    chain: list[int] = []
    visited: set[int] = set()
    cur = struct_addr
    while cur != 0 and cur not in visited:
        # User-mode VA cap on x86-64 Linux is 0x00007fff_ffffffff.
        # Anything above that is either a kernel-space pointer or a
        # garbage bit-pattern (often a tagged ptr from UE's
        # TWeakObjectPtr). Stop early; don't even try the read.
        if cur < 0 or cur > 0x0000_7fff_ffff_ffff:
            break
        visited.add(cur)
        chain.append(cur)
        try:
            cur = pm.read_u64(cur + USTRUCT_SUPER_STRUCT)
        except (OverflowError, OSError, ValueError):
            break
    return chain


def get_class_layout(pm: ProcessMemory, class_addr: int,
                     alloc: FNameEntryAllocator) -> dict[str, FPropertyInfo]:
    """
    Build a merged {field_name: FPropertyInfo} for a class, walking the
    SuperStruct chain so inherited fields are included. Derived overrides
    inherited (by name).
    """
    chain = walk_super_chain(pm, class_addr)
    fields: dict[str, FPropertyInfo] = {}
    # root-first so derived overrides shadow parent
    for sa in reversed(chain):
        for prop in walk_properties(pm, sa, alloc):
            fields[prop.name] = prop
    return fields


def describe_class(pm: ProcessMemory, class_addr: int,
                   alloc: FNameEntryAllocator) -> list[tuple[UStructInfo, list[FPropertyInfo]]]:
    """
    Walk the SuperStruct chain and return a per-level breakdown:
    [(struct_info, own_properties), ...] from derived down to root.
    """
    chain = walk_super_chain(pm, class_addr)
    out = []
    for sa in chain:
        info = read_ustruct_header(pm, sa, alloc)
        props = walk_properties(pm, sa, alloc)
        out.append((info, props))
    return out


def find_field_by_name(pm: ProcessMemory, struct_addr: int,
                       target_name: str,
                       alloc: FNameEntryAllocator) -> int | None:
    """
    Walk a single UStruct's ChildProperties chain and return the FField
    address whose NamePrivate equals `target_name` (no inheritance walk —
    use walk_super_chain for that).
    """
    # Hardened: same VA-cap + per-read try/except pattern as
    # walk_super_chain / walk_properties. A garbage struct_addr (transient
    # bad reflection read during resolve_paths or post-cache-reset tick)
    # used to raise OverflowError uncaught, blowing up the snapshot.
    if struct_addr <= 0 or struct_addr > 0x0000_7fff_ffff_ffff:
        return None
    try:
        head = pm.read_u64(struct_addr + USTRUCT_CHILD_PROPERTIES)
    except (OSError, OverflowError, ValueError):
        return None
    cur = head
    visited: set[int] = set()
    while cur and cur not in visited:
        if cur < 0 or cur > 0x0000_7fff_ffff_ffff:
            break
        visited.add(cur)
        nm = pm.try_read(cur + FFIELD_NAME_PRIVATE, 8)
        if nm and len(nm) >= 8:
            ci, num = struct.unpack("<II", nm)
            n = alloc.fname_to_str(ci, num)
            if n == target_name:
                return cur
        nxt = pm.try_read(cur + FFIELD_NEXT, 8)
        cur = struct.unpack("<Q", nxt)[0] if nxt and len(nxt) >= 8 else 0
    return None


def find_field_by_name_with_super(pm: ProcessMemory, struct_addr: int,
                                  target_name: str,
                                  alloc: FNameEntryAllocator) -> int | None:
    """Same as find_field_by_name but also walks SuperStruct chain."""
    for sa in walk_super_chain(pm, struct_addr):
        a = find_field_by_name(pm, sa, target_name, alloc)
        if a is not None:
            return a
    return None


def read_fstructproperty_struct(pm: ProcessMemory, ffield_addr: int) -> int:
    """
    Return the UScriptStruct* held by an FStructProperty field. The caller
    is responsible for knowing the field is in fact StructProperty-typed.
    Returns 0 on any /proc read failure — callers already treat 0 as
    "struct not found".
    """
    if ffield_addr <= 0 or ffield_addr > 0x0000_7fff_ffff_ffff:
        return 0
    try:
        return pm.read_u64(ffield_addr + FSTRUCTPROPERTY_STRUCT_OFFSET)
    except (OSError, OverflowError, ValueError):
        return 0


def read_fbool_property_mask(pm: ProcessMemory,
                             ffield_addr: int) -> tuple[int, int]:
    """
    Return (ByteOffset, ByteMask) for an FBoolProperty field.

    Adding `ByteOffset` to the property's `Offset_Internal` produces
    the byte address (within the owning instance) that stores the bit;
    `ByteMask` picks out the specific bit (e.g. 0x08 = bit 3 = the
    fourth bool packed into the same byte).

    For non-bitfield bools (own byte) ByteMask is typically 0xFF.
    """
    data = pm.try_read(ffield_addr + FBOOLPROPERTY_FIELDSIZE_OFFSET, 4)
    if data is None or len(data) < 4:
        # Reasonable fallback: assume own byte at the property's
        # Offset_Internal with no extra offset.
        return (0, 0xFF)
    return (data[1], data[2])


def bool_property_mask(pm: ProcessMemory,
                       owner_class_addr: int,
                       field_name: str,
                       alloc: FNameEntryAllocator,
                       ) -> tuple[int, int] | None:
    """
    For a class member of type BoolProperty, return
      (effective_byte_offset_within_instance, byte_mask)
    ready to use as:  (instance[effective_off] & mask) != 0.

    Returns None if the field doesn't exist or isn't a BoolProperty.
    """
    ff = find_field_by_name_with_super(pm, owner_class_addr, field_name, alloc)
    if ff is None:
        return None
    prop = read_fproperty(pm, ff, alloc)
    if prop is None or prop.type_name != "BoolProperty":
        return None
    byte_off, byte_mask = read_fbool_property_mask(pm, ff)
    if byte_mask == 0:
        return None
    return (prop.offset + byte_off, byte_mask)


def struct_layout_for_field(pm: ProcessMemory, owner_class_addr: int,
                            field_name: str,
                            alloc: FNameEntryAllocator
                            ) -> dict[str, FPropertyInfo]:
    """
    For a class member of type StructProperty, return the field map of
    its UScriptStruct (so the caller can read the struct contents from
    an owner instance using `instance_addr + member_offset + sub_offset`).
    Returns {} if the field isn't found or isn't a StructProperty.
    """
    ff = find_field_by_name_with_super(pm, owner_class_addr, field_name, alloc)
    if ff is None:
        return {}
    struct_addr = read_fstructproperty_struct(pm, ff)
    if struct_addr == 0:
        return {}
    return get_class_layout(pm, struct_addr, alloc)


__all__ = [
    "FPropertyInfo",
    "UStructInfo",
    "read_fproperty",
    "read_ustruct_header",
    "read_field_class_name",
    "walk_properties",
    "walk_super_chain",
    "get_class_layout",
    "describe_class",
    "find_field_by_name",
    "find_field_by_name_with_super",
    "read_fstructproperty_struct",
    "read_fbool_property_mask",
    "bool_property_mask",
    "struct_layout_for_field",
    "USTRUCT_SUPER_STRUCT",
    "USTRUCT_CHILD_PROPERTIES",
    "USTRUCT_PROPERTIES_SIZE",
    "FFIELD_NEXT",
    "FFIELD_NAME_PRIVATE",
    "FPROPERTY_OFFSET_INTERNAL",
    "FSTRUCTPROPERTY_STRUCT_OFFSET",
]
