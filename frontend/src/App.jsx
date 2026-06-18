import { useEffect, useState, useCallback } from "react";
import { api } from "./lib/api.js";
import Header from "./components/Header.jsx";
import KpiStrip from "./components/KpiStrip.jsx";
import LiveMap from "./components/LiveMap.jsx";
import PriorityTable from "./components/PriorityTable.jsx";
import ZoneDrawer from "./components/ZoneDrawer.jsx";
import TimingGap from "./components/TimingGap.jsx";
import CoverageSimulator from "./components/CoverageSimulator.jsx";
import ValidationPanel from "./components/ValidationPanel.jsx";
import ForecastView from "./components/ForecastView.jsx";
import TypologyView from "./components/TypologyView.jsx";
import StationView from "./components/StationView.jsx";
import Dispatch from "./components/Dispatch.jsx";

const VIEWS = [
  ["command", "Command Map"],
  ["queue", "Priority Queue"],
  ["timing", "Timing Gap"],
  ["coverage", "Coverage / ROI"],
  ["forecast", "Forecast"],
  ["typology", "Typology"],
  ["stations", "Station Command"],
  ["validation", "Methodology & Validation"],
];

export default function App() {
  const [view, setView] = useState("command");
  const [payload, setPayload] = useState(null);
  const [filter, setFilter] = useState(null); // KPI quick-filter
  const [selected, setSelected] = useState(null); // zone id
  const [flyTo, setFlyTo] = useState(null);
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    api("/api/map/payload").then(setPayload).catch(console.error);
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (hash.startsWith("#/dispatch/")) {
    return <Dispatch id={decodeURIComponent(hash.replace("#/dispatch/", ""))} />;
  }

  const openZone = useCallback((id, fly = false) => {
    setSelected(id);
    if (fly) {
      const z = payload?.zones.find((x) => x.id === id);
      if (z) setFlyTo([z.lat, z.lon]);
    }
  }, [payload]);

  if (!payload) return <div style={{ padding: 40 }}>Loading ClearLane…</div>;

  const zones = payload.zones;
  const filtered = applyFilter(zones, filter);

  return (
    <div className="app">
      <Header kpis={payload.kpis} onOpenZone={openZone} setView={setView} />
      <div className="body">
        <nav className="nav">
          {VIEWS.map(([k, label]) => (
            <button key={k} className={view === k ? "active" : ""}
              onClick={() => setView(k)}>{label}</button>
          ))}
        </nav>
        <div style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
          <KpiStrip kpis={payload.kpis} filter={filter} setFilter={setFilter} setView={setView} />
          <div className={"view" + (view === "command" ? " map-view" : "")}>
            {view === "command" && (
              <LiveMap zones={filtered} flyTo={flyTo} onSelect={(id) => openZone(id)} />
            )}
            {view === "queue" && (
              <PriorityTable zones={filtered} onSelect={(id) => openZone(id, true)} />
            )}
            {view === "timing" && <TimingGap onSelect={(id) => openZone(id, true)} />}
            {view === "coverage" && <CoverageSimulator totalZones={payload.kpis.total_zones} />}
            {view === "forecast" && <ForecastView onSelect={(id) => openZone(id, true)} />}
            {view === "typology" && <TypologyView />}
            {view === "stations" && <StationView onSelect={(id) => openZone(id, true)} />}
            {view === "validation" && <ValidationPanel />}
          </div>
        </div>
      </div>
      {selected && <ZoneDrawer id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function applyFilter(zones, f) {
  if (!f) return zones;
  const map = {
    P1: (z) => z.tier === "P1",
    chronic: (z) => z.chronic,
    evening_blind_spot: (z) => z.evening_blind_spot,
    emerging: (z) => z.emerging,
    forecast_rising: (z) => z.forecast_rising,
  };
  return map[f] ? zones.filter(map[f]) : zones;
}
