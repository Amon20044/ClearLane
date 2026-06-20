import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { tierColor } from "../lib/format.js";
import { isActive, zoneActivity, lensLabel } from "../lib/timeLens.js";

// Carriageway Impact Index lens. Ranks zones by the MODELED flow-impact proxy
// (obstruction pressure × static road-context multiplier) — explicitly NOT a
// congestion measurement. The story is the *divergence* from strategic priority:
// junction / arterial / metro-adjacent zones that a pure-pressure rank under-rates.
export default function FlowImpactView({ onSelect, lens = { mode: "all" }, daily = null }) {
  const [rows, setRows] = useState(null);
  const [sort, setSort] = useState("flow_impact_rank");
  const [dir, setDir] = useState(1);
  const [tier, setTier] = useState("");
  const lensOn = isActive(lens);

  useEffect(() => { api("/api/flow-impact").then(setRows).catch(() => setRows([])); }, []);

  const movers = useMemo(() => {
    if (!rows) return [];
    return [...rows]
      .map((z) => ({ ...z, delta: z.rank - z.flow_impact_rank }))
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 4);
  }, [rows]);

  const sorted = useMemo(() => {
    if (!rows) return [];
    let r = tier ? rows.filter((z) => z.tier === tier) : rows;
    r = r.map((z) => ({ ...z, expected: Math.round(zoneActivity(z, lens, daily)) }));
    return r.sort((a, b) => {
      const x = a[sort], y = b[sort];
      if (typeof x === "string") return dir * x.localeCompare(y);
      return dir * ((x ?? 0) - (y ?? 0));
    });
  }, [rows, sort, dir, tier, lens, daily]);

  if (!rows) return <div className="panel">Loading flow-impact lens…</div>;

  const head = (key, label) => (
    <th onClick={() => { setSort(key); setDir(sort === key ? -dir : 1); }}>
      {label}{sort === key ? (dir > 0 ? " ▲" : " ▼") : ""}</th>
  );

  return (
    <div className="panel page">
      <h2>Carriageway Impact lens</h2>
      <p className="sub">
        Ranks zones by <b>modeled flow-impact</b> = obstruction pressure ×
        road-context multiplier (junction criticality, road class, metro/commercial
        proximity). This is a <b>proxy for how much a block here disrupts movement</b>,
        built from static public road context — <b>not a measurement of congestion</b>
        (the data has no flow/speed signal). Click a row for the breakdown.
        {lensOn && <> <b style={{ color: "var(--accent)" }}>Date lens: {lensLabel(lens, daily)}</b> — Expected column shows activity for that date.</>}
      </p>

      {movers.length > 0 && (
        <div className="rankstory" style={{ display: "block", marginBottom: 14 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            BIGGEST MOVERS — zones the flow-impact lens elevates above their strategic rank
            (critical intersections / arterials a pure-pressure rank under-weights):
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {movers.map((z) => (
              <button key={z.id} className="btn" onClick={() => onSelect(z.id)}
                style={{ textAlign: "left", lineHeight: 1.3, flex: "1 1 160px", minWidth: 0 }}>
                <b>{z.name}</b><br />
                <span className="mono" style={{ fontSize: 11 }}>
                  flow #{z.flow_impact_rank} <span className="muted">vs strategic #{z.rank}</span>
                  {z.delta > 0 && <span style={{ color: "var(--accent)" }}> ▲{z.delta}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="filterbar">
        {["", "P1", "P2", "P3", "P4"].map((t) => (
          <button key={t || "all"} className={"btn" + (tier === t ? " accent" : "")}
            onClick={() => setTier(t)}>{t || "All"}</button>
        ))}
      </div>

      <div className="scroll">
        <table className="dt">
          <thead>
            <tr>
              {head("flow_impact_rank", "Flow #")}<th>Location</th>{head("tier", "Tier")}
              {head("flow_impact", "Flow impact")}{head("context_multiplier", "×context")}
              {lensOn && head("expected", "Expected")}
              {head("priority", "Pressure-priority")}{head("rank", "Strategic #")}
              <th>Δ vs strategic</th><th>Station</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 400).map((z) => {
              const delta = z.rank - z.flow_impact_rank;
              return (
                <tr key={z.id} onClick={() => onSelect(z.id)}>
                  <td data-label="Flow #" className="mono">{z.flow_impact_rank}</td>
                  <td data-label="Location"><b>{z.name}</b><span className="mono muted" style={{ fontSize: 10 }}> {z.id}</span></td>
                  <td data-label="Tier"><span className="tier-pill" style={{ background: tierColor(z.tier) }}>{z.tier}</span></td>
                  <td data-label="Flow impact" className="mono">{z.flow_impact}</td>
                  <td data-label="×context" className="mono">×{z.context_multiplier}</td>
                  {lensOn && <td data-label="Expected" className="mono" style={{ color: "var(--accent)" }}>{z.expected}</td>}
                  <td data-label="Pressure-priority">{z.priority}</td>
                  <td data-label="Strategic #" className="mono">{z.rank}</td>
                  <td data-label="Δ vs strategic" className="mono" style={{ color: delta > 0 ? "var(--accent)" : delta < 0 ? "#5b6472" : "inherit" }}>
                    {delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : "—"}</td>
                  <td data-label="Station">{z.station || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
