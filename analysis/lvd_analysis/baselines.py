"""Baseline detectors (brief §10): class-balanced random, shared public IP, exact same
browser profile, and a documented statistical model (L2 logistic regression, stdlib).

Each baseline trains only on the dev set and writes a submission in the same format the blue
team uses, so it is scored by exactly the same code.
"""
from __future__ import annotations

import math
import random
from typing import Any

from .common import FAMILIES, VOLATILE_FIELDS
from .features import pair_features

SUBMISSION_SCHEMA = "lvd-detector-submission/1"


def _index(doc: dict) -> dict[str, dict]:
    return {v["id"]: v for v in doc["visits"]}


def _profile(v: dict) -> str:
    stable = {k: o for k, o in v["observations"].items() if k not in VOLATILE_FIELDS}
    return repr(sorted((k, repr(o)) for k, o in stable.items())) + repr(sorted(v["headers"].items()))


class Logistic:
    """Deterministic batch gradient descent with standardised inputs and L2 penalty."""

    def __init__(self, families: list[str], l2: float = 0.01, epochs: int = 800, lr: float = 0.5):
        self.families, self.l2, self.epochs, self.lr = families, l2, epochs, lr
        self.w: list[float] = []
        self.mu: list[float] = []
        self.sd: list[float] = []

    def _x(self, f: dict[str, float]) -> list[float]:
        return [f[k] for k in self.families]

    def fit(self, rows: list[dict[str, float]], y: list[int]) -> "Logistic":
        X = [self._x(r) for r in rows]
        d = len(self.families)
        self.mu = [sum(x[j] for x in X) / len(X) for j in range(d)]
        self.sd = [math.sqrt(sum((x[j] - self.mu[j]) ** 2 for x in X) / len(X)) or 1.0 for j in range(d)]
        Z = [[(x[j] - self.mu[j]) / self.sd[j] for j in range(d)] + [1.0] for x in X]
        w = [0.0] * (d + 1)
        n = len(Z)
        for _ in range(self.epochs):
            g = [0.0] * (d + 1)
            for z, t in zip(Z, y):
                p = 1 / (1 + math.exp(-max(-30, min(30, sum(a * b for a, b in zip(w, z))))))
                for j in range(d + 1):
                    g[j] += (p - t) * z[j]
            for j in range(d + 1):
                w[j] -= self.lr * (g[j] / n + (self.l2 * w[j] if j < d else 0))
        self.w = w
        return self

    def prob(self, f: dict[str, float]) -> float:
        z = [(v - m) / s for v, m, s in zip(self._x(f), self.mu, self.sd)] + [1.0]
        return 1 / (1 + math.exp(-max(-30, min(30, sum(a * b for a, b in zip(self.w, z))))))


def run_baseline(name: str, dev: dict, target: dict, seed: int = 0, families: list[str] | None = None) -> dict[str, Any]:
    dv, tv = _index(dev), _index(target)
    preds = []
    if name == "random":
        prev = sum(1 for p in dev["pairs"] if p["sameHost"]) / max(1, len(dev["pairs"]))
        rng = random.Random(seed)
        for p in target["pairs"]:
            same = rng.random() < prev
            preds.append({"pairId": p["id"], "sameHost": same, "confidence": prev if same else 1 - prev, "evidenceCategories": []})
    elif name == "shared-ip":
        for p in target["pairs"]:
            a, b = tv[p["a"]], tv[p["b"]]
            same = bool(a["ipPseudonym"]) and a["ipPseudonym"] == b["ipPseudonym"]
            preds.append({"pairId": p["id"], "sameHost": same, "confidence": 1.0, "evidenceCategories": ["network"]})
    elif name == "exact-profile":
        for p in target["pairs"]:
            same = _profile(tv[p["a"]]) == _profile(tv[p["b"]])
            preds.append({"pairId": p["id"], "sameHost": same, "confidence": 1.0, "evidenceCategories": ["browser-config", "display", "headers"]})
    elif name == "logistic":
        fams = families or FAMILIES
        rows = [pair_features(dv[p["a"]], dv[p["b"]]) for p in dev["pairs"]]
        y = [1 if p["sameHost"] else 0 for p in dev["pairs"]]
        if len(set(y)) < 2:
            raise ValueError("dev set needs both classes to fit the statistical model")
        model = Logistic(fams).fit(rows, y)
        for p in target["pairs"]:
            pr = model.prob(pair_features(tv[p["a"]], tv[p["b"]]))
            preds.append({"pairId": p["id"], "sameHost": pr >= 0.5, "confidence": pr if pr >= 0.5 else 1 - pr, "evidenceCategories": fams})
    else:
        raise ValueError(f"unknown baseline {name}")
    return {
        "schema": SUBMISSION_SCHEMA,
        "detector": {"name": f"baseline:{name}", "version": "1", "families": families or FAMILIES},
        "set": target["set"],
        "predictions": preds,
    }
