// Player search — top-left pill that filters the current snapshot's players by
// name (or clan tag) and, on pick, selects + follows that player (opens the
// PlayerPanel and centres the camera on them). Works in both live and replay
// (reads curSnap, which is the current frame in either mode).

import { useEffect, useRef, useState } from "react";
import { useViewerStore } from "../state/viewerStore";
import { teamColor } from "../canvas/draw";
import { playerKey } from "./PlayerPanel";
import type { Player } from "../state/types";

const MAX_RESULTS = 14;

export function PlayerSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const curSnap = useViewerStore((s) => s.curSnap);
  const setSelectedPlayerKey = useViewerStore((s) => s.setSelectedPlayerKey);
  const setFollowKey = useViewerStore((s) => s.setFollowKey);

  const query = q.trim().toLowerCase();
  const players = curSnap?.players ?? [];
  const matches = query
    ? players
        .filter((p) =>
          (p.name ?? "").toLowerCase().includes(query) ||
          (p.clanTag ?? "").toLowerCase().includes(query))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
        .slice(0, MAX_RESULTS)
    : [];

  // Close the dropdown on any outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => { setHi(0); }, [q]);

  const pick = (p: Player) => {
    const key = playerKey(p);
    setSelectedPlayerKey(key);   // opens the PlayerPanel
    setFollowKey(key);           // centres + follows on the map
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault(); setOpen(true);
      setHi((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (matches[hi]) pick(matches[hi]);
    } else if (e.key === "Escape") {
      if (q) { setQ(""); } else { setOpen(false); e.currentTarget.blur(); }
    }
  };

  return (
    <div className="player-search" ref={rootRef}>
      <label className="ps-input">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input value={q}
               onChange={(e) => { setQ(e.target.value); setOpen(true); }}
               onFocus={() => setOpen(true)}
               onKeyDown={onKeyDown}
               placeholder="Search players…" spellCheck={false} />
        {q && <button className="ps-clear" title="Clear"
                      onClick={() => setQ("")}>✕</button>}
      </label>

      {open && query && (
        <div className="ps-drop">
          {matches.length === 0 ? (
            <div className="ps-empty">No matching players</div>
          ) : (
            matches.map((p, i) => (
              <button key={playerKey(p)}
                      className={"ps-item" + (i === hi ? " ps-hi" : "")}
                      onMouseEnter={() => setHi(i)}
                      onClick={() => pick(p)}>
                <span className="ps-dot"
                      style={{ background: teamColor(p.teamId) }} />
                <span className="ps-name">
                  {p.clanTag && <span className="ps-clan">{p.clanTag} </span>}
                  {p.name ?? "—"}
                </span>
                <span className="ps-sq">
                  {p.squadName ?? (p.squadId ? `Team ${p.squadId}` : "No squad")}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
