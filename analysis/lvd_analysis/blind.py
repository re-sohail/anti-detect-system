"""Build the blinded release (brief §9, §16, §17 R5).

Outputs:
  blue/dev.json                    visits + labelled pairs for detector development
  supervisor/eval-host.json        held-out hosts: visits + unlabelled pairs (released later)
  supervisor/eval-time.json        held-out time window (only if a cutoff is preregistered)
  supervisor/key.json              hidden labels, conditions, pseudonym key, prereg hash

The blue team sees only what the test service observed, under random identifiers, in random
order. Internal IDs, labels, preset names, guest reports, times and raw IPs are removed.
"""
from __future__ import annotations

import hashlib
import hmac
import itertools
import random
from typing import Any

from .common import LABELS, canonical, load_json, now_iso, sha256_file, sha256_text, write_json
from .prereg import validate

REMOVED_FIELDS = {"storage.testToken"}


def browser_major(v: dict) -> str:
    ua = (v["observations"].get("nav.userAgent") or {}).get("value") or ""
    return ua.split("Chrome/")[1].split(".")[0] if "Chrome/" in ua else "unknown"


def pair_label(a: dict, b: dict) -> str:
    if a["truth"]["guest"] == b["truth"]["guest"]:
        return "same-guest"
    if a["truth"]["host"] == b["truth"]["host"]:
        return "different-guest-same-host"
    return "different-host"


def condition_of(a: dict, b: dict) -> str:
    kinds = sorted([a["truth"]["environmentKind"] or "?", b["truth"]["environmentKind"] or "?"])
    return f"{kinds[0]}|{kinds[1]}"


def subgroup_attrs(v: dict) -> dict[str, str]:
    t = v["truth"]
    virtual = "virtual" if t["environmentKind"] == "managed-guest" else "physical" if t["environmentKind"] in ("host-profile", "physical-control") else "other"
    return {
        "guestOs": t.get("guestOs") or "none",
        "hostOs": t.get("hostOs") or "unknown",
        "browserMajor": browser_major(v),
        "virtualVsPhysical": virtual,
        "egress": t.get("exitKind") or "unknown",
    }


def visible(v: dict, new_id: str, hmac_key: bytes, headers_allowed: list[str]) -> dict[str, Any]:
    ip = v.get("peerIp")
    return {
        "id": new_id,
        "instrumentVersion": v["instrumentVersion"],
        "observations": {k: o for k, o in sorted(v["observations"].items()) if k not in REMOVED_FIELDS},
        "headers": {h: v["headers"][h] for h in headers_allowed if h in v["headers"]},
        # Equality of network endpoints is observable; the address itself is not released.
        "ipPseudonym": hmac.new(hmac_key, ip.encode(), hashlib.sha256).hexdigest()[:16] if ip else None,
        "clockOffsetS": round(v["clockOffsetMs"] / 1000),
    }


def split_hosts(hosts: list[str], fraction: float, rng: random.Random) -> tuple[set[str], set[str]]:
    hs = sorted(hosts)
    rng.shuffle(hs)
    n_eval = max(1, round(len(hs) * fraction)) if len(hs) >= 2 else 0
    n_eval = min(n_eval, len(hs) - 1) if len(hs) >= 2 else 0
    return set(hs[n_eval:]), set(hs[:n_eval])


def build_pairs(visits: list[dict], cfg: dict, rng: random.Random) -> list[tuple[dict, dict, str]]:
    """All within-set pairs, capped per guest pair, then negatives sampled to the preregistered ratio."""
    by_guest_pair: dict[tuple[str, str], list[tuple[dict, dict]]] = {}
    for a, b in itertools.combinations(visits, 2):
        key = tuple(sorted((a["truth"]["guest"], b["truth"]["guest"])))
        by_guest_pair.setdefault(key, []).append((a, b))
    cap = cfg["maxPairsPerGuestPair"]
    pos, neg = [], []
    for key in sorted(by_guest_pair):
        items = by_guest_pair[key]
        rng.shuffle(items)
        for a, b in items[:cap]:
            label = pair_label(a, b)
            (neg if label == "different-host" else pos).append((a, b, label))
    want_neg = round(len(pos) * cfg["negativesPerPositive"])
    if len(neg) > want_neg:
        neg = rng.sample(neg, want_neg)
    pairs = pos + neg
    rng.shuffle(pairs)
    return pairs


