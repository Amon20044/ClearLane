import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { api } from "../lib/api.js";
import { tierColor, mapsUrl } from "../lib/format.js";

const CENTER = [12.9716, 77.5946];
const BASES = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
  osm: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
};
const TYPO_COLORS = ["#378ADD", "#EF9F27", "#7fe0a0", "#b98bff", "#ff8a8a",
  "#E6C229", "#46c5c5", "#e07fc0"];

function FlyTo({ pos }) {
  const map = useMap();
  useEffect(() => { if (pos) map.flyTo(pos, 16, { duration: 0.8 }); }, [pos]);
  return null;
}

export default function LiveMap({ zones, flyTo, onSelect }) {
  const [base, setBase] = useState("dark");
  const [colorMode, setColorMode] = useState("tier"); // tier | typology
  const [showEvidence, setShowEvidence] = useState(false);
  const [showRings, setShowRings] = useState(true);
  const [evidence, setEvidence] = useState([]);

  useEffect(() => {
    if (showEvidence && evidence.length === 0) {
      api("/api/evidence-points").then((p) => setEvidence(p.slice(0, 3000))).catch(() => {});
    }
  }, [showEvidence]);

  const typoList = useMemo(
    () => [...new Set(zones.map((z) => z.typology))].filter(Boolean), [zones]);
  const colorOf = (z) =>
    colorMode === "typology"
      ? TYPO_COLORS[typoList.indexOf(z.typology) % TYPO_COLORS.length]
      : tierColor(z.tier);

  const radius = (z) => 4 + (z.pressure / 100) * 11;

  return (
    <>
      <div className="layer-toggles">
        <label className="toggle"><input type="checkbox" checked={showRings}
          onChange={(e) => setShowRings(e.target.checked)} /> Evening blind-spot rings</label>
        <label className="toggle"><input type="checkbox" checked={showEvidence}
          onChange={(e) => setShowEvidence(e.target.checked)} /> Evidence points</label>
        <label className="toggle"><input type="checkbox"
          checked={colorMode === "typology"}
          onChange={(e) => setColorMode(e.target.checked ? "typology" : "tier")} /> Color by typology</label>
        <select className="searchbox" value={base} onChange={(e) => setBase(e.target.value)}
          style={{ width: "auto" }}>
          <option value="dark">Dark</option><option value="light">Light</option>
          <option value="osm">OSM</option>
        </select>
      </div>

      <div className="map-overlay stats">
        <div className="mono" style={{ fontSize: 22, fontWeight: 800 }}>{zones.length}</div>
        <div className="muted" style={{ fontSize: 11 }}>zones shown</div>
        <div style={{ marginTop: 6, fontSize: 11 }}>
          P1 {zones.filter((z) => z.tier === "P1").length} · blind {zones.filter((z) => z.evening_blind_spot).length}
        </div>
      </div>

      <div className="map-overlay legend">
        {colorMode === "tier"
          ? ["P1", "P2", "P3", "P4"].map((t) => (
              <div className="row" key={t}><span className="dot" style={{ background: tierColor(t) }} /> {t}</div>))
          : typoList.slice(0, 8).map((t, i) => (
              <div className="row" key={t}><span className="dot" style={{ background: TYPO_COLORS[i % 8] }} /> {t}</div>))}
        <div className="row muted" style={{ marginTop: 6, fontSize: 10 }}>size = obstruction pressure</div>
      </div>

      <MapContainer center={CENTER} zoom={12} preferCanvas>
        <TileLayer url={BASES[base]} attribution="© OpenStreetMap, © CARTO" />
        <FlyTo pos={flyTo} />

        {showEvidence && evidence.map((p, i) => (
          <CircleMarker key={"e" + i} center={[p.lat, p.lon]} radius={1.6}
            pathOptions={{ color: "#5b6472", weight: 0, fillOpacity: 0.5 }} />
        ))}

        {zones.map((z) => (
          <CircleMarker key={z.id} center={[z.lat, z.lon]} radius={radius(z)}
            pathOptions={{ color: colorOf(z), weight: z.emerging ? 2 : 1,
              fillColor: colorOf(z), fillOpacity: 0.55,
              dashArray: z.forecast_rising ? "3" : null }}
            eventHandlers={{ click: () => onSelect(z.id) }}>
            <Popup>
              <b>Zone {z.id}</b> — <span style={{ color: tierColor(z.tier) }}>{z.tier}</span><br />
              Priority {z.priority} · pressure {z.pressure}<br />
              {z.station || "—"} · {z.typology}<br />
              {z.evening_blind_spot && <span style={{ color: "#EF9F27" }}>⚠ evening blind spot<br /></span>}
              <i style={{ fontSize: 11 }}>{z.intervention}</i><br />
              <a href={mapsUrl(z.lat, z.lon)} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>
            </Popup>
          </CircleMarker>
        ))}

        {showRings && zones.filter((z) => z.evening_blind_spot).map((z) => (
          <CircleMarker key={"r" + z.id} center={[z.lat, z.lon]} radius={radius(z) + 5}
            pathOptions={{ color: "#EF9F27", weight: 1.3, fill: false, dashArray: "4" }} />
        ))}
      </MapContainer>
    </>
  );
}
