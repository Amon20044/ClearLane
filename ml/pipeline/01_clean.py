"""
Stage 01 — load, IST-convert, parse violations, filter, geo-bucket.

Honesty guardrails enforced here:
  * never touches the 100%-empty columns (description/closed_datetime/...),
  * drops rejected+duplicate tickets and pure non-parking rows,
  * every filter step is logged to outputs/reports/cleaning_summary.txt.

Self-check target: ~248,374 rows remain (16.8% removed).
"""
from __future__ import annotations

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C          # noqa: E402
import utils as U           # noqa: E402

USECOLS = [
    "id", "latitude", "longitude", "location", "vehicle_number", "vehicle_type",
    "violation_type", "offence_code", "created_datetime", "modified_datetime",
    "device_id", "created_by_id", "center_code", "police_station",
    "data_sent_to_scita", "junction_name", "validation_status",
    "validation_timestamp",
]


def run() -> pd.DataFrame:
    log_lines: list[str] = []

    def log(msg: str):
        print(f"[01_clean] {msg}")
        log_lines.append(msg)

    log(f"Loading {C.RAW_CSV.name}")
    df = pd.read_csv(
        C.RAW_CSV,
        usecols=USECOLS,
        dtype={
            "id": "string", "vehicle_number": "string", "vehicle_type": "string",
            "violation_type": "string", "offence_code": "string",
            "location": "string", "police_station": "string",
            "junction_name": "string", "device_id": "string",
            "created_by_id": "string", "validation_status": "string",
        },
        na_values=["NULL", ""],
        low_memory=False,
    )
    n0 = len(df)
    log(f"Raw rows loaded: {n0:,}  (verified ground truth: {C.RAW_ROW_COUNT:,})")

    # numeric coords
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")

    # data_sent_to_scita -> bool
    df["scita"] = df["data_sent_to_scita"].astype("string").str.upper().eq("TRUE")

    # --- timestamps -> IST ------------------------------------------------- #
    df["created_ist"] = U.to_ist(df["created_datetime"])
    df["modified_ist"] = U.to_ist(df["modified_datetime"])
    df["hour_ist"] = df["created_ist"].dt.hour
    df["dow_ist"] = df["created_ist"].dt.dayofweek          # 0=Mon
    df["date_ist"] = df["created_ist"].dt.date
    df["month_ist"] = df["created_ist"].dt.strftime("%Y-%m")
    df["is_weekend"] = df["dow_ist"] >= 5

    # --- parse violation arrays ------------------------------------------- #
    df["violation_list"] = df["violation_type"].map(U.parse_array)
    df["n_violations"] = df["violation_list"].map(len)
    df["has_parking_violation"] = df["violation_list"].map(U.has_parking)
    df["primary_violation"] = df["violation_list"].map(U.primary_violation)
    df["row_severity"] = df["violation_list"].map(U.row_severity)
    df["vehicle_wt"] = df["vehicle_type"].map(U.vehicle_weight)

    # --- filters ----------------------------------------------------------- #
    log(f"--- filtering (start {len(df):,}) ---")

    status_norm = df["validation_status"].astype("string").str.lower()
    drop_status = status_norm.isin(C.DROP_VALIDATION_STATUS)
    log(f"drop rejected+duplicate validation_status: -{int(drop_status.sum()):,}")
    df = df[~drop_status].copy()

    no_parking = ~df["has_parking_violation"]
    log(f"drop rows with no parking-relevant violation: -{int(no_parking.sum()):,}")
    df = df[~no_parking].copy()

    out_bbox = ~U.in_bbox(df["latitude"], df["longitude"]) | df["latitude"].isna()
    log(f"drop rows outside Bengaluru bbox / missing coords: -{int(out_bbox.sum()):,}")
    df = df[~out_bbox].copy()

    n1 = len(df)
    removed_pct = 100.0 * (n0 - n1) / n0
    log(f"clean rows remaining: {n1:,}  ({removed_pct:.1f}% removed; "
        f"target {C.SELF_CHECK_TARGETS['clean_rows']:,})")

    # --- confidence -------------------------------------------------------- #
    is_high = status_norm.reindex(df.index).isin(C.HIGH_CONFIDENCE_STATUS) | df["scita"]
    df["confidence"] = is_high.map({True: "high", False: "medium"})
    df["confidence_mult"] = df["confidence"].map(C.CONFIDENCE_MULT)
    log(f"confidence: high={int((df['confidence']=='high').sum()):,} "
        f"medium={int((df['confidence']=='medium').sum()):,}")

    # --- geo buckets ------------------------------------------------------- #
    df["bucket_100m"] = U.bucket_100m(df["latitude"], df["longitude"])
    df["point_11m"] = U.point_11m(df["latitude"], df["longitude"])

    # event weight (used by Pillar A): severity × footprint × confidence
    df["event_weight"] = df["row_severity"] * df["vehicle_wt"] * df["confidence_mult"]

    # --- persist ----------------------------------------------------------- #
    keep_cols = [
        "id", "latitude", "longitude", "location", "vehicle_number",
        "vehicle_type", "vehicle_wt", "primary_violation", "row_severity",
        "n_violations", "police_station", "junction_name", "device_id",
        "created_by_id", "scita", "confidence", "confidence_mult",
        "event_weight", "created_ist", "hour_ist", "dow_ist", "date_ist",
        "month_ist", "is_weekend", "bucket_100m", "point_11m",
    ]
    out = df[keep_cols].copy()
    out["violation_list_str"] = df["violation_list"].map(lambda x: "|".join(x))

    out.to_parquet(C.DATA_PROC / "events_clean.parquet", index=False)
    # CSV without the heavy datetime objects re-stringified
    out.to_csv(C.DATA_PROC / "events_clean.csv", index=False)

    # monthly sanity vs ground truth
    monthly = out["month_ist"].value_counts().sort_index()
    log("monthly (clean): " + ", ".join(f"{k}={v:,}" for k, v in monthly.items()))

    summary = [
        "ClearLane — cleaning summary (stage 01)",
        "=" * 48,
        f"data window (verified): {C.TIME_WINDOW_START} -> {C.TIME_WINDOW_END}",
        "",
    ] + log_lines
    (C.REPORTS / "cleaning_summary.txt").write_text("\n".join(summary) + "\n")
    print(f"[01_clean] wrote events_clean ({n1:,} rows) + cleaning_summary.txt")
    return out


if __name__ == "__main__":
    run()
