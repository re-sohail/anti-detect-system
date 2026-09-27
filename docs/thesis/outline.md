# Thesis outline (plan Phase 11, items 12–23)

1. **Introduction** — research question; H1–H3 (`docs/phase0-governance/glossary-and-hypotheses.md`); contribution and non-goals.
2. **Related work** — fingerprinting research [2][3][4][5][28]; profile managers, VM tools and device clouds as *categories* with vendor claims marked (`docs/competitor/protocol.md`); research gap (`docs/phase1-evidence/README.md`).
3. **System** — architecture and trust boundaries (`threat-model.md`); capability-driven guest catalogue; provisioning; evidence integrity (append-only, manifests, exports).
4. **Instrument and data model** — field dictionary v1.0.0, reason codes, coverage and stability tables (`lvd_analysis coverage`).
5. **Study protocol, controls and ethics** — treatments, schedule, consent, exclusions (`docs/protocol/`).
6. **Network study** — exit registry, per-visit verification, invalid-run accounting.
7. **Results: detection** — per set and condition: confusion matrices, precision/recall/FPR/FNR with host-level intervals, calibration, finer labels, subgroups, baselines, ablation by family.
8. **Results: performance and reliability** — per reference host: start→control, start→desktop, start→browser, idle/active RSS, CPU, disk growth, power/thermal; fault-injection outcomes.
9. **Discussion** — detectable and undetectable observations in the tested sample; host and browser diversity; how updates may change findings (H3); negative results with conditions.
10. **Limitations** — single-host-type generality, sample size, time window, instrument scope, Chromium vs Chrome on arm64.
11. **Reproducibility** — archive contents and the external reproduction (`reproduction-guide.md`).

Appendices: claim ledger, decision log, deviation log, preregistration, scoring reports, dataset datasheet.
