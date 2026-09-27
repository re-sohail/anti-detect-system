"""Command line: python -m lvd_analysis <command> ...

Supervisor workflow (see analysis/README.md):
  merge      collector export + ground-truth files  -> merged.json      (supervisor only)
  coverage   merged.json                            -> coverage.md/json
  prereg     write a preregistration template       -> prereg.json      (edit, then never change)
  blind      merged + prereg                        -> release/blue/dev.json, release/supervisor/*
  leakage    audit release/blue against merged      (must pass before handing files over)
  freeze     blue team hashes its detector          -> receipt.json     (before release)
  release    copy a held-out set to release/blue and timestamp it
  baselines  run the four baselines on a released set
  score      score a submission against the hidden key
  ablation   family ablation of the statistical model
  schedule   randomised collection order for the study protocol
  matrix     four-axis environment matrix (competitor protocol)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .ablation import ablate
from .baselines import run_baseline
from .blind import blind, release
from .common import load_json, sha256_file, write_json
from .coverage import coverage, markdown as coverage_md, stability
from .freeze import check_receipt, freeze, validate_submission
from .leakage import audit
from .merge import merge
from .prereg import template, validate
from .report import render
from .schedule import make_schedule, to_csv
from .matrix import build as build_matrix, markdown as matrix_md
from .scoring import score


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="lvd_analysis", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", action="version", version=__version__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("merge")
    s.add_argument("--collector", required=True)
    s.add_argument("--ground-truth", nargs="+", required=True)
    s.add_argument("--out", required=True)
    s.add_argument("--include-status", nargs="+", default=["complete"])

    s = sub.add_parser("coverage")
    s.add_argument("--merged", required=True)
    s.add_argument("--out", required=True, help="output prefix (writes .md and .json)")

    s = sub.add_parser("prereg")
    s.add_argument("--author", required=True)
    s.add_argument("--estimand", default="pairwise-host-linking-recall")
    s.add_argument("--out", required=True)

    s = sub.add_parser("blind")
    s.add_argument("--merged", required=True)
    s.add_argument("--prereg", required=True)
    s.add_argument("--out-dir", required=True)

    s = sub.add_parser("leakage")
    s.add_argument("--merged", required=True)
    s.add_argument("--blue-dir", required=True)

    s = sub.add_parser("freeze")
    s.add_argument("--detector", required=True, help="detector file or directory")
    s.add_argument("--config", help="rules/thresholds file, if separate")
    s.add_argument("--team", required=True)
    s.add_argument("--out", required=True)

    s = sub.add_parser("release")
    s.add_argument("--out-dir", required=True)
    s.add_argument("--set", required=True, choices=["eval-host", "eval-time"])

    s = sub.add_parser("baselines")
    s.add_argument("--out-dir", required=True)
    s.add_argument("--set", required=True, choices=["eval-host", "eval-time"])

    s = sub.add_parser("score")
    s.add_argument("--out-dir", required=True)
    s.add_argument("--set", required=True, choices=["eval-host", "eval-time"])
    s.add_argument("--prereg", required=True)
    s.add_argument("--predictions", required=True)
    s.add_argument("--receipt", help="freeze receipt (required unless the submission is a baseline)")
    s.add_argument("--detector", help="detector path, to verify it is unchanged since freezing")

    s = sub.add_parser("ablation")
    s.add_argument("--out-dir", required=True)
    s.add_argument("--set", required=True, choices=["eval-host", "eval-time"])

    s = sub.add_parser("schedule")
    s.add_argument("--environments", required=True, help='JSON file: [{"id","treatment","host"}]')
    s.add_argument("--days", type=int, required=True)
    s.add_argument("--visits-per-day", type=int, default=2)
    s.add_argument("--start", required=True, help="YYYY-MM-DD")
    s.add_argument("--seed", type=int, required=True)
    s.add_argument("--out", required=True, help="output prefix (writes .json and .csv)")

    s = sub.add_parser("matrix")
    s.add_argument("--merged", required=True)
    s.add_argument("--out", required=True, help="output prefix (writes .json and .md)")

    a = ap.parse_args(argv)

    if a.cmd == "merge":
        m = merge(a.collector, a.ground_truth, tuple(a.include_status))
        write_json(a.out, m)
        print(json.dumps({"visits": len(m["visits"]), "excluded": len(m["excluded"]), "counts": m["counts"]}, indent=2))
    elif a.cmd == "coverage":
        m = load_json(a.merged)
        cov, stab = coverage(m), stability(m)
        write_json(a.out + ".json", {"coverage": cov, "stability": stab, "merged": sha256_file(a.merged)})
        Path(a.out + ".md").write_text(coverage_md(cov, stab), encoding="utf-8")
        print(f"wrote {a.out}.md and {a.out}.json")
    elif a.cmd == "prereg":
        write_json(a.out, template(a.author, a.estimand))
        print(f"wrote {a.out}. Edit thresholds/splits now; `blind` will pin its SHA-256.")
    elif a.cmd == "blind":
        print(json.dumps(blind(a.merged, a.prereg, a.out_dir), indent=2))
    elif a.cmd == "leakage":
        r = audit(a.merged, a.blue_dir)
        print(json.dumps(r, indent=2))
        return 0 if r["pass"] else 1
    elif a.cmd == "freeze":
        r = freeze(a.detector, a.config, a.team)
        write_json(a.out, r)
        print(json.dumps(r, indent=2))
    elif a.cmd == "release":
        print(f"released {a.set} at {release(a.out_dir, a.set)}")
    elif a.cmd == "baselines":
        key = load_json(f"{a.out_dir}/supervisor/key.json")
        if a.set not in key["releasedAt"]:
            print(f"error: {a.set} not released yet", file=sys.stderr)
            return 2
        dev = load_json(f"{a.out_dir}/blue/dev.json")
        target = load_json(f"{a.out_dir}/blue/{a.set}.json")
        for name in ("random", "shared-ip", "exact-profile", "logistic"):
            path = f"{a.out_dir}/baselines/{a.set}-{name}.json"
            write_json(path, run_baseline(name, dev, target))
            print(f"wrote {path}")
    elif a.cmd == "score":
        prereg = load_json(a.prereg)
        validate(prereg)
        key = load_json(f"{a.out_dir}/supervisor/key.json")
        if sha256_file(a.prereg) != key["preregSha256"]:
            print("error: preregistration changed after blinding", file=sys.stderr)
            return 2
        sub_ = load_json(a.predictions)
        errs = validate_submission(sub_, {p["id"] for p in key["sets"][a.set]["pairs"]})
        is_baseline = str(sub_.get("detector", {}).get("name", "")).startswith("baseline:")
        receipt = None
        if not is_baseline:
            if not a.receipt:
                errs.append("a freeze receipt is required for non-baseline detectors")
            else:
                receipt = load_json(a.receipt)
                errs += check_receipt(receipt, a.detector, key["releasedAt"].get(a.set))
        if errs:
            print("refused:\n  " + "\n  ".join(errs), file=sys.stderr)
            return 2
        result = score(key, a.set, sub_, prereg)
        name = str(sub_["detector"]["name"]).replace(":", "-").replace("/", "-")
        base = f"{a.out_dir}/scores/{a.set}-{name}"
        write_json(base + ".json", {"result": result, "predictionsSha256": sha256_file(a.predictions), "receipt": receipt})
        Path(base + ".md").write_text(render(result, sub_["detector"], receipt, prereg), encoding="utf-8")
        print(f"wrote {base}.md")
    elif a.cmd == "ablation":
        key = load_json(f"{a.out_dir}/supervisor/key.json")
        dev = load_json(f"{a.out_dir}/blue/dev.json")
        target = load_json(key["sets"][a.set]["file"])
        r = ablate(dev, target, key["sets"][a.set])
        write_json(f"{a.out_dir}/scores/{a.set}-ablation.json", r)
        print(json.dumps(r, indent=2))
    elif a.cmd == "schedule":
        sch = make_schedule(load_json(a.environments), a.days, a.visits_per_day, a.start, a.seed)
        write_json(a.out + ".json", sch)
        Path(a.out + ".csv").write_text(to_csv(sch), encoding="utf-8")
        print(f"wrote {len(sch['rows'])} planned visits to {a.out}.csv")
    elif a.cmd == "matrix":
        m = build_matrix(load_json(a.merged))
        write_json(a.out + ".json", {**m, "merged": sha256_file(a.merged)})
        Path(a.out + ".md").write_text(matrix_md(m), encoding="utf-8")
        print(f"wrote {a.out}.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
