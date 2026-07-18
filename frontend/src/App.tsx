import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { MapCanvas } from "./canvas/MapCanvas";
import type { Hit } from "./canvas/hitTest";
import { TopBar } from "./ui/TopBar";
import { TeamBar } from "./ui/TeamBar";
import { MatchOverlay } from "./ui/MatchOverlay";
import { BufferOverlay } from "./ui/BufferOverlay";
import { PlayerSearch } from "./ui/PlayerSearch";
import { Tooltip } from "./ui/Tooltip";
import { PlayerPanel, playerKey } from "./ui/PlayerPanel";
import { InfoPanel } from "./ui/InfoPanel";
import { Home } from "./ui/Home";

// The vehicle panel drags in the 433 KB vehicle-loadout catalog, which nothing
// else uses. Load it (and the catalog) only when a vehicle is actually clicked —
// see the conditional mount below, which is what makes the split defer instead of
// loading on boot.
const VehiclePanel = lazy(() =>
  import("./ui/VehiclePanel").then((m) => ({ default: m.VehiclePanel })));
import { KillFeed } from "./ui/KillFeed";
import { Scoreboard } from "./ui/Scoreboard";
import { TimelineBar } from "./ui/TimelineBar";
import { RecordingPicker } from "./ui/RecordingPicker";
import { PlayerStats } from "./ui/PlayerStats";
import { useReplayLoader } from "./api/replay";
import { useReplayPlayback } from "./api/playback";
import { useKillFeed } from "./killfeed/useKillFeed";
import { useViewerStore } from "./state/viewerStore";

export default function App() {
  const mode = useViewerStore((s) => s.mode);
  const setMode = useViewerStore((s) => s.setMode);
  const setReplay = useViewerStore((s) => s.setReplay);

  // Boot from URL params (one-shot on mount): `?mode=replay&id=...`
  // → flip to replay and seed the replay slice. The picker auto-opens
  // when mode=replay but no id is provided. This build has no live map, so
  // `?mode=live` is not honoured — the store default (canLive=false) keeps the
  // whole live surface hidden and there is no live stream to open.
  useEffect(() => {
    const url = new URL(window.location.href);
    const m = url.searchParams.get("mode");
    const id = url.searchParams.get("id");
    if (m === "replay") {
      if (id) {
        setReplay((r) => ({ ...r, id, frames: [], currentIdx: 0,
                            playing: false, speed: 1,
                            baseWallMs: 0, baseSnapMs: 0 }));
        setMode("replay");
      } else {
        setMode("replay");
        // Open the picker after the dialog has mounted.
        setTimeout(() => {
          const dlg = document.getElementById("recording-picker") as
            HTMLDialogElement | null;
          dlg?.showModal();
        }, 0);
      }
    }
    // Intentionally empty deps — boot-once. Subsequent URL changes
    // are pushed BY us via history.replaceState in TopBar / picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replay frame loader (no-op unless mode === "replay").
  useReplayLoader();
  // rAF playback engine (no-op unless replay is playing).
  useReplayPlayback();
  // Watches curSnap, runs the kill-feed tick diff, pushes new entries
  // into the store. Self-contained: no props, no return value.
  useKillFeed();

  const [tooltip, setTooltip] = useState<{ hit: Hit | null; x: number; y: number }>(
    { hit: null, x: 0, y: 0 });
  const selectedVehicleId    = useViewerStore((s) => s.selectedVehicleId);
  const setSelectedVehicleId = useViewerStore((s) => s.setSelectedVehicleId);
  const setSelectedPlayerKey = useViewerStore((s) => s.setSelectedPlayerKey);
  const setSelectedInfo = useViewerStore((s) => s.setSelectedInfo);
  const toggleScoreboard     = useViewerStore((s) => s.toggleScoreboard);
  const setScoreboardVisible = useViewerStore((s) => s.setScoreboardVisible);

  const onHover = useCallback((hit: Hit | null, x: number, y: number) => {
    setTooltip({ hit, x, y });
  }, []);
  const onLeave = useCallback(() => {
    setTooltip({ hit: null, x: 0, y: 0 });
  }, []);
  // Every entity is clickable. Player → PlayerPanel, vehicle → VehiclePanel,
  // everything else (marker/deployable/spawner/rally/capzone/projectile) →
  // the shared InfoPanel. The store setters are mutually exclusive so only
  // one detail panel is ever open; empty-space click closes all.
  const onClick = useCallback((hit: Hit | null) => {
    const h = hit?.hit;
    if (!h) {
      setSelectedVehicleId(null);
      setSelectedPlayerKey(null);
      setSelectedInfo(null);
      return;
    }
    if (h.type === "vehicle") {
      setSelectedVehicleId(h.e.id);
      setSelectedPlayerKey(null);
    } else if (h.type === "player") {
      setSelectedPlayerKey(playerKey(h.e));
      setSelectedVehicleId(null);
    } else {
      setSelectedInfo({ kind: h.type, id: h.e.id });
    }
  }, [setSelectedVehicleId, setSelectedPlayerKey, setSelectedInfo]);

  // Hotkeys:
  //   Esc      — close any open detail panel + scoreboard
  //   Tab      — toggle scoreboard (Squad in-game convention).
  //              preventDefault so focus doesn't jump between buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept while a text input is focused.
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        setSelectedVehicleId(null);
        setSelectedPlayerKey(null);
        setSelectedInfo(null);
        setScoreboardVisible(false);
      } else if (e.key === "Tab") {
        e.preventDefault();
        toggleScoreboard();
      } else if (e.key === " " || e.code === "Space") {
        // Space toggles play/pause in replay mode; ignored in live.
        const s = useViewerStore.getState();
        if (s.mode === "replay" && s.replay.frames.length) {
          e.preventDefault();
          s.setReplay((r) => ({
            ...r,
            playing: !r.playing,
            baseWallMs: 0, baseSnapMs: 0,
            currentIdx: r.currentIdx >= r.frames.length - 1
              ? 0 : r.currentIdx,
          }));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSelectedVehicleId, setSelectedPlayerKey, setSelectedInfo,
      setScoreboardVisible, toggleScoreboard]);

  // squadreader.com /stats: the rich stats view IS the page (a site-themed
  // full-page render), not the agent's command-panel landing. Everywhere else
  // (altaisquad, /replay) keeps the Home landing + the stats <dialog>.
  const statsRoute = import.meta.env.VITE_THEME === "apple" &&
    window.location.pathname.startsWith("/stats");

  return (
    <div id="root-grid">
      {statsRoute ? (
        // The /stats route is always the stats page — never the map — even if a
        // stray ?mode=replay|live is in the URL.
        <PlayerStats inline />
      ) : mode === "home" ? (
        <Home />
      ) : (
        <div id="stage">
          <MapCanvas onHover={onHover} onLeave={onLeave} onClick={onClick} />
          <TopBar />
          <TeamBar />
          <PlayerSearch />
          <BufferOverlay />
          <MatchOverlay />
          <Tooltip {...tooltip} />
          {selectedVehicleId &&
            <Suspense fallback={null}><VehiclePanel /></Suspense>}
          <PlayerPanel />
          <InfoPanel />
          <KillFeed />
          <TimelineBar />
        </div>
      )}
      {/* Dialogs/overlays stay mounted OUTSIDE the mode branch so Home can
          openModal() them (İstatistik / Kayıtlar) and they persist across modes.
          The stats <dialog> is skipped on /stats, where <PlayerStats inline/>
          above already renders the same view as the page (one id per document). */}
      <Scoreboard />
      <RecordingPicker />
      {!statsRoute && <PlayerStats />}
    </div>
  );
}
