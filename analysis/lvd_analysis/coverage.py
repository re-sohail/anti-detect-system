"""Instrument coverage and stability (plan Phase 4 items 28–29, brief §8).

Coverage: for each field and environment kind, how often a value was obtained, and why not.
Stability: for repeat visits of the same guest unit, how often each field kept its value.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from .common import family_of, obs_key


def coverage(merged: dict) -> dict[str, Any]:
    cov: dict[str, dict[str, Counter]] = defaultdict(lambda: defaultdict(Counter))
    for v in merged["visits"]:
        kind = v["truth"]["environmentKind"] or "unknown"
        for fid, o in v["observations"].items():
            cov[fid][kind]["ok" if o.get("status") == "ok" else f"absent:{o.get('reason')}"] += 1
    fields = {}
    for fid in sorted(cov):
        fields[fid] = {
            "family": family_of(fid),
            "byEnvironment": {k: {"n": sum(c.values()), "okRate": c["ok"] / sum(c.values()), "outcomes": dict(c)} for k, c in sorted(cov[fid].items())},
        }
    return {"fields": fields}


def stability(merged: dict) -> dict[str, Any]:
    by_guest: dict[str, list[dict]] = defaultdict(list)
    for v in sorted(merged["visits"], key=lambda x: x["receivedAt"]):
        by_guest[v["truth"]["guest"]].append(v)
    same: Counter = Counter()
    total: Counter = Counter()
    for visits in by_guest.values():
        for a, b in zip(visits, visits[1:]):
            for fid in set(a["observations"]) | set(b["observations"]):
                total[fid] += 1
                if obs_key(a["observations"].get(fid)) == obs_key(b["observations"].get(fid)):
                    same[fid] += 1
    return {"fields": {f: {"consecutivePairs": total[f], "unchangedRate": same[f] / total[f]} for f in sorted(total)},
            "guestsWithRepeats": sum(1 for v in by_guest.values() if len(v) > 1)}


def markdown(cov: dict, stab: dict) -> str:
    envs = sorted({e for f in cov["fields"].values() for e in f["byEnvironment"]})
    lines = ["# Instrument coverage and stability", "", "Values are the share of visits with an observed value. Absences carry reason codes.", "",
             "| Field | Family | " + " | ".join(envs) + " | Unchanged across repeat visits |",
             "|---|---|" + "---|" * len(envs) + "---|"]
    for fid, f in cov["fields"].items():
        cells = []
        for e in envs:
            b = f["byEnvironment"].get(e)
            if not b:
                cells.append("—")
                continue
            reasons = ", ".join(f"{k.split(':', 1)[1]}×{n}" for k, n in b["outcomes"].items() if k != "ok")
            cells.append(f"{b['okRate']:.0%}" + (f" ({reasons})" if reasons else ""))
        st = stab["fields"].get(fid)
        lines.append(f"| `{fid}` | {f['family']} | " + " | ".join(cells) + f" | {st['unchangedRate']:.0%} of {st['consecutivePairs']}" if st else f"| `{fid}` | {f['family']} | " + " | ".join(cells) + " | — |")
    return "\n".join(lines) + "\n"
