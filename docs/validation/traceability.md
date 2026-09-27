# Requirements traceability (plan Phase 10)

Every requirement maps to an executable test. Run all with `npm test` from the repository root (collector must be running for the live tests) and `python3 -m unittest discover -s analysis/tests`.

## Requirements R1–R5 (brief §17)

| Req | Statement | Test(s) | Evidence produced |
|---|---|---|---|
| R1 storage isolation | Token placed in A is retained after restart; B never stores it | `collector/scripts/e2e-r1-profiles.mjs` (two real Chrome profiles, restarts); pilot/T2 guest runs with `?place=1`; `analysis` matrix storage axis | collector visits with `storage.testToken` |
| R2 configuration provenance | Selected vs guest-reported vs browser-reported values compared; mismatches preserved | `app/test/services.test.ts` (full run: compare rows); `app/src/main/services/compare.ts`; pilot report `compare` | run detail compare table; exported run bundle |
| R3 public-exit validation | Selected route vs receiver-observed address; unexpected ⇒ invalid | `app/test/services.test.ts` (per-visit checks valid); `app/test/study.test.ts` (unapproved/unverifiable exits blocked); collector spoofing check (D-006) | `network_checks` per run |
| R4 crash integrity | Guest terminated mid-test ⇒ run interrupted, no fabricated observation | `app/test/services.test.ts` (interrupt → interrupted; finish without visit/report ⇒ invalid); `GuestService` exit listener; startup reconciliation | run status + reason |
| R5 blinded export | Internal IDs and filename labels unrecoverable from the blue-team data | `analysis/tests/test_pipeline.py::test_blind_split_labels_and_leakage` (planted token, host header, referer, raw IP absent; injected run token caught) | `lvd_analysis leakage` report |

## Negative inputs (brief §17)

| Case | Expected | Test |
|---|---|---|
| Image with wrong checksum | rejected, not stored, `checksum-mismatch` | services.test.ts "wrong published checksum" |
| Base image modified after registration | detected by verify | services.test.ts "detects later modification" |
| Insufficient disk | launch blocked, `insufficient-disk` | services.test.ts "guest creation is blocked" |
| Unsupported architecture | `guest-arch` check fails | services.test.ts "launch checks report …" |
| Unavailable hypervisor / missing backend | checks fail with reason | same |
| Denied / unrequested geolocation | recorded `permission-denied` / `permission-not-requested` / `insecure-context` | e2e-r1 script ("not guessed") |
| Collector outage | run invalid, no fallback route | services.test.ts "collector unreachable" |
| Interrupted export | only `.partial` folder remains; final folder has SHA256SUMS | services.test.ts export check; `runs.exportRun` |
| Manifest tampering | `checksum-mismatch` on read | services.test.ts "modified manifest" |
| Evidence UPDATE/DELETE | aborted by database trigger | collector store tests; app audit test |
| Freeze after release / changed detector / changed preregistration / missing predictions | scoring refused | analysis test_pipeline |
| Spoofed X-Forwarded-For | ignored; socket address used | manual check recorded in claim ledger C23 |
| Proxy exit without expected IP / unapproved exit | run refused, `route-mismatch` | study.test.ts |
| Physical control without active consent | run refused | study.test.ts |

## Claim traceability (template, plan Phase 10 item 17)

| Thesis claim | Requirement | Source | Condition | Result file | Limitation |
|---|---|---|---|---|---|
| "Two separate guests retain separate Chromium storage after restart" | R1 | — | T2 + T4 on host ___ | `scores/…`, matrix row `managed-guest` | one host type |
| "Two guests appear to have different public exits" | R3 | [22] | T6 | `network_checks` for runs ___ | only with ≥ 2 independent exits |
| "The detector cannot link these two guests" | R5, scoring | — | eval-host, detector ___ v___ | `scores/eval-host-___.md` | n pairs ___, n hosts ___, CI ___ |

Demo videos are not evidence for any claim.
