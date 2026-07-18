"""Pure-logic tests for the advisory address cache. Everything is driven
through an explicit `path=` into tmp_path, so nothing touches the real
~/.cache file or /proc."""
import json

from sqreader import addrcache


def test_put_then_get_round_trips(tmp_path):
    cache = tmp_path / "addresses.json"
    addrcache.put("bin-A", "gobjects", 246154488, path=cache)
    addrcache.put("bin-A", "fnamepool", 245699840, path=cache)
    assert addrcache.get("bin-A", "gobjects", path=cache) == 246154488
    assert addrcache.get("bin-A", "fnamepool", path=cache) == 245699840


def test_put_creates_parent_dirs(tmp_path):
    cache = tmp_path / "nested" / "deep" / "addresses.json"
    addrcache.put("bin-A", "gobjects", 123, path=cache)
    assert cache.exists()
    assert addrcache.get("bin-A", "gobjects", path=cache) == 123


def test_multiple_binaries_coexist(tmp_path):
    cache = tmp_path / "addresses.json"
    addrcache.put("bin-A", "gobjects", 111, path=cache)
    addrcache.put("bin-B", "gobjects", 222, path=cache)
    assert addrcache.get("bin-A", "gobjects", path=cache) == 111
    assert addrcache.get("bin-B", "gobjects", path=cache) == 222
    # Both keys persist in the same file.
    data = json.loads(cache.read_text())
    assert set(data) == {"bin-A", "bin-B"}


def test_get_none_binary_id_is_none(tmp_path):
    cache = tmp_path / "addresses.json"
    addrcache.put("bin-A", "gobjects", 111, path=cache)
    assert addrcache.get(None, "gobjects", path=cache) is None


def test_get_missing_key_or_binary_is_none(tmp_path):
    cache = tmp_path / "addresses.json"
    addrcache.put("bin-A", "gobjects", 111, path=cache)
    assert addrcache.get("bin-A", "does-not-exist", path=cache) is None
    assert addrcache.get("bin-Z", "gobjects", path=cache) is None


def test_put_none_binary_id_is_noop(tmp_path):
    cache = tmp_path / "addresses.json"
    addrcache.put(None, "gobjects", 111, path=cache)
    assert not cache.exists()


def test_load_missing_file_is_empty(tmp_path):
    assert addrcache.load(tmp_path / "nope.json") == {}


def test_load_corrupt_json_is_empty(tmp_path):
    cache = tmp_path / "addresses.json"
    cache.write_text("{ this is not json ]", encoding="utf-8")
    assert addrcache.load(cache) == {}
    # And get() over a corrupt file degrades to a clean miss, not a crash.
    assert addrcache.get("bin-A", "gobjects", path=cache) is None


def test_put_overwrites_existing_value(tmp_path):
    cache = tmp_path / "addresses.json"
    addrcache.put("bin-A", "gobjects", 111, path=cache)
    addrcache.put("bin-A", "gobjects", 999, path=cache)
    assert addrcache.get("bin-A", "gobjects", path=cache) == 999


def test_non_int_cached_value_ignored(tmp_path):
    # A hand-edited / corrupt entry with a non-int value must not be
    # handed back as if it were an address.
    cache = tmp_path / "addresses.json"
    cache.write_text(json.dumps({"bin-A": {"gobjects": "oops"}}), encoding="utf-8")
    assert addrcache.get("bin-A", "gobjects", path=cache) is None
