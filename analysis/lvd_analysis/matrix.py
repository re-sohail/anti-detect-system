"""Four-axis environment matrix (brief §15, plan Phase 7).

Each cell is derived from recorded observations and cites the runs it came from. Missing
evidence is reported as "not measured", never as a favourable result. No product is ranked.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any


def _group_key(v: dict) -> str:
    t = v["truth"]
    return f"{t['environmentKind']}: {t['product']}" if t.get("product") else f"{t['environmentKind']}"


def build(merged: dict) -> dict[str, Any]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for v in merged["visits"]:
        groups[_group_key(v)].append(v)
    rows = {}
    for name, vs in sorted(groups.items()):
        units = defaultdict(list)
        for v in vs:
            units[v["truth"]["guest"]].append(v)
        # Storage separation (R1): for every planted token, did later visits of the SAME unit read it
        # back (retained) or not (lost), and did any OTHER unit ever see it (crossing)?
        def tok(v: dict) -> dict:
            return ((v["observations"].get("storage.testToken") or {}).get("value") or {})
        planted, retained, lost, crossings = 0, 0, 0, 0
        for u, uvs in units.items():
            uvs = sorted(uvs, key=lambda x: x["receivedAt"])
            for i, v in enumerate(uvs):
                p = tok(v).get("placedToken")
                if not p:
                    continue
                planted += 1
                later = uvs[i + 1:]
                if later:
                    if any(tok(x).get("existingToken") == p for x in later):
                        retained += 1
                    else:
                        lost += 1
                crossings += sum(1 for ou, ouvs in units.items() if ou != u for x in ouvs if tok(x).get("existingToken") == p)
        storage = ("not measured (no token planted)" if planted == 0 else
                   f"{planted} planted: {retained} retained, {lost} lost after restart, {planted - retained - lost} not re-read; "
                   f"{crossings} cross-unit sightings")

        # OS separation: guest-reported OS vs host OS.
        pairs = {(v["guestReport"] or {}).get("os"): v["truth"].get("hostOs") for v in vs if v.get("guestReport")}
        os_sep = "not measured (no guest reports)" if not pairs else "; ".join(
            f"browser OS {g} on host {h}" + (" (different OS)" if g and h and g != {"darwin": "macos"}.get(h, h) else " (same OS)") for g, h in pairs.items())

        # Hardware provenance: what kind of hardware the values come from, and what the browser reported.
        kind = vs[0]["truth"]["environmentKind"]
        prov = {"managed-guest": "virtual (guest on shared physical host)", "host-profile": "physical (host)",
                "physical-control": "physical (separate computer)", "vendor-product": "vendor-reported / host", "device-cloud": "provider physical device"}.get(kind, "unknown")
        cores = sorted({str((v["observations"].get("nav.hardwareConcurrency") or {}).get("value")) for v in vs})

        # Network provenance: exits the server actually observed.
        ips = {v.get("peerIp") for v in vs if v.get("peerIp")}
        net = f"{len(ips)} distinct server-observed exit(s) across {len(units)} unit(s)" if ips else "not measured"

        rows[name] = {
            "storageSeparation": storage,
            "osSeparation": os_sep,
            "hardwareProvenance": f"{prov}; browser-reported logical CPUs: {', '.join(cores)}",
            "networkProvenance": net,
            "units": len(units),
            "visits": len(vs),
            "evidenceRuns": sorted({v["truth"]["runId"] for v in vs}),
        }
    return {"rows": rows, "note": "Derived from recorded observations; claims not observed are 'not measured'. Products are not ranked."}


def markdown(m: dict) -> str:
    lines = ["# Environment matrix (four axes, brief §15)", "", m["note"], "",
             "| Environment | Storage separation | OS separation | Hardware provenance | Network provenance | Units / visits |",
             "|---|---|---|---|---|---|"]
    for name, r in m["rows"].items():
        lines.append(f"| {name} | {r['storageSeparation']} | {r['osSeparation']} | {r['hardwareProvenance']} | {r['networkProvenance']} | {r['units']} / {r['visits']} |")
    lines += ["", "Evidence runs per row are listed in the JSON output."]
    return "\n".join(lines) + "\n"
