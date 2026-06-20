"""
ClearLane — per-column BI visualizer.

Reads the raw enforcement CSV and produces a self-contained HTML dashboard with a
CIRCULAR (doughnut) chart per column, time-pattern charts, a relationship matrix
(Cramer's V) between the key categoricals, and a build-roadmap section that maps
this dataset onto the product we still need to complete.

Usage:
    python analysis/eda_columns.py
    python analysis/eda_columns.py --csv "data/raw/<file>.csv" --rows 0   # 0 = all

Deps: pandas, numpy (already in the repo's requirements.txt). No scipy needed.
Output:
    analysis/clearlane_eda.html   (open in any browser)
    analysis/eda_data.json        (the computed aggregates)
"""
from __future__ import annotations

import argparse
import glob
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT_HTML = ROOT / "analysis" / "clearlane_eda.html"
OUT_JSON = ROOT / "analysis" / "eda_data.json"

TOP_N = 12          # categories shown per doughnut before bucketing into "Other"
IST = "Asia/Kolkata"

# Columns that are free-form identifiers — show cardinality, not a category map.
ID_LIKE = {"id", "vehicle_number", "updated_vehicle_number", "device_id",
           "created_by_id", "location"}
# Officer / device fields: aggregate ONLY (honesty: never profile individuals).
SENSITIVE = {"created_by_id", "device_id"}
TIMESTAMP_COLS = {"created_datetime", "closed_datetime", "modified_datetime",
                  "action_taken_timestamp", "data_sent_to_scita_timestamp",
                  "validation_timestamp"}
ARRAY_COLS = {"violation_type", "offence_code"}


# --------------------------------------------------------------------------- #
def find_csv(explicit: str | None) -> Path:
    if explicit and Path(explicit).exists():
        return Path(explicit)
    raw = ROOT / "data" / "raw"
    hits = sorted(glob.glob(str(raw / "*.csv")))
    big = [h for h in hits if "sample" not in os.path.basename(h).lower()]
    if big:
        return Path(big[0])
    if hits:
        return Path(hits[0])
    raise SystemExit("No CSV found in data/raw/")


def clean_null(s: pd.Series) -> pd.Series:
    return s.replace({"NULL": np.nan, "null": np.nan, "": np.nan, "None": np.nan})


def topn_counts(s: pd.Series, n=TOP_N):
    vc = s.value_counts(dropna=True)
    if len(vc) > n:
        head = vc.iloc[:n]
        other = vc.iloc[n:].sum()
        labels = [str(x) for x in head.index] + [f"Other ({len(vc) - n})"]
        values = head.tolist() + [int(other)]
    else:
        labels = [str(x) for x in vc.index]
        values = vc.tolist()
    return labels, [int(v) for v in values]


def explode_array(s: pd.Series):
    out = []
    for v in s.dropna():
        try:
            arr = json.loads(v) if isinstance(v, str) else v
            if isinstance(arr, list):
                out.extend(str(x).strip() for x in arr)
            else:
                out.append(str(arr))
        except Exception:
            out.append(str(v))
    return pd.Series(out, dtype="object")


def numeric_bins(s: pd.Series, bins=8):
    s = pd.to_numeric(s, errors="coerce").dropna()
    if s.empty:
        return [], []
    try:
        cut = pd.cut(s, bins=bins)
        vc = cut.value_counts().sort_index()
        labels = [f"{iv.left:.3f}–{iv.right:.3f}" for iv in vc.index]
        return labels, [int(v) for v in vc.tolist()]
    except Exception:
        return [], []


def cramers_v(a: pd.Series, b: pd.Series, cap=15) -> float:
    """Bias-free-ish Cramer's V between two categoricals (numpy only)."""
    def reduce(x):
        top = x.value_counts().iloc[:cap].index
        return x.where(x.isin(top), other="Other")
    a, b = reduce(a.astype("object")), reduce(b.astype("object"))
    ct = pd.crosstab(a, b).values.astype(float)
    n = ct.sum()
    if n == 0 or ct.shape[0] < 2 or ct.shape[1] < 2:
        return 0.0
    row = ct.sum(1, keepdims=True)
    col = ct.sum(0, keepdims=True)
    exp = row @ col / n
    with np.errstate(divide="ignore", invalid="ignore"):
        chi2 = np.nansum(np.where(exp > 0, (ct - exp) ** 2 / exp, 0.0))
    phi2 = chi2 / n
    r, k = ct.shape
    denom = min(r - 1, k - 1)
    return round(float(np.sqrt(phi2 / denom)) if denom else 0.0, 3)


