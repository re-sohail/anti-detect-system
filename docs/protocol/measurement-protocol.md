# Measurement protocol v0 — DRAFT for supervisor review (plan Phases 1, 5, 6)

Freeze as v1 before the first study visit. Any change after that creates a new protocol version and is logged as a deviation.

## 1. Instrument
Instrument **v1.0.0** (`packages/shared/src/instrument.ts`): 22 fields; 19 approved, 3 `pending-review` (recorded as `disabled-by-protocol`). Every absent value carries a reason code. Changing a field or a collection method requires a new instrument version and a labelled rerun (brief §9).

## 2. Environments and treatments (brief §9)
Change **one factor at a time** in the first pass.

| Treatment | Environments | Held constant | Min. target |
|---|---|---|---|
| T1 two browser profiles in one OS | host-profile A, host-profile B on one host | host, OS, browser build, egress | every study host |
| T2 two VMs on one host | managed guests A, B from the same preset | host, preset, image, egress | every reference host |
| T3 browsers on two physical hosts | physical-control machines + study hosts | browser major version where possible | ≥ 10 distinct machines |
| T4 repeated visits across restarts | one guest, restarted between visits | everything else | 3 restarts × each guest |
| T5 declared display / regional change | one guest, one factor changed (time zone OR locale OR display) via a new preset version | all other factors | 1 factor per condition |
| T6 independently verified network change | same guest, route switched between approved exits | everything else | only if ≥ 2 independent exits (Q3) |

## 3. Sample and schedule
- Record separately: physical hosts, guests per host, visits per guest, browser builds, collection days (brief §16). Host diversity is the binding constraint.
- Generate the order with `python -m lvd_analysis schedule --environments envs.json --days N --visits-per-day 2 --start YYYY-MM-DD --seed S --out schedule`. Collect on several days; randomise within each day.
- Plan a **controlled browser update** mid-study for H3; record the version change as a deviation-free, scheduled event.

## 4. Splits and preregistration
- `python -m lvd_analysis prereg --author NAME --out prereg.json`, edit thresholds, then **never change it**. The blinding step pins its SHA-256.
- At least one held-out-host split (default 50 % of hosts). A held-out-time split if a cutoff date is set.
- The detector is frozen (`freeze`) before the held-out set is released (`release`).

## 5. Per-run procedure
1. Pre-run checklist (`checklists.md`).
2. In the app: Runs → Start run (environment type, label, consent for physical controls, product details for vendor runs).
3. Guest runs: the in-guest runner opens the study page and sends the agent report automatically. External runs: open the study URL, then run `lvd-agent.py --collector … --run-token …` on that machine.
4. Finish and verify. Only `complete` runs enter analysis.
5. Post-run checklist; record any deviation.

## 6. Exclusions (fixed before unblinding)
- Runs not `complete` (interrupted, invalid: no visit, no agent report, egress invalid or unverified, instrument mismatch).
- Runs whose manifest fails its integrity hash.
- Runs from withdrawn participants.
- Visits whose run token is absent from every ground-truth file.

## 7. Network (brief §7)
Study 1 uses `default-nat` unless Q3 provides approved independent exits. Every run records start/end host egress and a per-visit server-observed exit check. An unexpected exit makes the run invalid for that treatment; it is retained and rerun. Outages are never retried through another route.

## 8. Analysis
`merge` → `coverage` → `prereg` → `blind` → `leakage` (must pass) → hand `release/blue/dev.json` to the blue team → `freeze` → `release` → blue-team predictions → `score` (plus `baselines`, `ablation`). Reports carry integer confusion matrices, precision/recall/FPR/FNR, host-level bootstrap intervals, calibration and suppressed small subgroups.
