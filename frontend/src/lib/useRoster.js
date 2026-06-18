// Shared roster hook: one source of truth for a station's officers across the
// Station Command and Staffing screens. Live -> backend SQL (auth-scoped);
// offline -> deterministic seed (genRoster) + station meta from the bundled list.
import { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import { authFetch, slugify } from "./auth.js";
import { genRoster } from "./force.js";

export function useRoster(slug, nZones = 12) {
  const [officers, setOfficers] = useState(null); // null = loading
  const [meta, setMeta] = useState(null);         // {slug,name,lat,lon,n_zones}
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!slug) { setOfficers([]); setMeta(null); setLive(false); return; }
    (async () => {
      // 1) live backend roster (auth-scoped to govt or the owning station)
      const r = await authFetch(`/api/force/roster?station=${encodeURIComponent(slug)}`);
      if (r && alive) { setMeta(r.station); setOfficers(r.officers); setLive(true); return; }
      // 2) offline: derive meta from the bundled station list + a deterministic seed
      const list = await api("/api/stations").catch(() => []);
      const s = (list || []).find((x) => slugify(x.station || "") === slug);
      if (!alive) return;
      setMeta(s ? { slug, name: s.station, lat: s.lat, lon: s.lon, n_zones: s.n_zones } : null);
      setOfficers(genRoster(slug, s?.n_zones ?? nZones));
      setLive(false);
    })();
    return () => { alive = false; };
  }, [slug, nZones]);

  const addOfficer = useCallback(async ({ name, rank, shift }) => {
    if (!name?.trim() || !slug) return;
    const body = { station_slug: slug, name: name.trim(), rank, shift };
    const r = await authFetch("/api/force/officers", { method: "POST", body: JSON.stringify(body) });
    setOfficers((xs) => [...(xs || []), r || {
      id: `local-${Date.now()}`, name: body.name, rank, shift, status: "available",
      badge: `${slug.slice(0, 3).toUpperCase()}-${1000 + (xs?.length || 0)}`,
    }]);
  }, [slug]);

  const removeOfficer = useCallback(async (id) => {
    if (!String(id).startsWith("local") && live) {
      await authFetch(`/api/force/officers/${id}`, { method: "DELETE" });
    }
    setOfficers((xs) => (xs || []).filter((o) => o.id !== id));
  }, [live]);

  return { officers: officers || [], meta, live, loading: officers === null,
           addOfficer, removeOfficer };
}
