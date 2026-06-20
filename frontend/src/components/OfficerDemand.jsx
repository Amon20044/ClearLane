import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { isGovt, scopeSlug, slugify } from "../lib/auth.js";
import { useRoster } from "../lib/useRoster.js";
import RosterPanel from "./RosterPanel.jsx";
import { haversine, km } from "../lib/plain.js";
import {
  areaExpectedTickets, officersNeeded, rangeDayCount, lensLabel, isActive,
} from "../lib/timeLens.js";

// Officer-demand + live deployment. For the chosen date window and area, estimate
// officers needed and compare to who is actually deployed there (live dispatches)
// vs the station's historical force. HONESTY: a transparent planning heuristic over
// recorded/projected ticket volume — NOT a congestion or response-time claim.
// "Force" = distinct officers historically seen at a station (proxy), zone-level only.
const OPEN_DONE = ["cleared", "structural_escalation"];

export default function OfficerDemand({ zones, lens, daily, snapshot, defaultStation }) {
  const [scope, setScope] = useState(defaultStation || "city");
  const [hours, setHours] = useState(8);
  const [rate, setRate] = useState(4);
  const [stationMeta, setStationMeta] = useState({});

  // roster (members + hierarchy) for the selected station
  const selSlug = scope === "city" ? null : slugify(scope);
  const roster = useRoster(selSlug, stationMeta[scope]?.n_zones);
  const canManage = !!selSlug && (isGovt() || scopeSlug() === selSlug);

  useEffect(() => {
    api("/api/stations").then((list) => {
      const m = {};
      (list || []).forEach((s) => { m[s.station] = s; });
      setStationMeta(m);
    }).catch(() => {});
  }, []);

  const stations = useMemo(
    () => [...new Set(zones.map((z) => z.station).filter(Boolean))].sort(), [zones]);
  const zoneStation = useMemo(() => {
    const m = {}; zones.forEach((z) => { m[z.id] = z.station; }); return m;
  }, [zones]);

  // live troops deployed per station (open dispatches, mapped to the zone's station)
  const deployedByStation = useMemo(() => {
    const m = {};
    for (const d of (snapshot?.dispatches || [])) {
      if (OPEN_DONE.includes(d.state)) continue;
      const stn = d.station || zoneStation[d.zone_id];
      if (stn) m[stn] = (m[stn] || 0) + 1;
    }
    return m;
  }, [snapshot, zoneStation]);

  const perDay = (raw) =>
    lens.mode === "range" ? raw / Math.max(1, rangeDayCount(lens, daily)) : raw;

  // nearest other station to each station (by centroid) — where to borrow troops
  const nearestOf = useMemo(() => {
    const meta = Object.values(stationMeta).filter((m) => m.lat != null);
    const out = {};
    for (const a of meta) {
      let best = null, bd = Infinity;
      for (const b of meta) {
        if (b.station === a.station) continue;
        const d = haversine(a.lat, a.lon, b.lat, b.lon);
        if (d < bd) { bd = d; best = b; }
      }
      out[a.station] = best ? { name: best.station, dist: bd } : null;
    }
    return out;
  }, [stationMeta]);

  const rows = useMemo(() => zones.length ? stations.map((st) => {
    const exp = perDay(areaExpectedTickets({ scope: "station", station: st, zones }, lens, daily));
    const needed = officersNeeded(exp, hours, rate);
    const deployed = deployedByStation[st] || 0;
    const meta = stationMeta[st] || {};
    return { st, exp, needed, deployed, gap: needed - deployed,
      force: meta.officers_seen, lat: meta.lat, lon: meta.lon, nearest: nearestOf[st] };
  }).sort((a, b) => {
    if (scope !== "city") { if (a.st === scope) return -1; if (b.st === scope) return 1; }
    return b.gap - a.gap || b.needed - a.needed;     // selected first, then most understaffed
  }) : [],
  [stations, zones, lens, daily, hours, rate, deployedByStation, stationMeta, nearestOf, scope]);

  // selected scope summary
  const exp = perDay(areaExpectedTickets(
    { scope: scope === "city" ? "city" : "station", station: scope, zones }, lens, daily));
  const needed = officersNeeded(exp, hours, rate);
  const deployed = scope === "city"
    ? Object.values(deployedByStation).reduce((s, n) => s + n, 0)
    : (deployedByStation[scope] || 0);
  const gap = needed - deployed;
  const sMeta = scope !== "city" ? (stationMeta[scope] || {}) : null;
  const maxNeeded = Math.max(1, ...rows.map((r) => r.needed));

  return (
    <div className="panel page">
      <h2>Officer-demand & deployment</h2>
      <p className="sub">
        Expected enforcement load for <b>{lensLabel(lens, daily)}</b>{!isActive(lens) && " (pick a date above)"} →
        officers needed, vs <b>troops deployed now</b> from the nearest station.
        Heuristic: officers ≈ expected tickets ÷ (rate × shift). Based on recorded/projected
        <b> ticket volume, not congestion</b>; "force" = distinct officers historically seen (proxy).
      </p>

      <div className="toolbar">
        <label className="ctrl">Area
          <select className="searchbox" value={scope}
            onChange={(e) => setScope(e.target.value)}>
            <option value="city">Whole city</option>
            {stations.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></label>
        <label className="ctrl">Shift hours: <b style={{ color: "var(--txt)" }}>{hours}h</b>
          <input type="range" min="4" max="12" value={hours} className="slider"
            onChange={(e) => setHours(+e.target.value)} /></label>
        <label className="ctrl">Tickets / officer / hour: <b style={{ color: "var(--txt)" }}>{rate}</b>
          <input type="range" min="1" max="10" step="0.5" value={rate} className="slider"
            onChange={(e) => setRate(+e.target.value)} /></label>
      </div>

      <div className="dials" style={{ marginBottom: 8 }}>
        <div className="dial"><div className="v">{Math.round(exp).toLocaleString("en-IN")}</div>
          <div className="l">Expected tickets / day</div></div>
        <div className="dial"><div className="v" style={{ color: "var(--accent)" }}>{needed}</div>
          <div className="l">Officers needed</div></div>
        <div className="dial"><div className="v" style={{ color: "var(--amber)" }}>{deployed}</div>
          <div className="l">Deployed now (live)</div></div>
        <div className="dial"><div className="v" style={{ color: gap > 0 ? "#ff8a8a" : "var(--good)" }}>
          {gap > 0 ? `−${gap}` : "OK"}</div><div className="l">{gap > 0 ? "Short by" : "Covered"}</div></div>
      </div>

      {sMeta && (
        <div className="note" style={{ marginBottom: 12 }}>
          <b>{scope}</b> station{sMeta.lat ? <> · centre <span className="mono">{sMeta.lat}, {sMeta.lon}</span></> : ""} ·
          historical force ≈ <b>{sMeta.officers_seen ?? "—"}</b> officers over {sMeta.active_days ?? "—"} active days ·
          {" "}<b>{deployed}</b> deployed now. {gap > 0
            ? `Send ${gap} more troop(s) from the nearest station to cover the expected load.`
            : "Current deployment covers the expected load."}
        </div>
      )}

      <h3>Per-station deployment ({rows.length} stations · {rows.reduce((s, r) => s + r.needed, 0)} needed · {rows.reduce((s, r) => s + r.deployed, 0)} deployed)</h3>
      <div className="scroll">
        <table className="dt">
          <thead><tr><th>Station</th><th>Expected/day</th><th>Needed</th><th>Deployed</th><th>Gap</th><th>Force</th><th>Nearest station</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const sel = r.st === scope;
              return (
                <tr key={r.st} onClick={() => setScope(r.st)} style={{ cursor: "pointer" }}
                  className={sel ? "row-sel" : ""}>
                  <td data-label="Station"><b>{r.st}</b>{sel && <span className="flag" style={{ marginLeft: 6 }}>selected</span>}</td>
                  <td data-label="Expected/day" className="mono">{Math.round(r.exp).toLocaleString("en-IN")}</td>
                  <td data-label="Needed" className="mono" style={{ color: "var(--accent)" }}>{r.needed}</td>
                  <td data-label="Deployed" className="mono" style={{ color: "var(--amber)" }}>{r.deployed}</td>
                  <td data-label="Gap" className="mono" style={{ color: r.gap > 0 ? "#ff8a8a" : "var(--good)" }}>
                    {r.gap > 0 ? `−${r.gap}` : "✓"}</td>
                  <td data-label="Force" className="mono muted">{r.force ?? "—"}</td>
                  <td data-label="Nearest station" style={{ fontSize: 12 }}>
                    {r.nearest
                      ? <span title="borrow troops from here" style={{ cursor: "pointer", color: "var(--accent)" }}
                          onClick={(e) => { e.stopPropagation(); setScope(r.nearest.name); }}>
                          {r.nearest.name} <span className="muted">· {km(r.nearest.dist)}</span></span>
                      : <span className="muted">—</span>}
                  </td>
                  <td data-label="Load"><div className="bar" style={{ maxWidth: 150 }}>
                    <span style={{ width: Math.min(100, (r.needed / maxNeeded) * 100) + "%",
                      background: r.gap > 0 ? "#ff8a8a" : "var(--accent)" }} /></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selSlug && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <h3 style={{ margin: "0 0 6px" }}>
            Members &amp; hierarchy — <span style={{ color: "var(--accent)" }}>{scope}</span> station
          </h3>
          <p className="sub" style={{ marginTop: 0 }}>
            Actual ranked roster for this station (Inspector / SHO down to constables),
            across the three rotating shifts. {canManage
              ? "You can add or remove officers here."
              : "Read-only — sign in as this station or as government to edit."}
          </p>
          <RosterPanel officers={roster.officers} live={roster.live} loading={roster.loading}
            canManage={canManage} onAdd={roster.addOfficer} onRemove={roster.removeOfficer} />
        </div>
      )}
    </div>
  );
}
