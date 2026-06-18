import { num } from "../lib/format.js";
import { Icon } from "./icons.jsx";

const ITEMS = [
  ["total_zones", "Operational zones", null, "typology", "var(--accent)"],
  ["P1", "P1 priority", "P1", "shield", "var(--p1)"],
  ["chronic", "Chronic zones", "chronic", "pulse", "var(--amber)"],
  ["evening_blind_spot", "Evening blind spots", "evening_blind_spot", "timing", "var(--p3)"],
  ["emerging", "Emerging", "emerging", "flow_impact", "#b98bff"],
  ["forecast_rising", "Forecast-rising", "forecast_rising", "forecast", "var(--bad)"],
];

export default function KpiStrip({ kpis, filter, setFilter, setView, snapshot }) {
  const liveZones = snapshot?.counts?.live_zones ?? 0;
  return (
    <div className="kpis">
      {ITEMS.map(([key, label, f, icon, color]) => (
        <div key={key}
          className={"kpi" + (filter === f && f ? " active" : "")}
          onClick={() => { if (f) { setFilter(filter === f ? null : f); setView("command"); } }}>
          <div className="kpi-ic" style={{ color }}><Icon name={icon} size={16} /></div>
          <div className="kpi-body">
            <div className="v">{num(kpis[key])}</div>
            <div className="l">{label}</div>
          </div>
        </div>
      ))}
      <div className="kpi" onClick={() => setView("operations")}
        style={{ borderColor: liveZones ? "var(--amber)" : undefined }}>
        <div className="kpi-ic" style={{ color: "var(--amber)" }}>
          <Icon name="operations" size={16} className={liveZones ? "op-pulse" : ""} /></div>
        <div className="kpi-body">
          <div className="v" style={{ color: liveZones ? "var(--amber)" : undefined }}>{num(liveZones)}</div>
          <div className="l">Live ops</div>
        </div>
      </div>
    </div>
  );
}
