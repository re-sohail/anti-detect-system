# Methodological failure checklist (brief §13, plan Phase 10 items 24–29)

Tick each before submission; link the evidence.

- [ ] No copied browser fingerprint is presented as a physical laptop. Presets are named descriptively; the model name is never browser evidence.
- [ ] No separate-public-IP claim without server verification (per-visit `network_checks` all `valid`).
- [ ] Real physical-machine controls are present (T3; count reported).
- [ ] The detector was not tuned on the held-out set (freeze receipt precedes release; scoring enforces it).
- [ ] No single accuracy value without the confusion matrix, false positives and sample size.
- [ ] Measured conditions are reported as such: virtual graphics, shared egress, constrained CPU, browser-version mismatch, preset/actual mismatches.
- [ ] Bootstrap is at the physical-host level; the number of repetitions is stated.
- [ ] Conditions with few hosts are labelled exploratory; small subgroups are suppressed.
- [ ] Exclusions were documented before unblinding (preregistration + deviation log).
- [ ] Both detectable and undetectable observations in the tested sample are named.
