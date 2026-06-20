# ClearLane — Model Build & Test Runbook

End-to-end CLI workflow for the ClearLane ML pipeline: **activate the
environment → train the final models → test a single input**. Windows
PowerShell is shown first (the primary dev box); macOS/Linux equivalents follow
each step.

> The pipeline is deterministic and precomputed. It writes JSON/parquet
> artifacts to `data/processed/`; the API only *serves* them (it never trains).
> See [`ml/AGENTS.md`](AGENTS.md) for the stage-by-stage design contract and
> [`docs/METHODOLOGY.md`](../docs/METHODOLOGY.md) for the honesty rules.

---

## The model stack

| # | Stage file | Model / method | Output |
|---|---|---|---|
| 05 | `05_forecaster.py` | **PoissonRegressor** (GLM baseline) → **LightGBM `objective=poisson`** (main) → **CatBoost Poisson** (challenger) | next-month obstruction-pressure count + SHAP drivers |
| 06b | `06b_blindspot.py` | **Positive-Unlabeled** context-residual ranker | `under_observed_score`, `blind_spot_ml` |
| 07b | `07b_reranker.py` | transparent linear blend + **LightGBM LambdaMART** (learn-to-rank) | `dispatch_priority`, `reason_codes` |
| live | `api/clearlane/bandit.py` | **LinUCB contextual bandit** (Thompson fallback) | online explore/exploit dispatch picks |

Full stage order (run by `run_all.py`):

```text
01_clean → 02_superzones → 03_scores → 04_advanced → 04b_features →
05_forecaster → 06_timing_gap → 06b_blindspot → 07_validation →
07b_reranker → 08_payload
```

---

## Prerequisites

- **Python 3.11** (3.10+ works).
- The raw CSV at `data/raw/jan to may police violation_anonymized791b166.csv`
  (~298k rows, gitignored). A **500-row sample** ships at
  `data/raw/sample_500.csv` for fast checks.
- **Every command below runs from the repo root with the venv activated** — i.e.
  the `(.venv) PS C:\ClearLane>` prompt. No `cd` into `ml/pipeline` is needed;
  `run_all.py` resolves its own paths.
- Using **`uv`** instead of an activated venv? Prefix any command with `uv run`
  (e.g. `uv run uvicorn …`) and install deps with
  `uv pip install -r requirements-ml.txt`.

---

## 1. Activate the virtual environment

**Windows (PowerShell):**

```powershell
.\.venv\Scripts\Activate.ps1
```

**macOS / Linux:**

```bash
source .venv/bin/activate
```

> First time only — create it first: `python -m venv .venv` then activate.
> Your prompt becomes `(.venv) PS C:\ClearLane>`; from there `python`, `pip` and
> `uvicorn` all resolve to the venv. Run every step below from this prompt.

---

## 2. Install the ML dependencies

```powershell
pip install -r requirements-ml.txt
# uv users:  uv pip install -r requirements-ml.txt
```

This installs the heavy stack: `pandas`, `numpy`, `scikit-learn`, `scipy`,
**`lightgbm`**, **`catboost`**, `shap`, `pyarrow`, plus `fastapi`/`uvicorn` for
local serving. LightGBM and CatBoost are both required for the main +
challenger models; if either is missing the pipeline **degrades gracefully** to
`GradientBoostingRegressor` and skips the challenger (so it never hard-fails).

Confirm the model libs:

```powershell
python -c "import lightgbm,catboost,shap; print('lgb',lightgbm.__version__,'cat',catboost.__version__,'shap',shap.__version__)"
```

---

## 3. Quick sanity check on the 500-row sample (≈15s)

Use this to verify the code path before committing to the full run. The
`CLEARLANE_RAW_CSV` override points the pipeline at the sample.

**Windows (PowerShell):**

```powershell
$env:CLEARLANE_RAW_CSV = "$PWD\data\raw\sample_500.csv"
python ml\pipeline\run_all.py --no-demo
Remove-Item Env:CLEARLANE_RAW_CSV          # clear the override afterwards
```

**macOS / Linux:**

```bash
CLEARLANE_RAW_CSV="$PWD/data/raw/sample_500.csv" \
  python ml/pipeline/run_all.py --no-demo
```

