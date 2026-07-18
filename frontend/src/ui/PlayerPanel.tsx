// Rich player detail panel — pinned right when a player is clicked.
// Surfaces everything the backend reads for a soldier: role + pool, HP,
// breath-hold stamina, ping, stance, held weapon + live magazines, action
// state (squad / leader / commander / idle-moving), the full per-player
// stat block, score and world position, plus a FOLLOW toggle that keeps
// the map camera centred on this player.

import { teamColor } from "../canvas/draw";
import { roleIconUrl } from "../canvas/icons";
import { weaponDisplayName, weaponStatic } from "../data/weaponsStatic";
import { useStaticCatalogs } from "../data/staticCatalogs";
import { useViewerStore } from "../state/viewerStore";
import type { Player, Snapshot } from "../state/types";

function fmtInt(v: number | null | undefined) {
  return v == null ? "—" : Math.round(v).toString();
}

function lifeLabel(life: string | null): string {
  if (life === "incapacitated") return "downed — awaiting revive";
  if (life === "bleeding")      return "bleeding";
  if (life === "healthy")       return "healthy";
  return "—";
}

function voiceLabel(vc: string): string {
  switch (vc) {
    case "local":       return "Local";
    case "squad":       return "Squad";
    case "command":     return "Command";
    case "toCommander": return "To Commander";
    default:
      // commandSQ1..9 — commander broadcasting to a specific squad.
      if (vc.startsWith("commandSQ")) return `Commander → Squad ${vc.slice(9)}`;
      return vc;
  }
}

function playerKey(p: { eosId: string | null; playerId: number | null;
                         name: string | null }) {
  return p.eosId ?? (p.playerId != null ? `pid:${p.playerId}` : `name:${p.name ?? "?"}`);
}

const st = (o: Record<string, unknown> | undefined, k: string): number | undefined =>
  (o?.[k] as number | undefined);
const bl = (o: Record<string, unknown> | undefined, k: string): boolean =>
  o?.[k] === true;

// Did the player move since the previous tick? (drives IDLE / MOVING)
function movedSince(prev: Snapshot | null, p: Player): boolean | null {
  const cur = p.soldier?.position;
  if (!cur || !prev) return null;
  const q = (prev.players ?? []).find((x) => playerKey(x) === playerKey(p))?.soldier?.position;
  if (!q) return null;
  const dx = cur.x - q.x, dy = cur.y - q.y;
  return dx * dx + dy * dy > 200 * 200; // >2 m between ticks
}

