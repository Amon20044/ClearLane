import { useMemo } from "react";
import { isGovt, scopeSlug } from "../lib/auth.js";
import { useRoster } from "../lib/useRoster.js";
import RosterPanel from "./RosterPanel.jsx";
import TroopMap from "./TroopMap.jsx";

// Station-scoped command center: live troop map + ranked roster + area problems.
// Used both by a station login (its own area) and by govt drilling into a station.
export default function CommandCenter({ slug, name, zones = [], opByZone = {},
                                       snapshot = null, onBack = null }) {
  const areaZonesByName = useMemo(
    () => zones.filter((z) => z.station === name), [zones, name]);
  const nZones = areaZonesByName.length || 12;
  const { officers, meta, live, loading, addOfficer, removeOfficer } = useRoster(slug, nZones);

  const stationName = meta?.name || name;
  const areaZones = useMemo(
    () => zones.filter((z) => z.station === stationName), [zones, stationName]);
  const station = meta && meta.lat != null ? meta
    : { slug, name: stationName, ...centroidObj(areaZones) };

  const problems = useMemo(() => areaZones.map((z) => ({
    id: z.id, name: z.name, lat: z.lat, lon: z.lon,
    score: opByZone[z.id]?.operational_priority ?? z.priority,
  })).sort((a, b) => b.score - a.score).slice(0, 16), [areaZones, opByZone]);

  const complaints = (snapshot?.complaints || []).filter((c) => c.station === stationName);
  const canManage = isGovt() || scopeSlug() === slug;

  return (
    <div className="cmd-wrap">
      <div className="cmd-head">
        {onBack && <button className="btn" onClick={onBack}>← All stations</button>}
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{stationName} — Station Command</div>
          <div className="muted" style={{ fontSize: 12 }}>
            login <span className="mono">{slug}</span> / <span className="mono">{slug}</span> ·
            {" "}{areaZones.length} zones · {officers.length} officers
          </div>
        </div>
      </div>

      <div className="cmd-stats">
        <Stat n={areaZones.filter((z) => z.tier === "P1").length} l="P1 zones" c="#E24B4A" />
        <Stat n={areaZones.filter((z) => z.tier === "P2").length} l="P2 zones" c="#EF9F27" />
        <Stat n={areaZones.filter((z) => z.evening_blind_spot).length} l="blind spots" c="#E6C229" />
        <Stat n={complaints.length} l="live complaints" c="#4aa3ff" />
        <Stat n={officers.length} l="officers" c="#7fe0a0" />
      </div>

      <div className="cmd-grid">
        <div className="panel" style={{ padding: 10 }}>
          <h3 style={{ margin: "2px 0 8px" }}>Live troop deployment</h3>
          <TroopMap slug={slug} station={station} officers={officers} problems={problems} height={440} />
        </div>

        <div className="panel" style={{ padding: 10, minWidth: 0 }}>
          <h3 style={{ margin: "2px 0 8px" }}>Members &amp; hierarchy</h3>
          <RosterPanel officers={officers} live={live} loading={loading}
            canManage={canManage} onAdd={addOfficer} onRemove={removeOfficer} />
        </div>
      </div>

      <div className="muted" style={{ fontSize: 11, padding: "0 12px 12px" }}>
        Roster persists to the local SQL database (backend) when live; offline it is a
        deterministic seed. {isGovt() && "Government override: you are editing this station's force."}
      </div>
    </div>
  );
}

function Stat({ n, l, c }) {
  return (
    <div className="cmd-stat">
      <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: c }}>{n}</div>
      <div className="muted" style={{ fontSize: 11 }}>{l}</div>
    </div>
  );
}
function centroidObj(zs) {
  if (!zs.length) return { lat: 12.9716, lon: 77.5946 };
  return { lat: zs.reduce((a, z) => a + z.lat, 0) / zs.length,
           lon: zs.reduce((a, z) => a + z.lon, 0) / zs.length };
}
