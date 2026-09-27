# Deviation log (append-only; plan Phase 5, item 22)

| ID | Date/time (UTC) | Run ID(s) | Planned | What happened | Effect on data | Action (rerun / exclude / annotate) | Recorded by |
|---|---|---|---|---|---|---|---|
| DV-001 | 2026-09-27 14:03 | pilot-1 run (PILOT treatment) | Hands-off run: runner opens page, page submits | Page stuck: Next.js dev blocked scripts for origin 10.0.2.2 | No visit until fixed | Collector restarted with `allowedDevOrigins`; page reloaded by sending F5 over QMP (manual intervention) | engineering |
| DV-002 | 2026-09-27 14:04 | pilot-1 run | Page submits after load | `crypto.randomUUID` undefined on insecure page; submission failed | No visit until fixed | Page patched (D-012); reloaded via F5 over QMP (manual intervention). Pilot 1 is therefore **not** a hands-off run; pilot 2 repeats it without intervention | engineering |
| DV-003 | 2026-09-27 14:08–14:16 | pilot-2 (all runs) | Constant power source (brief §11) | Host power changed from AC to battery during the pilot (sampler: 'AC Power', 'Battery Power') | Pilot-2 timings are not comparable with AC-only runs | Timings reported as pilot-only; checklist item on power source added | engineering |
| DV-004 | 2026-09-27 14:16 | pilot-2 guest A | R1: token retained across restart | Token planted in the first session after provisioning was not read back after the first restart. In a follow-up on the same guest (r1-settle), tokens survived later restarts with 5 s and 60 s settle times | R1 **not yet established** for first-session storage | Open finding: investigate first-session Chromium profile behaviour; pilot 3 repeats on fresh guests | engineering |
| DV-005 | 2026-09-27 14:24–15:09 | pilot-3 (no runs) | Both guests provisioned within 45 min | Guest B did not finish provisioning (slow mirror; serial output stopped at 1117 s) | No run data from pilot 3 | Pilot 3 abandoned; its clean guest A became the builder for a base image (D-014); pilot 4 repeated the protocol | engineering |

Rules: never edit an entry. Annotations on the evidence itself go through the collector's append-only annotation endpoint (`POST /api/v1/visits/<row>/annotations`).
