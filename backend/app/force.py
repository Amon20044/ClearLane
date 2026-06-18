"""
ClearLane — Force Command layer (RBAC + station roster + troop simulation).

This is a clearly-labelled DEPLOYMENT / OPERATIONS layer. Like operational.py it
NEVER touches the historical ML scores. It adds:

  * RBAC auth (token sessions in SQLite):
      - Government super-admin:  username "govt" / password "govt"  -> sees all
      - Per-station command:     username == password == station slug  (e.g.
        "HAL Old Airport" -> "hal-old-airport") -> sees ONLY its own area
  * A local SQL store for managing area-level forces:
      - fz_stations  (police stations; govt can add / remove)
      - fz_officers  (ranked officers per station; add / remove / re-shift)
  * Deterministic seeding from the real station list (stations.json) so every
    station boots with a realistic ranked roster across three shifts.

The live troop-tracking *movement* simulation runs client-side (frontend/src/lib/
force.js) for smooth animation and full offline support; this backend is the
source of truth for auth + roster persistence. Honesty: officer positions are a
SIMULATION for deployment planning, never a claim about measured traffic.
"""
from __future__ import annotations

import json
import math
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path
from threading import Lock

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api")

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "backend" / "data" / "clearlane.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

_lock = Lock()

# Indian-police station hierarchy (high -> low). SHO is the station Inspector.
RANKS = ["Inspector", "Police Sub-Inspector", "Assistant Sub-Inspector",
         "Head Constable", "Constable"]
# Three rotating shifts (IST hour ranges). "C" wraps past midnight.
SHIFTS = {
    "A": {"label": "Morning", "start": 6, "end": 14},
    "B": {"label": "Evening", "start": 14, "end": 22},
    "C": {"label": "Night", "start": 22, "end": 6},
}
_NAMES_FIRST = ["Arjun", "Vikram", "Suresh", "Ramesh", "Manjunath", "Kiran",
                "Prakash", "Naveen", "Ravi", "Anil", "Deepak", "Girish",
                "Harish", "Lokesh", "Mahesh", "Nandish", "Praveen", "Rakesh",
                "Santosh", "Umesh", "Yogesh", "Basava", "Chetan", "Dinesh",
                "Ganesh", "Hemanth", "Imran", "Jagdish", "Kishore", "Lavanya",
                "Meena", "Nagaraj", "Pooja", "Roopa", "Shilpa", "Tejaswini"]
_NAMES_LAST = ["Gowda", "Reddy", "Naik", "Rao", "Shetty", "Kumar", "Murthy",
               "Hegde", "Patil", "Iyer", "Nair", "Babu", "Das", "Singh",
               "Prasad", "Bhat", "Acharya", "Desai", "Kulkarni", "Pai"]


# --------------------------------------------------------------------------- #
def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "station"


def _art_dir() -> Path:
    override = os.environ.get("CLEARLANE_ARTIFACTS")
    if override and Path(override).exists():
        return Path(override)
    proc = ROOT / "data" / "processed"
    demo = ROOT / "frontend" / "public" / "demo"
    return proc if (proc / "stations.json").exists() else demo


def _load_stations_seed() -> list[dict]:
    for p in (_art_dir() / "stations.json",
              ROOT / "frontend" / "public" / "demo" / "stations.json"):
        if p.exists():
            try:
                return json.loads(p.read_text())
            except Exception:
                pass
    return []


def _rng(seed: int):
    """Tiny deterministic LCG so seeding is reproducible without numpy."""
    state = {"s": (seed * 2654435761) & 0xFFFFFFFF}

    def nxt(n):  # int in [0, n)
        state["s"] = (1103515245 * state["s"] + 12345) & 0x7FFFFFFF
        return state["s"] % n
    return nxt


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


