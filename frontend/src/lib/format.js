export const TIER_COLOR = { P1: "#E24B4A", P2: "#EF9F27", P3: "#E6C229", P4: "#639922" };
export const ACCENT = "#378ADD";

export const tierColor = (t) => TIER_COLOR[t] || "#5b6472";

export function nowIST() {
  // IST = UTC+5:30
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 3600000);
  return ist.toLocaleTimeString("en-GB", { hour12: false }) + " IST";
}

export const mapsUrl = (lat, lon) => `https://www.google.com/maps?q=${lat},${lon}`;

export const pct = (x, d = 1) => (x == null ? "—" : `${(+x).toFixed(d)}%`);
export const num = (x) => (x == null ? "—" : (+x).toLocaleString("en-IN"));

export const HOURS = Array.from({ length: 24 }, (_, i) => i);
export const MONTHS = ["2023-11", "2023-12", "2024-01", "2024-02", "2024-03", "2024-04"];
export const MONTH_LABEL = { "2023-11": "Nov", "2023-12": "Dec", "2024-01": "Jan",
  "2024-02": "Feb", "2024-03": "Mar", "2024-04": "Apr" };