> On the sample the self-check table prints **13 flags** and `run_all.py` exits
> non-zero — **this is expected** (500 rows is far below the verified targets).
> You're only checking that every stage *runs* and prints its model line, e.g.
> `LightGBM(poisson) … challenger=CatBoost(Poisson)` and
> `LambdaMART NDCG={'ndcg@10': …}`. `--no-demo` skips re-bundling the demo.

---

## 4. Train the FINAL models on the full dataset (≈1–3 min)

Auto-detects the full CSV, regenerates **`data/processed/*`** and re-bundles the
frontend demo fallback **`frontend/public/demo/*`**.

**Windows (PowerShell):**

```powershell
Remove-Item Env:CLEARLANE_RAW_CSV -ErrorAction SilentlyContinue   # ensure no sample override
python ml\pipeline\run_all.py
```

**macOS / Linux:**

```bash
unset CLEARLANE_RAW_CSV
python ml/pipeline/run_all.py
```

On the full data the self-check should print **mostly green** (`run_all.py`
exits 0). A flag means a real >15% drift to investigate — do not silence it.

### What it produces

| Location | Contents |
|---|---|
| `data/processed/*.parquet` | `events_clean`, `superzones`, `zone_scores`, `zone_features`, `zone_panel` |
| `data/processed/*.json` | serving artifacts incl. **new**: `forecaster_metrics.json`, `pu_scores.json`, `reranker_metrics.json`, and `map_payload.json` / `zones_detail.json` carrying `count_pred`, `under_observed`, `blind_spot_ml`, `dispatch_priority`, `reason_codes` |
| `frontend/public/demo/*.json` | the bundled offline fallback (re-copied unless `--no-demo`) |
| `outputs/reports/*.txt` | judge-facing cleaning / forecaster / validation reports |

---

## 5. Deploy the artifacts to MongoDB (for the live API)

The Vercel API serves artifacts out of MongoDB (read-only filesystem there).
Push the freshly built artifacts:

```powershell
python scripts\migrate_to_mongo.py
```

`MONGODB_URI` / `MONGODB_DB` are read from `.env` (or `backend/.env`)
automatically. Add `--reseed-force` to also wipe + reseed the station/officer
rosters.

---

## 6. Test one input

### A) No server — push one zone through the built artifacts

```powershell
python -c "import json; z=sorted(json.load(open('data/processed/map_payload.json',encoding='utf-8'))['zones'], key=lambda x:-(x.get('dispatch_priority') or 0))[0]; print('zone      :', z['id'], '-', z.get('name')); print('count_pred:', z.get('count_pred')); print('dispatch  :', z.get('dispatch_priority'), '| under_observed:', z.get('under_observed')); print('reasons   :', z.get('reason_codes'))"
```

Expected (values vary with data):

```text
zone      : 2883_17239 - KR Market
count_pred: 41.7
dispatch  : 100.0 | under_observed: 35.3
reasons   : ['forecast pressure rising next month', 'high current obstruction pressure', ...]
```

### B) Live server — exercise the real API path

Start the API. `MONGODB_URI=""` forces **filesystem mode** so it serves the
files you just built (skip that prefix to read MongoDB instead).

```powershell
# terminal A — from (.venv) PS C:\ClearLane>
$env:MONGODB_URI = ""
uvicorn index:app --app-dir api --port 8000
# uv users:  uv run uvicorn index:app --app-dir api --port 8000
```

```powershell
# terminal B — use Invoke-RestMethod (PowerShell's `curl` is an alias for
# Invoke-WebRequest, so use IRM to get auto-parsed JSON objects)
Invoke-RestMethod "http://localhost:8000/api/dispatch/queue?limit=3" | ConvertTo-Json -Depth 5
$id = (Invoke-RestMethod "http://localhost:8000/api/dispatch/queue?limit=1").queue[0].id
Invoke-RestMethod "http://localhost:8000/api/zone/$id/why" | ConvertTo-Json -Depth 5

# contextual-bandit pick, then an online reward update (re-pick reflects it)
Invoke-RestMethod "http://localhost:8000/api/dispatch/next?n=3" | ConvertTo-Json -Depth 5
$body = @{ zone_id = $id; kind = "action_taken" } | ConvertTo-Json
Invoke-RestMethod -Method Post "http://localhost:8000/api/dispatch/reward" -ContentType "application/json" -Body $body
```

