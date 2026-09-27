"""Join the collector's raw export with every host's ground-truth file (supervisor only).

Output is a single "merged" file: one record per visit with its hidden labels. It contains
ground truth and must never be given to the detection team.
"""
from __future__ import annotations

from typing import Any

from .common import load_json, sha256_file, now_iso

GROUND_TRUTH_SCHEMA = "lvd-ground-truth/1"


def physical_host(gt_host: str, env: dict | None) -> str:
    """Which physical computer produced the visit (the unit for host-level statistics)."""
    kind = (env or {}).get("kind")
    if kind == "physical-control":
        code = env.get("participantCode") or env.get("label")
        return f"control:{code}"
    if kind == "device-cloud":
        return f"device-cloud:{env.get('label')}"
    return gt_host


def guest_unit(run: dict, host: str) -> str:
    """The 'guest' unit: a VM condition, a browser profile, or the control machine itself."""
    env = run.get("environment") or {}
    kind = env.get("kind")
    if kind == "managed-guest":
        return f"{host}/guest:{run['guestId']}#c{run.get('guestCondition')}"
    if kind in ("physical-control", "device-cloud"):
        return f"{host}/self"
    return f"{host}/{kind}:{env.get('label')}"


def merge(collector_path: str, gt_paths: list[str], include_statuses: tuple[str, ...] = ("complete",)) -> dict[str, Any]:
    collector = load_json(collector_path)
    runs_by_token: dict[str, dict] = {}
    hosts: dict[str, dict] = {}
    for p in gt_paths:
        gt = load_json(p)
        if gt.get("schema") != GROUND_TRUTH_SCHEMA:
            raise ValueError(f"{p}: not a ground-truth file ({gt.get('schema')})")
        hosts[gt["hostId"]] = gt["host"]
        for r in gt["runs"]:
            if r["runToken"] in runs_by_token:
                raise ValueError(f"run token {r['runToken']} appears in two ground-truth files")
            runs_by_token[r["runToken"]] = {**r, "_gtHost": gt["hostId"]}

    reports: dict[str, list[dict]] = {}
    for gr in collector.get("guestReports", []):
        reports.setdefault(gr["run_token"], []).append(gr["report_json"])

    visits, excluded = [], []
    for v in collector["visits"]:
        run = runs_by_token.get(v["run_token"])
        if run is None:
            excluded.append({"visitId": v["visit_id"], "reason": "run token not in any ground-truth file"})
            continue
        if run["status"] not in include_statuses:
            excluded.append({"visitId": v["visit_id"], "reason": f"run status {run['status']}: {run.get('statusReason')}"})
            continue
        if not run.get("manifestIntact", False):
            excluded.append({"visitId": v["visit_id"], "reason": "run manifest failed integrity check"})
            continue
        host = physical_host(run["_gtHost"], run.get("environment"))
        env = run.get("environment") or {}
        visits.append({
            "visitId": v["visit_id"],
            "runToken": v["run_token"],
            "receivedAt": v["received_at"],
            "instrumentVersion": v["instrument_version"],
            "clockOffsetMs": v["clock_offset_ms"],
            "peerIp": v["peer_ip"],
            "headers": v["server_json"].get("headers", {}),
            "observations": v["payload_json"]["observations"],
            "guestReport": (reports.get(v["run_token"]) or [None])[-1],
            "truth": {
                "host": host,
                "guest": guest_unit(run, host),
                "runId": run["runId"],
                "treatment": run["treatment"],
                "environmentKind": env.get("kind"),
                "environmentLabel": env.get("label"),
                "product": (env.get("product") or {}).get("name"),
                "routeId": run.get("routeId"),
                "exitKind": run.get("exitKind"),
                "guestOs": (run.get("preset") or {}).get("guestOs"),
                "hostOs": hosts.get(run["_gtHost"], {}).get("os"),
            },
        })
    return {
        "schema": "lvd-merged/1",
        "createdAt": now_iso(),
        "inputs": {"collector": sha256_file(collector_path), "groundTruth": {p: sha256_file(p) for p in gt_paths}},
        "includeStatuses": list(include_statuses),
        "visits": visits,
        "excluded": excluded,
        "counts": counts(visits),
    }


def counts(visits: list[dict]) -> dict[str, Any]:
    """Brief §16: report hosts, guests per host, visits per guest, builds and days separately."""
    hosts: dict[str, set] = {}
    per_guest: dict[str, int] = {}
    builds, days = set(), set()
    for v in visits:
        t = v["truth"]
        hosts.setdefault(t["host"], set()).add(t["guest"])
        per_guest[t["guest"]] = per_guest.get(t["guest"], 0) + 1
        ua = (v["observations"].get("nav.userAgent") or {}).get("value") or ""
        builds.add(ua.split("Chrome/")[1].split(" ")[0] if "Chrome/" in ua else "unknown")
        days.add(v["receivedAt"][:10])
    return {
        "physicalHosts": len(hosts),
        "guests": len(per_guest),
        "guestsPerHost": {h: len(g) for h, g in sorted(hosts.items())},
        "visits": len(visits),
        "visitsPerGuest": dict(sorted(per_guest.items())),
        "browserBuilds": sorted(builds),
        "collectionDays": sorted(days),
    }
