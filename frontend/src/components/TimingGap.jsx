import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { tierColor, HOURS } from "../lib/format.js";

export default function TimingGap({ onSelect }) {
  const [data, setData] = useState(null);
  useEffect(() => { api("/api/timing-gap").then(setData).catch(console.error); }, []);
  if (!data) return <div className="panel">Loading…</div>;

  const h = data.timing.hourly_histogram;
  const max = Math.max(...h);
  const blind = data.blind_spots;

  return (
    <div>
      <div className="panel">
        <h2>The enforcement-timing gap</h2>
        <p className="sub">Enforcement peaks at {data.timing.peak_hour}:00. Only{" "}
          <b style={{ color: "#EF9F27" }}>{data.timing.evening_peak_share_pct}%</b> of tickets fall in the
          17:00–21:00 evening congestion window — the city's worst chronic zones go essentially unenforced
          exactly when congestion bites.</p>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 200, marginTop: 10 }}>
          {h.map((v, i) => {
            const evening = i >= 17 && i < 21;
            const morning = i >= 8 && i < 11;
            return (
              <div key={i} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ height: 170, display: "flex", alignItems: "flex-end" }}>
                  <div title={`${i}:00 — ${v.toLocaleString()}`} style={{ width: "100%",
                    height: (100 * v / max) + "%",
                    background: evening ? "#EF9F27" : morning ? "#378ADD" : "#2c3647", borderRadius: 2 }} />
                </div>
                <div className="mono muted" style={{ fontSize: 9 }}>{i}</div>
              </div>
            );
          })}
        </div>
        <div className="note" style={{ marginTop: 12 }}>{data.timing.note}</div>
      </div>

      <div className="panel">
        <h3>Evening blind-spot zones ({blind.length}) — top priority unenforced in 17:00–21:00</h3>
        <div className="scroll">
          <table>
            <thead><tr><th>#</th><th>Tier</th><th>Priority</th><th>Evening %</th><th>Station</th><th>Recommended</th></tr></thead>
            <tbody>
              {blind.sort((a, b) => a.rank - b.rank).slice(0, 120).map((z) => (
                <tr key={z.id} onClick={() => onSelect(z.id)}>
                  <td className="mono">{z.rank}</td>
                  <td><span className="tier-pill" style={{ background: tierColor(z.tier) }}>{z.tier}</span></td>
                  <td>{z.priority}</td>
                  <td className="mono">{((z.evening_share ?? 0) * 100).toFixed(1)}%</td>
                  <td>{z.station || "—"}</td>
                  <td style={{ fontSize: 12 }}>{z.intervention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
