"""Pure-logic tests for the Squad-log damage/wound/die correlation. No I/O,
no live process — feeds real log-line shapes through DamageLogParser and
checks the events it emits."""
from sqreader.squad.logtail import (
    DamageLogParser, _norm_weapon, find_squad_log, resolve_event_names,
)

TS = "[2026.07.12-18.31.24:082][892]"


def actual(victim, attacker, eos, weapon, dmg="50.0"):
    return (f"{TS}LogSquad: Player: {victim} ActualDamage={dmg} from {attacker} "
            f"(Online IDs: EOS: {eos} steam: 76561190000000000 | "
            f"Player Controller ID: BP_PlayerController_C_1)caused by {weapon}")


def wound(victim, ctrl="BP_PlayerController_C_1", eos="000200"):
    return (f"{TS}LogSquadTrace: [DedicatedServer]Wound(): Player: {victim} "
            f"KillingDamage=50.0 from {ctrl} (Online IDs: EOS: {eos} steam: 1)")


def die(victim, ctrl="nullptr", eos="INVALID", caused=None):
    line = (f"{TS}LogSquadTrace: [DedicatedServer]Die(): Player:{victim} "
            f"KillingDamage=100.0 from {ctrl} (Online IDs: EOS: {eos})")
    if caused is not None:
        line += f" caused by {caused}"
    return line


def revive(reviver, victim):
    return (f"{TS}LogSquad: {reviver} (Online IDs: EOS: 0002re steam: 1) "
            f"has revived {victim} (Online IDs: EOS: 0002vi steam: 2)")


def only(evs, **kw):
    hits = [e for e in evs if all(e.get(k) == v for k, v in kw.items())]
    return hits


def test_weapon_instance_id_stripped():
    assert _norm_weapon("BP_M4_SimonOffense_T800_C_2007009837") == "BP_M4_SimonOffense_T800_C"
    assert _norm_weapon("BP_Hydra70_Proj2_C_2006977119") == "BP_Hydra70_Proj2_C"
    assert _norm_weapon("nullptr") == "nullptr"


def test_wound_carries_attacker_and_weapon():
    p = DamageLogParser()
    p.feed(actual("VictimA", "KillerB", "0002ab", "BP_AK74_C_99"))
    p.feed(wound("VictimA"))
    evs = p.drain()
    w = only(evs, wounded=True)
    assert len(w) == 1
    assert w[0]["victim"] == "VictimA"
    assert w[0]["attacker"] == "KillerB"
    assert w[0]["causerWeapon"] == "BP_AK74_C"


def test_bleed_out_death_attributed_to_the_wounder():
    # The classic Squad case: hit -> Wound (attacker known) -> later Die from
    # nullptr (bleed-out, no attacker on the line). Must credit the wounder.
    p = DamageLogParser()
    p.feed(actual("VictimA", "KillerB", "0002ab", "BP_AK74_C_1"))
    p.feed(wound("VictimA"))
    p.feed(die("VictimA", ctrl="nullptr"))   # bleed-out
    evs = p.drain()
    k = only(evs, killed=True)
    assert len(k) == 1
    assert k[0]["attacker"] == "KillerB"
    assert k[0]["causerWeapon"] == "BP_AK74_C"
    assert k[0]["selfInflicted"] is False


def test_instant_kill_attributed_from_last_hit():
    # Die straight from a real controller (no Wound): attacker is the last hit.
    p = DamageLogParser()
    p.feed(actual("VictimA", "KillerB", "0002ab", "BP_Tank_C_1"))
    p.feed(die("VictimA", ctrl="BP_PlayerController_C_1"))
    k = only(p.drain(), killed=True)
    assert len(k) == 1
    assert k[0]["attacker"] == "KillerB"


def test_suicide_has_no_killer():
    p = DamageLogParser()
    p.feed(actual("SoloGuy", "SoloGuy", "0002ab", "BP_Frag_C_1"))
    p.feed(die("SoloGuy", ctrl="BP_PlayerController_C_1"))
    k = only(p.drain(), killed=True)
    assert len(k) == 1
    assert k[0]["attacker"] is None
    assert k[0]["selfInflicted"] is True


