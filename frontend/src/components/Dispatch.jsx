import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { tierColor, mapsUrl } from "../lib/format.js";

const STEPS = ["En route", "On site", "Cleared", "Escalated (structural)"];

export default function Dispatch({ id }) {
  const [z, setZ] = useState(null);
  const [status, setStatus] = useState(null);
  useEffect(() => { api("/api/zone/" + encodeURIComponent(id)).then(setZ).catch(console.error); }, [id]);
  if (!z) return <div style={{ padding: 24 }}>Loading dispatch…</div>;

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: 18 }}>
      <a href="#/" className="muted" style={{ fontSize: 13 }}>← back to dashboard</a>
      <h1 style={{ margin: "10px 0" }}>Zone {z.id}{" "}
        <span className="tier-pill" style={{ background: tierColor(z.tier) }}>{z.tier}</span></h1>
      <p className="mono muted">{z.lat.toFixed(5)}, {z.lon.toFixed(5)}</p>

      <a className="btn accent" style={{ display: "block", textAlign: "center", padding: 16, fontSize: 18 }}
        href={mapsUrl(z.lat, z.lon)} target="_blank" rel="noreferrer">Navigate ↗</a>

      <div style={{ display: "flex", justifyContent: "center", margin: "16px 0" }}>
        <img alt="QR" width="160" height="160"
          src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(mapsUrl(z.lat, z.lon))}`} />
      </div>

      <div className="intervention"><b>▸ {z.intervention}</b><br />
        <span className="muted">Window: {z.recommended_window}</span></div>

      <h3>Action checklist</h3>
      <ul style={{ lineHeight: 2 }}>
        <li>Clear obstructing vehicles ({z.vehicle_mix?.[0]?.name || "mixed"})</li>
        <li>{z.habitual ? "Habitual zone — log repeat plates, flag for parking infra" : "Transient — enforcement presence sufficient"}</li>
        <li>{z.evening_blind_spot ? "⚠ Evening blind spot — sweep 17:00–21:00" : "Cover current peak"}</li>
      </ul>

      <h3>Status</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {STEPS.map((s) => (
          <button key={s} className={"btn" + (status === s ? " accent" : "")}
            style={{ padding: 14, fontSize: 15 }} onClick={() => setStatus(s)}>{s}</button>
        ))}
      </div>
      {status && <p className="note" style={{ marginTop: 12 }}>Reported: <b>{status}</b> (deployment extension)</p>}
    </div>
  );
}
