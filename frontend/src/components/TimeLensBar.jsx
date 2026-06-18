import { lensLabel, istToday, istDatePlus, isActive } from "../lib/timeLens.js";

// Global time/prediction control shown above every view. DATE-DRIVEN: pick an
// actual calendar date (or range). A date in the data window shows recorded
// activity; a future date projects expected enforcement-demand (not congestion).
export default function TimeLensBar({ lens, setLens, daily }) {
  const set = (patch) => setLens({ ...lens, ...patch });
  const today = istToday(), tomorrow = istDatePlus(1);

  const chip = (active, label, onClick) => (
    <button className={"btn" + (active ? " accent" : "")}
      style={{ fontSize: 11, padding: "2px 9px" }} onClick={onClick}>{label}</button>
  );
  const isDate = lens.mode === "date";

  return (
    <div className="timelens">
      <div className="timelens-chips">
        <span className="muted" style={{ fontSize: 11, marginRight: 2 }}>📅 Date lens:</span>
        {chip(lens.mode === "all", "All-time", () => set({ mode: "all" }))}
        {chip(isDate && lens.date === today, "Today",
          () => set({ mode: "date", date: today, hour: null }))}
        {chip(isDate && lens.date === tomorrow, "Tomorrow",
          () => set({ mode: "date", date: tomorrow, hour: null }))}
        {chip(isDate && lens.date !== today && lens.date !== tomorrow, "Pick date",
          () => set({ mode: "date", date: lens.date || today, hour: lens.hour ?? null }))}
        {chip(lens.mode === "range", "Date range",
          () => set({ mode: "range", start: lens.start || daily?.start, end: lens.end || daily?.end }))}
      </div>

      {isDate && (
        <div className="timelens-ctrl">
          <input type="date" className="searchbox" style={{ width: "auto" }}
            value={lens.date || today} onChange={(e) => set({ date: e.target.value })} />
          <select className="searchbox" style={{ width: "auto" }}
            value={lens.hour == null ? "" : lens.hour}
            onChange={(e) => set({ hour: e.target.value === "" ? null : +e.target.value })}>
            <option value="">All day</option>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
        </div>
      )}

      {lens.mode === "range" && daily && (
        <div className="timelens-ctrl">
          <input type="date" className="searchbox" style={{ width: "auto" }}
            min={daily.start} max={daily.end} value={lens.start || daily.start}
            onChange={(e) => set({ start: e.target.value })} />
          <span className="muted">→</span>
          <input type="date" className="searchbox" style={{ width: "auto" }}
            min={daily.start} max={daily.end} value={lens.end || daily.end}
            onChange={(e) => set({ end: e.target.value })} />
          <span className="muted" style={{ fontSize: 10 }}>data: {daily.start} … {daily.end}</span>
        </div>
      )}

      <div className={"timelens-label" + (isActive(lens) ? " on" : "")}>
        {lensLabel(lens, daily)}
        {isActive(lens) && <span className="muted" style={{ fontSize: 10 }}>
          {lens.mode === "range" ? " · recorded activity"
            : (daily && daily.dates.indexOf(lens.date) >= 0) ? " · recorded that day"
              : " · projected demand, not congestion"}</span>}
      </div>
    </div>
  );
}
