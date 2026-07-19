"""Runtime offset overrides (Phase 1 self-heal): apply/revert of scalar constants
and offset-dict entries, with the naming-convention allow-list bounding exactly
what a signed pack is permitted to touch."""
from sqreader.squad import snapshot as sn


def test_apply_and_revert_scalar():
    orig = sn.SQ_VEHICLE_TURRETS_OFFSET
    applied = sn.apply_offset_overrides({"SQ_VEHICLE_TURRETS_OFFSET": 0xABC})
    try:
        assert "SQ_VEHICLE_TURRETS_OFFSET" in applied
        assert sn.SQ_VEHICLE_TURRETS_OFFSET == 0xABC
    finally:
        sn.revert_offset_overrides()
    assert sn.SQ_VEHICLE_TURRETS_OFFSET == orig


def test_apply_and_revert_dict_key():
    key = next(iter(sn.DEPLOYABLE_OFFSETS))
    orig = sn.DEPLOYABLE_OFFSETS[key]
    applied = sn.apply_offset_overrides({f"DEPLOYABLE_OFFSETS.{key}": orig + 0x40})
    try:
        assert f"DEPLOYABLE_OFFSETS.{key}" in applied
        assert sn.DEPLOYABLE_OFFSETS[key] == orig + 0x40
    finally:
        sn.revert_offset_overrides()
    assert sn.DEPLOYABLE_OFFSETS[key] == orig


def test_size_constant_is_overridable():
    orig = sn.MARKER_ITEM_SIZE
    sn.apply_offset_overrides({"MARKER_ITEM_SIZE": 112})
    try:
        assert sn.MARKER_ITEM_SIZE == 112
    finally:
        sn.revert_offset_overrides()
    assert sn.MARKER_ITEM_SIZE == orig


def test_unknown_and_forbidden_keys_ignored():
    # A non-existent constant, a real non-offset attribute (a function), a NEW
    # dict key, and a non-int value — all refused, none applied.
    applied = sn.apply_offset_overrides({
        "NOPE_OFFSET": 1,
        "apply_offset_overrides": 2,               # function name — refused
        "MARKER_ITEM_OFFSETS.BrandNewField": 3,    # new dict key — refused
        "MARKER_ITEM_SIZE": "notint",              # bad value — refused
    })
    try:
        assert applied == []
        assert callable(sn.apply_offset_overrides)             # untouched
        assert "BrandNewField" not in sn.MARKER_ITEM_OFFSETS   # no new key
    finally:
        sn.revert_offset_overrides()


def test_partial_pack_applies_only_known_keys():
    orig = sn.MARKER_ITEM_SIZE
    applied = sn.apply_offset_overrides({"MARKER_ITEM_SIZE": 120, "GARBAGE": 9})
    try:
        assert applied == ["MARKER_ITEM_SIZE"]
        assert sn.MARKER_ITEM_SIZE == 120
    finally:
        sn.revert_offset_overrides()
    assert sn.MARKER_ITEM_SIZE == orig
