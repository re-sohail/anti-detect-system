# Plan status — what is built, what is drafted, what needs people

Plan: `~/.claude/plans/users-mrmacbook-documents-personal-proj-snazzy-pike.md` (12 phases).
Legend: **built** = implemented and tested · **drafted** = document written, awaiting the team · **needs people** = cannot be done by software.

| Phase | Built / drafted here | Needs people |
|---|---|---|
| 0 Governance & ethics | drafted: §14 decision sheet + owners (`phase0-governance/team-meeting-decisions.md`), decision log, glossary + formal H1–H3, threat model + access control, ethics submission, consent form, retention/redaction policy, licensing inventory, risk register, templates | the meeting, answers to Q1–Q8, owner names, ethics filing and approval, supervisor sign-off |
| 1 Evidence review | built: source archiver (31/31 URLs archived with hashes), host inventory generator (app → Study data). drafted: claim ledger with honest statuses, research-gap statement, protocol v0 | manual reading of JavaScript-only Apple pages (C09/C10), literature review beyond the brief, inventory of every university host |
| 2 Feasibility pilot | built + run: 4 real QEMU/HVF pilots (single guest; two guests T2/T4/R1/C17; provisioning failure; derived base image — all 5 checks pass hands-off); report `phase2-pilot/feasibility-report.md` | pilot on the 2017 MacBook Air and on each reference host |
| 3 Core app | built: Electron app (11 screens), capability probe, image manager, versioned presets with diff preview, QEMU lifecycle, snapshots/conditions, cloud-init provisioning, in-guest runner, audit log, crash reconciliation, run manifests, exports | — |
| 4 Instrument & data model | built: instrument v1.1.0 (field dictionary, reason codes, secure-context handling), append-only collector with annotations, retention/redaction tool, raw export, ground-truth export, blinding pipeline | privacy review of the 3 pending fields (Q6) |
| 5 Controls & collection | built: consent register, environment kinds, randomised schedule generator, preregistration, held-out-host/time splits, leakage audit, dataset counts. drafted: protocol, checklists, deviation log | recruiting ≥ 10 control machines, consent, the collection itself |
| 6 Network study | built: exit registry (approval, tests, expected IP), per-run and per-visit egress verification, proxy pinning via guest policy, no-fallback rule, spoof-proof peer address | independent university exits (Q3), IT approval |
| 7 Competitor verification | built: vendor/device-cloud run type with lawful-access record, four-axis matrix generator. drafted: protocol + untested-claims table | lawful access to products; running the sessions |
| 8 Detection & statistics | built: blue-team template, freeze receipts, release step, baselines (random, shared IP, exact profile, logistic), scoring (confusion matrices, precision/recall/FPR/FNR, host-level bootstrap, calibration, finer labels, subgroups with suppression, success criteria), ablation, Markdown reports | the blue team's detector; the real held-out evaluation |
| 9 Performance & packaging | built: 5 s resource sampler (RSS, CPU, disk, power, thermal), start→control/desktop/browser timings, performance screen + export, CI workflow, electron-builder config, SBOM step | clean-install tests on Windows; institutional code signing; 24 h soak on reference hosts |
| 10 Validation | built: 29 JS tests + 14 Python tests + real-Chrome R1 e2e + Electron smoke; traceability matrix; methodology checklist | independent re-run by a second team member |
| 11 Thesis & handoff | drafted: outline, reproduction guide, datasheet template, review Q&A | writing, external reproduction, archive DOI, mock defence |