def test_revive_clears_attribution_so_later_world_death_is_unattributed():
    # KillerB downs A; a medic revives A; A later dies to a world cause.
    # That death must NOT be credited to B.
    p = DamageLogParser()
    p.feed(actual("PlayerA", "KillerB", "0002ab", "BP_AK74_C_1"))
    p.feed(wound("PlayerA"))
    p.drain()  # wounded row consumed
    p.feed(revive("Medic", "PlayerA"))       # <-- back in the fight
    p.feed(die("PlayerA", ctrl="nullptr"))   # later world death (fell)
    k = only(p.drain(), killed=True)
    assert len(k) == 1
    assert k[0]["attacker"] is None          # NOT credited to KillerB
    assert k[0]["selfInflicted"] is False


def test_revive_then_fresh_incap_credits_the_new_attacker():
    p = DamageLogParser()
    p.feed(actual("PlayerA", "KillerB", "0002ab", "BP_AK74_C_1"))
    p.feed(wound("PlayerA"))
    p.feed(revive("Medic", "PlayerA"))
    p.drain()
    p.feed(actual("PlayerA", "KillerC", "0002cd", "BP_M4_C_1"))
    p.feed(wound("PlayerA"))                  # fresh incap by C
    p.feed(die("PlayerA", ctrl="nullptr"))    # bleeds out from C's incap
    k = only(p.drain(), killed=True)
    assert len(k) == 1
    assert k[0]["attacker"] == "KillerC"     # the new wounder, not B


def test_world_death_with_no_prior_hit_has_no_attacker():
    p = DamageLogParser()
    p.feed(die("Faller", ctrl="nullptr"))   # fell, never hit by anyone
    k = only(p.drain(), killed=True)
    assert len(k) == 1
    assert k[0]["attacker"] is None
    assert k[0]["selfInflicted"] is False


def test_give_up_from_own_pawn_is_self_inflicted():
    # The real "gave up while downed" shape: Die from the victim's OWN
    # controller, caused by nullptr, with no hit ever recorded. Nobody killed
    # them — flag it as a self death so the feed shows it, not a bare "?".
    p = DamageLogParser()
    p.feed(die("Quitter", ctrl="BP_PlayerController_C_9", caused="nullptr"))
    k = only(p.drain(), killed=True)
    assert len(k) == 1
    assert k[0]["attacker"] is None
    assert k[0]["selfInflicted"] is True
    assert k[0]["damageType"] is None


def test_world_cause_surfaced_as_damage_type():
    # An unattributed death whose log line names a real cause (fall/drown/etc.)
    # carries that cause as damageType so the feed can phrase it.
    p = DamageLogParser()
    p.feed(die("Diver", ctrl="nullptr", caused="BP_Drown_C_2007009837"))
    k = only(p.drain(), killed=True)
    assert len(k) == 1
    assert k[0]["attacker"] is None
    assert k[0]["selfInflicted"] is False
    assert k[0]["damageType"] == "BP_Drown_C"   # instance id stripped


def test_bleed_out_still_attributed_even_with_caused_by_nullptr():
    # Regression: a real bleed-out (wounded by an enemy, then Die caused by
    # nullptr) must STILL credit the wounder — the give-up path only triggers
    # when there is no attacker on record.
    p = DamageLogParser()
    p.feed(actual("VictimA", "KillerB", "0002ab", "BP_AK74_C_1"))
    p.feed(wound("VictimA"))
    p.feed(die("VictimA", ctrl="BP_PlayerController_C_1", caused="nullptr"))
    k = only(p.drain(), killed=True)
    assert len(k) == 1
    assert k[0]["attacker"] == "KillerB"
    assert k[0]["selfInflicted"] is False


def test_die_eos_recovers_attacker_after_cache_expiry():
    # Death lands long after the wound, so the name-cache is empty — but the Die
    # line still carries the killer's controller EOS. resolve_event_names
    # recovers the attacker from the live roster. This is the round-end "?" fix.
    p = DamageLogParser()
    p.feed(die("Victim", ctrl="BP_PlayerController_C_5", eos="0002killer",
               caused="BP_Soldier_RU_Rifleman1_Desert_C_1"))
    evs = p.drain()
    k = only(evs, killed=True)
    assert len(k) == 1
    assert k[0]["attacker"] is None             # logtail alone can't name them
    assert k[0]["killerEos"] == "0002killer"    # but it kept the Die-line EOS
    resolve_event_names(evs, [
        {"name": "KillerBob", "eosId": "0002killer"},
        {"name": "Victim", "eosId": "0002victim"},
    ])
    assert k[0]["attacker"] == "KillerBob"       # recovered by EOS
    assert k[0]["attackerEosId"] == "0002killer"
    assert "killerEos" not in k[0]               # scratch field dropped