**macOS / Linux** (terminal B):

```bash
curl "http://localhost:8000/api/dispatch/queue?limit=3"
ID=$(curl -s "http://localhost:8000/api/dispatch/queue?limit=1" | python -c "import sys,json; print(json.load(sys.stdin)['queue'][0]['id'])")
curl "http://localhost:8000/api/zone/$ID/why"
curl "http://localhost:8000/api/dispatch/next?n=3"
curl -X POST "http://localhost:8000/api/dispatch/reward" -H "Content-Type: application/json" -d "{\"zone_id\":\"$ID\",\"kind\":\"action_taken\"}"
```

New ML endpoints:

| Endpoint | Returns |
|---|---|
| `GET /api/dispatch/queue?station=&tier=&live=&limit=` | M4-reranked zones (`dispatch_priority` + `reason_codes`); `live=1` adds a Mappls ETA-delta proxy |
| `GET /api/dispatch/next?station=&n=` | LinUCB contextual-bandit picks (explore/exploit) |
| `POST /api/dispatch/reward` `{zone_id, kind\|reward}` | online bandit update from an outcome |
| `POST /api/dispatch/route` `{ids, station, live}` | nearest-neighbour stop ordering over live drive-times |
| `GET /api/zone/{id}/why` | reason codes + SHAP drivers + the model used |

---

## Configuration (environment variables)

| Variable | Effect | Default |
|---|---|---|
| `CLEARLANE_RAW_CSV` | override the raw CSV (point at `sample_500.csv` for fast checks) | auto-detect largest non-sample CSV in `data/raw/` |
| `MYMAPINDIA_API_KEY` | enable live Mappls calls (pipeline enrichment + live ETA delta) | unset → offline deterministic defaults |
| `CLEARLANE_MAPPLS` | set `0` to force-disable Mappls even with a key | `1` |
| `MONGODB_URI` | API + migration target; empty string forces filesystem serving | unset → filesystem |
| `CLEARLANE_LLM` | `1` enables the optional Anthropic copilot extension | unset → deterministic briefing |

> **Pipeline Mappls is off by default**: `run_all.py` does not read
> `backend/.env`, so stage `04b` uses offline defaults (fast, no network). To
> enrich with real POIs/reachability, set `MYMAPINDIA_API_KEY` **and**
> `CLEARLANE_MAPPLS=1` in the shell *before* step 4.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ModuleNotFoundError: lightgbm` / `catboost` | not installed in the active venv → rerun step 2. Pipeline still runs via `GradientBoosting` fallback, but you lose the Poisson/LambdaMART/challenger paths. |
| `UnicodeEncodeError: '≥'` on Windows console | already fixed — `run_all.py` reconfigures stdout/stderr to UTF-8. If you call a stage directly, run via `run_all.py`. |
| `FileNotFoundError` for the raw CSV | the vendor filename varies; `config.py` auto-detects the largest non-sample CSV in `data/raw/`. Or set `CLEARLANE_RAW_CSV` explicitly. |
| Self-check prints 13 flags / exits non-zero | you ran on `sample_500.csv`. Expected — run the full dataset (step 4) for green. |
| `[Errno 10048] address already in use` | port 8000 is taken; use `--port 8001` or stop the other server. |
| API serves stale numbers | it's reading MongoDB. Re-run step 5 after training, or start with `MONGODB_URI=""` to serve files. |

---

## One-shot (full build, copy-paste)

```powershell
.\.venv\Scripts\Activate.ps1                  # -> (.venv) PS C:\ClearLane>
pip install -r requirements-ml.txt
Remove-Item Env:CLEARLANE_RAW_CSV -ErrorAction SilentlyContinue
python ml\pipeline\run_all.py                 # train all models + bundle demo
python scripts\migrate_to_mongo.py            # optional: push artifacts to MongoDB
uvicorn index:app --app-dir api --port 8000   # serve the API locally
```
