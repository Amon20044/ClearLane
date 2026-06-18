// Force Command — troop-tracking SIMULATION engine (client-side, deterministic).
//
// HONESTY: officer/unit positions are a deployment SIMULATION for planning and
// demonstration — never a claim about measured traffic or real GPS. It also never
// touches the historical ML scores; it only consumes them as "problems" to cover.
//
// It models patrol units ("Hoysala" teams) per station, grouped by 3 rotating
// shifts, and auto-allocates idle on-duty units to the worst unserved problem
// zones using a sliding service window so coverage visibly rotates over time.

export const RANKS = ["Inspector", "Police Sub-Inspector",
  "Assistant Sub-Inspector", "Head Constable", "Constable"];
export const SHIFTS = {
  A: { label: "Morning", start: 6, end: 14 },
  B: { label: "Evening", start: 14, end: 22 },
  C: { label: "Night", start: 22, end: 6 },
};

// demo-lively timings (sim, not realistic minutes)
const SPEED_KMPH = 28;
const SERVICE_MS = 18000;     // time a unit spends on-site
const COOLDOWN_MS = 45000;    // a served zone is deprioritised this long (window slides)
const VEHICLES = ["Hoysala", "Cheetah", "Pink Hoysala", "Pilot"];

const FIRST = ["Arjun", "Vikram", "Suresh", "Ramesh", "Manjunath", "Kiran",
  "Prakash", "Naveen", "Ravi", "Anil", "Deepak", "Girish", "Harish", "Lokesh",
  "Mahesh", "Praveen", "Rakesh", "Santosh", "Umesh", "Nagaraj", "Roopa", "Shilpa"];
const LAST = ["Gowda", "Reddy", "Naik", "Rao", "Shetty", "Kumar", "Murthy",
  "Hegde", "Patil", "Nair", "Babu", "Prasad", "Bhat", "Desai", "Kulkarni"];

function rng(seed) {
  let s = (seed * 2654435761) >>> 0;
  return (n) => { s = (1103515245 * s + 12345) & 0x7fffffff; return s % n; };
}
const slugSeed = (slug) => [...(slug || "x")].reduce((a, c) => a + c.charCodeAt(0), 0);

