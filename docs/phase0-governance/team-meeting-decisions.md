# Team meeting — §14 decisions (plan Phase 0, items 1–9)

**Status: DRAFT agenda. Every answer must be written here, dated and signed off before Phase 2 data collection.**
Brief §14 says these must be resolved in writing before the implementation plan is revised.

| # | Question (brief §14) | Answer | Decided by | Date |
|---|---|---|---|---|
| Q1 | Which physical hosts are available, with exact CPU architecture, RAM, installed OS and free storage? | *Attach one inventory per host, generated in the app (Study data → Save host inventory).* | | |
| Q2 | Which guest OS can be installed and licensed now, and which second guest must eventually be demonstrated? | Proposal: Debian 13 arm64 (DFSG, no licence cost) first; second guest TBD (Windows 11 needs licences and an x64 or supported Arm host). | | |
| Q3 | Does the university have two genuinely independent network exits? If not, will the first study hold public egress constant? | Proposal: study 1 holds egress constant (`default-nat`); register university exits in the app when available. | | |
| Q4 | How many distinct physical computers can participate as controls, and who obtains consent? | Target ≥ 10 distinct machines (host diversity matters more than visit count, brief §16). Consent officer: | | |
| Q5 | Which team owns the detector, and who retains the ground-truth mapping before the blind test? | Detector: blue team. Ground truth: supervisor only (release key, ground-truth exports). | | |
| Q6 | Which properties should the instrument collect first, and which require institutional privacy review? | Instrument v1.0.0 collects 19 approved fields; 3 are `pending-review` (canvas hash, WebGL renderer, high-entropy client hints). See `collector/` field dictionary. | | |
| Q7 | Is the first deliverable a Mac-only pilot, or is Windows host support a required acceptance criterion? | | | |
| Q8 | What constitutes a successful doctoral contribution: comparative measurement, a new detector, a reproducible dataset, or a combination? | | | |

## Owners (plan Phase 0, item 10)

| Area | Owner | Backup |
|---|---|---|
| VM / host adapter (`app/src/main/services/qemu.ts`, `guests.ts`) | | |
| Collector and data model (`collector/`, `packages/shared`) | | |
| Experiment coordination (schedule, checklists, deviations) | | |
| Detector evaluation (`analysis/`) | | |
| Source audit (claim ledger) | | |
| Consent and ethics liaison | | |

## Sign-off (plan Phase 0, item 33)

| Role | Name | Signature | Date |
|---|---|---|---|
| Supervisor | | | |
| PI / student | | | |
