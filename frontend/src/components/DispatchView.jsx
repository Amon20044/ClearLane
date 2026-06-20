import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, Tooltip } from "react-leaflet";
import { dispatchQueue, dispatchNext, dispatchRecalc, zoneWhy, dispatchReward } from "../lib/api.js";
import { Icon } from "./icons.jsx";

const BASE_DARK = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

// obstruction-priority heat colour (green -> amber -> red)
function heat(p) {
  const v = Math.max(0, Math.min(100, p || 0)) / 100;
  return `hsl(${(1 - v) * 120}, 85%, 55%)`;
}
function fmt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function DispatchView({ station, onSelect }) {
  const [data, setData] = useState(null);
  const [picks, setPicks] = useState(null);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recalcing, setRecalcing] = useState(false);
  const [why, setWhy] = useState(null);
  const [toast, setToast] = useState("");

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  const reload = async (withLive = live) => {
    setBusy(true);
    const [q, n] = await Promise.all([
      dispatchQueue({ station, live: withLive, limit: 60 }),
      dispatchNext({ station, n: 5 }),
    ]);
    setData(q); setPicks(n); setBusy(false);
  };

  useEffect(() => { reload(false); /* eslint-disable-next-line */ }, [station]);

  const toggleLive = async () => { const nx = !live; setLive(nx); await reload(nx); };

  const forceRecalc = async () => {
    setRecalcing(true);
    const snap = await dispatchRecalc({ limit: 80 });
    // recalc is city-wide; scope to the station for display if needed
    let q = snap.queue || [];
    if (station) q = q.filter((z) => (z.station || "").toLowerCase() === station.toLowerCase());
    setData({ ...snap, queue: q, live: snap.live });
    setLive(!!snap.live);
    const n = await dispatchNext({ station, n: 5 });
    setPicks(n);
    setRecalcing(false);
    flash(snap.persisted ? "Recalculated against live traffic · snapshot saved"
                         : "Recalculated against live traffic");
  };

  const queue = data?.queue || [];
  const center = useMemo(() => {
    const w = queue.filter((z) => z.lat != null);
    if (!w.length) return [12.97, 77.59];
    return [w.reduce((s, z) => s + z.lat, 0) / w.length,
            w.reduce((s, z) => s + z.lon, 0) / w.length];
  }, [queue]);

  const sendReward = async (z, kind) => {
    await dispatchReward({ zone_id: z.id, kind });
    flash(`Logged "${kind.replace(/_/g, " ")}" · bandit updated`);
    setPicks(await dispatchNext({ station, n: 5 }));
  };

  const openWhy = async (id) => {
    if (why?.id === id) { setWhy(null); return; }
    setWhy({ id, loading: true });
    setWhy({ ...(await zoneWhy(id)), id });
  };

  return (
    <div className="dispatch-view">
      <div className="dispatch-head">
        <div className="dispatch-title">
          <h2><Icon name="dispatch" size={20} /> Dispatch AI</h2>
          <p className="muted">
            Reranked by the M4 model — forecast + current pressure + under-observation
            + reachability. {station ? `Scoped to ${station}.` : "City-wide."}
          </p>
          {data && (
            <div className="dispatch-stamp">
              <span className="stamp-dot" data-live={data.live ? "1" : "0"} />
              Calculated <b>{fmt(data.generated_at)}</b>
              <span className="sep">·</span>
              auto-reranks every {data.auto_interval_min || 5} min
              {data.last_recalc && <><span className="sep">·</span> last cron {fmt(data.last_recalc)}</>}
              {data.live ? <span className="chip live">LIVE traffic</span>
                         : <span className="chip">model only</span>}
            </div>
          )}
        </div>
        <div className="dispatch-actions">
          <button className={"btn live-toggle" + (live ? " on" : "")} onClick={toggleLive} disabled={busy || recalcing}>
            <Icon name="pulse" size={14} /> {live ? "Live ETA: ON" : "Live ETA"}
          </button>
          <button className="btn accent recalc-btn" onClick={forceRecalc} disabled={recalcing}>
            <Icon name="sync" size={14} className={recalcing ? "spin" : ""} />
            {recalcing ? "Recalculating…" : "Force recalculate"}
          </button>
        </div>
      </div>

      <div className="dispatch-grid">
        <div className="dispatch-map">
          <MapContainer center={center} zoom={12} scrollWheelZoom
            style={{ height: "100%", width: "100%" }} preferCanvas>
            <TileLayer url={BASE_DARK} subdomains="abcd"
              attribution="&copy; OpenStreetMap, &copy; CARTO" />
            {queue.map((z) => z.lat != null && (
              <CircleMarker key={z.id} center={[z.lat, z.lon]}
                radius={6 + (z.dispatch_priority || 0) / 10}
                pathOptions={{ color: heat(z.dispatch_priority), weight: 1.5,
                               fillColor: heat(z.dispatch_priority), fillOpacity: 0.55 }}
                eventHandlers={{ click: () => onSelect && onSelect(z.id) }}>
                <Tooltip>{z.name || z.id} · P{Math.round(z.dispatch_priority)}</Tooltip>
                <Popup>
                  <b>{z.name || z.id}</b> <span className="tier-chip">{z.tier}</span>
                  <div className="pop-pri">dispatch priority {z.dispatch_priority}
                    {z.assoc_score != null && <> · live delay {z.assoc_score}%</>}
                    {z.eta_min != null && <> · ETA {z.eta_min}m</>}</div>
                  {!!(z.reason_codes || []).length && (
                    <ul className="pop-reasons">
                      {z.reason_codes.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>)}
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>

        <div className="dispatch-side">
          <div className="dq-card bandit-card">
            <div className="dq-card-head">
              <span><Icon name="pulse" size={14} /> AI next picks</span>
              <span className="algo">{picks?.algo || "…"}</span>
            </div>
            <p className="muted tiny">Explore vs exploit — balances known hotspots with
              under-observed zones so the loop finds blind spots, not just patrol bias.</p>
            <div className="bandit-list">
              {(picks?.selected || []).map((z, i) => (
                <div key={z.id} className="bandit-row">
                  <span className="dq-rank">{i + 1}</span>
                  <div className="bandit-body">
                    <button className="dq-name" onClick={() => onSelect && onSelect(z.id)}>
                      {z.name || z.id}
                    </button>
                    <div className="dq-reasons">{(z.reason_codes || [])[0] || z.station || "—"}</div>
                  </div>
                  {z.explore_bonus > 0 && (
                    <span className="xtag" title={`exploit ${z.exploit} · explore +${z.explore_bonus}`}>
                      {z.explore_bonus >= (z.exploit || 0) ? "explore" : "exploit"}
                    </span>)}
                  <span className="rw">
                    <button className="rw-ok" title="Action taken (reward)" onClick={() => sendReward(z, "action_taken")}>
                      <Icon name="validation" size={13} />
                    </button>
                    <button className="rw-no" title="False alarm (penalty)" onClick={() => sendReward(z, "false_alarm")}>
                      <Icon name="close" size={13} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="dq-card queue-card">
            <div className="dq-card-head">
              <span><Icon name="queue" size={14} /> Reranked queue</span>
              <span className="algo">{queue.length} zones</span>
            </div>
            <div className="dq-list">
              {queue.map((z, i) => (
                <div key={z.id} className={"dq-row" + (why?.id === z.id ? " open" : "")}>
                  <span className="dq-rank">{i + 1}</span>
                  <div className="dq-body">
                    <div className="dq-top">
                      <span className="dq-dot" style={{ background: heat(z.dispatch_priority) }} />
                      <button className="dq-name" onClick={() => onSelect && onSelect(z.id)}>
                        {z.name || z.id}
                      </button>
                      {z.eta_min != null && <span className="eta">{z.eta_min}m</span>}
                      <span className="dq-pri" style={{ color: heat(z.dispatch_priority) }}>
                        {Math.round(z.dispatch_priority)}
                      </span>
                      <button className="dq-why" title="Why this rank?" onClick={() => openWhy(z.id)}>
                        {why?.id === z.id ? "−" : "?"}
                      </button>
                    </div>
                    <div className="dq-reasons">
                      {(z.reason_codes || []).slice(0, 3).join(" · ") || "—"}
                    </div>
                    {why?.id === z.id && (
                      <div className="dq-whybox">
                        {why.loading ? "Loading…" : <>
                          <div className="wb-reasons">{(why.reason_codes || []).join(" · ")}</div>
                          {!!(why.model_drivers || []).length && (
                            <div className="wb-drivers">
                              <b>drivers:</b> {why.model_drivers.map((d) => d.feature).join(", ")}
                            </div>)}
                          {why.model?.forecaster && (
                            <div className="wb-model">{why.model.forecaster} · {why.model.objective}</div>)}
                        </>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {toast && <div className="dispatch-toast">{toast}</div>}
    </div>
  );
}
