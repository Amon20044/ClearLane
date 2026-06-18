import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, Tooltip } from "react-leaflet";
import L from "leaflet";
import { tick, snapshotUnits, getAutoAlloc, setAutoAlloc, dispatchUnit,
  forceCounts, SHIFTS } from "../lib/force.js";

const BASE_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const STATUS_COLOR = {
  idle: "#7fe0a0", enroute: "#378ADD", on_site: "#EF9F27",
  returning: "#b98bff", off_duty: "#566",
};
const STATUS_LABEL = {
  idle: "at station", enroute: "en route", on_site: "on site",
  returning: "returning", off_duty: "off duty",
};

function istHour() {
  const d = new Date();
  const ist = new Date(d.getTime() + (330 + d.getTimezoneOffset()) * 60000);
  return ist.getHours();
}

// small chevron-ish vehicle icon via divIcon
function unitIcon(color, dim) {
  return L.divIcon({
    className: "troop-icon",
    html: `<div class="troop-dot" style="background:${color};opacity:${dim ? 0.45 : 1}">🚓</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

export default function TroopMap({ slug, station, officers, problems = [],
                                  height = 460 }) {
  const [units, setUnits] = useState([]);
  const [hour, setHour] = useState(istHour());
  const [auto, setAuto] = useState(getAutoAlloc(slug));
  const problemsRef = useRef(problems);
  const hourRef = useRef(hour);
  problemsRef.current = problems;
  hourRef.current = hour;

  useEffect(() => { setAutoAlloc(slug, auto); }, [slug, auto]);

  useEffect(() => {
    const run = () => {
      setUnits(tick(slug, station, officers,
        { now: Date.now(), hour: hourRef.current, problems: problemsRef.current }));
    };
    run();
    const t = setInterval(run, 500);
    return () => clearInterval(t);
  }, [slug, station, officers]);

  const counts = useMemo(() => forceCounts(slug, hour), [units, slug, hour]);
  const center = [station.lat, station.lon];
  const onDuty = units.filter((u) => u.status !== "off_duty");
  const probMax = Math.max(1, ...problems.map((p) => p.score));

  return (
    <div>
      <div className="troopmap-canvas" style={{ height }}>
        <div className="map-overlay troop-control-card">
          <label className="toggle" style={{ borderColor: "var(--accent)" }}>
            <input type="checkbox" checked={auto}
              onChange={(e) => setAuto(e.target.checked)} /> Auto-allocate (sliding window)
          </label>
          <div className="troop-shift">
            <div className="troop-shift-top">
              <span className="muted">Shift clock</span>
              <b className="mono">{String(hour).padStart(2, "0")}:00</b>
              <span className="shift-chip" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>{shiftLabel(hour)}</span>
            </div>
            <input type="range" min="0" max="23" value={hour} className="slider"
              onChange={(e) => setHour(+e.target.value)} />
          </div>
        </div>

        <div className="map-overlay stats troop-stats-card">
          <div className="troop-big"><b>{counts.on_duty}</b><span>/{counts.units_total} units on duty</span></div>
          <div className="troop-stat-row">
            <span style={{ color: "#7fe0a0" }}>● {counts.idle} ready</span>
            <span style={{ color: "#378ADD" }}>● {counts.enroute} en route</span>
          </div>
          <div className="troop-stat-row">
            <span style={{ color: "#EF9F27" }}>● {counts.on_site} on site</span>
            <span className="muted">{counts.officers_on_duty} officers</span>
          </div>
        </div>

        <MapContainer center={center} zoom={13} preferCanvas style={{ height: "100%" }}>
          <TileLayer url={BASE_DARK} attribution="© OpenStreetMap, © CARTO" />

          {/* station HQ */}
          <CircleMarker center={center} radius={7}
            pathOptions={{ color: "#fff", weight: 2, fillColor: "#378ADD", fillOpacity: 0.9 }}>
            <Tooltip permanent direction="top" offset={[0, -8]} className="veh-tag">
              {station.name} HQ</Tooltip>
          </CircleMarker>

          {/* problem zones in this area */}
          {problems.map((p) => (
            <CircleMarker key={p.id} center={[p.lat, p.lon]}
              radius={5 + (p.score / probMax) * 13}
              pathOptions={{ color: "#E24B4A", weight: 1,
                fillColor: "#E24B4A", fillOpacity: 0.35 }}>
              <Popup><b>{p.name}</b><br />problem score {Math.round(p.score)}</Popup>
            </CircleMarker>
          ))}

          {/* unit -> target lines */}
          {onDuty.filter((u) => u.target).map((u) => (
            <Polyline key={"l" + u.id}
              positions={[[u.lat, u.lon], [u.target.lat, u.target.lon]]}
              pathOptions={{ color: STATUS_COLOR[u.status], weight: 1.5, dashArray: "4" }} />
          ))}

          {/* patrol units */}
          {units.map((u) => (
            <Marker key={u.id} position={[u.lat, u.lon]}
              icon={unitIcon(STATUS_COLOR[u.status], u.status === "off_duty")}>
              <Tooltip direction="top" offset={[0, -10]}>
                <b>{u.name}</b> · {STATUS_LABEL[u.status]}
                {u.zoneName ? <> → {u.zoneName}</> : null}
              </Tooltip>
              <Popup>
                <b>{u.name}</b> — shift {u.shift} ({SHIFTS[u.shift]?.label})<br />
                Lead: {u.lead?.rank} {u.lead?.name}<br />
                {u.size} officers · <span style={{ color: STATUS_COLOR[u.status] }}>{STATUS_LABEL[u.status]}</span><br />
                {u.zoneName && <>Assigned: {u.zoneName} ({u.etaKm?.toFixed(1)} km)<br /></>}
                {u.status === "idle" && problems[0] && (
                  <button className="btn" style={{ marginTop: 4 }}
                    onClick={() => dispatchUnit(slug, u.id, problems[0])}>
                    Dispatch to worst zone</button>
                )}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Simulated patrol deployment for planning — positions are not real GPS.
        Auto-allocate sends idle on-duty units to the worst unserved zones; after a
        service window each zone cools down so coverage <b>slides</b> down the queue.
      </div>
    </div>
  );
}

function shiftLabel(hour) {
  for (const k of Object.keys(SHIFTS)) {
    const s = SHIFTS[k];
    const on = s.start < s.end ? (hour >= s.start && hour < s.end)
      : (hour >= s.start || hour < s.end);
    if (on) return `${k} · ${s.label} shift`;
  }
  return "";
}
