import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";

export default function CoverageSimulator({ totalZones }) {
  const [curve, setCurve] = useState(null);
  const [k, setK] = useState(20);
  useEffect(() => { api("/api/coverage-curve").then(setCurve).catch(console.error); }, []);

  // NB: hooks must run on every render — keep useMemo above any early return.
  const at = useMemo(() => {
    if (!curve) return null;
    // nearest available K point, else interpolate
    const exact = curve.find((c) => c.k === k);
    if (exact) return exact.coverage_pct;
    const sorted = [...curve].sort((a, b) => a.k - b.k);
    let lo = sorted[0], hi = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].k <= k && sorted[i + 1].k >= k) { lo = sorted[i]; hi = sorted[i + 1]; }
    }
    const t = (k - lo.k) / Math.max(1, hi.k - lo.k);
    return +(lo.coverage_pct + t * (hi.coverage_pct - lo.coverage_pct)).toFixed(1);
  }, [curve, k]);

  if (!curve) return <div className="panel">Loading…</div>;

  const maxK = curve[curve.length - 1].k;

  return (
    <div className="panel">
      <h2>Coverage / ROI simulator</h2>
      <p className="sub">Deploying officers to the top-K <b>priority</b> zones covers what share of total
        <b> weighted obstruction evidence</b>? (Evidence-coverage, not a congestion-reduction claim.)</p>

      <div className="roi-stat">
        <div>
          <div className="big" style={{ color: "#378ADD" }}>{at}%</div>
          <div className="muted">of weighted obstruction evidence</div>
        </div>
        <div className="arrow">←</div>
        <div>
          <div className="big">{k}</div>
          <div className="muted">of {totalZones} zones enforced</div>
        </div>
      </div>

      <input type="range" min="1" max={maxK} value={k} className="slider"
        onChange={(e) => setK(+e.target.value)} />
      <div className="muted mono" style={{ fontSize: 11 }}>top {k} zones = {(100 * k / totalZones).toFixed(1)}% of all zones</div>

      <div className="scroll" style={{ maxHeight: "46vh", marginTop: 18 }}>
      <table style={{ minWidth: 0 }}>
        <thead><tr><th>Deploy top-K priority zones</th><th>Coverage of weighted evidence</th></tr></thead>
        <tbody>
          {curve.map((c) => (
            <tr key={c.k}><td className="mono">{c.k}</td><td>{c.coverage_pct}%</td></tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="note" style={{ marginTop: 14 }}>Headline: enforcing just the top-20 of {totalZones} zones
        covers ≈{curve.find((c) => c.k === 20)?.coverage_pct}% of all weighted obstruction evidence.</p>
    </div>
  );
}
