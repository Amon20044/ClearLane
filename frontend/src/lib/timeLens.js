// Global Time Lens — one shared notion of "which date / window am I looking at"
// that every view re-weights to. DATE-DRIVEN: pick an actual calendar date.
//  • a date inside the data window (Nov'23–Apr'24)  → RECORDED activity that day
//  • a date outside it (e.g. a future date)         → PROJECTED expected demand,
//    mapped through that date's weekday × hour historical pattern.
// HONESTY: neither measures congestion — ticket times reflect officer shifts.

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];          // pandas dow (0=Mon)
export const DAYS_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];                  // JS getDay order

export const defaultLens = () => ({ mode: "all", date: null, hour: null, start: null, end: null });

const pad = (n) => String(n).padStart(2, "0");
const sum = (a) => a.reduce((s, x) => s + (x || 0), 0);

export function istNow() {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + 5.5 * 3600000);
}
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const istToday = () => ymd(istNow());
export const istDatePlus = (n) => { const d = istNow(); d.setDate(d.getDate() + n); return ymd(d); };

const parse = (str) => new Date(str + "T00:00:00");
export const weekdayOf = (str) => (parse(str).getDay() + 6) % 7;                  // → pandas 0=Mon
export function fmtDate(str) {
  if (!str) return "—";
  const d = parse(str);
  return `${DOW3[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

export const isActive = (lens) => lens.mode !== "all";
export function isRecorded(lens, daily) {
  if (lens.mode === "range") return true;
  return lens.mode === "date" && !!daily && daily.dates.indexOf(lens.date) >= 0;
}
export const isProjected = (lens, daily) => lens.mode === "date" && !isRecorded(lens, daily);
export function targetWeekday(lens) {
  return lens.mode === "date" && lens.date ? weekdayOf(lens.date) : null;
}

export function lensLabel(lens, daily) {
  if (lens.mode === "all") return "All-time";
  if (lens.mode === "range") return `${fmtDate(lens.start)} → ${fmtDate(lens.end)} · recorded`;
  if (lens.mode === "date") {
    const h = lens.hour == null ? "" : ` · ${pad(lens.hour)}:00`;
    return `${fmtDate(lens.date)}${h} · ${isRecorded(lens, daily) ? "recorded" : "projected"}`;
  }
  return "All-time";
}

// Date-range helpers.
export function rangeDayCount(lens, daily) {
  if (!daily) return 0;
  const i0 = daily.dates.indexOf(lens.start), i1 = daily.dates.indexOf(lens.end);
  if (i0 < 0 || i1 < 0) return 0;
  return Math.abs(i1 - i0) + 1;
}
function rangeSlice(arr, lens, daily) {
  if (!arr || !daily) return 0;
  let i0 = daily.dates.indexOf(lens.start), i1 = daily.dates.indexOf(lens.end);
  if (i0 < 0) i0 = 0;
  if (i1 < 0) i1 = daily.dates.length - 1;
  if (i0 > i1) [i0, i1] = [i1, i0];
  let s = 0; for (let i = i0; i <= i1; i++) s += arr[i] || 0;
  return s;
}
const hourScale = (zone, hour) => {
  if (hour == null) return 1;
  const hTot = sum(zone.hourly || []);
  return hTot ? (zone.hourly?.[hour] || 0) / hTot : 0;
};

// Expected/observed tickets for a single ZONE in the current window. Returns a
// scalar comparable across zones (≈ tickets in the window).
export function zoneActivity(zone, lens, daily) {
  if (!zone) return 0;
  if (lens.mode === "all") return zone.n_tickets || 0;

  if (lens.mode === "range") {
    const arr = daily?.zones?.[zone.id];
    if (arr) return rangeSlice(arr, lens, daily);
    const frac = daily ? rangeDayCount(lens, daily) / daily.dates.length : 0;   // P4 fallback
    return (zone.n_tickets || 0) * frac;
  }

  // date mode
  const idx = daily ? daily.dates.indexOf(lens.date) : -1;
  if (idx >= 0) {                                  // recorded — that exact day
    const arr = daily.zones?.[zone.id];
    const base = arr ? (arr[idx] || 0) : (zone.n_tickets || 0) / daily.dates.length;
    return base * hourScale(zone, lens.hour);
  }
  // projected — map the date's weekday onto this zone's own pattern
  const wd = weekdayOf(lens.date);
  const dowTot = sum(zone.dow || []);
  if (!dowTot) return 0;
  return (zone.n_tickets || 0) * ((zone.dow?.[wd] || 0) / dowTot) * hourScale(zone, lens.hour);
}

// 0..1 intensity field for map sizing / shading, normalized across zones.
export function activityField(zones, lens, daily) {
  const vals = {}; let max = 0;
  for (const z of zones) { const v = zoneActivity(z, lens, daily); vals[z.id] = v; if (v > max) max = v; }
  return { vals, max: max || 1 };
}

// Window-adjusted ranking score: blends strategic priority with window intensity.
export function adjustedScore(zone, lens, daily, max) {
  const base = zone.priority || 0;
  if (lens.mode === "all") return base;
  const intensity = zoneActivity(zone, lens, daily) / (max || 1);
  return 0.5 * base + 0.5 * intensity * 100;
}

// Expected tickets for an AREA (city / station / zone list) in the window.
export function areaExpectedTickets({ scope, station, zones }, lens, daily) {
  const zl0 = zones || [];
  const stFilter = (z) => z.station === station;

  if (lens.mode === "all") {
    const days = daily ? daily.dates.length : 1;
    const zl = scope === "station" ? zl0.filter(stFilter) : zl0;
    return zl.reduce((s, z) => s + (z.n_tickets || 0), 0) / days;   // per-day average
  }
  if (lens.mode === "range") {
    if (scope === "city") return rangeSlice(daily?.city, lens, daily);
    if (scope === "station") return rangeSlice(daily?.stations?.[station], lens, daily);
    return zl0.reduce((s, z) => s + zoneActivity(z, lens, daily), 0);
  }
  // date mode
  const idx = daily ? daily.dates.indexOf(lens.date) : -1;
  if (idx >= 0) {                                  // recorded day
    if (scope === "city") return daily.city[idx] || 0;
    if (scope === "station") return daily.stations?.[station]?.[idx]
      ?? zl0.filter(stFilter).reduce((s, z) => s + zoneActivity(z, lens, daily), 0);
    return zl0.reduce((s, z) => s + zoneActivity(z, lens, daily), 0);
  }
  const zl = scope === "station" ? zl0.filter(stFilter) : zl0;
  return zl.reduce((s, z) => s + zoneActivity(z, lens, daily), 0);
}

// Officer-demand heuristic — transparent + tunable. NOT a congestion claim.
export function officersNeeded(expectedTickets, hours = 8, ratePerHour = 4) {
  if (!expectedTickets || hours <= 0 || ratePerHour <= 0) return 0;
  return Math.max(1, Math.ceil(expectedTickets / (ratePerHour * hours)));
}
