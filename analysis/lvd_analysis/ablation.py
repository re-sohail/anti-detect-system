"""Ablation of the documented statistical model over broad observation families (brief §10).

Reports how much each family contributed, by category only. It deliberately does not report
per-field effects, so the output is not a recipe for evading any platform.
"""
from __future__ import annotations

from typing import Any

from .baselines import run_baseline
from .common import FAMILIES
from .scoring import confusion, metrics


def ablate(dev: dict, target: dict, key_set: dict) -> dict[str, Any]:
    truth = {p["id"]: p["sameHost"] for p in key_set["pairs"]}

    def evaluate(fams: list[str]) -> dict:
        sub = run_baseline("logistic", dev, target, families=fams)
        return metrics(confusion((truth[p["pairId"]], p["sameHost"]) for p in sub["predictions"]))

    full = evaluate(FAMILIES)
    rows = {}
    for fam in FAMILIES:
        m = evaluate([f for f in FAMILIES if f != fam])
        rows[fam] = {
            "without": m,
            "deltaRecall": None if m["recall"] is None or full["recall"] is None else m["recall"] - full["recall"],
            "deltaFpr": None if m["fpr"] is None or full["fpr"] is None else m["fpr"] - full["fpr"],
        }
    return {"model": "baseline:logistic (family-level agreement features)", "full": full, "withoutFamily": rows}
