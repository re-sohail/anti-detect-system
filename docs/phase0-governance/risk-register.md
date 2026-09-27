# Risk register (plan Phase 0, item 30)

| ID | Risk | Likelihood | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R-01 | Too few distinct physical control computers | high | high (weak host-level inference) | Recruit early; report conditions with < 5 hosts as exploratory (built into scoring) | | open |
| R-02 | Consent or ethics approval delayed | medium | high | Run the technical pilot and synthetic-pipeline tests meanwhile; no volunteer data before approval | | open |
| R-03 | No independent university network exits | medium | medium | Study 1 holds egress constant; exit registry ready for later exits | | open |
| R-04 | Google Chrome unavailable for the guest architecture | medium | medium | Use Chromium on arm64 Linux; x86_64 host for Chrome; record the actual browser | | open |
| R-05 | Browser auto-update during collection | high | medium | Pin versions; schedule a controlled update for H3; record the version per visit | | open |
| R-06 | Detector tuned on held-out data | low | high | Freeze receipts are enforced before release by the analysis CLI | | mitigated |
| R-07 | Ground truth leaks into the blinded set | low | high | Automated leakage audit must pass before hand-over | | mitigated |
| R-08 | Guest licences unavailable (Windows, macOS) | medium | medium | Start with Linux; decide in Q2 | | open |
| R-09 | Pilot host too weak for two heavy guests | high (2017 Air) | medium | Use a reference host; the app measures capacity and blocks overcommit | | mitigated |
| R-10 | Competitor product cannot be obtained lawfully | medium | low | List public claims as untested and exclude from empirical rows | | open |