# --------------------------------------------------------------------------- #
def init_db():
    with _conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS fz_stations(
            slug TEXT PRIMARY KEY, name TEXT, lat REAL, lon REAL,
            n_zones INTEGER DEFAULT 0, seeded INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1, created_ts REAL);
        CREATE TABLE IF NOT EXISTS fz_officers(
            id INTEGER PRIMARY KEY AUTOINCREMENT, station_slug TEXT,
            name TEXT, badge TEXT, rank TEXT, shift TEXT,
            status TEXT DEFAULT 'available', created_ts REAL);
        CREATE TABLE IF NOT EXISTS fz_sessions(
            token TEXT PRIMARY KEY, role TEXT, scope TEXT, name TEXT,
            created_ts REAL);
        """)
    _seed_if_empty()


def _seed_station_officers(c, slug, n_zones):
    """Create a realistic ranked roster, round-robin across the 3 shifts."""
    size = max(6, min(18, round(n_zones * 0.35) + 5))
    rng = _rng(sum(ord(ch) for ch in slug) + size)
    # rank counts: 1 Inspector, up to 2 SI, up to 2 ASI, rest HC / Constable
    plan = ["Inspector"]
    plan += ["Police Sub-Inspector"] * min(2, max(1, size // 6))
    plan += ["Assistant Sub-Inspector"] * min(2, max(1, size // 6))
    while len(plan) < size:
        plan.append("Head Constable" if rng(10) < 4 else "Constable")
    now = time.time()
    shifts = ["A", "B", "C"]
    rows = []
    for i, rank in enumerate(plan):
        fn = _NAMES_FIRST[rng(len(_NAMES_FIRST))]
        ln = _NAMES_LAST[rng(len(_NAMES_LAST))]
        shift = shifts[i % 3]
        badge = f"{slug[:3].upper()}-{1000 + i}"
        rows.append((slug, f"{fn} {ln}", badge, rank, shift, "available", now))
    c.executemany("""INSERT INTO fz_officers
        (station_slug,name,badge,rank,shift,status,created_ts)
        VALUES(?,?,?,?,?,?,?)""", rows)


def _seed_if_empty():
    with _lock, _conn() as c:
        have = c.execute("SELECT COUNT(*) AS n FROM fz_stations").fetchone()["n"]
        if have:
            return
        now = time.time()
        for s in _load_stations_seed():
            name = s.get("station") or "Station"
            if name == "No Police Station":
                continue
            slug = slugify(name)
            c.execute("""INSERT OR IGNORE INTO fz_stations
                (slug,name,lat,lon,n_zones,seeded,active,created_ts)
                VALUES(?,?,?,?,?,1,1,?)""",
                (slug, name, s.get("lat"), s.get("lon"),
                 int(s.get("n_zones") or 0), now))
            _seed_station_officers(c, slug, int(s.get("n_zones") or 0))


# ensure tables + seed exist as soon as the module is imported (idempotent)
init_db()


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
class LoginIn(BaseModel):
    username: str = Field(max_length=80)
    password: str = Field(max_length=80)


def _session(token: str | None):
    if not token:
        return None
    with _conn() as c:
        r = c.execute("SELECT * FROM fz_sessions WHERE token=?", (token,)).fetchone()
    return dict(r) if r else None


def _auth(authorization: str | None):
    """Resolve the bearer token -> session, or raise 401."""
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    sess = _session(token)
    if not sess:
        raise HTTPException(401, "Not authenticated.")
    return sess


def _require_scope(sess: dict, slug: str | None):
    """Govt may touch any station; a station may touch only its own."""
    if sess["role"] == "govt":
        return
    if not slug or slug != sess["scope"]:
        raise HTTPException(403, "Out of scope for this account.")


@router.post("/auth/login")
def login(body: LoginIn):
    user = (body.username or "").strip().lower()
    pw = (body.password or "").strip().lower()
    role, scope, name = None, None, None
    if user == "govt" and pw == "govt":
        role, scope, name = "govt", "all", "Government Command"
    else:
        with _conn() as c:
            r = c.execute("SELECT * FROM fz_stations WHERE slug=? AND active=1",
                          (user,)).fetchone()
        # slug is BOTH username and password (demo RBAC, as specified)
        if r and pw == user:
            role, scope, name = "station", r["slug"], r["name"]
    if not role:
        raise HTTPException(401, "Invalid credentials.")
    token = secrets.token_urlsafe(24)
    with _lock, _conn() as c:
        c.execute("""INSERT INTO fz_sessions(token,role,scope,name,created_ts)
                     VALUES(?,?,?,?,?)""", (token, role, scope, name, time.time()))
    return ok({"token": token, "role": role, "scope": scope, "name": name})


@router.post("/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.lower().startswith("bearer "):
        tok = authorization[7:].strip()
        with _lock, _conn() as c:
            c.execute("DELETE FROM fz_sessions WHERE token=?", (tok,))
    return ok({"ok": True})


@router.get("/auth/me")
def me(authorization: str | None = Header(default=None)):
    sess = _auth(authorization)
    return ok({"role": sess["role"], "scope": sess["scope"], "name": sess["name"]})


# --------------------------------------------------------------------------- #
# Helpers to assemble roster / station summaries
# --------------------------------------------------------------------------- #
def _officer_rows(c, slug):
    return [dict(r) for r in c.execute(
        "SELECT * FROM fz_officers WHERE station_slug=? ORDER BY id", (slug,)
    ).fetchall()]


def _station_dict(c, r):
    n_off = c.execute("SELECT COUNT(*) AS n FROM fz_officers WHERE station_slug=?",
                      (r["slug"],)).fetchone()["n"]
    return {"slug": r["slug"], "name": r["name"], "lat": r["lat"], "lon": r["lon"],
            "n_zones": r["n_zones"], "officers": n_off, "active": bool(r["active"])}


# --------------------------------------------------------------------------- #
# Government endpoints (require govt role)
# --------------------------------------------------------------------------- #
class StationIn(BaseModel):
    name: str = Field(max_length=120)
    lat: float
    lon: float


@router.get("/govt/stations")
def govt_stations(authorization: str | None = Header(default=None)):
    sess = _auth(authorization)
    if sess["role"] != "govt":
        raise HTTPException(403, "Government access only.")
    with _conn() as c:
        rows = c.execute("SELECT * FROM fz_stations ORDER BY name").fetchall()
        out = [_station_dict(c, r) for r in rows]
        total_off = c.execute("SELECT COUNT(*) AS n FROM fz_officers").fetchone()["n"]
    return ok({"stations": out,
               "totals": {"stations": len(out), "officers": total_off}})


@router.post("/govt/stations")
def govt_add_station(body: StationIn, authorization: str | None = Header(default=None)):
    sess = _auth(authorization)
    if sess["role"] != "govt":
        raise HTTPException(403, "Government access only.")
    slug = slugify(body.name)
    now = time.time()
    with _lock, _conn() as c:
        exists = c.execute("SELECT 1 FROM fz_stations WHERE slug=?", (slug,)).fetchone()
        if exists:
            raise HTTPException(409, f"Station '{slug}' already exists.")
        c.execute("""INSERT INTO fz_stations(slug,name,lat,lon,n_zones,seeded,active,created_ts)
                     VALUES(?,?,?,?,0,1,1,?)""", (slug, body.name, body.lat, body.lon, now))
        _seed_station_officers(c, slug, 12)
    return ok({"slug": slug, "name": body.name,
               "login": {"username": slug, "password": slug}})


@router.delete("/govt/stations/{slug}")
def govt_remove_station(slug: str, authorization: str | None = Header(default=None)):
    sess = _auth(authorization)
    if sess["role"] != "govt":
        raise HTTPException(403, "Government access only.")
    with _lock, _conn() as c:
        c.execute("DELETE FROM fz_officers WHERE station_slug=?", (slug,))
        c.execute("DELETE FROM fz_sessions WHERE scope=?", (slug,))
        cur = c.execute("DELETE FROM fz_stations WHERE slug=?", (slug,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Station not found.")
    return ok({"removed": slug})


# --------------------------------------------------------------------------- #
# Roster endpoints (govt or the owning station)
# --------------------------------------------------------------------------- #
class OfficerIn(BaseModel):
    station_slug: str = Field(max_length=80)
    name: str = Field(max_length=80)
    rank: str = Field(default="Constable", max_length=60)
    shift: str = Field(default="A", max_length=2)


class OfficerPatch(BaseModel):
    rank: str | None = Field(default=None, max_length=60)
    shift: str | None = Field(default=None, max_length=2)
    status: str | None = Field(default=None, max_length=20)


@router.get("/force/roster")
def force_roster(station: str, authorization: str | None = Header(default=None)):
    sess = _auth(authorization)
    _require_scope(sess, station)
    with _conn() as c:
        st = c.execute("SELECT * FROM fz_stations WHERE slug=?", (station,)).fetchone()
        if not st:
            raise HTTPException(404, "Station not found.")
        officers = _officer_rows(c, station)
        sd = _station_dict(c, st)
    return ok({"station": sd, "officers": officers, "ranks": RANKS, "shifts": SHIFTS})


@router.post("/force/officers")
def force_add_officer(body: OfficerIn, authorization: str | None = Header(default=None)):
    sess = _auth(authorization)
    _require_scope(sess, body.station_slug)
    rank = body.rank if body.rank in RANKS else "Constable"
    shift = body.shift if body.shift in SHIFTS else "A"
    now = time.time()
    with _lock, _conn() as c:
        st = c.execute("SELECT 1 FROM fz_stations WHERE slug=?",
                       (body.station_slug,)).fetchone()
        if not st:
            raise HTTPException(404, "Station not found.")
        n = c.execute("SELECT COUNT(*) AS n FROM fz_officers WHERE station_slug=?",
                      (body.station_slug,)).fetchone()["n"]
        badge = f"{body.station_slug[:3].upper()}-{1000 + n}"
        cur = c.execute("""INSERT INTO fz_officers
            (station_slug,name,badge,rank,shift,status,created_ts)
            VALUES(?,?,?,?,?,?,?)""",
            (body.station_slug, body.name, badge, rank, shift, "available", now))
    return ok({"id": cur.lastrowid, "badge": badge, "name": body.name,
               "rank": rank, "shift": shift})


@router.patch("/force/officers/{oid}")
def force_patch_officer(oid: int, body: OfficerPatch,
                        authorization: str | None = Header(default=None)):
    sess = _auth(authorization)
    with _lock, _conn() as c:
        row = c.execute("SELECT * FROM fz_officers WHERE id=?", (oid,)).fetchone()
        if not row:
            raise HTTPException(404, "Officer not found.")
        _require_scope(sess, row["station_slug"])
        rank = body.rank if (body.rank in RANKS) else row["rank"]
        shift = body.shift if (body.shift in SHIFTS) else row["shift"]
        status = body.status or row["status"]
        c.execute("UPDATE fz_officers SET rank=?,shift=?,status=? WHERE id=?",
                  (rank, shift, status, oid))
    return ok({"id": oid, "rank": rank, "shift": shift, "status": status})


@router.delete("/force/officers/{oid}")
def force_remove_officer(oid: int, authorization: str | None = Header(default=None)):
    sess = _auth(authorization)
    with _lock, _conn() as c:
        row = c.execute("SELECT * FROM fz_officers WHERE id=?", (oid,)).fetchone()
        if not row:
            raise HTTPException(404, "Officer not found.")
        _require_scope(sess, row["station_slug"])
        c.execute("DELETE FROM fz_officers WHERE id=?", (oid,))
    return ok({"removed": oid})


# --------------------------------------------------------------------------- #
def _safe(obj):
    if isinstance(obj, dict):
        return {k: _safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_safe(v) for v in obj]
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj


def ok(p):
    return JSONResponse(content=_safe(p))