export function haversineKm(a, b, c, d) {
  const R = 6371, r = Math.PI / 180;
  const dphi = (c - a) * r, dl = (d - b) * r;
  const x = Math.sin(dphi / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Deterministic offline roster (mirrors backend force.py seeding closely enough).
export function genRoster(slug, nZones = 12) {
  const size = Math.max(6, Math.min(18, Math.round(nZones * 0.35) + 5));
  const nx = rng(slugSeed(slug) + size);
  const plan = ["Inspector"];
  const si = Math.min(2, Math.max(1, Math.floor(size / 6)));
  const asi = Math.min(2, Math.max(1, Math.floor(size / 6)));
  for (let i = 0; i < si; i++) plan.push("Police Sub-Inspector");
  for (let i = 0; i < asi; i++) plan.push("Assistant Sub-Inspector");
  while (plan.length < size) plan.push(nx(10) < 4 ? "Head Constable" : "Constable");
  const shifts = ["A", "B", "C"];
  return plan.map((rank, i) => ({
    id: `${slug}-${i}`,
    name: `${FIRST[nx(FIRST.length)]} ${LAST[nx(LAST.length)]}`,
    badge: `${slug.slice(0, 3).toUpperCase()}-${1000 + i}`,
    rank, shift: shifts[i % 3], status: "available",
  }));
}

function rankIdx(r) { const i = RANKS.indexOf(r); return i < 0 ? 99 : i; }

// Build patrol units from a roster: group each shift's officers into teams of ~3.
export function buildUnits(slug, station, officers) {
  const byShift = { A: [], B: [], C: [] };
  (officers || []).forEach((o) => { (byShift[o.shift] || byShift.A).push(o); });
  const units = [];
  Object.keys(byShift).forEach((sh) => {
    const team = byShift[sh].slice().sort((a, b) => rankIdx(a.rank) - rankIdx(b.rank));
    const perUnit = 3;
    const n = Math.max(team.length ? 1 : 0, Math.ceil(team.length / perUnit));
    for (let u = 0; u < n; u++) {
      const members = team.slice(u * perUnit, (u + 1) * perUnit);
      if (!members.length) continue;
      const veh = VEHICLES[(slugSeed(slug) + units.length) % VEHICLES.length];
      units.push({
        id: `${slug}-${sh}-${u}`, station_slug: slug, shift: sh,
        name: `${veh} ${sh}${u + 1}`, lead: members[0],
        members, size: members.length,
        home: { lat: station.lat, lon: station.lon },
        pos: { lat: station.lat, lon: station.lon },
        status: "idle", assignment: null,
      });
    }
  });
  return units;
}

export function shiftOnDuty(shift, hour) {
  const s = SHIFTS[shift]; if (!s) return false;
  return s.start < s.end ? (hour >= s.start && hour < s.end)
    : (hour >= s.start || hour < s.end);
}

// ---- per-station live state -------------------------------------------------
const STATE = new Map();   // slug -> { units, served: Map(zoneId->ts) }

export function ensureStation(slug, station, officers) {
  if (!STATE.has(slug)) {
    STATE.set(slug, {
      units: buildUnits(slug, station, officers), served: new Map(),
      autoAlloc: true,
    });
  } else if (officers && STATE.get(slug).units.length === 0) {
    STATE.get(slug).units = buildUnits(slug, station, officers);
  }
  return STATE.get(slug);
}
export function setAutoAlloc(slug, on) {
  const s = STATE.get(slug); if (s) s.autoAlloc = on;
}
export function getAutoAlloc(slug) { return STATE.get(slug)?.autoAlloc ?? true; }

function lerp(a, b, t) { return a + (b - a) * t; }

function moveUnit(u, now) {
  const a = u.assignment;
  if (!a) return;
  if (a.phase === "enroute" || a.phase === "returning") {
    const from = a.phase === "enroute" ? u.home : a.target;
    const to = a.phase === "enroute" ? a.target : u.home;
    const t = a.eta > a.depart ? Math.min(1, (now - a.depart) / (a.eta - a.depart)) : 1;
    u.pos = { lat: lerp(from.lat, to.lat, t), lon: lerp(from.lon, to.lon, t) };
    if (t >= 1) {
      if (a.phase === "enroute") {
        a.phase = "on_site"; a.onSiteUntil = now + SERVICE_MS;
        u.status = "on_site";
      } else {
        u.assignment = null; u.status = "idle"; u.pos = { ...u.home };
      }
    }
  } else if (a.phase === "on_site") {
    if (now >= a.onSiteUntil) {
      // record service, head back; the zone cools down so the window slides on
      STATE.get(u.station_slug)?.served.set(a.zoneId, now);
      const dKm = haversineKm(u.pos.lat, u.pos.lon, u.home.lat, u.home.lon);
      a.phase = "returning"; a.depart = now;
      a.eta = now + (dKm / SPEED_KMPH) * 3600 * 1000;
      u.status = "returning";
    }
  }
}

function assign(u, prob, now) {
  const dKm = haversineKm(u.home.lat, u.home.lon, prob.lat, prob.lon);
  u.assignment = {
    zoneId: prob.id, zoneName: prob.name, target: { lat: prob.lat, lon: prob.lon },
    phase: "enroute", depart: now, eta: now + (dKm / SPEED_KMPH) * 3600 * 1000,
    onSiteUntil: 0, etaKm: dKm,
  };
  u.status = "enroute";
}

// ctx: { now, hour, problems:[{id,name,lat,lon,score}] }
export function tick(slug, station, officers, ctx) {
  const s = ensureStation(slug, station, officers);
  const now = ctx.now || Date.now();
  // duty state from shift + sim hour
  s.units.forEach((u) => {
    const duty = shiftOnDuty(u.shift, ctx.hour);
    if (!duty) {
      u.status = "off_duty"; u.assignment = null; u.pos = { ...u.home };
    } else if (u.status === "off_duty") {
      u.status = "idle";
    }
  });
  s.units.forEach((u) => { if (u.status !== "off_duty") moveUnit(u, now); });

  if (s.autoAlloc) autoAllocate(slug, ctx.problems || [], now);
  return snapshotUnits(slug);
}

// Sliding-window allocator: idle on-duty units take the worst unserved problem
// (one not currently targeted and not recently served). As units finish and zones
// cool down, the assignment window "slides" down the ranked problem list.
export function autoAllocate(slug, problems, now = Date.now()) {
  const s = STATE.get(slug); if (!s) return [];
  const targeted = new Set(s.units.map((u) => u.assignment?.zoneId).filter(Boolean));
  const idle = s.units.filter((u) => u.status === "idle");
  const ranked = problems.slice().sort((a, b) => b.score - a.score);
  const plan = [];
  for (const u of idle) {
    const prob = ranked.find((p) =>
      !targeted.has(p.id) &&
      (now - (s.served.get(p.id) || 0)) > COOLDOWN_MS);
    if (!prob) break;
    assign(u, prob, now);
    targeted.add(prob.id);
    plan.push({ unit: u.name, zone: prob.name, etaKm: u.assignment.etaKm });
  }
  return plan;
}

// Manual dispatch: send a named unit to a specific problem zone.
export function dispatchUnit(slug, unitId, prob) {
  const s = STATE.get(slug); if (!s) return null;
  const u = s.units.find((x) => x.id === unitId);
  if (!u || u.status === "off_duty") return null;
  assign(u, prob, Date.now());
  return u;
}

export function snapshotUnits(slug) {
  const s = STATE.get(slug); if (!s) return [];
  return s.units.map((u) => ({
    id: u.id, name: u.name, shift: u.shift, size: u.size,
    lead: u.lead, members: u.members, status: u.status,
    lat: u.pos.lat, lon: u.pos.lon, home: u.home,
    target: u.assignment ? u.assignment.target : null,
    zoneId: u.assignment?.zoneId || null,
    zoneName: u.assignment?.zoneName || null,
    etaKm: u.assignment?.etaKm || null,
  }));
}

export function forceCounts(slug, hour) {
  const u = snapshotUnits(slug);
  const onDuty = u.filter((x) => x.status !== "off_duty");
  return {
    units_total: u.length,
    on_duty: onDuty.length,
    enroute: u.filter((x) => x.status === "enroute").length,
    on_site: u.filter((x) => x.status === "on_site").length,
    idle: u.filter((x) => x.status === "idle").length,
    officers_on_duty: onDuty.reduce((a, x) => a + x.size, 0),
  };
}
