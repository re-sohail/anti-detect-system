"""Pairwise features grouped by observation family (brief §10 ablations)."""
from __future__ import annotations

from .common import FAMILIES, family_of


def _same(oa: dict | None, ob: dict | None) -> float | None:
    if oa is None or ob is None:
        return None
    if oa.get("status") == "ok" and ob.get("status") == "ok":
        return 1.0 if oa.get("value") == ob.get("value") else 0.0
    if oa.get("status") == "absent" and ob.get("status") == "absent":
        return 1.0 if oa.get("reason") == ob.get("reason") else 0.0
    return 0.0  # one present, one absent


def pair_features(a: dict, b: dict) -> dict[str, float]:
    """Mean agreement per family; 0.5 when a family has nothing comparable."""
    sums: dict[str, list[float]] = {f: [] for f in FAMILIES}
    for fid in set(a["observations"]) | set(b["observations"]):
        s = _same(a["observations"].get(fid), b["observations"].get(fid))
        if s is not None:
            sums[family_of(fid)].append(s)
    for h in set(a["headers"]) | set(b["headers"]):
        sums["headers"].append(1.0 if a["headers"].get(h) == b["headers"].get(h) else 0.0)
    if a.get("ipPseudonym") and b.get("ipPseudonym"):
        sums["network"].append(1.0 if a["ipPseudonym"] == b["ipPseudonym"] else 0.0)
    sums["temporal"].append(1.0 if abs(a["clockOffsetS"] - b["clockOffsetS"]) <= 1 else 0.0)
    return {f: (sum(v) / len(v) if v else 0.5) for f, v in sums.items()}
