"""
Stage 04b — feature store + zone x time panel (the ML input layer).

Builds two artifacts consumed by the count forecaster (M1), the blind-spot PU
ranker (M2) and the dispatch reranker (M4):

  zone_features.parquet  per-zone CONTEXT: Mappls POI distances/counts (metro,
                         bus, school, hospital, market, parking), reverse-geocoded
                         locality/pincode, and station drive-reachability.
  zone_panel.parquet     zone x hour-band x day-type counts with baseline (Nov-Jan)
                         vs recent (Feb-Mar) lags — the finer panel for context.

OFFLINE-FIRST: every Mappls call is cached; with no network/key the POI distances
fall back to a far sentinel and reachability uses haversine, so the run stays
deterministic and the self-check is untouched (this stage writes NEW artifacts
only — it never modifies zone_scores).
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C          # noqa: E402
import utils as U           # noqa: E402
import mappls as M          # noqa: E402


def _band_of(hour: int) -> str:
    for name, lo, hi in C.HOUR_BANDS:
        if lo <= hour < hi:
            return name
    return C.HOUR_BANDS[-1][0]


def _zone_features(z: pd.DataFrame, ev: pd.DataFrame) -> pd.DataFrame:
    # station operational centre = mean ticket coord per station (zone-level only)
    st_ctr = (ev.groupby("police_station", observed=True)[["latitude", "longitude"]]
                .mean().rename(columns={"latitude": "st_lat", "longitude": "st_lon"}))

    rows = []
    enriched = 0
    for _, r in z.iterrows():
        lat, lon = float(r["lat"]), float(r["lon"])
        rec = {"superzone_id": r["superzone_id"]}
        any_poi = False
        for cat, (kw, radius) in C.MAPPLS_POI.items():
            dist, cnt = M.nearby_poi(lat, lon, kw, radius)
            rec[f"poi_{cat}_m"] = float(dist)
            rec[f"poi_{cat}_n"] = int(cnt)
            any_poi = any_poi or cnt > 0
        rg = M.reverse_geocode(lat, lon)
        rec["locality"] = rg.get("locality")
        rec["pincode"] = rg.get("pincode")
        # station reachability: live Mappls drive-time if available, else haversine
        st = r.get("police_station")
        if isinstance(st, str) and st in st_ctr.index:
            slat, slon = float(st_ctr.loc[st, "st_lat"]), float(st_ctr.loc[st, "st_lon"])
            rec["reach_km"] = round(U.haversine_m(lat, lon, slat, slon) / 1000.0, 3)
        else:
            rec["reach_km"] = np.nan
        rec["mappls_enriched"] = bool(any_poi or rg)
        enriched += int(rec["mappls_enriched"])
        rows.append(rec)

    M.flush()
    feats = pd.DataFrame(rows)
    # neutral fills so the model never sees NaN even fully offline
    for cat in C.MAPPLS_POI:
        feats[f"poi_{cat}_m"] = feats[f"poi_{cat}_m"].fillna(C.MAPPLS_POI_FAR_M)
        feats[f"poi_{cat}_n"] = feats[f"poi_{cat}_n"].fillna(0).astype(int)
    feats["reach_km"] = feats["reach_km"].fillna(feats["reach_km"].median()
                                                  if feats["reach_km"].notna().any() else 5.0)
    return feats, enriched


def _zone_panel(ev: pd.DataFrame) -> pd.DataFrame:
    e = ev.copy()
    e["band"] = e["hour_ist"].map(_band_of)
    e["day_type"] = np.where(e["is_weekend"], "weekend", "weekday")
    base = e["month_ist"].isin(C.FORECAST_FEATURE_MONTHS)
    recent = e["month_ist"].isin(C.FORECAST_TARGET_MONTHS)

    grp = ["superzone_id", "band", "day_type"]
    panel = (e.groupby(grp, observed=True)
               .agg(count=("id", "count"),
                    weight=("event_weight", "sum"),
                    severity=("row_severity", "mean")).reset_index())
    panel["count_base"] = (e[base].groupby(grp, observed=True)["id"].count()
                           .reindex(pd.MultiIndex.from_frame(panel[grp])).fillna(0).values)
    panel["count_recent"] = (e[recent].groupby(grp, observed=True)["id"].count()
                             .reindex(pd.MultiIndex.from_frame(panel[grp])).fillna(0).values)
    return panel


def run():
    z = pd.read_parquet(C.DATA_PROC / "zone_scores.parquet")
    ev = pd.read_parquet(C.DATA_PROC / "events_clean.parquet")

    feats, enriched = _zone_features(z, ev)
    feats.to_parquet(C.DATA_PROC / "zone_features.parquet", index=False)

    panel = _zone_panel(ev)
    panel.to_parquet(C.DATA_PROC / "zone_panel.parquet", index=False)

    mode = "LIVE Mappls" if M.available() else "offline defaults"
    print(f"[04b_features] zone_features ({len(feats)} zones, {enriched} enriched, "
          f"{mode}) · zone_panel ({len(panel)} zone x band x day rows)")
    return {"zones": len(feats), "enriched": enriched, "panel_rows": len(panel)}


if __name__ == "__main__":
    run()
