# Dataset datasheet — TEMPLATE (plan Phase 11, item 7)

**Motivation.** Measure whether browser profiles, local VMs and physically separate computers can be distinguished by a controlled test service.
**Composition.** Visits: ___ · physical hosts: ___ (study hosts ___, physical controls ___) · guests: ___ · browser builds: ___ · collection days: ___ (from `lvd_analysis merge` counts). Instrument version(s): ___.
**Collection.** University collector; protocol version ___; schedule seed ___; deviations: see log.
**Consent.** Physical controls under consent form v___; ethics reference ___. Withdrawn participants' data removed on ___.
**Preprocessing.** Exclusions per protocol §6 (___ visits excluded, reasons: ___). Blinding: random IDs, HMAC-pseudonymised IPs, header allow-list, planted token removed.
**Redaction for public release.** No raw IPs, participant codes, run tokens, guest names or preset labels. Subgroups with < 3 hosts suppressed.
**Uses.** Reproducing the thesis metrics; methodological comparison. **Not** for identifying individuals or for evading platform controls.
**Distribution.** Repository ___, DOI ___, licence ___.
**Maintenance.** Contact ___; errata appended, never overwritten.
