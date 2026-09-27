"""Shared helpers: hashing, JSON I/O, instrument families."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Field-id prefix -> observation family (brief §10 ablation families).
FAMILY_BY_PREFIX = {
    "nav": "browser-config",
    "uach": "browser-config",
    "intl": "browser-config",
    "perm": "browser-config",
    "storage": "browser-config",
    "screen": "display",
    "render": "rendering",
    "perf": "temporal",
    "geo": "location",
}
FAMILIES = ["network", "headers", "browser-config", "display", "rendering", "temporal", "location"]

# Fields that change within a session; excluded from "exact profile" identity.
VOLATILE_FIELDS = {"screen.viewport", "perf.timerResolution", "perf.navigation", "storage.testToken", "intl.timezoneOffsetMin"}

LABELS = ("same-guest", "different-guest-same-host", "different-host")


def obs_key(o: dict | None):
    """What an observation says, without collection timing (durationMs varies every visit)."""
    if o is None:
        return None
    if o.get("status") == "ok":
        return ("ok", json.dumps(o.get("value"), sort_keys=True))
    return ("absent", o.get("reason"))


def family_of(field_id: str) -> str:
    return FAMILY_BY_PREFIX.get(field_id.split(".", 1)[0], "browser-config")


def sha256_file(path: str | os.PathLike) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def load_json(path: str | os.PathLike) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: str | os.PathLike, obj: Any, *, exclusive: bool = True) -> str:
    """Write JSON; refuse to overwrite by default so outputs stay immutable. Returns SHA-256."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    with open(p, "x" if exclusive else "w", encoding="utf-8") as f:
        f.write(text)
    return sha256_text(text)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
