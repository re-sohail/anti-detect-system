"""Leakage audit of the blue team's files (brief §9, §17 R5).

Fails if any internal identifier, label, raw address or planted token can be found in the
blinded files, or if file order correlates with physical host.
"""
from __future__ import annotations

import glob
import json
import re
from typing import Any

from .common import load_json


def forbidden_strings(merged: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for v in merged["visits"]:
        t = v["truth"]
        for kind, s in [
            ("run token", v["runToken"]), ("original visit id", v["visitId"]), ("run id", t["runId"]),
            ("host id", t["host"]), ("guest unit", t["guest"]), ("environment label", t.get("environmentLabel")),
            ("raw peer ip", v.get("peerIp")),
        ]:
            if s and len(str(s)) >= 6:
                out[str(s)] = kind
        tok = (v["observations"].get("storage.testToken") or {}).get("value") or {}
        for s in (tok.get("existingToken"), tok.get("placedToken")):
            if s:
                out[s] = "planted study token"
        for part in re.split(r"[/#:]", t["guest"]):
            if len(part) >= 8 and part.startswith(("guest_", "host_")):
                out[part] = "guest/host id fragment"
    return out


def audit(merged_path: str, blue_dir: str) -> dict[str, Any]:
    merged = load_json(merged_path)
    forbidden = forbidden_strings(merged)
    by_visit = {v["visitId"]: v for v in merged["visits"]}
    findings: list[dict] = []
    files = sorted(glob.glob(f"{blue_dir}/*.json"))
    for f in files:
        text = open(f, encoding="utf-8").read()
        for s, kind in forbidden.items():
            if s in text:
                findings.append({"file": f, "problem": f"contains {kind}", "value": s[:12] + "…"})
        doc = json.loads(text)
        if any("storage.testToken" in v["observations"] for v in doc.get("visits", [])):
            findings.append({"file": f, "problem": "planted storage token field present"})
        if doc.get("set") != "dev" and any("label" in p or "sameHost" in p for p in doc.get("pairs", [])):
            findings.append({"file": f, "problem": "held-out pairs carry labels"})
        ids = [v["id"] for v in doc.get("visits", [])]
        if ids != sorted(ids):
            findings.append({"file": f, "problem": "visits are not in identifier order (order may encode collection)"})
    return {"filesChecked": files, "forbiddenStringsChecked": len(forbidden), "pass": not findings, "findings": findings,
            "note": "Order check: files must be sorted by random identifier; collection order is never preserved.",
            "visitsInMerged": len(by_visit)}
