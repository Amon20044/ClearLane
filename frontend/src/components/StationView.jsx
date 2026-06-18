import { useEffect, useState } from "react";
import { api, copilot } from "../lib/api.js";

export default function StationView({ onSelect }) {
  const [rows, setRows] = useState(null);
  const [brief, setBrief] = useState(null);
  useEffect(() => { api("/api/stations").then(setRows).catch(console.error); }, []);
  if (!rows) return <div className="panel">Loading…</div>;

  async function ask(station) {
    setBrief({ station, answer: "…" });
    const r = await copilot({ station, query: `deployment briefing for ${station}` });
    setBrief({ station, ...r });
  }

  return (
    <div className="panel">
      <h2>Station command</h2>
      <p className="sub">Per police station: priority load, current ticket-time peak, and recommended
        re-timing toward the evening blind spot. Click “brief” for a deployment note (LLM copilot is an
        optional deployment extension; deterministic fallback shown offline).</p>
      <div className="scroll">
        <table>
          <thead><tr><th>Station</th><th>Zones</th><th>P1</th><th>P2</th><th>Blind spots</th>
            <th>Peak hr</th><th>Recommended re-timing</th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.station}>
                <td>{s.station}</td><td className="mono">{s.n_zones}</td>
                <td className="mono">{s.P1}</td><td className="mono">{s.P2}</td>
                <td className="mono">{s.blind_spots}</td>
                <td className="mono">{s.current_peak_hour}:00</td>
                <td style={{ fontSize: 12 }}>{s.recommended_retiming}</td>
                <td><button className="btn" onClick={() => ask(s.station)}>brief</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {brief && (
        <div className="note" style={{ marginTop: 14 }}>
          <b>{brief.station}</b> <span className="muted">({brief.source})</span><br />{brief.answer}
        </div>
      )}
    </div>
  );
}
