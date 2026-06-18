import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { tierColor, mapsUrl, MONTHS, MONTH_LABEL } from "../lib/format.js";

function Bars({ items }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div>
      {items.map((i) => (
        <div key={i.name} style={{ margin: "5px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
            <span style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.name}</span>
            <span className="muted mono">{i.count}</span>
          </div>
          <div className="bar"><span style={{ width: (100 * i.count / max) + "%" }} /></div>
        </div>
      ))}
    </div>
  );
}

function Hourly({ data }) {
  const max = Math.max(1, ...data);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 70 }}>
      {data.map((v, h) => {
        const evening = h >= 17 && h < 21;
        return (
          <div key={h} title={`${h}:00 — ${v}`} style={{ flex: 1, height: "100%", display: "flex", alignItems: "flex-end" }}>
            <div style={{ width: "100%", height: (100 * v / max) + "%",
              background: evening ? "#EF9F27" : "#378ADD", borderRadius: 1 }} />
          </div>
        );
      })}
    </div>
  );
}

function Fingerprint({ grid }) {
  if (!grid) return null;
  const max = Math.max(1, ...grid.flat());
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div>
      {grid.map((row, d) => (
        <div key={d} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 1 }}>
          <span className="muted mono" style={{ width: 10, fontSize: 9 }}>{days[d]}</span>
          <div className="fingerprint" style={{ flex: 1 }}>
            {row.map((v, h) => (
              <div key={h} className="fp-cell"
                style={{ background: `rgba(55,138,221,${v / max})` }} title={`${days[d]} ${h}:00 — ${v}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ZoneDrawer({ id, onClose }) {
  const [z, setZ] = useState(null);
  useEffect(() => { setZ(null); api("/api/zone/" + encodeURIComponent(id)).then(setZ).catch(console.error); }, [id]);

  return (
    <div className="drawer-wrap">
      <div className="drawer-bg" onClick={onClose} />
      <div className="drawer">
        {!z ? <div>Loading zone…</div> : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2>Zone {z.id} <span className="tier-pill" style={{ background: tierColor(z.tier) }}>{z.tier}</span></h2>
              <button className="btn" onClick={onClose}>✕</button>
            </div>
            <p className="sub mono">{z.lat.toFixed(5)}, {z.lon.toFixed(5)} · rank #{z.rank}
              {z.junction && z.junction !== "No Junction" ? ` · ${z.junction}` : ""}</p>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <a className="btn accent" href={mapsUrl(z.lat, z.lon)} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>
              <button className="btn" onClick={() => navigator.clipboard?.writeText(`${z.lat},${z.lon}`)}>Copy coords</button>
              <a className="btn" target="_blank" rel="noreferrer"
                href={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(mapsUrl(z.lat, z.lon))}`}>QR ↗</a>
              <a className="btn" href={`#/dispatch/${encodeURIComponent(z.id)}`}>Dispatch ↗</a>
            </div>

            <div className="dials">
              <div className="dial"><div className="v">{z.scores.pressure}</div><div className="l">Pressure</div></div>
              <div className="dial"><div className="v">{z.scores.recurrence}</div><div className="l">Recurrence</div></div>
              <div className="dial"><div className="v">{z.scores.emergence}</div><div className="l">Emergence</div></div>
              <div className="dial"><div className="v" style={{ color: tierColor(z.tier) }}>{z.scores.priority}</div><div className="l">Priority</div></div>
            </div>

            <div className="intervention">
              <b>▸ {z.intervention}</b><br />
              <span className="muted">Window: {z.recommended_window}</span>
            </div>

            <div style={{ margin: "10px 0" }}>
              <span className={"tag " + (z.habitual ? "hab" : "tran")}>
                {z.habitual ? `Habitual · ${Math.round(z.repeat_share * 100)}% repeat` : "Transient (mostly unique)"}</span>
              <span className={"tag " + z.responsiveness}>{z.responsiveness}</span>
              {z.under_recognized && <span className="tag stable">under-recognized (bias)</span>}
            </div>

            <div className="note">{z.explanation}</div>

            <h3 style={{ marginTop: 16 }}>Next-month forecast</h3>
            <div className="kv"><span className="k">Predicted pressure (Feb–Mar model)</span>
              <span className="mono">{z.forecast.score}/100 {z.forecast.rising ? "↑ rising" : ""}</span></div>
            <p className="muted" style={{ fontSize: 11 }}>Forecasts obstruction pressure (a real, observed
              future quantity) on held-out months — not congestion.</p>

            <h3 style={{ marginTop: 16 }}>Hourly enforcement profile (IST)</h3>
            <Hourly data={z.hourly_histogram} />
            <p className="muted" style={{ fontSize: 11 }}>Amber = 17:00–21:00 evening congestion window (assumption).
              Ticket times reflect officer shifts, not traffic.</p>

            <h3 style={{ marginTop: 16 }}>Monthly recurrence</h3>
            <Hourly data={MONTHS.map((m) => z.monthly_recurrence[m] || 0)} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }} className="muted">
              {MONTHS.map((m) => <span key={m}>{MONTH_LABEL[m]}</span>)}
            </div>

            <h3 style={{ marginTop: 16 }}>Temporal fingerprint (weekday × hour)</h3>
            <Fingerprint grid={z.fingerprint} />

            <h3 style={{ marginTop: 16 }}>Violation mix</h3>
            <Bars items={z.violation_mix} />
            <h3 style={{ marginTop: 16 }}>Vehicle mix</h3>
            <Bars items={z.vehicle_mix} />

            <h3 style={{ marginTop: 16 }}>Enforcement exposure (bias control)</h3>
            <div className="kv"><span className="k">Distinct officers</span><span className="mono">{z.exposure.officers}</span></div>
            <div className="kv"><span className="k">Active enforcement days</span><span className="mono">{z.exposure.active_days}</span></div>
            <div className="kv"><span className="k">Bias-adjusted rank</span><span className="mono">#{z.bias_adjusted_rank}</span></div>

            <p className="muted" style={{ fontSize: 11, marginTop: 14 }}>Confidence: {z.confidence} · station {z.station || "—"}</p>
          </>
        )}
      </div>
    </div>
  );
}
