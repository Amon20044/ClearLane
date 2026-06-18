"""
Stage 05 — next-month hotspot forecaster (the legitimate AI/ML centerpiece).

  Features : each zone's Nov–Jan signals (pressure, recurrence, mix, repeat
             share, exposure, trend, typology, junction flag).
  Target   : that zone's Feb–Mar OBSTRUCTION PRESSURE — a real, observed future
             quantity. NOT congestion (the data has none).
  Model    : LightGBM gradient-boosted trees.
  Report   : R², Spearman, top-K precision (do top-predicted zones become hot?).
  Explain  : SHAP feature importances (falls back to gain importance if needed).

Framed as: "forecasts which zones stay / become high-obstruction next month,
validated on held-out months" — never as congestion prediction.
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


def _feature_frame(ev, z):
    feat_ev = ev[ev["month_ist"].isin(C.FORECAST_FEATURE_MONTHS)]
    g = feat_ev.groupby("superzone_id", observed=True)
    f = pd.DataFrame(index=z["superzone_id"])
    f["feat_pressure"] = g["event_weight"].sum().reindex(f.index).fillna(0)
    f["feat_tickets"] = g["id"].count().reindex(f.index).fillna(0)
    f["feat_active_days"] = g["date_ist"].nunique().reindex(f.index).fillna(0)
    f["feat_months"] = g["month_ist"].nunique().reindex(f.index).fillna(0)
    f["feat_veh_footprint"] = g["vehicle_wt"].mean().reindex(f.index).fillna(0)
    f["feat_severity"] = g["row_severity"].mean().reindex(f.index).fillna(0)
    f["feat_officers"] = g["created_by_id"].nunique().reindex(f.index).fillna(0)
    # within-feature-window monthly trend
    mp = (feat_ev.groupby(["superzone_id", "month_ist"], observed=True)["event_weight"]
          .sum().unstack(fill_value=0))
    for m in C.FORECAST_FEATURE_MONTHS:
        if m not in mp.columns:
            mp[m] = 0.0
    mp = mp[C.FORECAST_FEATURE_MONTHS]
    xidx = np.arange(len(C.FORECAST_FEATURE_MONTHS))
    f["feat_trend"] = mp.apply(
        lambda r: float(np.polyfit(xidx, r.values, 1)[0]) if r.sum() > 0 else 0.0,
        axis=1).reindex(f.index).fillna(0)
    # carry zone attributes computed in stage 04
    zi = z.set_index("superzone_id")
    f["feat_repeat_share"] = zi["repeat_share"].reindex(f.index).fillna(0)
    f["feat_junction"] = zi["junction_anchored"].reindex(f.index).fillna(False).astype(int)
    f["feat_cluster"] = zi["cluster"].reindex(f.index).fillna(-1).astype(int)
    return f


def run():
    ev = pd.read_parquet(C.DATA_PROC / "events_clean.parquet")
    z = pd.read_parquet(C.DATA_PROC / "zone_scores.parquet")

    f = _feature_frame(ev, z)

    # target: Feb–Mar obstruction pressure (real future value)
    tgt_ev = ev[ev["month_ist"].isin(C.FORECAST_TARGET_MONTHS)]
    target = (tgt_ev.groupby("superzone_id", observed=True)["event_weight"].sum()
              .reindex(f.index).fillna(0))
    y = np.log1p(target.values)              # stabilize skew
    X = f.values
    feat_names = list(f.columns)

    Xtr, Xte, ytr, yte, idx_tr, idx_te = train_test_split(
        X, y, np.arange(len(X)), test_size=C.FORECAST_TEST_FRAC,
        random_state=C.FORECAST_RANDOM_STATE)

    if _HAS_LGB:
        model = lgb.LGBMRegressor(
            n_estimators=400, learning_rate=0.03, num_leaves=31,
            subsample=0.8, colsample_bytree=0.8,
            random_state=C.FORECAST_RANDOM_STATE, verbose=-1)
    else:                                    # pragma: no cover
        model = GradientBoostingRegressor(random_state=C.FORECAST_RANDOM_STATE)
    model.fit(Xtr, ytr)

    pred_te = model.predict(Xte)
    ss_res = float(np.sum((yte - pred_te) ** 2))
    ss_tot = float(np.sum((yte - yte.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    rho = float(spearmanr(yte, pred_te).statistic)

    # top-K precision on the held-out set: do top-predicted become top-actual?
    topk_prec = {}
    for k in (10, 20, 50):
        k = min(k, len(yte))
        top_pred = set(np.argsort(pred_te)[-k:])
        top_actual = set(np.argsort(yte)[-k:])
        topk_prec[f"top{k}"] = round(len(top_pred & top_actual) / k, 3)

    # full-zone predictions (predict on all zones for the dashboard layer)
    full_pred = np.expm1(model.predict(X))
    z = z.set_index("superzone_id")
    z["forecast_pressure"] = pd.Series(full_pred, index=f.index)
    z["forecast_score"] = U.percentile_norm(z["forecast_pressure"])
    # rising = predicted future pressure exceeds feature-window pressure (scaled)
    feat_window_months = len(C.FORECAST_FEATURE_MONTHS)
    tgt_window_months = len(C.FORECAST_TARGET_MONTHS)
    expected_flat = f["feat_pressure"].values * (tgt_window_months / feat_window_months)
    z["forecast_rising"] = z["forecast_pressure"].values > expected_flat * 1.10
    z = z.reset_index()
    z.to_parquet(C.DATA_PROC / "zone_scores.parquet", index=False)

    # ---- SHAP (with graceful fallback to gain importance) ---------------- #
    shap_summary = {}
    try:
        import shap
        expl = shap.TreeExplainer(model)
        sv = expl.shap_values(Xte)
        mean_abs = np.abs(sv).mean(axis=0)
        shap_summary = {n: round(float(v), 4) for n, v in zip(feat_names, mean_abs)}
        shap_summary = dict(sorted(shap_summary.items(), key=lambda kv: -kv[1]))
        shap_method = "shap_tree_explainer"
    except Exception as e:                   # pragma: no cover
        imp = getattr(model, "feature_importances_", np.ones(len(feat_names)))
        imp = imp / (imp.sum() or 1)
        shap_summary = {n: round(float(v), 4) for n, v in
                        sorted(zip(feat_names, imp), key=lambda kv: -kv[1])}
        shap_method = f"gain_importance_fallback ({type(e).__name__})"

    metrics = {
        "model": "LightGBM" if _HAS_LGB else "GradientBoosting",
        "target": "Feb–Mar obstruction pressure (real observed future value)",
        "n_zones": int(len(X)), "n_features": len(feat_names),
        "train_size": int(len(Xtr)), "test_size": int(len(Xte)),
        "r2": round(r2, 3), "spearman": round(rho, 3),
        "topk_precision": topk_prec,
        "feature_importance_method": shap_method,
        "shap_importance": shap_summary,
        "forecast_rising_zones": int(z["forecast_rising"].sum()),
    }
    U.write_json(C.DATA_PROC / "forecaster_metrics.json", metrics)
    (C.REPORTS / "forecaster_metrics.txt").write_text(
        "\n".join(f"{k}: {v}" for k, v in metrics.items()) + "\n")

    print(f"[05_forecaster] {metrics['model']} R²={metrics['r2']} "
          f"Spearman={metrics['spearman']} topK={topk_prec}")
    print(f"[05_forecaster] top drivers: "
          f"{list(shap_summary)[:4]}  rising={metrics['forecast_rising_zones']}")
    return metrics


if __name__ == "__main__":
    run()
