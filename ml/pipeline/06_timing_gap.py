"""
Stage 06 — the differentiator: the enforcement-timing gap + coverage + stations.

  * City hourly histogram (IST): enforcement peaks ~10am; the evening congestion
    window (assumption, 17:00–21:00) gets ~0.16% of tickets.
  * Per-zone evening_share; P1/P2 zones below 2% -> evening_blind_spot (~516).
  * Coverage curve: cumulative % of total WEIGHTED PRESSURE captured by top-K
    zones (top-20 ≈17.5%, top-50 ≈36.6%). This is the ROI headline.
  * Station command: per-station P1/P2 counts, top zone, current time profile,
    recommended re-timing.

Congestion windows are stated as ASSUMPTIONS from domain knowledge. The data has
no flow/speed/delay signal — this is an enforcement-COVERAGE gap, not measured
evening congestion.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C          # noqa: E402
import utils as U           # noqa: E402


def run():
    ev = pd.read_parquet(C.DATA_PROC / "events_clean.parquet")
    z = pd.read_parquet(C.DATA_PROC / "zone_scores.parquet")

    # ---- city hourly histogram (IST) ------------------------------------- #
    hourly = ev["hour_ist"].value_counts().reindex(range(24), fill_value=0).sort_index()
    total = int(hourly.sum())
    ev_lo, ev_hi = C.EVENING_CONGESTION_WINDOW
    mo_lo, mo_hi = C.MORNING_CONGESTION_WINDOW
    evening_count = int(hourly.loc[ev_lo:ev_hi - 1].sum())
    evening_peak_share = round(100 * evening_count / total, 3)
    peak_hour = int(hourly.idxmax())

    # ---- per-zone evening share + blind spot ----------------------------- #
    is_evening = (ev["hour_ist"] >= ev_lo) & (ev["hour_ist"] < ev_hi)
    zev = (ev.assign(_ev=is_evening.astype(int))
             .groupby("superzone_id", observed=True)
             .agg(zone_total=("id", "count"), zone_evening=("_ev", "sum")))
    zev["evening_share"] = zev["zone_evening"] / zev["zone_total"]
    z = z.drop(columns=[c for c in ("evening_share", "evening_blind_spot")
                        if c in z.columns])
    z = z.set_index("superzone_id").join(zev["evening_share"]).reset_index()
    z["evening_share"] = z["evening_share"].fillna(0)
    z["evening_blind_spot"] = (z["tier"].isin(["P1", "P2"]) &
                               (z["evening_share"] < C.EVENING_BLIND_SPOT_SHARE))

    # refine intervention: append an evening sweep for flagged zones
    def add_evening(r):
        base = r["intervention"]
        if r["evening_blind_spot"] and "evening sweep" not in base.lower():
            return f"{base} + add evening sweep {ev_lo:02d}:00–{ev_hi:02d}:00"
        return base
    z["intervention"] = z.apply(add_evening, axis=1)

    # ---- coverage curve (ROI headline) ----------------------------------- #
    # Officers are deployed in PRIORITY order, so the operationally honest
    # question is: deploying to the top-K *priority* zones covers what share of
    # total weighted obstruction (pressure)?  (Not "top-K by pressure" — that
    # would assume you already know the answer you're ranking by.)
    total_pressure = float(z["pressure_raw"].sum())
    ranked = z.sort_values("priority", ascending=False)
    cum = ranked["pressure_raw"].cumsum() / total_pressure * 100
    coverage = []
    for k in C.COVERAGE_TOP_K:
        k = min(k, len(ranked))
        coverage.append({"k": int(k), "coverage_pct": round(float(cum.iloc[k - 1]), 2)})
    cov_top20 = next(c["coverage_pct"] for c in coverage if c["k"] == 20)
    cov_top50 = next(c["coverage_pct"] for c in coverage if c["k"] == 50)

    # ---- station command ------------------------------------------------- #
    stations = []
    for st, sub in z.groupby("police_station", observed=True):
        if pd.isna(st):
            continue
        st_ev = ev[ev["police_station"] == st]
        hh = st_ev["hour_ist"].value_counts().reindex(range(24), fill_value=0).sort_index()
        st_peak = int(hh.idxmax()) if hh.sum() else None
        st_evening = int(((st_ev["hour_ist"] >= ev_lo) & (st_ev["hour_ist"] < ev_hi)).sum())
        top = sub.sort_values("priority", ascending=False).iloc[0]
        # station operational centre = ticket centroid; force-size proxy = distinct
        # officers historically seen at this station (created_by_id), zone-level only.
        st_lat = float(st_ev["latitude"].mean()) if len(st_ev) else float(sub["lat"].mean())
        st_lon = float(st_ev["longitude"].mean()) if len(st_ev) else float(sub["lon"].mean())
        officers_seen = int(st_ev["created_by_id"].nunique()) if len(st_ev) else 0
        active_days = int(st_ev["date_ist"].nunique()) if len(st_ev) else 0
        stations.append({
            "station": str(st),
            "lat": round(st_lat, 5), "lon": round(st_lon, 5),
            "officers_seen": officers_seen, "active_days": active_days,
            "n_zones": int(len(sub)),
            "P1": int((sub["tier"] == "P1").sum()),
            "P2": int((sub["tier"] == "P2").sum()),
            "blind_spots": int(sub["evening_blind_spot"].sum()),
            "top_zone_id": str(top["superzone_id"]),
            "top_zone_priority": round(float(top["priority"]), 1),
            "current_peak_hour": st_peak,
            "evening_tickets": st_evening,
            "recommended_retiming": (
                f"Shift a patrol from the {st_peak:02d}:00 cluster to an evening "
                f"sweep ({ev_lo:02d}:00–{ev_hi:02d}:00)" if st_peak is not None else "n/a"),
        })
    stations.sort(key=lambda s: (-s["P1"], -s["P2"]))

    z.to_parquet(C.DATA_PROC / "zone_scores.parquet", index=False)
    timing = {
        "hourly_histogram": [int(v) for v in hourly.values],
        "total_tickets": total,
        "peak_hour": peak_hour,
        "evening_window": [ev_lo, ev_hi],
        "morning_window": [mo_lo, mo_hi],
        "evening_count": evening_count,
        "evening_peak_share_pct": evening_peak_share,
        "n_evening_blind_spots": int(z["evening_blind_spot"].sum()),
        "note": ("Congestion windows are domain-knowledge ASSUMPTIONS. The dataset "
                 "has no flow/speed signal; this is an enforcement-coverage gap, "
                 "not measured evening congestion. Ticket times reflect officer "
                 "shifts, not traffic."),
    }
    U.write_json(C.DATA_PROC / "timing_gap.json", timing)
    U.write_json(C.DATA_PROC / "coverage_curve.json", coverage)
    U.write_json(C.DATA_PROC / "stations.json", stations)

    print(f"[06_timing_gap] peak hour={peak_hour}:00 · evening share="
          f"{evening_peak_share}% (target {C.SELF_CHECK_TARGETS['evening_peak_share_pct']}%)")
    print(f"[06_timing_gap] evening blind spots={timing['n_evening_blind_spots']} "
          f"(target {C.SELF_CHECK_TARGETS['evening_blind_spot']})")
    print(f"[06_timing_gap] coverage top20={cov_top20}% "
          f"(target {C.SELF_CHECK_TARGETS['coverage_top20_pct']}%) · "
          f"top50={cov_top50}% (target {C.SELF_CHECK_TARGETS['coverage_top50_pct']}%)")
    print(f"[06_timing_gap] {len(stations)} stations")
    return timing


if __name__ == "__main__":
    run()
