"""Randomised collection schedule (brief §9, plan Phase 5 item 17).

Collection order is randomised within each day so that time of day or a software rollout
cannot trivially identify a treatment group. The seed and inputs are recorded so the schedule
is reproducible and auditable.
"""
from __future__ import annotations

import random
from datetime import date, timedelta
from typing import Any

from .common import now_iso


def make_schedule(environments: list[dict], days: int, visits_per_env_per_day: int, start: str, seed: int,
                  slots: tuple[str, ...] = ("09:00", "11:00", "13:00", "15:00", "17:00")) -> dict[str, Any]:
    """environments: [{"id": "guest-A", "treatment": "T2-vms-one-host", "host": "study-host-1"}, ...]"""
    if not environments:
        raise ValueError("no environments")
    rng = random.Random(seed)
    d0 = date.fromisoformat(start)
    rows = []
    for d in range(days):
        day_items = [e for e in environments for _ in range(visits_per_env_per_day)]
        rng.shuffle(day_items)
        # Spread the day's items across slots in random order.
        slot_order = list(slots)
        for i, e in enumerate(day_items):
            if i % len(slot_order) == 0:
                rng.shuffle(slot_order)
            rows.append({
                "date": (d0 + timedelta(days=d)).isoformat(),
                "slot": slot_order[i % len(slot_order)],
                "order": i + 1,
                "environment": e["id"],
                "treatment": e["treatment"],
                "host": e.get("host"),
                "status": "planned",
            })
    rows.sort(key=lambda r: (r["date"], r["slot"], r["order"]))
    return {"schema": "lvd-schedule/1", "createdAt": now_iso(), "seed": seed, "start": start, "days": days,
            "visitsPerEnvironmentPerDay": visits_per_env_per_day, "environments": environments, "rows": rows}


def to_csv(s: dict) -> str:
    out = ["date,slot,order,environment,treatment,host,status,deviation_note"]
    out += [f"{r['date']},{r['slot']},{r['order']},{r['environment']},{r['treatment']},{r['host'] or ''},{r['status']}," for r in s["rows"]]
    return "\n".join(out) + "\n"
