"""Pure-logic tests for clean_nonfinite — the pass that makes snapshots
survive strict JSON parsers (browsers, jq, serde) by turning NaN/Inf into
null. SQSquadState.objectiveScore is 0/0 = NaN at match start, so this is
a real code path, not a theoretical one."""

from sqreader.squad.snapshot import clean_nonfinite


def test_nan_and_infinities_become_none():
    assert clean_nonfinite(float("nan")) is None
    assert clean_nonfinite(float("inf")) is None
    assert clean_nonfinite(float("-inf")) is None


def test_finite_floats_pass_through():
    for v in (0.0, -1.5, 3.14, 1e300, 2.0):
        assert clean_nonfinite(v) == v


def test_non_float_scalars_pass_through():
    assert clean_nonfinite("hello") == "hello"
    assert clean_nonfinite(42) == 42
    assert clean_nonfinite(None) is None


def test_bools_are_preserved_not_coerced():
    # bool is not a float in Python, so it must ride through untouched.
    assert clean_nonfinite(True) is True
    assert clean_nonfinite(False) is False


def test_nested_dicts_and_lists_are_walked():
    snap = {
        "tick": 5,
        "teams": [
            {"id": 1, "score": float("nan")},
            {"id": 2, "score": 12.5},
        ],
        "meta": {"ratio": float("inf"), "name": "raas"},
    }
    out = clean_nonfinite(snap)
    assert out == {
        "tick": 5,
        "teams": [
            {"id": 1, "score": None},
            {"id": 2, "score": 12.5},
        ],
        "meta": {"ratio": None, "name": "raas"},
    }


def test_deeply_nested_nan():
    out = clean_nonfinite({"a": {"b": {"c": [float("nan"), 1.0]}}})
    assert out == {"a": {"b": {"c": [None, 1.0]}}}


def test_result_is_strict_json_serializable():
    import json

    dirty = {"x": float("nan"), "y": [float("inf"), 2.0], "z": "ok"}
    clean = clean_nonfinite(dirty)
    # allow_nan=False is what every non-Python parser effectively enforces.
    text = json.dumps(clean, allow_nan=False)
    assert "NaN" not in text and "Infinity" not in text