def test_die_eos_self_kill_not_credited_to_victim():
    # If the Die-line EOS is the victim's own, do not name them their own killer
    # — flag self-inflicted instead.
    p = DamageLogParser()
    p.feed(die("Loner", ctrl="BP_PlayerController_C_7", eos="0002loner",
               caused="BP_Frag_C_1"))
    evs = p.drain()
    resolve_event_names(evs, [{"name": "Loner", "eosId": "0002loner"}])
    k = only(evs, killed=True)[0]
    assert k["attacker"] is None
    assert k["selfInflicted"] is True


def test_die_eos_unknown_killer_left_unattributed():
    # Killer EOS not on the live roster (disconnected) — stays "?" rather than
    # inventing a name.
    p = DamageLogParser()
    p.feed(die("Victim", ctrl="BP_PlayerController_C_5", eos="0002gone",
               caused="BP_Soldier_RU_Rifleman1_Desert_C_1"))
    evs = p.drain()
    resolve_event_names(evs, [{"name": "Victim", "eosId": "0002victim"}])
    k = only(evs, killed=True)[0]
    assert k["attacker"] is None
    assert k["selfInflicted"] is False


def test_names_with_spaces_and_unicode():
    p = DamageLogParser()
    p.feed(actual("[ TŞK ] Hannibal", "「Ns」 Alexa", "0002cd", "BP_M4_C_1"))
    p.feed(wound("[ TŞK ] Hannibal"))
    w = only(p.drain(), wounded=True)
    assert len(w) == 1
    assert w[0]["victim"] == "[ TŞK ] Hannibal"
    assert w[0]["attacker"] == "「Ns」 Alexa"


def test_correlation_state_survives_drain():
    # The startup catch-up feeds the log tail, drains-and-discards the stale
    # events, then goes live — so a death after the discard must still be
    # attributed from the wound that preceded it. i.e. drain() must NOT wipe
    # the pending / wounded_by correlation state.
    p = DamageLogParser()
    p.feed(actual("VictimA", "KillerB", "0002ab", "BP_AK74_C_1"))
    p.feed(wound("VictimA"))
    p.drain()  # <-- catch-up discard
    p.feed(die("VictimA", ctrl="nullptr"))   # dies AFTER the discard
    k = only(p.drain(), killed=True)
    assert len(k) == 1
    assert k[0]["attacker"] == "KillerB"     # still credited to the wounder


def test_drain_clears():
    p = DamageLogParser()
    p.feed(actual("V", "K", "0002ab", "BP_X_C_1"))
    p.feed(wound("V"))
    assert len(p.drain()) == 1
    assert p.drain() == []


def test_resolve_event_names_strips_clan_tag_to_base():
    players = [{"name": "I3lack"}, {"name": "MorrukGta5"}, {"name": "Selective"}]
    events = [
        {"attacker": "『GM』 I3lack", "victim": "Selective"},
        {"attacker": "TIM MorrukGta5", "victim": "『GM』 I3lack"},
    ]
    resolve_event_names(events, players)
    assert events[0]["attacker"] == "I3lack"      # tag stripped to base
    assert events[0]["victim"] == "Selective"     # exact stays
    assert events[1]["attacker"] == "MorrukGta5"
    assert events[1]["victim"] == "I3lack"


def test_resolve_event_names_no_midword_false_match():
    # "lack" must NOT match "I3lack" (no tag boundary before it).
    players = [{"name": "lack"}, {"name": "I3lack"}]
    events = [{"attacker": "『GM』 I3lack", "victim": None}]
    resolve_event_names(events, players)
    assert events[0]["attacker"] == "I3lack"


def test_resolve_event_names_unknown_left_as_is():
    players = [{"name": "Alice"}]
    events = [{"attacker": "SomeoneWhoLeft", "victim": "Alice"}]
    resolve_event_names(events, players)
    assert events[0]["attacker"] == "SomeoneWhoLeft"  # no crash, unchanged
    assert events[0]["victim"] == "Alice"


def test_find_squad_log_returns_none_or_str():
    # Environment-dependent (no logs on the test box) — just must not raise.
    r = find_squad_log()
    assert r is None or isinstance(r, str)
