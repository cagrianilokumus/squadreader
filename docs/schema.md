# sqreader snapshot schema

The contract for what the reader emits per tick. We're building up to
this incrementally — each phase adds more fields. The full target is
documented in the kickoff doc; this file tracks **what we actually
produce today**.

---

## Phase 0 — no snapshot yet

The reader can attach to the process and read raw memory at known
addresses. No structured output.

---

## Phase 1 — reflection anchors (planned)

A diagnostic dump only:

```json
{
  "binary_build_id": "96be21a...",
  "squad_version": "v10.4.1",
  "ue_version": "5.7.4-604352",
  "module_base": 2097152,
  "globals": {
    "g_world_string": 20682414,
    "g_world_pointer": null,
    "g_uobject_array": null,
    "f_name_pool": null
  },
  "first_uobjects": []
}
```

---

## Phase 3 target

See `squad-memory-reader-kickoff.md` § "Reference: Snapshot Schema
Contract (Truncated)" for the full target, and `kickoff-changes.md`
§ "Phase 4+" for the 11 additional reader paths (capture zones, FOBs,
damage events, vehicle pool, projectiles, markers, RAAS lane,
per-player extras, vehicle IDs, continuous mode, offset auto-verify).
