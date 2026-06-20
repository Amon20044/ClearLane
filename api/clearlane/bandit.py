"""
ClearLane — contextual-bandit dispatch (M5, the self-improving loop).

Dispatch is an explore/exploit problem: keep sending units to known hotspots
(exploit) while occasionally probing high-context-risk but under-observed zones
(explore) so the system discovers blind spots instead of only re-confirming where
police already patrol. We use LinUCB (contextual) when numpy is available, else a
Thompson-sampling Beta bandit (contextless) — both update online from officer
feedback (reward map in config / OP rules).

State is in-process (resets on restart); production would persist the per-arm
matrices to MongoDB. The OFFLINE pipeline already ships the deterministic M4
reranker — this layer only re-orders exploration live and never edits ML scores.
"""
from __future__ import annotations

try:
    import numpy as np
    _HAS_NP = True
except Exception:                       # pragma: no cover
    _HAS_NP = False

ALPHA = 0.6          # exploration coefficient (config.BANDIT_ALPHA mirror)


class _LinUCB:
    """Contextual LinUCB. Per-arm ridge regression with an upper-confidence bonus."""
    def __init__(self, d: int, alpha: float = ALPHA):
        self.d, self.alpha = d, alpha
        self.A: dict[str, object] = {}
        self.b: dict[str, object] = {}

    def _ensure(self, arm):
        if arm not in self.A:
            self.A[arm] = np.identity(self.d)
            self.b[arm] = np.zeros(self.d)

    def score(self, arm, x):
        self._ensure(arm)
        A_inv = np.linalg.inv(self.A[arm])
        theta = A_inv @ self.b[arm]
        x = np.asarray(x, dtype=float)
        mean = float(theta @ x)
        bonus = self.alpha * float(np.sqrt(x @ A_inv @ x))
        return mean + bonus, mean, bonus

    def update(self, arm, x, reward: float):
        self._ensure(arm)
        x = np.asarray(x, dtype=float)
        self.A[arm] = self.A[arm] + np.outer(x, x)
        self.b[arm] = self.b[arm] + reward * x


class _Thompson:
    """Contextless Thompson sampling (Beta) fallback when numpy is unavailable."""
    def __init__(self):
        self.ab: dict[str, list] = {}

    def score(self, arm, x):
        import random
        a, b = self.ab.get(arm, (1.0, 1.0))
        s = random.betavariate(a, b)
        return s, a / (a + b), 0.0

    def update(self, arm, x, reward: float):
        a, b = self.ab.get(arm, (1.0, 1.0))
        self.ab[arm] = [a + max(0.0, reward), b + max(0.0, 1.0 - reward)]


_D = 5   # context dim: [bias, forecast, pressure, under_observed, dispatch_priority]
_BANDIT = _LinUCB(_D) if _HAS_NP else _Thompson()


def context(zone: dict):
    """Feature vector for a zone arm from its map_payload record."""
    f = (zone.get("forecast_score") or 0) / 100.0
    p = (zone.get("pressure") or 0) / 100.0
    u = (zone.get("under_observed") or 0) / 100.0
    d = (zone.get("dispatch_priority") or zone.get("priority") or 0) / 100.0
    return [1.0, f, p, u, d]


def rank(zones: list[dict], n: int = 5):
    """Bandit-selected zones (explore + exploit). Returns the top-n with scores."""
    scored = []
    for z in zones:
        x = context(z)
        total, mean, bonus = _BANDIT.score(z["id"], x)
        scored.append((total, mean, bonus, z))
    scored.sort(key=lambda t: -t[0])
    out = []
    for total, mean, bonus, z in scored[:n]:
        out.append({**z, "bandit_score": round(float(total), 3),
                    "exploit": round(float(mean), 3),
                    "explore_bonus": round(float(bonus), 3)})
    return out


def reward(zone: dict, r: float):
    _BANDIT.update(zone["id"], context(zone), float(r))


def algo() -> str:
    return "LinUCB (contextual)" if _HAS_NP else "Thompson (Beta)"
