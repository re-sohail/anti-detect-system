"""Freezing (brief §9): a detector's rules, thresholds and predictions are hashed and
timestamped before the held-out set is released. Scoring checks the receipt."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .common import load_json, now_iso, sha256_file, sha256_text

VALID_FINER = {"same-guest", "different-guest-same-host", "different-host"}


def hash_tree(path: str) -> str:
    """Hash of every file under a detector directory (names + contents)."""
    p = Path(path)
    if p.is_file():
        return sha256_file(p)
    parts = []
    for f in sorted(x for x in p.rglob("*") if x.is_file() and "__pycache__" not in x.parts):
        parts.append(f"{f.relative_to(p)}:{sha256_file(f)}")
    return sha256_text("\n".join(parts))


def validate_submission(sub: dict, pair_ids: set[str] | None = None) -> list[str]:
    errs = []
    if sub.get("schema") != "lvd-detector-submission/1":
        errs.append("schema must be lvd-detector-submission/1")
    seen = set()
    for i, p in enumerate(sub.get("predictions", [])):
        if not isinstance(p.get("sameHost"), bool):
            errs.append(f"prediction {i}: sameHost must be boolean")
        c = p.get("confidence")
        if c is not None and not (isinstance(c, (int, float)) and 0 <= c <= 1):
            errs.append(f"prediction {i}: confidence must be in [0,1]")
        if p.get("finerLabel") is not None and p["finerLabel"] not in VALID_FINER:
            errs.append(f"prediction {i}: unknown finerLabel")
        if p.get("pairId") in seen:
            errs.append(f"duplicate pairId {p.get('pairId')}")
        seen.add(p.get("pairId"))
    if pair_ids is not None:
        missing, extra = pair_ids - seen, seen - pair_ids
        if missing:
            errs.append(f"{len(missing)} pairs have no prediction")
        if extra:
            errs.append(f"{len(extra)} predictions refer to unknown pairs")
    return errs


def freeze(detector_path: str, rules_or_thresholds: str | None, team: str) -> dict[str, Any]:
    """Receipt for the detector BEFORE seeing the held-out set: code + configuration hash."""
    return {
        "schema": "lvd-freeze-receipt/1",
        "frozenAt": now_iso(),
        "team": team,
        "detectorPath": os.path.basename(detector_path.rstrip("/")),
        "detectorSha256": hash_tree(detector_path),
        "configSha256": sha256_file(rules_or_thresholds) if rules_or_thresholds else None,
    }


def check_receipt(receipt: dict, detector_path: str | None, released_at: str | None) -> list[str]:
    errs = []
    if receipt.get("schema") != "lvd-freeze-receipt/1":
        errs.append("not a freeze receipt")
    if released_at is None:
        errs.append("held-out set has not been released yet")
    elif receipt["frozenAt"] >= released_at:
        errs.append(f"detector frozen at {receipt['frozenAt']}, after the held-out release at {released_at}")
    if detector_path and hash_tree(detector_path) != receipt["detectorSha256"]:
        errs.append("detector code changed after freezing")
    return errs


def load_receipt(path: str) -> dict:
    return load_json(path)
