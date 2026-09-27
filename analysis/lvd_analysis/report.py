"""Markdown rendering of scoring results for the thesis appendix."""
from __future__ import annotations

from typing import Any


def _f(x: float | None) -> str:
    return "—" if x is None else f"{x:.3f}"


def _ci(ci: dict | None, k: str) -> str:
    if not ci or ci.get(k) in (None, [None, None]):
        return ""
    lo, hi = ci[k]
    return f" [{_f(lo)}, {_f(hi)}]"


def block(title: str, s: dict) -> list[str]:
    c, m = s["confusion"], s["metrics"]
    tag = " — **exploratory** (too few hosts)" if s["exploratory"] else ""
    return [
        f"### {title}{tag}",
        "",
        f"Pairs {s['nPairs']} · physical hosts {s['nHosts']} · host types {s['hostTypes']} · prevalence {_f(m['prevalence'])}",
        "",
        "| | predicted same host | predicted different host |",
        "|---|---|---|",
        f"| **truly same host** | TP {c['tp']} | FN {c['fn']} |",
        f"| **truly different host** | FP {c['fp']} | TN {c['tn']} |",
        "",
        f"precision {_f(m['precision'])}{_ci(s['ci'], 'precision')} · recall {_f(m['recall'])}{_ci(s['ci'], 'recall')} · "
        f"FPR {_f(m['fpr'])}{_ci(s['ci'], 'fpr')} · FNR {_f(m['fnr'])}{_ci(s['ci'], 'fnr')}",
        "",
    ]


def render(result: dict[str, Any], detector: dict, receipt: dict | None, prereg: dict) -> str:
    lines = [
        f"# Scoring report — {detector.get('name')} v{detector.get('version')} on `{result['set']}`",
        "",
        f"Positive class: **{prereg['positiveClass']}**. Estimand: {prereg['estimand']}. "
        f"Intervals: {prereg['bootstrap']['method']}, {prereg['bootstrap']['repetitions']} repetitions, level {prereg['bootstrap']['level']}.",
        f"Detector frozen at {receipt['frozenAt'] if receipt else 'n/a (baseline)'}.",
        "",
        *block("All pairs", result["overall"]),
        "## By condition",
        "",
    ]
    for k, s in result["byCondition"].items():
        lines += block(k, s)
    lines += ["## By true label", "", "| label | pairs | predicted same host |", "|---|---|---|"]
    lines += [f"| {k} | {v['n']} | {v['predictedSameHost']} |" for k, v in result["byTrueLabel"].items()]
    if result.get("finerConfusion"):
        fc = result["finerConfusion"]["matrix"]
        cols = list(next(iter(fc.values())).keys())
        lines += ["", "## Finer labels (rows = truth)", "", "| | " + " | ".join(cols) + " |", "|---" * (len(cols) + 1) + "|"]
        lines += [f"| {t} | " + " | ".join(str(fc[t][c]) for c in cols) + " |" for t in fc]
    cal = result.get("calibration")
    if cal:
        lines += ["", f"## Calibration (ECE {_f(cal['ece'])}, n={cal['n']})", "", "| confidence bin | n | mean confidence | accuracy |", "|---|---|---|---|"]
        lines += [f"| {b['bin'][0]:.1f}–{b['bin'][1]:.1f} | {b['n']} | {_f(b['meanConfidence'])} | {_f(b['accuracy'])} |" for b in cal["bins"]]
    lines += ["", "## Subgroups", ""]
    for attr, groups in result["subgroups"].items():
        for val, s in groups.items():
            if s.get("suppressed"):
                lines.append(f"- {attr} = {val}: suppressed ({s['reason']}; {s['nPairs']} pairs)")
            else:
                m = s["metrics"]
                lines.append(f"- {attr} = {val}: pairs {s['nPairs']}, hosts {s['nHosts']}, recall {_f(m['recall'])}, FPR {_f(m['fpr'])}{' (exploratory)' if s['exploratory'] else ''}")
    lines += ["", "## Preregistered success criteria", ""]
    for c in result["successCriteria"]:
        verdict = "not evaluable" if c["met"] is None else ("met" if c["met"] else "NOT met")
        lines.append(f"- {c['metric']} {c['comparator']} {c['value']} on {c['condition']}: observed {_f(c['observed'])} → **{verdict}**{' (exploratory)' if c['exploratory'] else ''}")
    lines.append("")
    return "\n".join(lines)
