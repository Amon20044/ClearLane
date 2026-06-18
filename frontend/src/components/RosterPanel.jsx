import { useMemo, useState } from "react";
import { RANKS, SHIFTS } from "../lib/force.js";

// Presentational members + hierarchy view for one station. Ranks are shown
// top-down (Inspector / SHO at the top → Constables) with a shift chip per
// officer. Optional add/remove when the viewer is in scope (canManage).
const RANK_HEADING = {
  "Inspector": "Inspector · Station House Officer",
  "Police Sub-Inspector": "Sub-Inspectors",
  "Assistant Sub-Inspector": "Assistant Sub-Inspectors",
  "Head Constable": "Head Constables",
  "Constable": "Constables",
};
const SHIFT_COLOR = { A: "#378ADD", B: "#EF9F27", C: "#b98bff" };

export default function RosterPanel({ officers = [], live = false, loading = false,
                                     canManage = false, onAdd, onRemove, compact = false }) {
  const [form, setForm] = useState({ name: "", rank: "Constable", shift: "A" });

  const byRank = useMemo(() => {
    const g = {}; RANKS.forEach((r) => (g[r] = []));
    officers.forEach((o) => (g[o.rank] || g.Constable).push(o));
    return g;
  }, [officers]);
  const shiftCount = useMemo(() => {
    const c = { A: 0, B: 0, C: 0 };
    officers.forEach((o) => { c[o.shift] = (c[o.shift] || 0) + 1; });
    return c;
  }, [officers]);

  function submit() {
    if (!form.name.trim()) return;
    onAdd?.(form);
    setForm({ name: "", rank: "Constable", shift: "A" });
  }

  if (loading) return <div className="muted" style={{ padding: 8 }}>Loading roster…</div>;

  return (
    <div>
      <div className="roster-summary">
        <b>{officers.length}</b> officers
        <span className="muted"> · </span>
        {Object.keys(SHIFTS).map((s) => (
          <span key={s} className="shift-chip" style={{ borderColor: SHIFT_COLOR[s], color: SHIFT_COLOR[s] }}>
            {s} {SHIFTS[s].label} {shiftCount[s] || 0}
          </span>
        ))}
        <span className={live ? "badge live" : "badge demo"} style={{ padding: "1px 7px", marginLeft: 6 }}>
          {live ? "● LIVE roster" : "● offline seed"}
        </span>
      </div>

      {canManage && (
        <div className="add-officer">
          <input className="searchbox" placeholder="officer name"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
          <select className="searchbox" value={form.rank}
            onChange={(e) => setForm({ ...form, rank: e.target.value })}>
            {RANKS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <select className="searchbox" value={form.shift}
            onChange={(e) => setForm({ ...form, shift: e.target.value })}>
            {Object.keys(SHIFTS).map((s) => <option key={s} value={s}>{s} · {SHIFTS[s].label}</option>)}
          </select>
          <button className="btn accent" onClick={submit}>Add</button>
        </div>
      )}

      <div className="roster-scroll" style={compact ? { maxHeight: 280 } : undefined}>
        {RANKS.map((rank) => {
          const list = byRank[rank];
          if (!list.length) return null;
          return (
            <div key={rank} className="rank-group">
              <div className="rank-title">
                {RANK_HEADING[rank]} <span className="muted mono">{list.length}</span>
              </div>
              {list.map((o) => (
                <div key={o.id} className="off-row">
                  <span className="off-rank" title={rank}>{abbr(rank)}</span>
                  <span className="off-name">{o.name}</span>
                  <span className="shift-chip" style={{ borderColor: SHIFT_COLOR[o.shift], color: SHIFT_COLOR[o.shift] }}>
                    {o.shift}
                  </span>
                  <span className="muted mono off-badge">{o.badge}</span>
                  {canManage && <button className="x-btn" title="remove"
                    onClick={() => onRemove?.(o.id)}>✕</button>}
                </div>
              ))}
            </div>
          );
        })}
        {!officers.length && <div className="muted" style={{ padding: 8 }}>No officers on strength.</div>}
      </div>
    </div>
  );
}

function abbr(rank) {
  return ({ "Inspector": "INSP", "Police Sub-Inspector": "PSI",
    "Assistant Sub-Inspector": "ASI", "Head Constable": "HC", "Constable": "PC" })[rank] || "PC";
}
