"""
Stage 02 — cluster occupied 100 m buckets into ~500 m operational superzones.

Deterministic grid-merge (snap to a ~0.0045°/~500 m cell). Grid is chosen over
DBSCAN on purpose: haversine DBSCAN density-chains dense commercial corridors
(KR Market, Chickpet) into a single mega-blob, destroying operational meaning.
The grid gives stable, dispatchable ~500 m zones.

Self-check target: ~1,543 superzones.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C          # noqa: E402
import utils as U           # noqa: E402


def run() -> pd.DataFrame:
    df = pd.read_parquet(C.DATA_PROC / "events_clean.parquet")
    print(f"[02_superzones] {len(df):,} events")

    df["superzone_id"] = U.superzone_cell(df["latitude"], df["longitude"])

    # per-zone centroid, then medoid = real member point nearest the centroid
    grp = df.groupby("superzone_id", observed=True)
    cen = grp.agg(
        cen_lat=("latitude", "mean"),
        cen_lon=("longitude", "mean"),
        n_tickets=("id", "count"),
        weighted_pressure=("event_weight", "sum"),
    ).reset_index()

    df = df.merge(cen[["superzone_id", "cen_lat", "cen_lon"]], on="superzone_id")
    df["_d2"] = (df["latitude"] - df["cen_lat"]) ** 2 + \
                (df["longitude"] - df["cen_lon"]) ** 2
    medoid = (df.sort_values("_d2")
                .groupby("superzone_id", observed=True)
                .agg(med_lat=("latitude", "first"),
                     med_lon=("longitude", "first")).reset_index())

    # modal parent police station + member bucket count
    def _modal(s: pd.Series):
        m = s.dropna()
        return m.mode().iloc[0] if len(m) else None

    extra = grp.agg(
        police_station=("police_station", _modal),
        n_member_buckets=("bucket_100m", "nunique"),
        junction_mode=("junction_name", _modal),
    ).reset_index()

    zones = (cen.merge(medoid, on="superzone_id")
                .merge(extra, on="superzone_id"))
    zones = zones.rename(columns={"med_lat": "lat", "med_lon": "lon"})

    # write superzone_id back onto events
    df = df.drop(columns=["cen_lat", "cen_lon", "_d2"])
    df.to_parquet(C.DATA_PROC / "events_clean.parquet", index=False)

    zones = zones.sort_values("weighted_pressure", ascending=False).reset_index(drop=True)
    zones.to_parquet(C.DATA_PROC / "superzones.parquet", index=False)

    print(f"[02_superzones] {len(zones):,} superzones "
          f"(target {C.SELF_CHECK_TARGETS['superzones']:,})")
    print(f"[02_superzones] median tickets/zone="
          f"{int(zones['n_tickets'].median())}, "
          f"max={int(zones['n_tickets'].max())}")
    return zones


if __name__ == "__main__":
    run()
