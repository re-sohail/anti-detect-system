"""Preregistration (brief §9, §16): decided and hashed BEFORE the held-out data is seen.

The blinding step records the preregistration's SHA-256 in the supervisor key, and scoring
refuses to run if the preregistration file changed afterwards.
"""
from __future__ import annotations

import secrets
from typing import Any

from .common import now_iso

ESTIMANDS = ("pairwise-host-linking-recall", "different-host-fpr", "multiclass")


def template(author: str, estimand: str = "pairwise-host-linking-recall") -> dict[str, Any]:
    if estimand not in ESTIMANDS:
        raise ValueError(f"estimand must be one of {ESTIMANDS}")
    return {
        "schema": "lvd-prereg/1",
        "createdAt": now_iso(),
        "author": author,
        "estimand": estimand,
        "positiveClass": "same-host",
        "successCriteria": [
            {"set": "eval-host", "condition": "all", "metric": "recall", "comparator": ">=", "value": 0.8},
            {"set": "eval-host", "condition": "all", "metric": "fpr", "comparator": "<=", "value": 0.05},
        ],
        "splits": {"heldOutHost": {"evalHostFraction": 0.5}, "heldOutTime": {"cutoff": None}},
        "pairs": {"negativesPerPositive": 1.0, "maxPairsPerGuestPair": 20},
        "bootstrap": {"method": "physical-host cluster bootstrap, percentile interval", "repetitions": 2000, "level": 0.95},
        "minHostsForEstimate": 5,
        "subgroupMinHosts": 3,
        "subgroups": ["guestOs", "hostOs", "browserMajor", "virtualVsPhysical", "egress"],
        "visibleHeaders": ["user-agent", "accept-language", "accept", "accept-encoding", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "dnt", "sec-gpc"],
        "exclusions": [
            "Runs whose status is not 'complete' (interrupted, invalid) are excluded before blinding.",
            "Runs whose manifest failed its integrity check are excluded.",
            "storage.testToken is a planted study artifact and is removed from the blinded set.",
        ],
        "seed": secrets.randbelow(2**31),
        "notes": "Edit thresholds and splits before running `blind`. After that, this file must not change.",
    }


def validate(p: dict[str, Any]) -> None:
    if p.get("schema") != "lvd-prereg/1":
        raise ValueError("not a preregistration file")
    if p["estimand"] not in ESTIMANDS:
        raise ValueError("unknown estimand")
    if p["positiveClass"] != "same-host":
        raise ValueError("only 'same-host' is supported as the positive class")
    f = p["splits"]["heldOutHost"]["evalHostFraction"]
    if not 0 < f < 1:
        raise ValueError("evalHostFraction must be in (0, 1)")
    if p["bootstrap"]["repetitions"] < 200:
        raise ValueError("use at least 200 bootstrap repetitions")
