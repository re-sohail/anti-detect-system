#!/usr/bin/env python3
"""LVD guest agent: reports facts from INSIDE a guest (or physical control machine) to the
university collector, keyed by run token (brief section 5). Standard library only.

Values that cannot be determined are omitted, never guessed.

    python3 lvd-agent.py --collector http://10.0.2.2:4100 --run-token tok_...
    python3 lvd-agent.py --print            # show the report without sending it
    python3 lvd-agent.py --watch http://10.0.2.2:4180/g/<guest>/<secret>/
        runner mode (installed by provisioning): polls the control app for the guest's open run,
        sends the guest report for it once, and opens the study page in the browser.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import locale
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

AGENT_VERSION = "1.0.0"


def sh(*cmd: str, timeout: float = 5) -> str | None:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=True)
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def os_name() -> str:
    s = platform.system().lower()
    return {"darwin": "macos"}.get(s, s)


def os_version() -> str | None:
    if os.path.exists("/etc/os-release"):
        with open("/etc/os-release", encoding="utf-8") as f:
            m = re.search(r'^PRETTY_NAME="?([^"\n]+)"?', f.read(), re.M)
            if m:
                return m.group(1)
    if sys.platform == "darwin":
        return sh("sw_vers", "-productVersion")
    return platform.version() or None


def time_zone() -> str | None:
    tz = os.environ.get("TZ")
    if tz:
        return tz.lstrip(":")
    if sys.platform.startswith("linux"):
        v = sh("timedatectl", "show", "-p", "Timezone", "--value")
        if v:
            return v
    try:
        target = os.path.realpath("/etc/localtime")
        m = re.search(r"zoneinfo/(.+)$", target)
        if m:
            return m.group(1)
    except OSError:
        pass
    if sys.platform == "win32":
        return sh("tzutil", "/g")  # Windows zone name, recorded as-is (not IANA)
    return None


def locale_name() -> str | None:
    for var in ("LC_ALL", "LC_MESSAGES", "LANG"):
        v = os.environ.get(var)
        if v and v not in ("C", "POSIX", "C.UTF-8"):
            return v
    if sys.platform == "darwin":
        v = sh("defaults", "read", "-g", "AppleLocale")
        if v:
            return v
    try:
        loc = locale.getlocale()[0]
        return loc or None
    except ValueError:
        return None


def display() -> dict | None:
    if sys.platform.startswith("linux"):
        out = sh("xrandr", "--current")
        if out:
            m = re.search(r"current (\d+) x (\d+)", out)
            if m:
                return {"width": int(m.group(1)), "height": int(m.group(2))}
    if sys.platform == "darwin":
        out = sh("system_profiler", "SPDisplaysDataType", timeout=15)
        if out:
            m = re.search(r"UI Looks like: (\d+) x (\d+)", out) or re.search(r"Resolution: (\d+) x (\d+)", out)
            if m:
                return {"width": int(m.group(1)), "height": int(m.group(2))}
    if sys.platform == "win32":
        try:
            import ctypes
            u = ctypes.windll.user32
            u.SetProcessDPIAware()
            return {"width": u.GetSystemMetrics(0), "height": u.GetSystemMetrics(1)}
        except Exception:
            return None
    return None


def memory_mb() -> int | None:
    try:
        if sys.platform.startswith("linux"):
            with open("/proc/meminfo", encoding="utf-8") as f:
                m = re.search(r"MemTotal:\s+(\d+) kB", f.read())
                return int(m.group(1)) // 1024 if m else None
        if sys.platform == "darwin":
            v = sh("sysctl", "-n", "hw.memsize")
            return int(v) // 1024 // 1024 if v else None
        if sys.platform == "win32":
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("l", ctypes.c_ulong), ("load", ctypes.c_ulong), ("total", ctypes.c_ulonglong)] + [
                    (f"f{i}", ctypes.c_ulonglong) for i in range(6)
                ]

            s = MS()
            s.l = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s))
            return int(s.total // 1024 // 1024)
    except (OSError, ValueError):
        return None
    return None


def chrome_version() -> str | None:
    candidates = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
    for c in candidates:
        p = shutil.which(c)
        if p:
            v = sh(p, "--version")
            if v:
                return v
    mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if os.path.exists(mac):
        return sh(mac, "--version")
    if sys.platform == "win32":
        v = sh("reg", "query", r"HKCU\Software\Google\Chrome\BLBeacon", "/v", "version")
        if v:
            m = re.search(r"version\s+REG_SZ\s+([\d.]+)", v)
            return f"Google Chrome {m.group(1)}" if m else None
    return None


def build_report(run_token: str) -> dict:
    report = {
        "schemaVersion": 1,
        "runToken": run_token,
        "reportedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "agentVersion": AGENT_VERSION,
        "os": os_name(),
        "osVersion": os_version(),
        "kernel": platform.release() or None,
        "timeZone": time_zone(),
        "locale": locale_name(),
        "display": display(),
        "cpus": os.cpu_count(),
        "memoryMb": memory_mb(),
        "chromeVersion": chrome_version(),
    }
    return {k: v for k, v in report.items() if v is not None}


def post_json(url: str, body: dict, timeout: float = 10) -> int:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.status


def send_report(collector: str, report: dict) -> tuple[bool, str]:
    try:
        status = post_json(collector.rstrip("/") + "/api/v1/guest-report", report)
        return True, f"HTTP {status}"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code} {e.read().decode()[:300]}"
    except urllib.error.URLError as e:
        # No retry through any other route (brief section 17).
        return False, f"unreachable: {e.reason}"


def event(base: str, name: str, run_token: str | None = None, detail: dict | None = None) -> None:
    try:
        post_json(base + "events", {"event": name, "runToken": run_token, "detail": detail or {}}, timeout=5)
    except (urllib.error.URLError, OSError):
        pass  # the control app records what it receives; nothing is invented here


def find_browser() -> str | None:
    for c in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        p = shutil.which(c)
        if p:
            return p
    return None


def watch(base: str, interval: float) -> int:
    base = base if base.endswith("/") else base + "/"
    event(base, "runner-started", detail={"agentVersion": AGENT_VERSION})
    seen: set[str] = set()
    while True:
        try:
            with urllib.request.urlopen(base + "current-run", timeout=5) as res:
                run = json.loads(res.read()) if res.status == 200 else None
        except (urllib.error.URLError, OSError, ValueError):
            run = None
        if run and run.get("runToken") not in seen:
            token = run["runToken"]
            seen.add(token)
            ok, detail = send_report(run["collectorUrl"], build_report(token))
            event(base, "agent-report-sent" if ok else "agent-report-failed", token, {"result": detail})
            browser = find_browser()
            if browser:
                try:
                    subprocess.Popen([browser, "--new-window", run["studyUrl"]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    event(base, "browser-launched", token, {"browser": os.path.basename(browser)})
                except OSError as e:
                    event(base, "browser-launch-failed", token, {"error": str(e)})
            else:
                event(base, "browser-launch-failed", token, {"error": "no chromium/chrome on PATH"})
        time.sleep(interval)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--collector", help="Collector base URL, e.g. http://10.0.2.2:4100")
    ap.add_argument("--run-token", help="Run token shown in the control app")
    ap.add_argument("--print", action="store_true", help="Print the report and do not send it")
    ap.add_argument("--watch", metavar="URL", help="Runner mode: control-app endpoint for this guest")
    ap.add_argument("--event", help="With --watch URL: send one event (e.g. provisioned) and exit")
    ap.add_argument("--interval", type=float, default=5.0, help="Runner poll interval in seconds")
    a = ap.parse_args()

    if a.watch and a.event:
        base = a.watch if a.watch.endswith("/") else a.watch + "/"
        event(base, a.event)
        return 0
    if a.watch:
        return watch(a.watch, a.interval)

    token = a.run_token or "tok_" + "0" * 16
    report = build_report(token)
    if a.print or not a.collector:
        print(json.dumps(report, indent=2))
        return 0
    if not a.run_token or not re.fullmatch(r"[A-Za-z0-9_-]{16,64}", a.run_token):
        print("error: --run-token is required and must be the token from the control app", file=sys.stderr)
        return 2

    ok, detail = send_report(a.collector, report)
    print(("sent: " if ok else "failed: ") + detail, file=sys.stdout if ok else sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