def blind(merged_path: str, prereg_path: str, out_dir: str) -> dict[str, Any]:
    merged = load_json(merged_path)
    prereg = load_json(prereg_path)
    validate(prereg)
    rng = random.Random(prereg["seed"])
    hmac_key = rng.getrandbits(256).to_bytes(32, "big")
    visits = merged["visits"]

    dev_hosts, eval_hosts = split_hosts(sorted({v["truth"]["host"] for v in visits}), prereg["splits"]["heldOutHost"]["evalHostFraction"], rng)
    cutoff = prereg["splits"]["heldOutTime"]["cutoff"]
    sets: dict[str, list[dict]] = {"dev": [], "eval-host": [], "eval-time": []}
    for v in visits:
        if v["truth"]["host"] in eval_hosts:
            sets["eval-host"].append(v)
        elif cutoff and v["receivedAt"] >= cutoff:
            sets["eval-time"].append(v)
        else:
            sets["dev"].append(v)

    used_ids: set[str] = set()

    def rid(prefix: str) -> str:
        while True:
            x = f"{prefix}-{rng.getrandbits(64):016x}"
            if x not in used_ids:
                used_ids.add(x)
                return x

    key: dict[str, Any] = {
        "schema": "lvd-release-key/1",
        "createdAt": now_iso(),
        "preregSha256": sha256_file(prereg_path),
        "mergedSha256": sha256_file(merged_path),
        "pseudonymKeyHex": hmac_key.hex(),
        "split": {"devHosts": sorted(dev_hosts), "evalHosts": sorted(eval_hosts), "timeCutoff": cutoff},
        "sets": {},
        "releasedAt": {},
    }
    outputs: dict[str, str] = {}
    for name, vs in sets.items():
        if name == "eval-time" and not cutoff:
            continue
        rng.shuffle(vs)
        idmap = {v["visitId"]: rid("v") for v in vs}
        pairs = build_pairs(vs, prereg["pairs"], rng)
        vis = [visible(v, idmap[v["visitId"]], hmac_key, prereg["visibleHeaders"]) for v in vs]
        vis.sort(key=lambda x: x["id"])  # order carries no information
        pair_rows, key_pairs = [], []
        for a, b, label in pairs:
            pid = rid("p")
            row = {"id": pid, "a": idmap[a["visitId"]], "b": idmap[b["visitId"]]}
            if name == "dev":
                row |= {"label": label, "sameHost": label != "different-host"}
            pair_rows.append(row)
            sa, sb = subgroup_attrs(a), subgroup_attrs(b)
            key_pairs.append({
                "id": pid, "label": label, "sameHost": label != "different-host",
                "hostA": a["truth"]["host"], "hostB": b["truth"]["host"],
                "condition": condition_of(a, b),
                "treatments": sorted({a["truth"]["treatment"], b["truth"]["treatment"]}),
                "subgroups": {k: sa[k] if sa[k] == sb[k] else "mixed" for k in sa},
            })
        pair_rows.sort(key=lambda x: x["id"])
        doc = {"schema": "lvd-blinded/1", "set": name, "instrumentVersions": sorted({x["instrumentVersion"] for x in vis}), "visits": vis, "pairs": pair_rows}
        path = f"{out_dir}/blue/dev.json" if name == "dev" else f"{out_dir}/supervisor/{name}.json"
        outputs[name] = write_json(path, doc)
        n_pos = sum(1 for p in key_pairs if p["sameHost"])
        key["sets"][name] = {
            "file": path, "sha256": outputs[name], "pairs": key_pairs, "visitHosts": {idmap[v["visitId"]]: v["truth"]["host"] for v in vs},
            "prevalence": n_pos / len(key_pairs) if key_pairs else None, "nPairs": len(key_pairs),
            "nHosts": len({v["truth"]["host"] for v in vs}),
        }
    write_json(f"{out_dir}/supervisor/key.json", key)
    return {"outputs": outputs, "split": key["split"], "sets": {k: {kk: vv for kk, vv in s.items() if kk in ("nPairs", "nHosts", "prevalence")} for k, s in key["sets"].items()}}


def release(out_dir: str, set_name: str) -> str:
    """Copy a held-out set to the blue team's folder and record when (after detectors are frozen)."""
    key_path = f"{out_dir}/supervisor/key.json"
    key = load_json(key_path)
    if set_name not in key["sets"] or set_name == "dev":
        raise ValueError(f"unknown held-out set {set_name}")
    if set_name in key["releasedAt"]:
        raise ValueError(f"{set_name} was already released at {key['releasedAt'][set_name]}")
    src = key["sets"][set_name]["file"]
    if sha256_file(src) != key["sets"][set_name]["sha256"]:
        raise ValueError(f"{src} changed since blinding")
    doc = load_json(src)
    write_json(f"{out_dir}/blue/{set_name}.json", doc)
    key["releasedAt"][set_name] = now_iso()
    write_json(key_path, key, exclusive=False)
    return key["releasedAt"][set_name]


def fingerprint(obj: Any) -> str:
    return sha256_text(canonical(obj))
