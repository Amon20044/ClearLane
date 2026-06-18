import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, Popup } from "react-leaflet";
import { api } from "../lib/api.js";
import { authFetch } from "../lib/auth.js";
import { slugify } from "../lib/auth.js";
import { genRoster } from "../lib/force.js";
import CommandCenter from "./CommandCenter.jsx";

const BASE_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const CENTER = [12.9716, 77.5946];

// Government super-admin console: oversee every station, manage stations, and
// drill into any station's command center.
export default function GovtConsole({ zones = [], opByZone = {}, snapshot = null }) {
  const [stations, setStations] = useState([]);
  const [totals, setTotals] = useState({ stations: 0, officers: 0 });
  const [live, setLive] = useState(false);
  const [drill, setDrill] = useState(null);   // {slug,name}
  const [q, setQ] = useState("");
  const [add, setAdd] = useState({ name: "", lat: "", lon: "" });
  const [err, setErr] = useState(null);

  async function load() {
    const r = await authFetch("/api/govt/stations");
    if (r) {
      setStations(r.stations); setTotals(r.totals); setLive(true); return;
    }
    // offline fallback: derive from bundled station list
    const list = await api("/api/stations").catch(() => []);
    const st = (list || [])
      .filter((s) => s.station && s.station !== "No Police Station")
      .map((s) => ({
        slug: slugify(s.station), name: s.station, lat: s.lat, lon: s.lon,
        n_zones: s.n_zones || 0,
        officers: genRoster(slugify(s.station), s.n_zones || 12).length, active: true,
      }));
    setStations(st);
    setTotals({ stations: st.length, officers: st.reduce((a, s) => a + s.officers, 0) });
    setLive(false);
  }
  useEffect(() => { load(); }, []);

  // P1 counts per station from the (immutable) ML payload
  const p1ByStation = useMemo(() => {
    const m = {};
    zones.forEach((z) => { if (z.tier === "P1") m[z.station] = (m[z.station] || 0) + 1; });
    return m;
  }, [zones]);
  const complaintsByStation = useMemo(() => {
    const m = {};
    (snapshot?.complaints || []).forEach((c) => { if (c.station) m[c.station] = (m[c.station] || 0) + 1; });
    return m;
  }, [snapshot]);

  const filtered = stations.filter((s) =>
    !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.slug.includes(q.toLowerCase()));

  async function addStation() {
    setErr(null);
    const lat = parseFloat(add.lat), lon = parseFloat(add.lon);
    if (!add.name.trim() || Number.isNaN(lat) || Number.isNaN(lon)) {
      setErr("Enter a name and valid lat/lon."); return;
    }
    const r = await authFetch("/api/govt/stations",
      { method: "POST", body: JSON.stringify({ name: add.name.trim(), lat, lon }) });
    if (!r && live) { setErr("Add failed (already exists?)."); return; }
    setAdd({ name: "", lat: "", lon: "" });
    if (r) await load();
    else setStations((xs) => [...xs, { slug: slugify(add.name), name: add.name.trim(),
      lat, lon, n_zones: 0, officers: genRoster(slugify(add.name), 12).length, active: true }]);
  }
  async function removeStation(slug) {
    if (!confirm(`Remove station "${slug}"? This deletes its roster too.`)) return;
    if (live) await authFetch(`/api/govt/stations/${slug}`, { method: "DELETE" });
    setStations((xs) => xs.filter((s) => s.slug !== slug));
  }

  if (drill) {
    return <CommandCenter slug={drill.slug} name={drill.name} zones={zones}
      opByZone={opByZone} snapshot={snapshot} onBack={() => setDrill(null)} />;
  }

  return (
    <div className="govt-wrap">
      <div className="cmd-stats">
        <Stat n={totals.stations} l="police stations" c="#378ADD" />
        <Stat n={totals.officers} l="officers on strength" c="#7fe0a0" />
        <Stat n={zones.filter((z) => z.tier === "P1").length} l="P1 zones (city)" c="#E24B4A" />
        <Stat n={snapshot?.counts?.active_complaints ?? 0} l="live complaints" c="#4aa3ff" />
        <Stat n={snapshot?.counts?.open_dispatches ?? 0} l="open dispatches" c="#EF9F27" />
        <div className="cmd-stat">
          <span className={live ? "badge live" : "badge demo"}>{live ? "● LIVE DB" : "● offline"}</span>
        </div>
      </div>

      <div className="govt-grid">
        <div className="panel" style={{ padding: 10 }}>
          <h3 style={{ margin: "2px 0 8px" }}>City overview — all stations</h3>
          <div className="troopmap-canvas" style={{ height: 420 }}>
            <MapContainer center={CENTER} zoom={11} preferCanvas style={{ height: "100%" }}>
              <TileLayer url={BASE_DARK} attribution="© OpenStreetMap, © CARTO" />
              {stations.map((s) => {
                const p1 = p1ByStation[s.name] || 0;
                return (
                  <CircleMarker key={s.slug} center={[s.lat, s.lon]}
                    radius={6 + Math.min(16, p1 * 1.6)}
                    pathOptions={{ color: "#fff", weight: 1,
                      fillColor: p1 >= 6 ? "#E24B4A" : p1 >= 3 ? "#EF9F27" : "#378ADD",
                      fillOpacity: 0.7 }}>
                    <Tooltip>{s.name} · {p1} P1</Tooltip>
                    <Popup>
                      <b>{s.name}</b><br />{s.officers} officers · {p1} P1 zones<br />
                      <button className="btn" onClick={() => setDrill({ slug: s.slug, name: s.name })}>
                        Open command →</button>
                    </Popup>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
        </div>

        <div className="panel" style={{ padding: 10, minWidth: 0 }}>
          <h3 style={{ margin: "2px 0 8px" }}>Manage stations</h3>
          <div className="add-officer" style={{ flexWrap: "wrap" }}>
            <input className="searchbox" placeholder="new station name"
              value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            <input className="searchbox mono" style={{ width: 84 }} placeholder="lat"
              value={add.lat} onChange={(e) => setAdd({ ...add, lat: e.target.value })} />
            <input className="searchbox mono" style={{ width: 84 }} placeholder="lon"
              value={add.lon} onChange={(e) => setAdd({ ...add, lon: e.target.value })} />
            <button className="btn accent" onClick={addStation}>Add station</button>
          </div>
          {err && <div className="login-err">{err}</div>}
          {add.name && <div className="muted" style={{ fontSize: 11, margin: "4px 0" }}>
            login will be <span className="mono">{slugify(add.name)}</span> / <span className="mono">{slugify(add.name)}</span></div>}

          <input className="searchbox" style={{ width: "100%", margin: "8px 0" }}
            placeholder="filter stations…" value={q} onChange={(e) => setQ(e.target.value)} />

          <div className="roster-scroll" style={{ maxHeight: 320 }}>
            {filtered.map((s) => (
              <div key={s.slug} className="off-row station-row">
                <span className="off-name" style={{ cursor: "pointer" }}
                  onClick={() => setDrill({ slug: s.slug, name: s.name })}>{s.name}</span>
                <span className="muted mono" style={{ fontSize: 11 }}>{p1ByStation[s.name] || 0} P1</span>
                <span className="muted mono" style={{ fontSize: 11 }}>{s.officers} off</span>
                {complaintsByStation[s.name] ? <span className="mono" style={{ color: "#4aa3ff", fontSize: 11 }}>⚑{complaintsByStation[s.name]}</span> : <span />}
                <button className="btn" style={{ padding: "2px 8px" }}
                  onClick={() => setDrill({ slug: s.slug, name: s.name })}>open</button>
                <button className="x-btn" title="remove station" onClick={() => removeStation(s.slug)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11, padding: "0 12px 12px" }}>
        Government command sees every area. Station accounts (slug login) see only their
        own zones and troops. Troop positions are a deployment simulation, not live GPS;
        ML priority scores are never modified by this layer.
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
