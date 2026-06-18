import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

const COLORS = ["#378ADD", "#EF9F27", "#7fe0a0", "#b98bff", "#ff8a8a", "#E6C229", "#46c5c5", "#e07fc0"];

export default function TypologyView() {
  const [d, setD] = useState(null);
  useEffect(() => { api("/api/typology").then(setD).catch(console.error); }, []);
  if (!d) return <div className="panel">Loading…</div>;
  const counts = d.meta.counts || {};
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((e) => e[1]));

  return (
    <div className="panel">
      <h2>Zone typology (unsupervised)</h2>
      <p className="sub">KMeans on each zone's temporal × composition fingerprint (k={d.meta.k},
        silhouette {d.meta.silhouette}). A lens nobody else has: types of hotspots, not just a heatmap.</p>
      {entries.map(([name, n], i) => (
        <div key={name} style={{ margin: "8px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span><span className="dot" style={{ background: COLORS[i % 8], display: "inline-block", marginRight: 7 }} />{name}</span>
            <span className="muted mono">{n} zones</span>
          </div>
          <div className="bar"><span style={{ width: (100 * n / max) + "%", background: COLORS[i % 8] }} /></div>
        </div>
      ))}
      <p className="note" style={{ marginTop: 14 }}>Use the “Color by typology” toggle on the Command Map to
        see these clusters geographically.</p>
    </div>
  );
}