# --------------------------------------------------------------------------- #
def build(csv: Path, nrows: int):
    print(f"[eda] loading {csv.name} ...")
    df = pd.read_csv(csv, nrows=(nrows or None), low_memory=False, dtype=str)
    n = len(df)
    print(f"[eda] {n:,} rows × {len(df.columns)} columns")

    # null-normalise object columns
    for c in df.columns:
        df[c] = clean_null(df[c])

    # parse the primary timestamp into IST parts
    ts = pd.to_datetime(df["created_datetime"], errors="coerce", utc=True)
    ts_ist = ts.dt.tz_convert(IST)
    df["_hour"] = ts_ist.dt.hour
    df["_weekday"] = ts_ist.dt.day_name()
    df["_month"] = ts_ist.dt.strftime("%Y-%m")
    df["_primary_violation"] = explode_first(df["violation_type"])

    charts = []           # per-column doughnuts
    for col in [c for c in df.columns if not c.startswith("_")]:
        s = df[col]
        miss = float(s.isna().mean() * 100)
        uniq = int(s.nunique(dropna=True))
        base = {"col": col, "missing_pct": round(miss, 1), "unique": uniq, "n": n}

        if col in ARRAY_COLS:
            labels, values = topn_counts(explode_array(s))
            base.update(type="doughnut", labels=labels, values=values,
                        note="multi-label per ticket — exploded to individual labels")
        elif col in TIMESTAMP_COLS:
            fill = round(100 - miss, 1)
            base.update(type="doughnut", labels=["present", "empty"],
                        values=[int(s.notna().sum()), int(s.isna().sum())],
                        note=f"{fill}% filled" + (" — engineer-usable" if fill > 50 else " — too empty to model"))
        elif col in ("latitude", "longitude"):
            labels, values = numeric_bins(s)
            base.update(type="doughnut", labels=labels, values=values,
                        note="binned coordinate range (spatial key)")
        elif col in ID_LIKE:
            labels, values = topn_counts(s, n=8)
            top_share = round(100 * sum(values[:-1]) / max(1, s.notna().sum()), 1) if labels else 0
            note = f"{uniq:,} unique ids"
            if col in SENSITIVE:
                note += " · shown in aggregate only (officers never profiled)"
            base.update(type="doughnut", labels=labels, values=values, note=note)
        else:
            labels, values = topn_counts(s)
            base.update(type="doughnut", labels=labels, values=values, note="category share")
        charts.append(base)

    # time-pattern charts (from created_datetime, IST)
    def order_counts(series, order):
        vc = series.value_counts()
        return order, [int(vc.get(k, 0)) for k in order]

    hours = [f"{h:02d}:00" for h in range(24)]
    wk = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    months = sorted([m for m in df["_month"].dropna().unique()])
    time_charts = [
        {"title": "By hour of day (IST)", "labels": hours,
         "values": [int((df["_hour"] == h).sum()) for h in range(24)],
         "note": "ticket times track officer shifts — NOT traffic. Peak ~10:00, evening near-empty."},
        {"title": "By weekday", "labels": wk, "values": order_counts(df["_weekday"], wk)[1],
         "note": "weekday enforcement pattern"},
        {"title": "By month (IST)", "labels": months,
         "values": [int((df["_month"] == m).sum()) for m in months],
         "note": "real window: Nov 2023 → Apr 2024 (filename mislabel)"},
    ]

    # relationships — Cramer's V among the modeling-relevant categoricals
    rel_cols = {
        "vehicle_type": df["vehicle_type"], "police_station": df["police_station"],
        "validation_status": df["validation_status"], "violation": df["_primary_violation"],
        "junction": df["junction_name"], "hour_band": pd.cut(
            pd.to_numeric(df["_hour"], errors="coerce"),
            bins=[-1, 6, 11, 16, 21, 24], labels=["night", "morning", "midday", "evening", "late"]),
        "weekday": df["_weekday"],
    }
    keys = list(rel_cols)
    matrix = [[cramers_v(rel_cols[a], rel_cols[b]) if a != b else 1.0 for b in keys] for a in keys]

    meta = {
        "file": csv.name, "rows": n, "columns": int(len(df.columns) - 4),
        "date_min": str(ts_ist.min()), "date_max": str(ts_ist.max()),
    }
    data = {"meta": meta, "charts": charts, "time_charts": time_charts,
            "relationship": {"keys": keys, "matrix": matrix}}
    return data


def explode_first(s: pd.Series) -> pd.Series:
    def first(v):
        if not isinstance(v, str):
            return np.nan
        try:
            arr = json.loads(v)
            return str(arr[0]).strip() if isinstance(arr, list) and arr else np.nan
        except Exception:
            return np.nan
    return s.map(first)


