"""Scoring (brief §10, §16).

- Positive class: same-host (declared in the preregistration).
- Confusion matrices with integer counts, per held-out set and per condition.
- precision = TP/(TP+FP), recall = TP/(TP+FN), FPR = FP/(FP+TN), FNR = FN/(FN+TP).
- Uncertainty: cluster bootstrap over PHYSICAL HOSTS (not visits or pairs), percentile interval.
- Calibration (reliability bins, ECE) when confidences are supplied.
- Subgroups with suppression below the preregistered minimum number of hosts.
- Conditions with fewer hosts than preregistered are labelled exploratory.
"""
from __future__ import annotations

import random
from collections import Counter
from typing import Any, Iterable

from .common import LABELS


def confusion(pairs: Iterable[tuple[bool, bool]], weights: Iterable[float] | None = None) -> dict[str, float]:
    tp = fp = tn = fn = 0.0
    for (truth, pred), w in zip(pairs, weights if weights is not None else _ones()):
        if truth and pred:
            tp += w
        elif truth and not pred:
            fn += w
        elif not truth and pred:
            fp += w
        else:
            tn += w
    return {"tp": tp, "fp": fp, "tn": tn, "fn": fn}


def _ones():
    while True:
        yield 1.0


def _div(a: float, b: float) -> float | None:
    return a / b if b else None


def metrics(c: dict[str, float]) -> dict[str, float | None]:
    tp, fp, tn, fn = c["tp"], c["fp"], c["tn"], c["fn"]
    n = tp + fp + tn + fn
    return {
        "precision": _div(tp, tp + fp),
        "recall": _div(tp, tp + fn),
        "fpr": _div(fp, fp + tn),
        "fnr": _div(fn, fn + tp),
        "accuracy": _div(tp + tn, n),
        "prevalence": _div(tp + fn, n),
    }


def cluster_bootstrap(rows: list[dict], repetitions: int, level: float, seed: int) -> dict[str, list[float | None]]:
    """Resample physical hosts with replacement. A pair's weight is the product of how many
    times each of its hosts was drawn (a same-host pair counts its host once)."""
    hosts = sorted({h for r in rows for h in (r["hostA"], r["hostB"])})
    rng = random.Random(seed)
    samples: dict[str, list[float]] = {k: [] for k in ("precision", "recall", "fpr", "fnr", "accuracy")}
    for _ in range(repetitions):
        draw = Counter(rng.choice(hosts) for _ in hosts)
        weights = [draw[r["hostA"]] if r["hostA"] == r["hostB"] else draw[r["hostA"]] * draw[r["hostB"]] for r in rows]
        m = metrics(confusion(((r["truth"], r["pred"]) for r in rows), weights))
        for k in samples:
            if m[k] is not None:
                samples[k].append(m[k])  # type: ignore[arg-type]
    lo_q, hi_q = (1 - level) / 2, 1 - (1 - level) / 2
    out: dict[str, list[float | None]] = {}
    for k, vals in samples.items():
        if len(vals) < repetitions * 0.5:
            out[k] = [None, None]  # undefined in most resamples: do not report a spurious interval
            continue
        s = sorted(vals)
        out[k] = [s[int(lo_q * (len(s) - 1))], s[int(hi_q * (len(s) - 1))]]
    return out


def calibration(rows: list[dict], bins: int = 10) -> dict[str, Any] | None:
    """Among predictions near a stated confidence, how many were correct?"""
    usable = [r for r in rows if r.get("confidence") is not None]
    if not usable:
        return None
    table = []
    ece = 0.0
    for i in range(bins):
        lo, hi = i / bins, (i + 1) / bins
        inb = [r for r in usable if lo <= r["confidence"] < hi or (i == bins - 1 and r["confidence"] == 1.0)]
        if not inb:
            continue
        conf = sum(r["confidence"] for r in inb) / len(inb)
        acc = sum(1 for r in inb if r["truth"] == r["pred"]) / len(inb)
        ece += len(inb) / len(usable) * abs(conf - acc)
        table.append({"bin": [lo, hi], "n": len(inb), "meanConfidence": conf, "accuracy": acc})
    return {"bins": table, "ece": ece, "n": len(usable)}


