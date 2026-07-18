"""Tests for to_raw_layer_key — the display-name → SquadCalc RawLayerKey
conversion the offline fetch script uses to hit the SquadCalc API. Runs only
offline, but a wrong mapping means a whole map silently has no static data, so
the longest-prefix logic is worth pinning."""

from sqreader.squad.capzones import to_raw_layer_key

# A layer_bounds-shaped table: keyed by full display name, each entry carries
# the map-level mapName/mapId pair (exactly like the real data/static file).
BOUNDS = {
    "Al Basrah AAS v1": {"mapName": "Al Basrah", "mapId": "AlBasrah"},
    "Al Basrah RAAS v1": {"mapName": "Al Basrah", "mapId": "AlBasrah"},
    "Narva AAS v3": {"mapName": "Narva", "mapId": "Narva"},
    "Black Coast RAAS v2": {"mapName": "Black Coast", "mapId": "BlackCoast"},
}


def test_compound_map_name_and_mode_suffix():
    assert to_raw_layer_key("Al Basrah RAAS v1", BOUNDS) == "AlBasrah_RAAS_v1"


def test_two_word_map_name_longest_prefix():
    # "Black Coast" (two words) must win over any shorter prefix.
    assert to_raw_layer_key("Black Coast RAAS v2", BOUNDS) == "BlackCoast_RAAS_v2"


def test_single_word_map():
    assert to_raw_layer_key("Narva AAS v3", BOUNDS) == "Narva_AAS_v3"


def test_exact_map_name_no_suffix_returns_bare_id():
    # If the layer name is exactly a mapName, suffix is empty → just the id.
    bounds = {"Narva": {"mapName": "Narva", "mapId": "Narva"}}
    assert to_raw_layer_key("Narva", bounds) == "Narva"


def test_unknown_map_falls_back_to_space_underscore():
    # No prefix matches → plain space→underscore, no id swap.
    assert to_raw_layer_key("Totally Unknown Map RAAS v1", BOUNDS) \
        == "Totally_Unknown_Map_RAAS_v1"


def test_empty_layer_name():
    assert to_raw_layer_key("", BOUNDS) == ""


def test_ignores_malformed_bounds_entries():
    bounds = {
        "junk": "not-a-dict",
        "no-id": {"mapName": "Foo"},
        "Narva AAS v3": {"mapName": "Narva", "mapId": "Narva"},
    }
    assert to_raw_layer_key("Narva AAS v3", bounds) == "Narva_AAS_v3"
