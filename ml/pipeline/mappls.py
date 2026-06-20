"""
Mappls REST adapter for the pipeline — OFFLINE-FIRST + on-disk cached.

Every successful response is cached to `data/processed/mappls_cache/` keyed by
rounded coordinates, so a re-run is deterministic and the whole pipeline works
with NO network and NO key (callers receive neutral defaults). Uses only stdlib
`urllib` (no extra dependency). Auth = static `access_token` query param from the
`MYMAPINDIA_API_KEY` env var (see config.MAPPLS_API_KEY_ENV).

Honesty: Mappls supplies geographic CONTEXT (POIs, locality, road snap, drive
time) — never a measurement of congestion. The live ETA delta is a serving-side
proxy, labelled as such.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C   # noqa: E402
import utils as U    # noqa: E402

_CACHE: dict[str, dict] = {}
_DIRTY: set[str] = set()


# --------------------------------------------------------------------------- #
def api_key() -> str | None:
    return os.environ.get(C.MAPPLS_API_KEY_ENV) or None


def available() -> bool:
    return bool(C.MAPPLS_ENABLED and api_key())


def _round(v: float) -> float:
    return round(float(v), C.MAPPLS_COORD_DECIMALS)


def _cache_file(kind: str) -> Path:
    C.MAPPLS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return C.MAPPLS_CACHE_DIR / f"{kind}.json"


def _cache(kind: str) -> dict:
    if kind not in _CACHE:
        f = _cache_file(kind)
        try:
            _CACHE[kind] = json.loads(f.read_text()) if f.exists() else {}
        except Exception:
            _CACHE[kind] = {}
    return _CACHE[kind]


def flush():
    """Persist any newly-fetched results so the next run is offline-reproducible."""
    for kind in list(_DIRTY):
        try:
            _cache_file(kind).write_text(json.dumps(_CACHE.get(kind, {})))
        except Exception:
            pass
    _DIRTY.clear()


def _http_get_json(url: str):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ClearLane/1.0"})
        with urllib.request.urlopen(req, timeout=C.MAPPLS_TIMEOUT_S) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def _cached_call(kind: str, key: str, url_builder):
    """Return cached value, else fetch (if a key is available) and cache it.
    Never caches failures, so an offline run stays deterministic + recoverable."""
    cache = _cache(kind)
    if key in cache:
        return cache[key]
    if not available():
        return None
    data = _http_get_json(url_builder())
    if data is not None:
        cache[key] = data
        _DIRTY.add(kind)
    return data


# --------------------------------------------------------------------------- #
# Reverse geocode -> locality / pincode / road (context)
# --------------------------------------------------------------------------- #
def reverse_geocode(lat: float, lon: float) -> dict:
    lat, lon = _round(lat), _round(lon)
    key = f"{lat},{lon}"

    def url():
        q = urllib.parse.urlencode({"lat": lat, "lng": lon, "access_token": api_key()})
        return f"https://search.mappls.com/search/address/rev-geocode?{q}"

    data = _cached_call("revgeo", key, url)
    if not data:
        return {}
    res = (data.get("results") or [{}])[0] if isinstance(data, dict) else {}
    return {
        "locality": res.get("locality") or res.get("subLocality"),
        "pincode": res.get("pincode"),
        "street": res.get("street"),
        "district": res.get("district"),
        "formatted_address": res.get("formatted_address"),
    }


# --------------------------------------------------------------------------- #
# Nearby POI -> nearest distance (m) + count within radius
# --------------------------------------------------------------------------- #
def nearby_poi(lat: float, lon: float, keyword: str, radius: int):
    lat, lon = _round(lat), _round(lon)
    key = f"{lat},{lon}|{keyword}|{radius}"

    def url():
        q = urllib.parse.urlencode({
            "keywords": keyword, "refLocation": f"{lat},{lon}",
            "radius": radius, "access_token": api_key()})
        return f"https://search.mappls.com/search/places/nearby/json?{q}"

    data = _cached_call("nearby", key, url)
    locs = (data or {}).get("suggestedLocations") if isinstance(data, dict) else None
    if not locs:
        return (C.MAPPLS_POI_FAR_M, 0)
    dmin, cnt = C.MAPPLS_POI_FAR_M, 0
    for p in locs:
        try:
            plat, plon = float(p["latitude"]), float(p["longitude"])
        except Exception:
            # Nearby may return only `distance` (m) — use it directly.
            d = p.get("distance")
            if d is not None:
                dmin = min(dmin, float(d)); cnt += 1
            continue
        d = U.haversine_m(lat, lon, plat, plon)
        dmin = min(dmin, d); cnt += 1
    return (round(float(dmin), 1), int(cnt))


# --------------------------------------------------------------------------- #
# Driving distance/time matrix -> seconds (offline -> None; caller uses haversine)
# --------------------------------------------------------------------------- #
def drive_seconds(src_lat, src_lon, dst_lat, dst_lon, traffic=False):
    a = (_round(src_lat), _round(src_lon))
    b = (_round(dst_lat), _round(dst_lon))
    resource = "distance_matrix_eta" if traffic else "distance_matrix"
    key = f"{resource}|{a[0]},{a[1]}|{b[0]},{b[1]}"

    def url():
        coords = f"{a[1]},{a[0]};{b[1]},{b[0]}"   # Mappls = lon,lat
        return (f"https://route.mappls.com/route/dm/{resource}/driving/{coords}"
                f"?access_token={api_key()}")

    data = _cached_call("dm", key, url)
    try:
        return float(data["results"]["durations"][0][1])
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# Snap-to-road V2 (optional road-segment cleanup; offline -> None)
# --------------------------------------------------------------------------- #
def snap_point(lat: float, lon: float):
    lat, lon = _round(lat), _round(lon)
    key = f"{lat},{lon}"
    cache = _cache("snap")
    if key in cache:
        return cache[key]
    if not available():
        return None
    try:
        body = urllib.parse.urlencode({"points": f"{lon},{lat}", "type": "break"}).encode()
        u = f"https://route.mappls.com/routev2/movement/trace_route?access_token={api_key()}"
        req = urllib.request.Request(u, data=body, headers={"User-Agent": "ClearLane/1.0"})
        with urllib.request.urlopen(req, timeout=C.MAPPLS_TIMEOUT_S) as r:
            data = json.loads(r.read().decode("utf-8"))
        sp = (data.get("snappedPoints") or [{}])[0]
        loc = sp.get("location")
        out = {"lat": loc[1], "lon": loc[0]} if isinstance(loc, list) and len(loc) == 2 else None
        if out:
            cache[key] = out
            _DIRTY.add("snap")
        return out
    except Exception:
        return None
