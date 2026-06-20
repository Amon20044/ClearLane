"""
ClearLane backend — live Mappls adapter (serving side, clearly labelled).

Used ONLY by the dispatch routes to add a live "delay proxy" and drive-time
reachability on top of the precomputed ML artifacts. It never alters the
historical scores. Offline / no-key / error -> returns None and callers fall back
to the precomputed values (offline-first contract preserved).

Honesty: the delay ratio (live ETA vs free-flow ETA on the station->zone
corridor) is a PROXY for current stress, NOT a measurement of congestion.
"""
from __future__ import annotations

import json
import math
import os
import time
import urllib.request

_KEY_ENV = "MYMAPINDIA_API_KEY"
_TIMEOUT = 5
_TTL = 120          # seconds — live values are cached briefly
_cache: dict[str, tuple] = {}


def api_key():
    return os.environ.get(_KEY_ENV) or None


def available() -> bool:
    # opt out with CLEARLANE_MAPPLS=0; otherwise on whenever a key is present
    return os.environ.get("CLEARLANE_MAPPLS", "1") != "0" and bool(api_key())


def _get_json(url: str):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ClearLane/1.0"})
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def _cached(key: str, fn):
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < _TTL:
        return hit[1]
    val = fn()
    if val is not None:
        _cache[key] = (now, val)
    return val


def _dm_seconds(resource: str, slat, slon, dlat, dlon):
    if not available():
        return None

    def fn():
        coords = f"{slon},{slat};{dlon},{dlat}"   # Mappls = lon,lat
        u = (f"https://route.mappls.com/route/dm/{resource}/driving/{coords}"
             f"?access_token={api_key()}")
        data = _get_json(u)
        try:
            return float(data["results"]["durations"][0][1])
        except Exception:
            return None

    return _cached(f"{resource}|{slat:.4f},{slon:.4f}|{dlat:.4f},{dlon:.4f}", fn)


def reach_seconds(slat, slon, dlat, dlon, traffic=False):
    """Driving seconds station->zone (live). None when Mappls is unavailable."""
    return _dm_seconds("distance_matrix_eta" if traffic else "distance_matrix",
                       slat, slon, dlat, dlon)


def delay_ratio(slat, slon, dlat, dlon):
    """Live-traffic ETA vs free-flow ETA on the station->zone corridor, as a
    0..1+ ratio (0 = free-flowing). Proxy for present stress, not measured
    congestion. None when unavailable."""
    free = _dm_seconds("distance_matrix", slat, slon, dlat, dlon)
    eta = _dm_seconds("distance_matrix_eta", slat, slon, dlat, dlon)
    if not free or not eta or free <= 0:
        return None
    return max(0.0, (eta - free) / free)


def nn_order(start, points, traffic=True):
    """Nearest-neighbour ordering of stops by live drive time from `start`
    (a light VRP/route-optimization proxy over the Distance Matrix). Returns the
    visiting order as a list of indices into `points`, or None when Mappls is
    unavailable so the caller can keep the input order."""
    if not available() or not points:
        return None
    order, remaining = [], list(range(len(points)))
    cur = start
    while remaining:
        best, best_sec = None, None
        for i in remaining:
            sec = reach_seconds(cur[0], cur[1], points[i][0], points[i][1], traffic)
            if sec is None:
                return None                   # bail to input order on any miss
            if best_sec is None or sec < best_sec:
                best, best_sec = i, sec
        order.append(best)
        cur = points[best]
        remaining.remove(best)
    return order


def haversine_km(a_lat, a_lon, b_lat, b_lon) -> float:
    R = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dphi = math.radians(b_lat - a_lat)
    dl = math.radians(b_lon - a_lon)
    x = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(x))
