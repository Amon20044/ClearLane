// API layer. Every call falls back to the bundled /demo/*.json so the dashboard
// always renders even when the backend is asleep or unreachable (judging safety).
const BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

const DEMO = {
  "/api/map/payload": "/demo/map_payload.json",
  "/api/coverage-curve": "/demo/coverage_curve.json",
  "/api/timing-gap": "/demo/timing_gap.json",
  "/api/emerging": "/demo/emerging.json",
  "/api/forecast": "/demo/forecast.json",
  "/api/typology": "/demo/typology.json",
  "/api/stations": "/demo/stations.json",
  "/api/validation": "/demo/validation.json",
  "/api/evidence-points": "/demo/evidence_points.json",
};

let LIVE = !!BASE;
export const isLive = () => LIVE;

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// Demo-only artifacts loaded directly (zone detail, briefings, timing blind spots).
let _detail = null;
async function detailMap() {
  if (!_detail) _detail = await getJSON("/demo/zones_detail.json");
  return _detail;
}

export async function api(path) {
  if (BASE) {
    try {
      return await getJSON(BASE + path);
    } catch (e) {
      LIVE = false; // fall through to demo
    }
  }
  // demo fallbacks
  if (path.startsWith("/api/zone/")) {
    const id = decodeURIComponent(path.split("/api/zone/")[1]);
    return (await detailMap())[id] || null;
  }
  if (path.startsWith("/api/priority/queue")) {
    const p = await getJSON("/demo/map_payload.json");
    return [...p.zones].sort((a, b) => a.rank - b.rank);
  }
  if (path === "/api/timing-gap") {
    const t = await getJSON("/demo/timing_gap.json");
    const p = await getJSON("/demo/map_payload.json");
    return { timing: t, blind_spots: p.zones.filter((z) => z.evening_blind_spot) };
  }
  if (path === "/api/validation") {
    const v = await getJSON("/demo/validation.json");
    let offender = null;
    try { offender = await getJSON("/demo/offender_stat.json"); } catch {}
    return { validation: v, offender_stat: offender };
  }
  if (path.startsWith("/api/search")) {
    const q = decodeURIComponent((path.split("q=")[1] || "")).toLowerCase();
    const idx = await getJSON("/demo/search_index.json");
    return idx.filter((r) =>
      (r.label || "").toLowerCase().includes(q) ||
      (r.station || "").toLowerCase().includes(q) ||
      (r.junction || "").toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q)).slice(0, 25);
  }
  const key = path.split("?")[0];
  if (DEMO[key]) return getJSON(DEMO[key]);
  throw new Error("no demo fallback for " + path);
}

export async function copilot(body) {
  if (BASE) {
    try {
      const r = await fetch(BASE + "/api/copilot", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) return r.json();
    } catch {}
  }
  // demo briefing fallback
  try {
    const briefs = await getJSON("/demo/briefings.json");
    const b = body.station && briefs[body.station];
    return { answer: b || "Copilot is a deployment extension; run the backend to enable it.",
             source: "deterministic" };
  } catch {
    return { answer: "Copilot unavailable in offline demo.", source: "none" };
  }
}
