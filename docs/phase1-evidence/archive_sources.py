#!/usr/bin/env python3
"""Snapshot every source in sources.json with its retrieval time and SHA-256 (plan Phase 1, item 4).

    python3 archive_sources.py            # writes archive/<id>-<n>.<ext> and archive/manifest.json

A fetch failure is recorded as a failure, never skipped. Pages that need JavaScript may archive
as a shell; open the saved file to confirm before relying on it.
"""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent
UA = "LVD-research-source-archiver/1.0 (university research; contact in docs/phase0-governance)"


def main() -> int:
    sources = json.loads((HERE / "sources.json").read_text())
    out = HERE / "archive"
    out.mkdir(exist_ok=True)
    manifest = []
    for s in sources:
        for n, url in enumerate(s["urls"], 1):
            rec = {"id": s["id"], "url": url, "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=30) as r:
                    body = r.read()
                    ctype = r.headers.get("content-type", "")
                ext = "pdf" if "pdf" in ctype or url.endswith(".pdf") else "html"
                name = f"{s['id']:02d}-{n}.{ext}"
                (out / name).write_bytes(body)
                rec |= {"status": r.status, "file": name, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest(), "contentType": ctype}
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                rec |= {"status": "failed", "error": str(getattr(e, "reason", e))}
            manifest.append(rec)
            print(f"[{s['id']:02d}] {rec['status']} {url}")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    failed = [m for m in manifest if m["status"] == "failed"]
    print(f"{len(manifest) - len(failed)} archived, {len(failed)} failed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
