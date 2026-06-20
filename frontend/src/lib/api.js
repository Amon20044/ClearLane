// API layer. Every call falls back to the bundled /demo/*.json so the dashboard
// always renders even when the backend is asleep or unreachable (judging safety).
//
// VITE_API_BASE is empty by default -> same-origin RELATIVE "/api/*" calls, which
// is exactly how we deploy on Vercel (frontend + Python function share an origin).
// In local dev the Vite proxy (vite.config.js) forwards "/api" to the backend.
// Set an absolute VITE_API_BASE only to point at a backend on another origin.
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
  "/api/replay-frames": "/demo/replay_frames.json",
  "/api/offenders": "/demo/offenders.json",
  "/api/daily": "/demo/daily.json",
};

// Try the live API first (relative on Vercel, or an absolute VITE_API_BASE);
// flip to demo fallback only after a request actually fails.
let LIVE = true;
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
  if (LIVE) {
    try {
      return await getJSON(BASE + path);
    } catch (e) {
      LIVE = false; // backend unreachable -> fall through to bundled demo
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
  if (path.startsWith("/api/flow-impact")) {
    const p = await getJSON("/demo/map_payload.json");
    return [...p.zones].sort(
      (a, b) => (a.flow_impact_rank ?? 1e9) - (b.flow_impact_rank ?? 1e9));
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

// ---- Multi-model dispatch layer (reranker + bandit), demo-safe ------------- #
const _dscore = (z) =>
  z.dispatch_priority != null ? z.dispatch_priority : (z.priority || 0);

// derive reason codes client-side when the artifact predates the reranker
function _fallbackReasons(z) {
  if (z.reason_codes && z.reason_codes.length) return z.reason_codes;
  const r = [];
  if ((z.forecast_score ?? 0) >= 60 || z.rising) r.push("forecast pressure rising next month");
  if ((z.pressure ?? 0) >= 60) r.push("high current obstruction pressure");
  if ((z.under_observed ?? 0) >= 60 || z.blind_spot_ml) r.push("likely under-observed (blind spot)");
  if (z.chronic) r.push("chronic hotspot");
  if (z.evening_blind_spot) r.push("evening enforcement gap");
  return r.slice(0, 4);
}

async function _demoZones() {
  const p = await getJSON("/demo/map_payload.json");
  return p.zones || [];
}

export async function dispatchQueue({ station, tier, live = false, limit = 60 } = {}) {
  const qs = new URLSearchParams();
  if (station) qs.set("station", station);
  if (tier) qs.set("tier", tier);
  if (live) qs.set("live", "1");
  qs.set("limit", String(limit));
  if (LIVE) {
    try { return await getJSON(`${BASE}/api/dispatch/queue?${qs}`); }
    catch { LIVE = false; }
  }
  let zones = await _demoZones();
  if (station) zones = zones.filter((z) => (z.station || "").toLowerCase() === station.toLowerCase());
  if (tier) zones = zones.filter((z) => z.tier === tier.toUpperCase());
  const queue = [...zones].sort((a, b) => _dscore(b) - _dscore(a)).slice(0, limit)
    .map((z) => ({
      id: z.id, name: z.name, station: z.station, tier: z.tier, lat: z.lat, lon: z.lon,
      dispatch_priority: Math.round(_dscore(z) * 10) / 10, priority: z.priority,
      pressure: z.pressure, forecast_score: z.forecast_score, under_observed: z.under_observed,
      blind_spot_ml: z.blind_spot_ml || false, evening_blind_spot: z.evening_blind_spot || false,
      reason_codes: _fallbackReasons(z), assoc_score: null, eta_min: null, live: false,
    }));
  return { live: false, mappls: false, count: queue.length,
           note: "offline demo — dispatch_priority falls back to historical priority.",
           generated_at: new Date().toISOString(), last_recalc: null,
           auto_interval_min: 5, queue };
}

// Force a live rerank now (also what the Vercel cron hits every 5 min).
export async function dispatchRecalc({ limit = 80 } = {}) {
  if (LIVE) {
    try { return await getJSON(`${BASE}/api/dispatch/recalc?limit=${limit}`); }
    catch { LIVE = false; }
  }
  const q = await dispatchQueue({ limit });        // offline: just rebuild from the bundle
  return { ...q, persisted: false };
}

export async function dispatchNext({ station, n = 5 } = {}) {
  const qs = new URLSearchParams();
  if (station) qs.set("station", station);
  qs.set("n", String(n));
  if (LIVE) {
    try { return await getJSON(`${BASE}/api/dispatch/next?${qs}`); }
    catch { LIVE = false; }
  }
  const { queue } = await dispatchQueue({ station, limit: n });
  return { algo: "offline (priority)", n: queue.length,
           selected: queue.map((z) => ({ ...z, bandit_score: null, exploit: null, explore_bonus: null })),
           note: "Bandit runs on the live backend; offline shows the deterministic top picks." };
}

export async function zoneWhy(id) {
  if (LIVE) {
    try { return await getJSON(`${BASE}/api/zone/${encodeURIComponent(id)}/why`); }
    catch { LIVE = false; }
  }
  const z = (await detailMap())[id] || {};
  const disp = z.dispatch || {};
  return { id, name: z.name, tier: z.tier, dispatch: disp,
           reason_codes: (disp.reason_codes && disp.reason_codes.length)
             ? disp.reason_codes : _fallbackReasons(z),
           forecast: z.forecast, blind_spot: z.blind_spot, flow_impact: z.flow_impact,
           scores: z.scores, explanation: z.explanation, model_drivers: [],
           model: { forecaster: "precomputed", objective: "poisson" } };
}

export async function dispatchReward(body) {
  try { return await postJSON("/api/dispatch/reward", body); }
  catch { return { ok: false, offline: true }; }
}

export async function dispatchRoute(body) {
  try { return await postJSON("/api/dispatch/route", body); }
  catch {
    const zones = await _demoZones();
    const zmap = Object.fromEntries(zones.map((z) => [z.id, z]));
    const route = (body.ids || []).filter((i) => zmap[i]).map((i) => {
      const z = zmap[i];
      return { id: z.id, name: z.name, station: z.station, lat: z.lat, lon: z.lon,
               dispatch_priority: Math.round(_dscore(z) * 10) / 10 };
    });
    return { live: false, stops: route.length, route };
  }
}

// ---- Operational loop (live backend, with an offline in-memory fallback) ---
import * as localOps from "./localOps.js";

async function postJSON(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = `${r.status}`;
    try { detail = (await r.json()).detail || detail; } catch {}
    throw new Error(detail);
  }
  return r.json();
}

export const opSnapshot = async () => {
  try { return await getJSON(BASE + "/api/operational/snapshot"); } catch {}
  return localOps.snapshot();
};
export const opComplaint = async (body) => {
  try { return await postJSON("/api/complaints", body); } catch (e) {
    if (String(e.message).includes("bounding box")) throw e; }
  return localOps.postComplaint(body);
};
export const opDispatch = async (body) => {
  try { return await postJSON("/api/dispatches", body); } catch {}
  return localOps.postDispatch(body);
};
export const opFeedback = async (body) => {
  try { return await postJSON("/api/officer-feedback", body); } catch {}
  return localOps.postFeedback(body);
};
export const opPatchStatus = async (id, stateVal) => {
  try {
    const r = await fetch(`${BASE}/api/dispatches/${id}/status`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: stateVal }) });
    if (r.ok) return r.json();
  } catch {}
  return localOps.patchStatus(id, stateVal);
};
// seed the offline fallback's zone index from the bundled map payload
export const seedOpZones = (zones) =>
  localOps.setZones((zones || []).map((z) => ({
    id: z.id, name: z.name, lat: z.lat, lon: z.lon, tier: z.tier,
    priority: z.priority, station: z.station })));

export async function copilot(body) {
  try {
    const r = await fetch(BASE + "/api/copilot", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
  } catch {}
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