export function PlayerPanel() {
  useStaticCatalogs();  // re-render once the weapon catalog loads in
  const key       = useViewerStore((s) => s.selectedPlayerKey);
  const snap      = useViewerStore((s) => s.curSnap);
  const prevSnap  = useViewerStore((s) => s.prevSnap);
  const close     = useViewerStore((s) => s.setSelectedPlayerKey);
  const followKey = useViewerStore((s) => s.followKey);
  const setFollow = useViewerStore((s) => s.setFollowKey);

  if (!key) return null;

  const p = (snap?.players ?? []).find((x) => playerKey(x) === key) ?? null;

  if (!p) {
    return (
      <div id="player-panel" className="detail-panel">
        <header>
          <h2>player lost</h2>
          <button onClick={() => close(null)} title="close">✕</button>
        </header>
        <div className="body">
          <div className="empty">no longer in the snapshot — left, switched teams, or out of range</div>
        </div>
      </div>
    );
  }

  const s       = p.soldier;
  const hp      = s?.health ?? 0;
  const hpPct   = Math.max(0, Math.min(100, hp));
  const hpColor = hpPct > 50 ? "var(--good)" : hpPct > 25 ? "var(--warn)" : "var(--bad)";
  const life    = s?.lifeState ?? null;
  const downed  = !!s && !s.stale && !!s.position &&
                  (life != null ? life === "incapacitated" : hp <= 0);
  const alive   = hp > 0 && !s?.stale;
  const spr     = s?.stamina ?? null;
  const sprMax  = s?.staminaMax ?? null;
  const sprPct  = spr != null && sprMax && sprMax > 0
    ? Math.max(0, Math.min(100, (spr / sprMax) * 100)) : null;
  const stance  = s?.stance ?? null;
  const pos     = s?.position;
  const stats   = (p.stats ?? {}) as Record<string, unknown>;
  const voice   = p.voiceChannel && p.voiceChannel !== "none" ? p.voiceChannel : null;

  const roleUrl  = roleIconUrl(p);
  const roleId   = p.roleId ?? "—";
  const rolePool = p.rolePoolLabel ?? p.rolePool ?? "";
  const tc       = teamColor(p.teamId);

  const ping     = p.ping;
  const pingCls  = ping == null ? "" : ping < 60 ? "ok" : ping < 120 ? "warn" : "bad";

  // ACTION badges
  const inSquad  = p.squadId != null && p.squadId > 0;
  const sq       = inSquad
    ? (snap?.squads ?? []).find((x) => x.id === p.squadId && x.teamId === p.teamId)
    : undefined;
  const isSL     = !!(sq?.leaderStateAddr && p._addr && sq.leaderStateAddr === p._addr);
  const isCmdr   = bl(stats, "isCommander");
  const isAdmin  = bl(stats, "isAdmin");
  const moving   = alive ? movedSince(prevSnap, p) : null;

  const following = followKey === key;
  const toggleFollow = () => setFollow(following ? null : key);

  return (
    <div id="player-panel" className="detail-panel pp">
      <header>
        <h2>
          <span className="dot" style={{ background: tc }} />
          {p.clanTag ? `[${p.clanTag}] ` : ""}{p.name ?? "?"}
          {voice && <span className="pp-voice"
            title={`Talking: ${voiceLabel(voice)}`}>🎙</span>}
        </h2>
        <button onClick={() => close(null)} title="close (esc)">✕</button>
      </header>
      <div className="body">
        <div className="pp-sub">
          Team <b style={{ color: tc }}>{p.teamId ?? "—"}</b>
          {inSquad && <> · Squad <b>{p.squadId}</b>{sq?.name ? ` · ${sq.name}` : ""}</>}
        </div>

        {/* Role + FOLLOW */}
        <div className="pp-role">
          <div className="pp-role-thumb" style={{ borderColor: tc }}>
            {roleUrl ? <img src={roleUrl} alt="" /> : <span className="q">?</span>}
          </div>
          <div className="pp-role-text">
            <div className="pp-role-id">{roleId}</div>
            {rolePool && <div className="pp-role-pool">{rolePool}</div>}
          </div>
          <button className={"pp-follow" + (following ? " on" : "")}
                  onClick={toggleFollow}
                  title="keep camera on this player">
            {following ? "FOLLOW ✓" : "FOLLOW"}
          </button>
        </div>

        {/* HP + Stamina bars */}
        <div className="pp-bar">
          <span className="pp-bar-lbl">{fmtInt(hpPct)} HP</span>
          <div className="pp-track"><div className="pp-fill"
            style={{ width: `${hpPct}%`, background: hpColor }} /></div>
          <span className="pp-bar-num">{fmtInt(hp)}/100</span>
        </div>
        {sprPct != null && (
          <div className="pp-bar">
            <span className="pp-bar-lbl">{fmtInt(sprPct)}% STA</span>
            <div className="pp-track"><div className="pp-fill"
              style={{ width: `${sprPct}%`, background: "var(--accent)" }} /></div>
            <span className="pp-bar-num">{fmtInt(sprPct)}%</span>
          </div>
        )}

        {/* Fact rows */}
        <div className="pp-rows">
          <Row label="PING">
            <span className={"pp-ping " + pingCls}>
              {ping != null ? `${Math.round(ping)} ms` : "—"}</span>
          </Row>
          <Row label="STANCE">
            <StanceIcon stance={stance} /><span className="pp-cap">{stance ?? "—"}</span>
          </Row>
          {life && life !== "healthy" && (
            <Row label="STATUS">
              <span className={"pp-cap " + (life === "incapacitated" ? "bad" : "warn")}>
                {lifeLabel(life)}</span>
            </Row>
          )}
          {voice && (
            <Row label="VOICE"><span className="pp-cap">{voiceLabel(voice)}</span></Row>
          )}
          {s?.weapon && (
            <Row label="WEAPON">
              <WeaponIcon /><b>{weaponDisplayName(s.weapon.className)}</b>
            </Row>
          )}
          <Row label="ACTION">
            <div className="pp-badges">
              {s?.classShort?.includes("DeveloperAdminCam") &&
                <span className="pp-badge cam">ADMIN CAM</span>}
              {isCmdr && <span className="pp-badge cmd">CMDR</span>}
              {isSL && <span className="pp-badge sl">SL</span>}
              {isAdmin && <span className="pp-badge adm">ADMIN</span>}
              {p.isBot && <span className="pp-badge bot">BOT</span>}
              <span className={"pp-badge " + (inSquad ? "sq" : "solo")}>
                {inSquad ? "SQUAD" : "SOLO"}</span>
              {moving != null && (
                <span className={"pp-badge " + (moving ? "mv" : "idle")}>
                  {moving ? "MOVING" : "IDLE"}</span>
              )}
              {life === "incapacitated" && <span className="pp-badge down">DOWNED</span>}
              {life === "bleeding" && <span className="pp-badge bleed">BLEEDING</span>}
              {life == null && downed && <span className="pp-badge down">DOWNED</span>}
            </div>
          </Row>
          {s?.weapon?.magazines && s.weapon.magazines.length > 0 && (
            <Row label="AMMO">
              <Mags mags={s.weapon.magazines}
                    slots={weaponStatic(s.weapon.className)?.maxMags} />
            </Row>
          )}
        </div>

        {/* Stat chips — two rows */}
        <div className="pp-stats">
          <Stat g="🎯" c="var(--good)" label="Kills" v={st(stats, "kills")} />
          <Stat g="💀" c="var(--bad)" label="Deaths" v={st(stats, "deaths")} />
          <Stat g="⚠" c="var(--bad)" label="Team Kills" v={st(stats, "teamKills")} />
          <Stat g="🚗" label="Vehicle Kills" v={st(stats, "vehicleKills")} />
          <Stat g="🩹" label="Wounds Taken" v={st(stats, "wounds")} />
        </div>
        <div className="pp-stats">
          <Stat g="✚" c="var(--good)" label="Revive Pts" v={st(stats, "revivedPoints")} />
          <Stat g="❤" c="var(--good)" label="Heal Pts" v={st(stats, "healPoints")} />
          <Stat g="🚩" label="Objective" v={st(stats, "objectiveScore")} />
          <Stat g="🤝" label="Teamwork" v={st(stats, "teamWorkScore")} />
        </div>

        <div className="pp-foot">
          <span className="pp-score">SCORE <b>{fmtInt(p.score)}</b></span>
          {pos && (
            <span className="pp-pos">
              {Math.round(pos.x)}, {Math.round(pos.y)},{" "}
              {pos.z != null ? Math.round(pos.z) : "—"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pp-row">
      <span className="pp-row-k">{label}</span>
      <span className="pp-row-v">{children}</span>
    </div>
  );
}

function Stat({ g, c, label, v }: {
  g: string; c?: string; label: string; v: number | null | undefined;
}) {
  return (
    <div className="pp-stat" title={label}>
      <span className="pp-stat-g" style={c ? { color: c } : undefined}>{g}</span>
      <span className="pp-stat-v">{fmtInt(v)}</span>
    </div>
  );
}

// Magazine strip: one pill per mag slot. Full = bright, partial = amber,
// empty = dim. "Full" is inferred as the max round-count seen (spare mags
// are normally topped up); the loaded/being-fired mag reads lower -> amber.
function Mags({ mags, slots }: { mags: number[]; slots?: number }) {
  const n = Math.max(mags.length, slots ?? 0);
  const full = Math.max(1, ...mags);
  const cells = [];
  for (let i = 0; i < n; i++) {
    const c = mags[i];
    const cls = c == null ? "empty" : c <= 0 ? "empty" : c >= full ? "full" : "part";
    cells.push(
      <span key={i} className={"pp-mag " + cls} title={c != null ? `${c} rounds` : "empty"}>
        <span className="pp-mag-fill" style={{
          height: c != null && full > 0 ? `${Math.min(100, (c / full) * 100)}%` : "0%",
        }} />
      </span>,
    );
  }
  return <span className="pp-mags">{cells}</span>;
}

function StanceIcon({ stance }: { stance: string | null }) {
  // three minimal poses
  if (stance === "prone")
    return <svg className="pp-svg" viewBox="0 0 16 16"><rect x="2" y="9" width="12" height="2.4" rx="1.2" fill="currentColor"/><circle cx="13" cy="10.2" r="2" fill="currentColor"/></svg>;
  if (stance === "crouched")
    return <svg className="pp-svg" viewBox="0 0 16 16"><circle cx="8" cy="4" r="2" fill="currentColor"/><path d="M8 6 L8 10 L5 13 M8 10 L11 13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round"/></svg>;
  return <svg className="pp-svg" viewBox="0 0 16 16"><circle cx="8" cy="3.5" r="2" fill="currentColor"/><path d="M8 5.5 L8 11 M8 11 L6 14 M8 11 L10 14 M8 7 L5.5 9 M8 7 L10.5 9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/></svg>;
}

function WeaponIcon() {
  return <svg className="pp-svg" viewBox="0 0 20 16"><path d="M2 6 H15 V8 H10 V10 H8 V8 H2 Z M12 8 V11 H13.5 V8" fill="currentColor"/><rect x="14" y="5" width="4" height="2" rx="0.5" fill="currentColor"/></svg>;
}

// Helper exported so App can build the same key from a clicked Player.
export { playerKey };
