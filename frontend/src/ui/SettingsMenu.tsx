// Display-settings popover (gear button in the top-right controls). Houses the
// number-label options (squad-leader numbers, all player/vehicle numbers) and
// the map-layer show/hide toggles — the single home for what the map draws.

import { useEffect, useRef, useState } from "react";
import {
  useViewerStore, LAYER_ORDER, NUMBER_ORDER, LAYER_LABELS, type LayerKey,
} from "../state/viewerStore";

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const layers = useViewerStore((s) => s.layers);
  const toggleLayer = useViewerStore((s) => s.toggleLayer);
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

  const Row = ({ k }: { k: LayerKey }) => (
    <label className="settings-row">
      <input type="checkbox" checked={!!layers[k]}
             onChange={() => toggleLayer(k)} />
      <span>{LAYER_LABELS[k]}</span>
    </label>
  );

  return (
    <div className="settings-wrap" ref={rootRef}>
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
          <div className="settings-group">Numbers</div>
          {NUMBER_ORDER.map((k) => <Row key={k} k={k} />)}
          <div className="settings-group">Map layers</div>
          {LAYER_ORDER.map((k) => <Row key={k} k={k} />)}
        </div>
      )}
    </div>
  );
}
