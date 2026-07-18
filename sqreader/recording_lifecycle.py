"""Shared, dependency-free recording lifecycle security constants."""

from __future__ import annotations


RECORDING_STATE_ACTIVE = "active"
RECORDING_STATE_FINALIZED = "finalized"
RECORDING_STATE_UNVERIFIED = "unverified"

# Hub authorization and recorder rotation must use the same threshold.  If the
# recorder accepted a new match id sooner than the hub, a transient id could
# create an orphan recording outside the set of ids the HTTP gate protects.
MATCH_TRANSITION_CONFIRM_TICKS = 3

# Only values known to mean "not currently playing" may contribute to an end
# confirmation. Unknown/future/torn strings remain ambiguous and fail closed.
INACTIVE_MATCH_STATES = frozenset({
    "WaitingToStart",
    "Warmup",
    "WaitingPostMatch",
    "EndState",
})


__all__ = [
    "RECORDING_STATE_ACTIVE",
    "RECORDING_STATE_FINALIZED",
    "RECORDING_STATE_UNVERIFIED",
    "MATCH_TRANSITION_CONFIRM_TICKS",
    "INACTIVE_MATCH_STATES",
]
