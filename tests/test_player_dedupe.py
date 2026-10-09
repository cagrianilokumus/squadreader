"""One row per player out of build_snapshot, however many SQPlayerStates exist.

The kill feed printed "? > MaG" seventeen ticks running (skira 6cf1f93f): a
player stuck reconnecting had two player states, neither with an EOS id, and
both reached every consumer under one name with different counters.
"""
from __future__ import annotations

from typing import Any

from sqreader.squad.snapshot import dedupe_players


def row(name: str | None, eos: str | None = None, team: int | None = 1,
        deaths: int = 0, kills: int = 0, role: str | None = None,
        soldier: bool = False, score: float = 0.0) -> dict[str, Any]:
    return {
        "name": name, "eosId": eos, "teamId": team, "roleId": role,
        "score": score, "stats": {"deaths": deaths, "kills": kills},
        "soldier": {"classShort": "BP_Soldier_USA_Rifleman1_C"} if soldier else None,
    }


def names(rows: list[dict[str, Any]]) -> list[str | None]:
    return sorted((r["name"] for r in rows), key=str)


def test_stuck_reconnect_without_ids_keeps_the_copy_holding_the_match():
    old = row("MaG", deaths=1, kills=2, role="WPMC_Recruit")
    loading = row("MaG", team=0)
    for order in ([old, loading], [loading, old]):
        out = dedupe_players(order)
        assert len(out) == 1
        assert out[0] is old


def test_a_copy_without_an_id_is_dropped_when_one_with_an_id_has_the_name():
    real = row("MaG", eos="55e972", deaths=1, kills=2, soldier=True)
    ghost = row("MaG", deaths=1, kills=2)
    out = dedupe_players([ghost, real, row("Other", eos="o")])
    assert names(out) == ["MaG", "Other"]
    assert [r for r in out if r["name"] == "MaG"][0] is real


def test_same_id_still_prefers_the_copy_with_a_live_soldier():
    gone = row("A", eos="a", deaths=3, score=50.0)
    live = row("A", eos="a", deaths=3, soldier=True)
    assert dedupe_players([live, gone]) == [live]


def test_same_id_prefers_a_joined_team_over_a_loading_copy():
    joined = row("A", eos="a", deaths=4)
    loading = row("A", eos="a", team=0)
    assert dedupe_players([joined, loading]) == [joined]
    assert dedupe_players([loading, joined]) == [joined]


def test_a_player_whose_id_dropped_out_alone_is_kept():
    # The EOS id is often unreadable on the tick a player dies; that row is the
    # only one for them and must survive, or the death is never seen.
    lone = row("Chuky", deaths=1)
    out = dedupe_players([row("A", eos="a"), lone])
    assert lone in out


def test_different_players_are_never_merged():
    out = dedupe_players([row("A", eos="a"), row("B", eos="b"), row("C"), row("D")])
    assert names(out) == ["A", "B", "C", "D"]


def test_rows_without_a_name_pass_through():
    out = dedupe_players([row(None), row(None), row("A", eos="a")])
    assert len(out) == 3
