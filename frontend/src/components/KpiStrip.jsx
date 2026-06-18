import { num } from "../lib/format.js";

const ITEMS = [
  ["total_zones", "Operational zones", null],
  ["P1", "P1 priority", "P1"],
  ["chronic", "Chronic zones", "chronic"],
  ["evening_blind_spot", "Evening blind spots", "evening_blind_spot"],
  ["emerging", "Emerging", "emerging"],
  ["forecast_rising", "Forecast-rising", "forecast_rising"],
];

export default function KpiStrip({ kpis, filter, setFilter, setView }) {
  return (
    <div className="kpis">
      {ITEMS.map(([key, label, f]) => (
        <div key={key}
          className={"kpi" + (filter === f && f ? " active" : "")}
          onClick={() => { if (f) { setFilter(filter === f ? null : f); setView("command"); } }}>
          <div className="v">{num(kpis[key])}</div>
          <div className="l">{label}</div>
        </div>
      ))}
    </div>
  );
}
