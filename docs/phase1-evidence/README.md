# Phase 1 — evidence review

- `sources.json` — the 28-entry source register from the brief.
- `archive_sources.py` — snapshots every source with retrieval time and SHA-256 (`archive/manifest.json`). Run again before submission (plan Phase 11, item 24).
- `claim-ledger.csv` — every consequential claim with status: **documented** (quote found in our snapshot), **cited-unconfirmed** (snapshot could not show the content), **vendor-claim** (recorded as a claim only), **measured** (our own experiment), **proposed**, **unverified**.
- Host inventory: generate per host in the app (Study data → Save as Markdown + JSON).
- Measurement protocol v0: `../protocol/measurement-protocol.md`.
- Competitor matrix skeleton: `../competitor/protocol.md`.

## Research gap statement (plan Phase 1, item 32)
Existing profile managers, VM tools and fingerprinting sites each cover one aspect. The contribution here is a **controlled, host-level, reproducible comparison** of profiles, local VMs and physically separate computers, measured by one versioned instrument, with **physical ground truth**, a **blinded detector evaluation** and **quantified errors**, including negative results. It is not the first multi-profile app and makes no anonymity claim.

## Literature beyond the brief (plan Phase 1, item 23)
Starting points to review before submission (not yet read for this project; add to the ledger once read):
Laperdrix et al., "Browser Fingerprinting: A Survey" (ACM TWEB 2020); Gómez-Boix et al., "Hiding in the Crowd" (WWW 2018); Mowery & Shacham, "Pixel Perfect: Fingerprinting Canvas in HTML5" (W2SP 2012); Englehardt & Narayanan, "Online Tracking: A 1-million-site Measurement and Analysis" (CCS 2016).
