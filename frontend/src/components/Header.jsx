import { useEffect, useState } from "react";
import { isLive, api } from "../lib/api.js";
import { nowIST } from "../lib/format.js";

export default function Header({ kpis, onOpenZone, setView }) {
  const [clock, setClock] = useState(nowIST());
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);

  useEffect(() => {
    const t = setInterval(() => setClock(nowIST()), 1000);
    return () => clearInterval(t);
  }, []);

  async function search(v) {
    setQ(v);
    if (v.length < 2) return setHits([]);
    try {
      const r = await api("/api/search?q=" + encodeURIComponent(v));
      setHits(r.slice(0, 6));
    } catch {
      setHits([]);
    }
  }

  return (
    <header className="header">
      <div className="wordmark">Clear<span className="lane">Lane</span></div>
      <div className="meta">{kpis.data_window}</div>
      <div className="spacer" />
      <div style={{ position: "relative" }}>
        <input className="searchbox" placeholder="Search junction / zone…"
          value={q} onChange={(e) => search(e.target.value)} />
        {hits.length > 0 && (
          <div className="map-overlay" style={{ position: "absolute", top: 32, right: 0, zIndex: 2000 }}>
            {hits.map((h) => (
              <div key={h.id} className="kv" style={{ cursor: "pointer" }}
                onClick={() => { setView("command"); onOpenZone(h.id, true); setHits([]); setQ(""); }}>
                <span>{h.label}</span><span className="muted mono">{h.tier}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <span className="mono meta">{clock}</span>
      <span className={"badge " + (isLive() ? "live" : "demo")}>
        {isLive() ? "● LIVE" : "● DEMO (offline)"}
      </span>
    </header>
  );
}
