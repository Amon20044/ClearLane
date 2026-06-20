"""
Stage 07b — dispatch reranker (M4) + reason codes.

Turns the separate model outputs into ONE operational number per zone:

  dispatch_priority = blend( forecast, pressure, under-observed, live-delay,
                             reachability )   (RERANK_WEIGHTS in config)

live_delay is 0 here (offline) and is filled at SERVING from the Mappls ETA delta
proxy; reachability rewards zones a station can reach fast. Each zone also gets
human `reason_codes` (the top contributors) for the "why this zone" panel.

Also trains a LightGBM LambdaMART (learn-to-rank) challenger grouped by station,
with NDCG@10 — the phase-2 learned reranker, reported alongside the transparent
v1 (which remains the shipped score: auditable + offline).
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C          # noqa: E402
import utils as U           # noqa: E402

try:
    import lightgbm as lgb
    _HAS_LGB = True
except Exception:                       # pragma: no cover
    _HAS_LGB = False


_REASON = {
    "forecast": "forecast pressure rising next month",
    "pressure": "high current obstruction pressure",
    "under_observed": "under-observed — likely blind spot",
    "reachability": "fast to reach from station",
    "live_delay": "live traffic delay on the approach",
}


def _components(z):
    w = C.RERANK_WEIGHTS
    df = z.set_index("superzone_id").copy()
    try:
        zf = pd.read_parquet(C.DATA_PROC / "zone_features.parquet").set_index("superzone_id")
        df["reach_km"] = pd.to_numeric(zf["reach_km"], errors="coerce")
    except Exception:
        df["reach_km"] = np.nan
    reach = df["reach_km"].fillna(df["reach_km"].median() if df["reach_km"].notna().any() else 3.0)
    reach_score = 1.0 / (1.0 + reach)        # closer -> higher (0..1)

    comp = pd.DataFrame(index=df.index)
    comp["forecast"] = w["forecast"] * (df["forecast_score"].fillna(0) / 100.0)
    comp["pressure"] = w["pressure"] * (df["A"].fillna(0) / 100.0)
    comp["under_observed"] = w["under_observed"] * (df.get("under_observed_score", 0).fillna(0) / 100.0)
    comp["live_delay"] = w["live_delay"] * 0.0          # offline; filled at serving
    comp["reachability"] = w["reachability"] * (reach_score / reach_score.max())
    return comp, df


def _reason_codes(comp_row, flags):
    pairs = sorted(((k, v) for k, v in comp_row.items() if v > 0 and k != "live_delay"),
                   key=lambda kv: -kv[1])
    reasons = [_REASON[k] for k, _ in pairs[:C.RERANK_REASON_TOP_N]]
    for f in flags:
        if f not in reasons:
            reasons.append(f)
    return reasons[:C.RERANK_REASON_TOP_N + 2]


def _lambdarank(z, comp):
    """Phase-2 learn-to-rank challenger: LightGBM LambdaMART grouped by station,
    relevance = binned realized pressure. Reports NDCG@10. Best-effort."""
    if not (_HAS_LGB and C.RERANK_LAMBDARANK):
        return {}
    try:
        df = z.dropna(subset=["police_station"]).copy()
        df = df.sort_values("police_station")
        feats = ["forecast_score", "A", "B", "C"]
        feats += [c for c in ("under_observed_score",) if c in df.columns]
        X = df[feats].fillna(0).values
        rel = pd.qcut(df["pressure_raw"].rank(method="first"),
                      C.RERANK_RELEVANCE_BINS, labels=False).astype(int).values
        groups = df.groupby("police_station", observed=True).size().values
        # station-level split for an honest NDCG
        stations = df["police_station"].unique()
        rng = np.random.default_rng(C.PU_RANDOM_STATE)
        test_st = set(rng.choice(stations, size=max(1, len(stations) // 4), replace=False))
        is_te = df["police_station"].isin(test_st).values
        tr_df, te_df = df[~is_te], df[is_te]
        if len(tr_df) < 10 or len(te_df) < 5:
            return {"skipped": "too few groups"}
        g_tr = tr_df.groupby("police_station", observed=True).size().values
        g_te = te_df.groupby("police_station", observed=True).size().values
        rk = lgb.LGBMRanker(objective="lambdarank", n_estimators=300, learning_rate=0.05,
                            num_leaves=31, random_state=C.PU_RANDOM_STATE, verbose=-1)
        rk.fit(tr_df[feats].fillna(0).values,
               pd.qcut(tr_df["pressure_raw"].rank(method="first"),
                       C.RERANK_RELEVANCE_BINS, labels=False).astype(int).values,
               group=g_tr,
               eval_set=[(te_df[feats].fillna(0).values,
                          pd.qcut(te_df["pressure_raw"].rank(method="first"),
                                  C.RERANK_RELEVANCE_BINS, labels=False).astype(int).values)],
               eval_group=[g_te], eval_at=[10])
        ndcg = rk.best_score_.get("valid_0", {})
        ndcg = {k: round(float(v), 3) for k, v in ndcg.items()}
        return {"model": "LightGBM LambdaMART", "group": "police_station",
                "relevance_bins": C.RERANK_RELEVANCE_BINS, "features": feats,
                "ndcg": ndcg}
    except Exception as e:                   # pragma: no cover
        return {"skipped": type(e).__name__}


def run():
    z = pd.read_parquet(C.DATA_PROC / "zone_scores.parquet")
    z = z.drop(columns=[c for c in ("dispatch_priority", "dispatch_rank",
                                    "dispatch_raw", "reason_codes") if c in z.columns])

    comp, df = _components(z)
    dp_raw = comp.sum(axis=1)
    dispatch_priority = U.percentile_norm(dp_raw)

    reason_map = {}
    for sid in df.index:
        flags = []
        r = df.loc[sid]
        if bool(r.get("chronic", False)):
            flags.append("chronic hotspot")
        if bool(r.get("evening_blind_spot", False)):
            flags.append("evening enforcement gap")
        if bool(r.get("habitual", False)):
            flags.append("habitual repeat vehicles")
        reason_map[sid] = _reason_codes(comp.loc[sid].to_dict(), flags)

    zi = z.set_index("superzone_id")
    zi["dispatch_raw"] = dp_raw
    zi["dispatch_priority"] = dispatch_priority
    zi["dispatch_rank"] = dp_raw.rank(ascending=False, method="first").astype(int)
    zi["reason_codes"] = pd.Series({k: "|".join(v) for k, v in reason_map.items()})
    z = zi.reset_index()
    z.to_parquet(C.DATA_PROC / "zone_scores.parquet", index=False)

    # sanity: does dispatch_priority correlate with realized pressure? (NDCG-ish)
    from scipy.stats import spearmanr
    rho = round(float(spearmanr(z["dispatch_raw"], z["pressure_raw"]).statistic), 3)
    challenger = _lambdarank(z, comp)

    metrics = {
        "model": "transparent linear blend (shipped)",
        "weights": C.RERANK_WEIGHTS,
        "note": ("live_delay is 0 offline and filled at serving from the Mappls ETA "
                 "delta proxy; reachability rewards fast station access."),
        "spearman_vs_pressure": rho,
        "n_zones": int(len(z)),
        "top10_zone_ids": [str(s) for s in
                           z.sort_values("dispatch_raw", ascending=False)
                            .head(10)["superzone_id"]],
        "learn_to_rank_challenger": challenger,
    }
    U.write_json(C.DATA_PROC / "reranker_metrics.json", metrics)
    print(f"[07b_reranker] dispatch_priority blend {C.RERANK_WEIGHTS} · "
          f"Spearman vs pressure={rho}"
          + (f" · LambdaMART NDCG={challenger.get('ndcg')}" if challenger.get("ndcg") else ""))
    return metrics


if __name__ == "__main__":
    run()
