"""Blue-team detector template.

Copy this file, implement `predict`, then:
  1. develop only on blue/dev.json (labelled pairs);
  2. `python -m lvd_analysis freeze --detector <your dir> --team <name>` BEFORE the held-out release;
  3. after release: `python your_detector.py blue/eval-host.json > predictions.json`.

The submission must predict every pair: sameHost (bool), confidence (0..1), optional
finerLabel ('same-guest' | 'different-guest-same-host' | 'different-host') and the evidence
categories used (network, headers, browser-config, display, rendering, temporal, location).
Recognising virtualization is not the same as linking two guests to one host; report them separately.
"""
from __future__ import annotations

import json
import sys

DETECTOR = {"name": "example-detector", "version": "0.1"}


def predict(a: dict, b: dict) -> dict:
    same_tz = a["observations"].get("intl.timeZone") == b["observations"].get("intl.timeZone")
    same_ip = a.get("ipPseudonym") is not None and a.get("ipPseudonym") == b.get("ipPseudonym")
    same = same_ip and same_tz
    return {"sameHost": same, "confidence": 0.6, "evidenceCategories": ["network", "browser-config"]}


def main(path: str) -> None:
    doc = json.load(open(path, encoding="utf-8"))
    visits = {v["id"]: v for v in doc["visits"]}
    preds = [{"pairId": p["id"], **predict(visits[p["a"]], visits[p["b"]])} for p in doc["pairs"]]
    json.dump({"schema": "lvd-detector-submission/1", "detector": DETECTOR, "set": doc["set"], "predictions": preds}, sys.stdout, indent=2)


if __name__ == "__main__":
    main(sys.argv[1])