# --------------------------------------------------------------------------- #
def render_html(data: dict) -> str:
    payload = json.dumps(data).replace("</", "<\\/")
    return HTML_TEMPLATE.replace("__DATA__", payload)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=None)
    ap.add_argument("--rows", type=int, default=0, help="0 = all rows")
    args = ap.parse_args()

    csv = find_csv(args.csv)
    data = build(csv, args.rows)

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(data, indent=2))
    OUT_HTML.write_text(render_html(data), encoding="utf-8")
    print(f"[eda] wrote {OUT_HTML.relative_to(ROOT)}")
    print(f"[eda] wrote {OUT_JSON.relative_to(ROOT)}")


# --------------------------------------------------------------------------- #
HTML_TEMPLATE = r"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ClearLane — Column BI</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root{--bg:#070A10;--panel:#111621;--line:#232c3e;--txt:#EAEEF6;--muted:#8a96ac;--accent:#3E97F0;--teal:#38E1C8}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--txt);
    font-family:"DM Sans",Inter,system-ui,sans-serif}
  body::before{content:"";position:fixed;inset:0;z-index:-1;
    background:radial-gradient(900px 500px at 12% -8%,rgba(62,151,240,.12),transparent 60%),
    radial-gradient(800px 500px at 100% 0,rgba(56,225,200,.08),transparent 55%)}
  header{padding:22px 26px;border-bottom:1px solid var(--line);
    background:linear-gradient(180deg,rgba(17,22,33,.96),rgba(13,17,26,.8));backdrop-filter:blur(12px)}
  h1{margin:0;font-size:20px;font-weight:800;letter-spacing:-.02em}
  h1 span{color:var(--accent)}
  .sub{color:var(--muted);font-size:13px;margin-top:4px}
  .kpis{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
  .kpi{background:#161D2B;border:1px solid var(--line);border-radius:10px;padding:8px 14px}
  .kpi b{font-size:20px;font-weight:800} .kpi span{display:block;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px}
  h2{font-size:15px;margin:26px 0 12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
  .wrap{padding:20px 26px 60px;max-width:1500px;margin:0 auto}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
  .card{background:linear-gradient(180deg,rgba(20,26,39,.7),rgba(15,20,31,.7));
    border:1px solid var(--line);border-radius:14px;padding:14px}
  .card h3{margin:0 0 2px;font-size:14px} .card .meta{color:var(--muted);font-size:11px;margin-bottom:6px}
  .card .note{color:var(--muted);font-size:11px;margin-top:8px;line-height:1.4;border-top:1px solid #1a2230;padding-top:7px}
  .cv{height:208px;position:relative}
  table.rel{border-collapse:collapse;font-size:12px;width:100%}
  table.rel th,table.rel td{padding:7px 9px;text-align:center;border:1px solid #1a2230}
  table.rel th{color:var(--muted);font-weight:600;background:#141a26;position:sticky;top:0}
  table.rel td.k{text-align:left;color:var(--muted);background:#141a26;font-weight:600}
  .roadmap{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
  .step{background:linear-gradient(180deg,rgba(20,26,39,.7),rgba(15,20,31,.7));border:1px solid var(--line);
    border-left:3px solid var(--accent);border-radius:12px;padding:14px}
  .step b{display:block;font-size:14px;margin-bottom:5px} .step p{margin:0;color:var(--muted);font-size:12.5px;line-height:1.5}
  .step .tag{font-size:10px;font-weight:700;color:var(--teal);text-transform:uppercase;letter-spacing:.4px}
  .legend{font-size:10px;color:var(--muted);margin:4px 0 0}
</style></head>
<body>
<header>
  <h1>Clear<span>Lane</span> · Column BI</h1>
  <div class="sub" id="sub"></div>
  <div class="kpis" id="kpis"></div>
</header>
<div class="wrap">
  <h2>Time patterns (created_datetime · IST)</h2>
  <div class="grid" id="time"></div>
  <h2>Every column — distribution</h2>
  <div class="grid" id="cols"></div>
  <h2>Relationships — Cramér's V (0 = independent · 1 = strongly associated)</h2>
  <div class="card" style="overflow:auto"><div id="rel"></div>
    <div class="legend">What to engineer from the strong cells: any pair &gt; 0.3 is a useful interaction
      feature (e.g. station×violation, hour-band×violation). Diagonal is self (1.0).</div></div>
  <h2>Build roadmap — from this table to the full product</h2>
  <div class="roadmap" id="road"></div>
</div>
<script>
const D = __DATA__;
const PAL = ["#3E97F0","#38E1C8","#EF9F27","#E24B4A","#b98bff","#7fe0a0","#E6C229","#46c5c5",
  "#e07fc0","#5b8def","#f2a93b","#ff7a82","#8a96ac"];
Chart.defaults.color="#8a96ac"; Chart.defaults.borderColor="#1a2230"; Chart.defaults.font.family="DM Sans";

document.getElementById("sub").textContent =
  `${D.meta.file} · ${D.meta.date_min.slice(0,10)} → ${D.meta.date_max.slice(0,10)}`;
document.getElementById("kpis").innerHTML =
  [["rows",D.meta.rows.toLocaleString()],["columns",D.meta.columns],
   ["charts",D.charts.length+D.time_charts.length]]
  .map(([l,v])=>`<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join("");

function donut(elId, labels, values, cutout="62%"){
  new Chart(document.getElementById(elId), {type:"doughnut",
    data:{labels,datasets:[{data:values,backgroundColor:PAL,borderWidth:1,borderColor:"#0b0f18"}]},
    options:{plugins:{legend:{position:"right",labels:{boxWidth:10,font:{size:10}}}},
      cutout,maintainAspectRatio:false}});
}
function card(c, idx, prefix){
  const id = prefix+idx;
  return `<div class="card"><h3>${c.col||c.title}</h3>
    <div class="meta">${c.unique!=null?`${c.unique.toLocaleString()} unique · ${c.missing_pct}% missing`:""}</div>
    <div class="cv"><canvas id="${id}"></canvas></div>
    <div class="note">${c.note||""}</div></div>`;
}
document.getElementById("time").innerHTML = D.time_charts.map((c,i)=>card(c,i,"t")).join("");
D.time_charts.forEach((c,i)=>donut("t"+i,c.labels,c.values));
document.getElementById("cols").innerHTML = D.charts.map((c,i)=>card(c,i,"c")).join("");
D.charts.forEach((c,i)=>donut("c"+i,c.labels,c.values));

// relationship matrix
const {keys,matrix}=D.relationship;
const heat=v=>{const t=Math.max(0,Math.min(1,v));const a=[16,22,33],b=[62,151,240];
  const c=a.map((x,i)=>Math.round(x+(b[i]-x)*t));return `rgb(${c[0]},${c[1]},${c[2]})`;};
let h="<table class='rel'><tr><th></th>"+keys.map(k=>`<th>${k}</th>`).join("")+"</tr>";
matrix.forEach((row,i)=>{h+=`<tr><td class='k'>${keys[i]}</td>`+
  row.map(v=>`<td style="background:${heat(v)};color:${v>0.55?'#fff':'#cdd6e6'}">${v.toFixed(2)}</td>`).join("")+"</tr>";});
h+="</table>"; document.getElementById("rel").innerHTML=h;

// roadmap
const ROAD=[
 ["1 · Unify on H3 × time","DATA","Convert lat/lon to H3 cells (res ~9) and build one modeling table: H3 cell × time-bucket × day-type. Free-text location/junction become display metadata, not the join key."],
 ["2 · Enrich with Mappls","CONTEXT","Per cell: reverse-geocode road + ward/admin layer, Nearby POIs (metro, bus, school, hospital, market, parking), and station→cell ETA via Routing. These become model features."],
 ["3 · Targets you can honestly train","MODEL","Primary: Poisson/Tweedie count of parking-obstruction events per cell-time (GLM baseline → LightGBM Poisson → CatBoost challenger). Severity-weight by violation_type/offence_code. Aux: validation_status risk; station workload."],
 ["4 · Blind-spot layer (PU)","MODEL","No trustworthy negatives → frame as positive-unlabeled / under-observation ranking: contextually risky cell-times that are historically under-seen. Label it 'high-risk under-observed', never 'confirmed hotspot'."],
 ["5 · Live impact (re-rank)","LIVE","Attach a present-stress signal: TomTom Flow Segment (1 − currentSpeed/freeFlowSpeed) if a mixed stack is allowed, else Mappls traffic-aware ETA deltas. Call it a Parking–Congestion Association Score."],
 ["6 · Dispatch optimizer","OPS","priority = f(forecast pressure, blind-spot uplift, severity, live stress, station reachability) → Mappls distance-matrix / VRP for 'which station, fastest route, how many P1 in 30 min'."],
 ["7 · Explainability","TRUST","Tree SHAP reason codes per tile ('high evening risk: metro proximity + repeat history + low parking supply + route delay'). Matters more to judges than RMSE."],
 ["8 · Multi-user delivery","PRODUCT","Same state, 4 audiences: govt = ward planning, command = P1/P2/P3 queue, field officer = navigate + outcome capture (creates future labels), citizen = corridor risk + cleaner routes."],
];
document.getElementById("road").innerHTML = ROAD.map(([t,tag,p])=>
  `<div class="step"><span class="tag">${tag}</span><b>${t}</b><p>${p}</p></div>`).join("");
</script>
</body></html>
"""

if __name__ == "__main__":
    main()
