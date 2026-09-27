# Deviation log (append-only; plan Phase 5, item 22)

| ID | Date/time (UTC) | Run ID(s) | Planned | What happened | Effect on data | Action (rerun / exclude / annotate) | Recorded by |
|---|---|---|---|---|---|---|---|
| DV-001 | 2026-09-27 14:03 | pilot-1 run (PILOT treatment) | Hands-off run: runner opens page, page submits | Page stuck: Next.js dev blocked scripts for origin 10.0.2.2 | No visit until fixed | Collector restarted with `allowedDevOrigins`; page reloaded by sending F5 over QMP (manual intervention) | engineering |
| DV-002 | 2026-09-27 14:04 | pilot-1 run | Page submits after load | `crypto.randomUUID` undefined on insecure page; submission failed | No visit until fixed | Page patched (D-012); reloaded via F5 over QMP (manual intervention). Pilot 1 is therefore **not** a hands-off run; pilot 2 repeats it without intervention | engineering |

Rules: never edit an entry. Annotations on the evidence itself go through the collector's append-only annotation endpoint (`POST /api/v1/visits/<row>/annotations`).
