"""SYNTHETIC test fixtures only. Never use for results: these are fabricated observations
that exercise the pipeline's code paths, not measurements of any environment."""
from __future__ import annotations

import random
import uuid


def make(n_hosts: int = 6, guests_per_host: int = 2, visits_per_guest: int = 3, seed: int = 1, shared_ip_hosts: bool = True):
    rng = random.Random(seed)
    tzs = ["Europe/London", "Asia/Tokyo", "America/New_York", "Europe/Berlin"]
    collector = {"runs": [], "visits": [], "guestReports": [], "echoChecks": [], "annotations": [], "retentionLog": []}
    gts = []
    day = 0
    for h in range(n_hosts):
        host_id = f"host_{uuid.UUID(int=rng.getrandbits(128))}"
        ip = f"198.51.100.{h + 10}" if shared_ip_hosts else None
        cores = rng.choice([4, 8, 10])
        runs = []
        for g in range(guests_per_host):
            guest_id = f"guest_{rng.getrandbits(48):012x}"
            tz = rng.choice(tzs)
            for k in range(visits_per_guest):
                token = f"tok_{rng.getrandbits(96):024x}"
                run_id = f"run_{rng.getrandbits(48):012x}"
                status = "complete" if not (h == 0 and g == 0 and k == 0) else "interrupted"
                runs.append({
                    "runToken": token, "runId": run_id, "status": status, "statusReason": None if status == "complete" else "guest exited",
                    "treatment": "T2-vms-one-host", "createdAt": "2026-10-01T10:00:00.000Z", "finishedAt": None,
                    "manifestSha256": "0" * 64, "manifestIntact": True, "hostId": host_id,
                    "environment": {"kind": "managed-guest", "label": f"guest {g}", "participantCode": None, "consentWithdrawn": None, "product": None},
                    "guestId": guest_id, "guestCondition": 1, "preset": {"id": "p", "version": 1, "name": "Linux desktop study A", "guestOs": "linux"},
                    "image": None, "routeId": "default-nat", "exitKind": "default-nat", "software": None,
                })
                day += 1
                obs = {
                    "intl.timeZone": {"status": "ok", "value": tz},
                    "nav.hardwareConcurrency": {"status": "ok", "value": 2},
                    "nav.userAgent": {"status": "ok", "value": "Mozilla/5.0 (X11; Linux aarch64) Chrome/153.0.0.0 Safari/537.36"},
                    "screen.size": {"status": "ok", "value": {"width": 1280, "height": 800}},
                    "screen.viewport": {"status": "ok", "value": {"innerWidth": rng.randint(1000, 1280)}},
                    "render.canvas2d": {"status": "absent", "reason": "disabled-by-protocol"},
                    "storage.testToken": {"status": "ok", "value": {"existingToken": f"planted-{guest_id}", "placedToken": None}},
                    "perf.timerResolution": {"status": "ok", "value": 0.1},
                }
                collector["runs"].append({"run_token": token, "run_id": run_id, "route_id": "default-nat", "expected_ip": None, "registered_at": "2026-10-01"})
                collector["visits"].append({
                    "id": len(collector["visits"]) + 1, "run_token": token, "visit_id": str(uuid.UUID(int=rng.getrandbits(128))),
                    "received_at": f"2026-10-{1 + day % 28:02d}T10:00:00.000Z", "schema_version": 1, "instrument_version": "1.0.0",
                    "client_time": "2026-10-01T10:00:00.000Z", "clock_offset_ms": rng.randint(-200, 200) + h * 3000,
                    "peer_ip": ip or f"203.0.113.{rng.randint(1, 250)}", "peer_source": "socket",
                    "server_json": {"headers": {"user-agent": "UA", "accept-language": "en-GB", "host": "10.0.2.2:4100", "referer": f"http://10.0.2.2:4100/t/{token}"}},
                    "payload_json": {"observations": obs},
                })
                collector["guestReports"].append({"run_token": token, "received_at": "x", "peer_ip": ip, "report_json": {"os": "linux", "cpus": 2}})
        gts.append({"schema": "lvd-ground-truth/1", "exportedAt": "2026-10-30T00:00:00Z", "hostId": host_id, "appVersion": "t",
                    "host": {"arch": "arm64", "os": "darwin", "osRelease": "x", "cpuModel": "x", "cpuCount": cores, "totalMemMb": 16384},
                    "exits": [], "runs": runs})
    # a stray visit from a run no ground-truth file knows
    collector["visits"].append({**collector["visits"][1], "id": 9999, "run_token": "tok_unknownunknownunknown", "visit_id": str(uuid.uuid4())})
    return collector, gts
