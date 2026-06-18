"""
Stage 03 — the three pillars and the Operational Priority score.

  Pillar A  Obstruction Pressure   = Σ(severity × footprint × confidence)  -> pct
  Pillar B  Structural Recurrence  = f(active_days, months, regularity)    -> pct
  Pillar C  Emergence              = recent-vs-baseline growth (gated)      -> pct

  Operational Priority = 0.50·A + 0.30·B + 0.20·C   -> tiers P1/P2/P3/P4

All pillars are PERCENTILE-normalized (robust to outliers; stated in methodology).
Self-check targets: P1≈151 P2≈382 P3≈250 P4≈760 · chronic≈618 · emerging≈279.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C          # noqa: E402
import utils as U           # noqa: E402

_DAYS_IN_MONTH = {
    "2023-11": 30, "2023-12": 31, "2024-01": 31,
    "2024-02": 29, "2024-03": 31, "2024-04": 8,   # April partial -> 8 days
}


def run() -> pd.DataFrame:
    ev = pd.read_parquet(C.DATA_PROC / "events_clean.parquet")
    zones = pd.read_parquet(C.DATA_PROC / "superzones.parquet")
    grp = ev.groupby("superzone_id", observed=True)

    # ---- Pillar A : obstruction pressure --------------------------------- #
    A_raw = grp["event_weight"].sum().rename("pressure_raw")

    # ---- Pillar B : structural recurrence -------------------------------- #
    active_days = grp["date_ist"].nunique().rename("active_days")
    months_present = grp["month_ist"].nunique().rename("months_present")
    span = grp["created_ist"].agg(["min", "max"])
    span_days = ((span["max"] - span["min"]).dt.days + 1).clip(lower=1).rename("span_days")
    rec = pd.concat([active_days, months_present, span_days], axis=1)
    rec["regularity"] = (rec["active_days"] / rec["span_days"]).clip(0, 1)
    # composite: distinct active days, scaled by consistency and monthly spread
    rec["B_raw"] = (rec["active_days"]
                    * (0.5 + 0.5 * rec["regularity"])
                    * (rec["months_present"] / 6.0))

    # ---- Pillar C : emergence (recent vs baseline, day-normalized) ------- #
    monthly = (ev.groupby(["superzone_id", "month_ist"], observed=True)["id"]
                 .count().unstack(fill_value=0))
    for m in _DAYS_IN_MONTH:
        if m not in monthly.columns:
            monthly[m] = 0
    recent_daily = monthly[C.RECENT_MONTH] / _DAYS_IN_MONTH[C.RECENT_MONTH]
    base_daily = pd.concat(
        [monthly[m] / _DAYS_IN_MONTH[m] for m in C.BASELINE_MONTHS], axis=1
    ).mean(axis=1)
    recent_vol = monthly[C.RECENT_MONTH].rename("recent_vol")
    growth_ratio = (recent_daily / base_daily.replace(0, np.nan)).rename("growth_ratio")
    growth_ratio = growth_ratio.replace([np.inf, -np.inf], np.nan)

    emg = pd.concat([recent_vol, base_daily.rename("baseline_daily"),
                     growth_ratio], axis=1)
    emg["gated"] = emg["recent_vol"] >= C.EMERGENCE_MIN_RECENT_VOLUME
    emg["emerging"] = (emg["gated"] &
                       (emg["growth_ratio"] >= C.EMERGENCE_GROWTH_THRESHOLD))

    # ---- assemble & normalize -------------------------------------------- #
    z = zones.set_index("superzone_id")
    z = z.join([A_raw, rec[["active_days", "months_present", "span_days",
                            "regularity", "B_raw"]], emg])

    z["A"] = U.percentile_norm(z["pressure_raw"])
    z["B"] = U.percentile_norm(z["B_raw"])
    # Pillar C: percentile-norm growth only among gated zones; others -> 0.
    c_score = pd.Series(0.0, index=z.index)
    gated = z["gated"].fillna(False)
    if gated.sum() > 1:
        c_score.loc[gated] = U.percentile_norm(z.loc[gated, "growth_ratio"].fillna(0))
    z["C"] = c_score

    z["priority"] = (C.PRIORITY_WEIGHTS["A"] * z["A"] +
                     C.PRIORITY_WEIGHTS["B"] * z["B"] +
                     C.PRIORITY_WEIGHTS["C"] * z["C"])

    t = C.TIER_THRESHOLDS
    z["tier"] = np.select(
        [z["priority"] >= t["P1"], z["priority"] >= t["P2"], z["priority"] >= t["P3"]],
        ["P1", "P2", "P3"], default="P4",
    )
    z["chronic"] = z["B"] >= C.CHRONIC_THRESHOLD
    z["emerging"] = z["emerging"].fillna(False)

    z = z.reset_index().sort_values("priority", ascending=False).reset_index(drop=True)
    z["rank"] = np.arange(1, len(z) + 1)
    z.to_parquet(C.DATA_PROC / "zone_scores.parquet", index=False)

    counts = z["tier"].value_counts().to_dict()
    print("[03_scores] tiers:", {k: int(counts.get(k, 0)) for k in ["P1", "P2", "P3", "P4"]},
          f"(targets P1={C.SELF_CHECK_TARGETS['P1']} P2={C.SELF_CHECK_TARGETS['P2']} "
          f"P3={C.SELF_CHECK_TARGETS['P3']} P4={C.SELF_CHECK_TARGETS['P4']})")
    print(f"[03_scores] chronic={int(z['chronic'].sum())} "
          f"(target {C.SELF_CHECK_TARGETS['chronic']}) · "
          f"emerging={int(z['emerging'].sum())} "
          f"(target {C.SELF_CHECK_TARGETS['emerging']})")
    return z


if __name__ == "__main__":
    run()