def summarize(rows: list[dict], prereg: dict, seed_offset: int = 0) -> dict[str, Any]:
    c = confusion((r["truth"], r["pred"]) for r in rows)
    hosts = sorted({h for r in rows for h in (r["hostA"], r["hostB"])})
    host_types = Counter(h.split(":", 1)[0] if ":" in h else "study-host" for h in hosts)
    bs = prereg["bootstrap"]
    return {
        "nPairs": len(rows),
        "nHosts": len(hosts),
        "hostTypes": dict(host_types),
        "confusion": {k: int(v) for k, v in c.items()},
        "metrics": metrics(c),
        "ci": cluster_bootstrap(rows, bs["repetitions"], bs["level"], prereg["seed"] + seed_offset) if len(hosts) >= 2 else None,
        "exploratory": len(hosts) < prereg["minHostsForEstimate"],
    }


def score(key: dict, set_name: str, submission: dict, prereg: dict) -> dict[str, Any]:
    kset = key["sets"][set_name]
    preds = {p["pairId"]: p for p in submission["predictions"]}
    rows = []
    for kp in kset["pairs"]:
        p = preds[kp["id"]]
        rows.append({
            **kp, "truth": kp["sameHost"], "pred": p["sameHost"],
            "confidence": p.get("confidence"), "finer": p.get("finerLabel"),
        })

    result: dict[str, Any] = {"set": set_name, "overall": summarize(rows, prereg)}

    by_cond: dict[str, list[dict]] = {}
    for r in rows:
        by_cond.setdefault(r["condition"], []).append(r)
    result["byCondition"] = {k: summarize(v, prereg, i + 1) for i, (k, v) in enumerate(sorted(by_cond.items()))}

    by_label: dict[str, list[dict]] = {}
    for r in rows:
        by_label.setdefault(r["label"], []).append(r)
    result["byTrueLabel"] = {
        k: {"n": len(v), "predictedSameHost": sum(1 for r in v if r["pred"])} for k, v in sorted(by_label.items())
    }

    finer = [r for r in rows if r["finer"]]
    if finer:
        matrix = {t: {p: 0 for p in LABELS} for t in LABELS}
        for r in finer:
            matrix[r["label"]][r["finer"]] += 1
        result["finerConfusion"] = {"n": len(finer), "matrix": matrix}

    result["calibration"] = calibration(rows)

    subgroups: dict[str, dict] = {}
    for attr in prereg["subgroups"]:
        groups: dict[str, list[dict]] = {}
        for r in rows:
            groups.setdefault(r["subgroups"].get(attr, "unknown"), []).append(r)
        subgroups[attr] = {}
        for val, rs in sorted(groups.items()):
            n_hosts = len({h for r in rs for h in (r["hostA"], r["hostB"])})
            if n_hosts < prereg["subgroupMinHosts"]:
                subgroups[attr][val] = {"suppressed": True, "reason": f"fewer than {prereg['subgroupMinHosts']} hosts", "nPairs": len(rs)}
            else:
                s = summarize(rs, prereg, 1000)
                s.pop("ci")  # subgroup intervals are not preregistered
                subgroups[attr][val] = s
    result["subgroups"] = subgroups
    result["successCriteria"] = [check_criterion(c, set_name, result) for c in prereg["successCriteria"] if c["set"] == set_name]
    return result


def check_criterion(c: dict, set_name: str, result: dict) -> dict[str, Any]:
    block = result["overall"] if c["condition"] == "all" else result["byCondition"].get(c["condition"])
    value = block["metrics"].get(c["metric"]) if block else None
    ok = None
    if value is not None:
        ok = value >= c["value"] if c["comparator"] == ">=" else value <= c["value"]
    return {**c, "observed": value, "met": ok, "exploratory": block["exploratory"] if block else None}
