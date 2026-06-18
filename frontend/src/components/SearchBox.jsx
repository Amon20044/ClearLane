import { useState } from "react";
import { api } from "../lib/api.js";
import { Icon } from "./icons.jsx";

// Shared search box (header on desktop, nav drawer on mobile). onPick(id) fires
// when a result is chosen.
export default function SearchBox({ onPick, cls = "", autoFocus = false,
                                   placeholder = "Search junction / zone…" }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);

  async function search(v) {
    setQ(v);
    if (v.length < 2) return setHits([]);
    try {
      const r = await api("/api/search?q=" + encodeURIComponent(v));
      setHits(r.slice(0, 6));
    } catch { setHits([]); }
  }

  return (
    <div className={"hdr-search " + cls}>
      <span className="hdr-search-ic"><Icon name="search" size={15} /></span>
      <input className="searchbox" placeholder={placeholder} value={q}
        autoFocus={autoFocus} onChange={(e) => search(e.target.value)} />
      {hits.length > 0 && (
        <div className="hdr-results glass">
          {hits.map((h) => (
            <div key={h.id} className="kv" style={{ cursor: "pointer" }}
              onClick={() => { onPick(h.id); setHits([]); setQ(""); }}>
              <span>{h.label}</span><span className="muted mono">{h.tier}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
