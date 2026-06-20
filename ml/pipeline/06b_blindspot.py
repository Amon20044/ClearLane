"""
Stage 06b — blind-spot / under-observation ranker (positive-unlabeled framing).

There are no inspected negatives in the data ("this zone was checked and was
clean"), so a plain classifier would be wrong. Instead we use a context-residual
PU method:

  1. Fit a model that predicts a zone's observed obstruction pressure (Pillar A)
     from CONTEXT ONLY (location, junction/road/demand, Mappls POIs, reachability)
     — deliberately excluding the enforcement history.
  2. residual = predicted_by_context - observed.  A large POSITIVE residual means
     "the context says this should be a hotspot, but few tickets exist here" =
     a high-risk UNDER-OBSERVED zone (a likely blind spot).

Output: `under_observed_score` (0-100) + `blind_spot_ml` flag on zone_scores, and
`pu_scores.json`. The rule-based `evening_blind_spot` from stage 06 is left
untouched (kept as a sanity flag + self-check metric). Honest label everywhere:
"high-risk under-observed", never "confirmed hotspot".
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.model_selection import train_test_split

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C          # noqa: E402
import utils as U           # noqa: E402

try:
    import lightgbm as lgb
    _HAS_LGB = True
except Exception:                       # pragma: no cover
    from sklearn.ensemble import GradientBoostingRegressor
    _HAS_LGB = False


def _context_matrix(z):
    """Assemble the context-only feature frame (merging stage-04b features)."""
    df = z.set_index("superzone_id").copy()
    try:
        zf = pd.read_parquet(C.DATA_PROC / "zone_features.parquet").set_index("superzone_id")
        for c in zf.columns:
            if c.startswith("poi_") or c == "reach_km":
                df[c] = pd.to_numeric(zf[c], errors="coerce")
    except Exception:
        pass
    cols = [c for c in C.PU_CONTEXT_FEATURES if c in df.columns]
    X = df[cols].copy()
    for c in cols:
        X[c] = pd.to_numeric(X[c], errors="coerce")
        fill = C.MAPPLS_POI_FAR_M if c.endswith("_m") else X[c].median()
        X[c] = X[c].fillna(fill if pd.notna(fill) else 0.0)
    return X, cols


def run():
    z = pd.read_parquet(C.DATA_PROC / "zone_scores.parquet")
    z = z.drop(columns=[c for c in ("under_observed_score", "blind_spot_ml", "ctx_pred")
                        if c in z.columns])

    X, cols = _context_matrix(z)
    y = z.set_index("superzone_id")["A"].reindex(X.index).fillna(0).values  # observed pressure pct

    Xtr, Xte, ytr, yte = train_test_split(
        X.values, y, test_size=0.25, random_state=C.PU_RANDOM_STATE)
    if _HAS_LGB:
        model = lgb.LGBMRegressor(n_estimators=400, learning_rate=0.03, num_leaves=31,
                                  subsample=0.8, colsample_bytree=0.8,
                                  random_state=C.PU_RANDOM_STATE, verbose=-1)
    else:                                    # pragma: no cover
        from sklearn.ensemble import GradientBoostingRegressor
        model = GradientBoostingRegressor(random_state=C.PU_RANDOM_STATE)
    model.fit(Xtr, ytr)

    pred_te = model.predict(Xte)
    ss_res = float(np.sum((yte - pred_te) ** 2))
    ss_tot = float(np.sum((yte - yte.mean()) ** 2))
    holdout_r2 = round(1 - ss_res / ss_tot, 3) if ss_tot > 0 else 0.0

    ctx_pred = model.predict(X.values)
    resid = ctx_pred - y                        # context-says-more-than-observed
    score = U.percentile_norm(pd.Series(resid, index=X.index))
    spearman_ctx = round(float(spearmanr(ctx_pred, y).statistic), 3)

    zi = z.set_index("superzone_id")
    zi["ctx_pred"] = pd.Series(ctx_pred, index=X.index)
    zi["under_observed_score"] = score
    cutoff = float(score.quantile(C.PU_FLAG_TOP_DECILE))
    zi["blind_spot_ml"] = zi["under_observed_score"] >= cutoff
    z = zi.reset_index()
    z.to_parquet(C.DATA_PROC / "zone_scores.parquet", index=False)

    # lift: of the top-K under-observed zones, how many are currently LOW-tier
    # (P3/P4) -> genuinely hidden by the count-based priority. That is the value.
    ranked = z.sort_values("under_observed_score", ascending=False)
    hidden = {}
    for k in (20, 50, 100):
        k = min(k, len(ranked))
        topk = ranked.head(k)
        hidden[f"top{k}_hidden_pct"] = round(
            100 * topk["tier"].isin(["P3", "P4"]).mean(), 1)

    pu = {
        "method": "context-residual positive-unlabeled (predicted-by-context minus observed)",
        "model": "LightGBM" if _HAS_LGB else "GradientBoosting",
        "n_zones": int(len(z)), "n_context_features": len(cols),
        "context_features": cols,
        "holdout_r2_context_to_pressure": holdout_r2,
        "spearman_context_vs_observed": spearman_ctx,
        "blind_spot_ml_count": int(z["blind_spot_ml"].sum()),
        "hidden_discovery": hidden,
        "note": ("High under_observed_score = context (junctions, POIs, road class, "
                 "reachability) implies obstruction risk but few tickets exist there "
                 "yet. A discovery signal for patrols, NOT a confirmed hotspot."),
        "zones": [{"id": str(r["superzone_id"]),
                   "under_observed_score": round(float(r["under_observed_score"]), 1),
                   "tier": r["tier"], "pressure": round(float(r["A"]), 1),
                   "ctx_pred": round(float(r["ctx_pred"]), 1),
                   "station": (None if pd.isna(r["police_station"]) else str(r["police_station"]))}
                  for _, r in ranked.head(60).iterrows()],
    }
    U.write_json(C.DATA_PROC / "pu_scores.json", pu)

    print(f"[06b_blindspot] context->pressure R2={holdout_r2} "
          f"Spearman={spearman_ctx} · ML blind spots={pu['blind_spot_ml_count']} · "
          f"top20 hidden(P3/P4)={hidden.get('top20_hidden_pct')}%")
    return pu


if __name__ == "__main__":
    run()
