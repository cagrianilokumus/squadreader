"""Plugin framework: containment, config, state, alert plumbing.

The whole point of the framework is that a broken plugin cannot cost the reader
a tick. That is what most of these assert.
"""
from __future__ import annotations

import json

from sqreader.plugins import PLUGIN_CLASSES, PluginManager, load_config, register
from sqreader.plugins.base import Plugin, TickContext
from sqreader.stats import StatsStore, recent_alerts


def _snap(tick=1, state="InProgress", players=()):
    return {
        "tick": tick,
        "gameState": {"matchState": state, "matchId": "m1"},
        "players": list(players),
        "damageEvents": [],
        "counts": {"cacheResets": 0},
    }


# --------------------------------------------------------------------------
# config
# --------------------------------------------------------------------------

def test_missing_config_disables_everything():
    assert load_config(None) == {}


def test_unreadable_config_disables_everything_instead_of_raising(tmp_path):
    assert load_config(tmp_path / "nope.json") == {}


def test_malformed_config_disables_everything(tmp_path):
    p = tmp_path / "c.json"
    p.write_text("{ this is not json", encoding="utf-8")
    assert load_config(p) == {}


def test_config_that_is_not_an_object_disables_everything(tmp_path):
    p = tmp_path / "c.json"
    p.write_text("[1, 2, 3]", encoding="utf-8")
    assert load_config(p) == {}


def test_config_shape_is_normalised(tmp_path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({
        "a": {"enabled": True, "config": {"x": 1}},
        "b": {"enabled": False},
        "c": {"enabled": True, "config": "not-a-dict"},
        "d": "garbage",
    }), encoding="utf-8")
    cfg = load_config(p)
    assert cfg["a"] == {"enabled": True, "config": {"x": 1}}
    assert cfg["b"] == {"enabled": False, "config": {}}
    assert cfg["c"] == {"enabled": True, "config": {}}   # bad config -> empty
    assert "d" not in cfg                                # not an object -> gone


# --------------------------------------------------------------------------
# containment
# --------------------------------------------------------------------------

class _Boom(Plugin):
    PLUGIN_ID = "test_boom"
    LABEL = "always raises"

    def on_tick(self, ctx: TickContext) -> None:
        raise RuntimeError("boom")


class _Counter(Plugin):
    PLUGIN_ID = "test_counter"
    LABEL = "counts ticks"

    def __init__(self, config=None):
        super().__init__(config)
        self.seen = 0

    def on_tick(self, ctx: TickContext) -> None:
        self.seen += 1


register(_Boom)
register(_Counter)


def _mgr(*ids, emit=None, config=None):
    cfg = {i: {"enabled": True, "config": config or {}} for i in ids}
    return PluginManager(cfg, server_id="t", emit_alert=emit)


def test_a_raising_plugin_does_not_stop_the_next_one():
    m = _mgr("test_boom", "test_counter")
    m.run_tick(_snap(), tick=1)
    m.run_tick(_snap(tick=2), tick=2)
    assert m.errors["test_boom"] == 2
    assert m.plugins["test_counter"].seen == 2, "the boom plugin ate the tick"


def test_manager_records_the_last_error_for_health():
    m = _mgr("test_boom")
    m.run_tick(_snap(), tick=1)
    st = m.stats()
    assert st["plugins"]["test_boom"]["errors"] == 1
    assert "boom" in st["plugins"]["test_boom"]["lastError"]


def test_unknown_plugin_id_is_skipped_not_fatal():
    m = PluginManager({"no_such_plugin": {"enabled": True, "config": {}}},
                      server_id="t")
    assert m.plugins == {}
    m.run_tick(_snap(), tick=1)      # must not raise


def test_disabled_plugins_are_never_constructed():
    m = PluginManager({"test_counter": {"enabled": False, "config": {}}},
                      server_id="t")
    assert "test_counter" not in m.plugins


def test_instance_state_survives_across_ticks():
    """A detector's whole job is noticing something across ticks — if the
    instance were rebuilt each tick, none of them could work."""
    m = _mgr("test_counter")
    for i in range(5):
        m.run_tick(_snap(tick=i), tick=i)
    assert m.plugins["test_counter"].seen == 5


def test_registered_classes_are_discoverable():
    assert "cheat_detect" in PLUGIN_CLASSES


# --------------------------------------------------------------------------
# alerts
# --------------------------------------------------------------------------

class _Alerter(Plugin):
    PLUGIN_ID = "test_alerter"
    LABEL = "alerts once per tick"

    def on_tick(self, ctx: TickContext) -> None:
        self.alert(ctx, alert_type="test", eos_id="eos-1",
                   player_name="Alice", confidence=0.5,
                   details={"why": "because"})


register(_Alerter)


def test_alert_reaches_the_stats_db(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    m = _mgr("test_alerter", emit=store.insert_alert)
    m.run_tick(_snap(), tick=7)
    store.close()

    rows = recent_alerts(db)
    assert len(rows) == 1
    r = rows[0]
    assert r["plugin_id"] == "test_alerter"
    assert r["alert_type"] == "test"
    assert r["player_name"] == "Alice"
    assert r["match_id"] == "m1"
    assert r["tick"] == 7
    assert r["details"] == {"why": "because"}   # decoded, not a JSON string


def test_alert_counter_moves_even_without_a_sink():
    m = _mgr("test_alerter")           # no emit_alert
    m.run_tick(_snap(), tick=1)
    assert m.alerts["test_alerter"] == 1


def test_a_failing_alert_sink_costs_the_alert_not_the_tick():
    def bad_sink(_row):
        raise OSError("disk full")

    m = _mgr("test_alerter", "test_counter", emit=bad_sink)
    m.run_tick(_snap(), tick=1)
    # The alerter's write blew up, but it was not counted as a plugin error and
    # the next plugin still ran.
    assert m.errors["test_alerter"] == 0
    assert m.plugins["test_counter"].seen == 1


def test_recent_alerts_can_filter_by_type(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.insert_alert({"ts": 1.0, "plugin_id": "p", "alert_type": "speedhack",
                        "eos_id": "a"})
    store.insert_alert({"ts": 2.0, "plugin_id": "p", "alert_type": "remote_melee",
                        "eos_id": "b"})
    store.close()

    assert len(recent_alerts(db)) == 2
    only = recent_alerts(db, alert_type="speedhack")
    assert len(only) == 1
    assert only[0]["eos_id"] == "a"
