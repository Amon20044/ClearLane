import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { tierColor } from "../lib/format.js";

export default function TimingGap({ onSelect, stationName = null, zones = [] }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (stationName) return;   // station mode is computed locally from scoped zones
    api("/api/timing-gap").then(setData).catch(console.error);
  }, [stationName]);

  // Station mode: build this area's own hourly histogram + timing stats from the
  // per-zone hourly arrays in the (scoped) payload — truly area-specific.
  const local = useMemo(() => {
    if (!stationName) return null;
    const h = new Array(24).fill(0);
    zones.forEach((z) => (z.hourly || []).forEach((v, i) => { h[i] += v || 0; }));
    const total = h.reduce((a, b) => a + b, 0) || 1;
    const peak_hour = h.indexOf(Math.max(...h));
    const evening = h.slice(17, 21).reduce((a, b) => a + b, 0);
    return {
      timing: {
        hourly_histogram: h, peak_hour,
        evening_peak_share_pct: +(100 * evening / total).toFixed(1),
        note: `Recorded enforcement activity for ${stationName}, by hour of day. ` +
          `Ticket times track officer shifts, not measured traffic — the evening ` +
          `window (17:00–21:00) is an assumed congestion peak, shown as a coverage gap.`,
      },
      blind_spots: zones.filter((z) => z.evening_blind_spot),
    };
  }, [stationName, zones]);

  const view = stationName ? local : data;
  if (!view) return <div className="panel">Loading…</div>;

  const h = view.timing.hourly_histogram;
  const max = Math.max(...h, 1);
  const blind = view.blind_spots;

  return (
    <div>
      <div className="panel">
        <h2>The enforcement-timing gap{stationName ? ` — ${stationName}` : ""}</h2>
        <p className="sub">Enforcement peaks at {view.timing.peak_hour}:00. Only{" "}
          <b style={{ color: "#EF9F27" }}>{view.timing.evening_peak_share_pct}%</b> of {stationName ? "this area's" : ""} tickets fall in the
          17:00–21:00 evening congestion window — {stationName ? "this area's" : "the city's"} worst chronic zones go essentially unenforced
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
        <div className="note" style={{ marginTop: 12 }}>{view.timing.note}</div>
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
