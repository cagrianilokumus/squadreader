// Display-settings popover (gear button in the top-right controls). Houses the
// team view (both teams, or one team's own map), the number-label options
// (squad-leader numbers, all player/vehicle numbers) and the map-layer
// show/hide toggles — the single home for what the map draws.

import { memo, useEffect, useRef, useState } from "react";
import {
  useViewerStore, LAYER_ORDER, NUMBER_ORDER, LAYER_LABELS, type LayerKey,
} from "../state/viewerStore";
import { teamColor } from "../canvas/draw";
import type { TeamView } from "../canvas/teamView";

// "USMC_LO_Motorized" -> "USMC". Null when the frame has not named the faction.
function useFaction(team: 1 | 2): string | null {
  return useViewerStore((s) => {
    const id = s.curSnap?.teams?.find((t) => t.id === team)?.factionId;
    return id ? id.split("_")[0] || id : null;
  });
}

function TeamLabel({ team }: { team: 1 | 2 }) {
  const faction = useFaction(team);
  return (
    <>
      <span className="tv-dot" style={{ background: teamColor(team) }} />
      {faction ?? `Team ${team}`}
    </>
  );
}

// Both teams, or one team's own players, vehicles, FOBs, markers and rallies —
// what that team saw on its map. Objectives stay, they belong to both.
function TeamViewPicker() {
  const tv = useViewerStore((s) => s.teamView);
  const setTeamView = useViewerStore((s) => s.setTeamView);
  const opt = (t: TeamView) => ({
    role: "radio" as const, "aria-checked": tv === t,
    className: "tv-opt" + (tv === t ? " on" : ""),
    onClick: () => setTeamView(t),
  });
  return (
    <div className="tv-seg" role="radiogroup" aria-label="Team view">
      <button {...opt(0)}>Both</button>
      <button {...opt(1)} title="Only team 1's own map"><TeamLabel team={1} /></button>
      <button {...opt(2)} title="Only team 2's own map"><TeamLabel team={2} /></button>
    </div>
  );
}

// While one team is shown, say so outside the menu too — otherwise half the
// match is missing from the map with nothing on screen to explain it.
function TeamViewChip() {
  const tv = useViewerStore((s) => s.teamView);
  const setTeamView = useViewerStore((s) => s.setTeamView);
  if (tv === 0) return null;
  return (
    <button className="tv-chip" onClick={() => setTeamView(0)}
            title="Showing one team's map only — click to show both teams">
      <TeamLabel team={tv} /> only <span aria-hidden="true">×</span>
    </button>
  );
}

// Module scope on purpose. Declared inside SettingsMenu it was a NEW component
// type every render, so React remounted every row each time — and TopBar
// re-renders on every frame. At 8x playback the label under the cursor was
// replaced between mousedown and mouseup, so the click never landed.
function Row({ k }: { k: LayerKey }) {
  const on = useViewerStore((s) => !!s.layers[k]);
  const toggleLayer = useViewerStore((s) => s.toggleLayer);
  return (
    <label className="settings-row">
      <input type="checkbox" checked={on} onChange={() => toggleLayer(k)} />
      <span>{LAYER_LABELS[k]}</span>
    </label>
  );
}

// Memoised so TopBar's per-frame re-render (it reads curSnap) stops here: the
// menu takes no props, so nothing about it changes when the frame does.
export const SettingsMenu = memo(function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Dismiss on outside-click or Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="settings-wrap" ref={rootRef}>
      <TeamViewChip />
      <button className={"settings-btn" + (open ? " on" : "")}
              onClick={() => setOpen((o) => !o)}
              title="display settings" aria-label="display settings"
              aria-expanded={open}>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor"
                  strokeWidth="1.8" />
          <path fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round"
                d="M12 3.2v2.3M12 18.5v2.3M3.2 12h2.3M18.5 12h2.3
                   M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6
                   M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
        </svg>
      </button>
      {open && (
        <div className="settings-menu" role="menu">
          <div className="settings-group">Team view</div>
          <TeamViewPicker />
          <div className="settings-group">Numbers</div>
          {NUMBER_ORDER.map((k) => <Row key={k} k={k} />)}
          <div className="settings-group">Map layers</div>
          {LAYER_ORDER.map((k) => <Row key={k} k={k} />)}
        </div>
      )}
    </div>
  );
});
