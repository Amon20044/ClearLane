"""
Stage 05 — next-month obstruction forecaster (the legitimate ML centerpiece).

  Features : each zone's Nov-Jan signals (pressure, recurrence, mix, repeat share,
             exposure, trend, typology, junction) PLUS Mappls context from stage
             04b (POI distances/counts, station reachability) and the auxiliary
             offence-code severity.
  Target   : that zone's Feb-Mar TICKET COUNT — a real, observed future COUNT.
             Modelled with a POISSON objective (count data). NOT congestion.
  Models   : sklearn PoissonRegressor (GLM baseline) -> LightGBM `objective=poisson`
             (main) -> CatBoost Poisson (challenger, if installed).
  Holdout  : temporal design (features Nov-Jan -> target Feb-Mar) + a spatial
             (zone) hold-out for generalization metrics.
  Report   : Poisson deviance, R2, Spearman, top-K precision. SHAP reason codes.

forecast_pressure is derived from the predicted count x the zone's weight/ticket
so the downstream payload + UI keep working unchanged.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.linear_model import PoissonRegressor
from sklearn.metrics import mean_poisson_deviance
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C          # noqa: E402
import utils as U           # noqa: E402

try:
    import lightgbm as lgb
    _HAS_LGB = True
except Exception:                       # pragma: no cover
    from sklearn.ensemble import GradientBoostingRegressor
    _HAS_LGB = False

try:                                    # optional challenger
    from catboost import CatBoostRegressor
    _HAS_CAT = True
except Exception:                       # pragma: no cover
    _HAS_CAT = False


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
    f["feat_offence_sev"] = g["offence_severity_aux"].mean().reindex(f.index).fillna(0)
    f["feat_officers"] = g["created_by_id"].nunique().reindex(f.index).fillna(0)
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
    zi = z.set_index("superzone_id")
    f["feat_repeat_share"] = zi["repeat_share"].reindex(f.index).fillna(0)
    f["feat_junction"] = zi["junction_anchored"].reindex(f.index).fillna(False).astype(int)
    f["feat_cluster"] = zi["cluster"].reindex(f.index).fillna(-1).astype(int)

    # --- Mappls context features from stage 04b (offline -> neutral defaults) #
    try:
        zf = pd.read_parquet(C.DATA_PROC / "zone_features.parquet").set_index("superzone_id")
        num = [c for c in zf.columns if c.startswith("poi_") or c == "reach_km"]
        for c in num:
            f[f"ctx_{c}"] = pd.to_numeric(zf[c], errors="coerce").reindex(f.index)
        # fill: distances -> far sentinel, counts/reach -> 0/median
        for c in num:
            col = f"ctx_{c}"
            if c.endswith("_m"):
                f[col] = f[col].fillna(C.MAPPLS_POI_FAR_M)
            else:
                f[col] = f[col].fillna(0)
    except Exception:
        pass
    return f


def _weight_per_ticket(f):
    wpt = f["feat_pressure"] / f["feat_tickets"].replace(0, np.nan)
    return wpt.fillna(wpt.median() if wpt.notna().any() else 0.3)


def run():
    ev = pd.read_parquet(C.DATA_PROC / "events_clean.parquet")
    z = pd.read_parquet(C.DATA_PROC / "zone_scores.parquet")

    f = _feature_frame(ev, z)
    feat_names = list(f.columns)
    X = f.values.astype(float)

    # target = Feb-Mar TICKET COUNT (a real observed future count -> Poisson)
    tgt_ev = ev[ev["month_ist"].isin(C.FORECAST_TARGET_MONTHS)]
    y = (tgt_ev.groupby("superzone_id", observed=True)["id"].count()
         .reindex(f.index).fillna(0).values.astype(float))

    Xtr, Xte, ytr, yte = train_test_split(
        X, y, test_size=C.FORECAST_TEST_FRAC, random_state=C.FORECAST_RANDOM_STATE)

    # ---- GLM baseline (interpretable benchmark) -------------------------- #
    sc = StandardScaler().fit(Xtr)
    glm = PoissonRegressor(alpha=1e-3, max_iter=500).fit(sc.transform(Xtr), ytr)
    glm_pred = np.clip(glm.predict(sc.transform(Xte)), 1e-6, None)
    glm_dev = float(mean_poisson_deviance(yte, glm_pred))

    # ---- main model: LightGBM Poisson ------------------------------------ #
    if _HAS_LGB:
        params = dict(C.FORECAST_LGBM_PARAMS)
        model = lgb.LGBMRegressor(random_state=C.FORECAST_RANDOM_STATE, verbose=-1, **params)
        model_name = "LightGBM(poisson)"
    else:                                    # pragma: no cover
        from sklearn.ensemble import GradientBoostingRegressor
        model = GradientBoostingRegressor(random_state=C.FORECAST_RANDOM_STATE)
        model_name = "GradientBoosting"
    model.fit(Xtr, ytr)
    pred_te = np.clip(model.predict(Xte), 1e-6, None)

    poisson_dev = float(mean_poisson_deviance(yte, pred_te))
    ss_res = float(np.sum((yte - pred_te) ** 2))
    ss_tot = float(np.sum((yte - yte.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    rho = float(spearmanr(yte, pred_te).statistic)
    topk_prec = {}
    for k in (10, 20, 50):
        k = min(k, len(yte))
        topk_prec[f"top{k}"] = round(
            len(set(np.argsort(pred_te)[-k:]) & set(np.argsort(yte)[-k:])) / k, 3)

    # ---- CatBoost Poisson challenger (optional) -------------------------- #
    challenger = {}
    if _HAS_CAT and C.FORECAST_CATBOOST:
        try:                                 # pragma: no cover
            cb = CatBoostRegressor(loss_function="Poisson", iterations=400,
                                   learning_rate=0.05, depth=6, verbose=False,
                                   random_seed=C.FORECAST_RANDOM_STATE)
            cb.fit(Xtr, ytr)
            cb_pred = np.clip(cb.predict(Xte), 1e-6, None)
            challenger = {"model": "CatBoost(Poisson)",
                          "poisson_deviance": round(float(mean_poisson_deviance(yte, cb_pred)), 3),
                          "spearman": round(float(spearmanr(yte, cb_pred).statistic), 3)}
        except Exception as e:
            challenger = {"model": "CatBoost", "skipped": type(e).__name__}

    # ---- full-zone predictions -> count + derived pressure --------------- #
    full_count = np.clip(model.predict(X), 0, None)
    wpt = _weight_per_ticket(f).values
    z = z.set_index("superzone_id")
    z["forecast_count"] = pd.Series(full_count, index=f.index)
    z["forecast_pressure"] = pd.Series(full_count * wpt, index=f.index)
    z["forecast_score"] = U.percentile_norm(z["forecast_pressure"])
    feat_window_months = len(C.FORECAST_FEATURE_MONTHS)
    tgt_window_months = len(C.FORECAST_TARGET_MONTHS)
    expected_flat = f["feat_pressure"].values * (tgt_window_months / feat_window_months)
    z["forecast_rising"] = z["forecast_pressure"].values > expected_flat * 1.10
    z = z.reset_index()
    z.to_parquet(C.DATA_PROC / "zone_scores.parquet", index=False)

    # ---- SHAP (fallback to gain importance) ------------------------------ #
    shap_summary, shap_method = {}, ""
    try:
        import shap
        sv = shap.TreeExplainer(model).shap_values(Xte)
        mean_abs = np.abs(sv).mean(axis=0)
        shap_summary = dict(sorted(
            {n: round(float(v), 4) for n, v in zip(feat_names, mean_abs)}.items(),
            key=lambda kv: -kv[1]))
        shap_method = "shap_tree_explainer"
    except Exception as e:                   # pragma: no cover
        imp = getattr(model, "feature_importances_", np.ones(len(feat_names)))
        imp = imp / (imp.sum() or 1)
        shap_summary = {n: round(float(v), 4) for n, v in
                        sorted(zip(feat_names, imp), key=lambda kv: -kv[1])}
        shap_method = f"gain_importance_fallback ({type(e).__name__})"

    metrics = {
        "model": model_name,
        "objective": "poisson" if (_HAS_LGB and C.FORECAST_POISSON) else "regression",
        "target": "Feb-Mar ticket COUNT (real observed future count)",
        "holdout": "temporal (Nov-Jan features -> Feb-Mar target) + spatial zone split",
        "n_zones": int(len(X)), "n_features": len(feat_names),
        "train_size": int(len(Xtr)), "test_size": int(len(Xte)),
        "poisson_deviance": round(poisson_dev, 3),
        "r2": round(r2, 3), "spearman": round(rho, 3),
        "topk_precision": topk_prec,
        "glm_baseline": {"model": "PoissonRegressor(GLM)",
                         "poisson_deviance": round(glm_dev, 3)},
        "challenger": challenger,
        "mappls_features": [n for n in feat_names if n.startswith("ctx_")],
        "feature_importance_method": shap_method,
        "shap_importance": shap_summary,
        "forecast_rising_zones": int(z["forecast_rising"].sum()),
    }
    U.write_json(C.DATA_PROC / "forecaster_metrics.json", metrics)
    (C.REPORTS / "forecaster_metrics.txt").write_text(
        "\n".join(f"{k}: {v}" for k, v in metrics.items()) + "\n")

    print(f"[05_forecaster] {model_name} poissonDev={metrics['poisson_deviance']} "
          f"(GLM {metrics['glm_baseline']['poisson_deviance']}) R2={r2:.3f} "
          f"Spearman={rho:.3f} topK={topk_prec}")
    print(f"[05_forecaster] top drivers: {list(shap_summary)[:4]} · "
          f"rising={metrics['forecast_rising_zones']}"
          + (f" · challenger={challenger.get('model')}" if challenger else ""))
    return metrics


if __name__ == "__main__":
    run()
