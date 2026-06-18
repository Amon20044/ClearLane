import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { tierColor } from "../lib/format.js";

export default function ForecastView({ onSelect }) {
  const [d, setD] = useState(null);
  useEffect(() => { api("/api/forecast").then(setD).catch(console.error); }, []);
  if (!d) return <div className="panel">Loading…</div>;
  const m = d.metrics || {};

  return (
    <div>
      <div className="panel">
        <h2>Next-month hotspot forecast</h2>
        <p className="sub">{m.model} forecasts which zones stay / become high-obstruction next month,
          validated on held-out months. Target: observed future violation pressure — not congestion.</p>
        <div className="grid3">
          <div className="dial"><div className="v">{m.r2}</div><div className="l">R² (held-out)</div></div>
          <div className="dial"><div className="v">{m.spearman}</div><div className="l">Spearman</div></div>
          <div className="dial"><div className="v">{m.topk_precision?.top20}</div><div className="l">Top-20 precision</div></div>
        </div>
      </div>

      <div className="panel">
        <h3>Top predicted-hot zones</h3>
        <div className="scroll">
          <table>
            <thead><tr><th>Zone</th><th>Tier</th><th>Forecast score</th><th>Trend</th></tr></thead>
            <tbody>
              {d.zones.slice(0, 120).map((z) => (
                <tr key={z.id} onClick={() => onSelect(z.id)}>
                  <td className="mono">{z.id}</td>
                  <td><span className="tier-pill" style={{ background: tierColor(z.tier) }}>{z.tier}</span></td>
                  <td>{z.forecast_score}</td>
                  <td>{z.rising ? <span className="flag rise">↑ rising</span> : <span className="muted">stable</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
