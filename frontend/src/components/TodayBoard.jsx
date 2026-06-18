import { useEffect, useMemo, useState } from "react";
import { tierColor, mapsUrl } from "../lib/format.js";
import { opDispatch } from "../lib/api.js";
import {
  zoneActivity, isRecorded, fmtDate, istToday, istDatePlus, weekdayOf, DAYS_FULL,
} from "../lib/timeLens.js";

// Date-driven emergency board. Pick ANY calendar date → ranked zones to deploy to.
// A date in the data window shows recorded activity; a future date projects
// expected enforcement-demand from that date's weekday × hour pattern + forecast
// + live citizen reports. NOT a congestion prediction.
export default function TodayBoard({ zones, opByZone = {}, onSelect, onChange, daily = null }) {
  const [date, setDate] = useState(istToday());
  const [hour, setHour] = useState(null);
  const [, setTick] = useState(0);                 // 60s clock so "Today" stays live
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const lens = useMemo(() => ({ mode: "date", date, hour }), [date, hour]);
  const recorded = isRecorded(lens, daily);
  const today = istToday(), tomorrow = istDatePlus(1);

  const ranked = useMemo(() => {
    let max = 1;
    const scored = zones.map((z) => {
      const op = opByZone[z.id];
      const base = op ? op.operational_priority : z.priority;
      const act = zoneActivity(z, lens, daily);
      if (act > max) max = act;
      return { z, op, base, act };
    });
    for (const s of scored) {
      const actNorm = s.act / max;                  // 0..1
      s.score = Math.round(0.45 * s.base + 0.20 * (s.z.forecast_score || 0) + 0.35 * actNorm * 100);
      s.actNorm = actNorm;
    }
    scored.sort((a, b) => {
      if (!!a.op !== !!b.op) return a.op ? -1 : 1;
      if (a.op && b.op) return b.op.operational_priority - a.op.operational_priority;
      return b.score - a.score;
    });
    return scored.slice(0, 24);
  }, [zones, opByZone, lens, daily]);

  const reason = (s) => {
    const bits = [];
    if (s.op) bits.push(`live report (${(s.op.dispatch_state || "recommended").replace(/_/g, " ")})`);
    if (s.z.tier === "P1" || s.z.tier === "P2") bits.push(`${s.z.tier} chronic zone`);
    if (s.actNorm >= 0.6) bits.push(recorded ? "very active that day" : "high expected activity");
    else if (s.actNorm >= 0.3) bits.push(recorded ? "active that day" : "moderate expected activity");
    if (hour != null) bits.push(`around ${String(hour).padStart(2, "0")}:00`);
    if (s.z.forecast_rising) bits.push("forecast rising");
    if (s.z.evening_blind_spot) bits.push("evening blind spot");
    return bits.slice(0, 3).join(" · ") || "expected activity";
  };

  const dispatch = async (id) => {
    setBusy(id);
    try { await opDispatch({ zone_id: id, state: "assigned" }); if (onChange) await onChange(); }
    finally { setBusy(null); }
  };

  const liveCount = ranked.filter((s) => s.op).length;

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Emergency board
          <span className="mono" style={{ color: "var(--accent)", fontSize: 13, marginLeft: 8 }}>
            {fmtDate(date)}{hour != null ? ` · ${String(hour).padStart(2, "0")}:00` : ""}</span>
        </h2>
        <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
          <button className={"btn" + (date === today ? " accent" : "")} onClick={() => setDate(today)}>Today</button>
          <button className={"btn" + (date === tomorrow ? " accent" : "")} onClick={() => setDate(tomorrow)}>Tomorrow</button>
          <input type="date" className="searchbox" style={{ width: "auto" }} value={date}
            onChange={(e) => setDate(e.target.value)} />
          <select className="searchbox" style={{ width: "auto" }} value={hour == null ? "" : hour}
            onChange={(e) => setHour(e.target.value === "" ? null : +e.target.value)}>
            <option value="">All day</option>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
        </div>
      </div>
      <p className="sub">
        Plan for <b>{DAYS_FULL[weekdayOf(date)]}</b> — ranked zones to deploy to, top-down.
        {recorded
          ? " Showing recorded enforcement activity for this date."
          : " Projected expected enforcement-demand from this date's weekday × hour pattern + forecast + live reports."}
        {" "}<b>Not a congestion prediction</b> — ticket times reflect officer shifts.
      </p>
      {liveCount > 0 && (
        <div style={{ color: "var(--amber)", fontSize: 13, marginBottom: 8 }}>
          ⚑ {liveCount} zone{liveCount > 1 ? "s" : ""} with live citizen reports — prioritised at the top.
        </div>
      )}

      <div className="scroll">
        {ranked.map((s, i) => {
          const z = s.z;
          return (
            <div key={z.id} className="today-card"
              style={{
                display: "grid", gridTemplateColumns: "34px 1fr auto", gap: 12, alignItems: "center",
                padding: "10px 12px", marginBottom: 8, borderRadius: 10,
                background: "var(--panel2)", border: "1px solid var(--line)",
                borderLeft: `4px solid ${s.op ? "var(--amber)" : tierColor(z.tier)}`,
              }}>
              <div className="mono" style={{ fontSize: 18, fontWeight: 800, opacity: 0.55 }}>{i + 1}</div>
              <div style={{ minWidth: 0, cursor: "pointer" }} onClick={() => onSelect(z.id)}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{z.name}</b>
                  <span className="tier-pill" style={{ background: tierColor(z.tier) }}>{z.tier}</span>
                  {s.op && <span style={{ color: "var(--amber)", fontSize: 11 }}>⚑ live</span>}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{reason(s)}</div>
                <div className="bar" style={{ marginTop: 4, maxWidth: 320 }}>
                  <span style={{ width: Math.min(100, s.score) + "%" }} /></div>
              </div>
              <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 4 }}>
                <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: s.op ? "var(--amber)" : "var(--accent)" }}>
                  {s.op ? s.op.operational_priority : s.score}</div>
                <div className="muted" style={{ fontSize: 10 }}>{s.op ? "operational" : recorded ? "day score" : "forecast score"}</div>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  {!s.op && <button className="btn accent" disabled={busy === z.id}
                    onClick={() => dispatch(z.id)} style={{ fontSize: 11, padding: "2px 8px" }}>Dispatch</button>}
                  <a className="btn" href={mapsUrl(z.lat, z.lon)} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, padding: "2px 8px" }}>Navigate ↗</a>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
