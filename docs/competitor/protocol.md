# Competitor verification protocol (brief §15, plan Phase 7)

## Rules
1. Test a product only with **lawful access whose terms permit research use**. Otherwise list its public claims as *untested* (table below) and exclude it from empirical rows.
2. Record per test (the app's run form enforces this for `vendor-product` / `device-cloud` runs): product, edition, version, configuration (default unless the protocol says otherwise), vendor URL for each claim, lawful-access basis, embedded browser engine if shown, host OS, date.
3. Use the **same** university observation page and instrument version for every environment.
4. Order per session: host Chrome → second host profile → vendor product (default configuration) → local VM (this app) → physical control computer.
5. Missing coverage is reported as *not measured*, never as zero risk. Record negative observations for competitors **and** for this app with the same rubric. No ranking by invisibility, ban resistance or marketing language.
6. Capabilities are dated: re-test a subset later to show time dependence.

## Matrix
Generated from recorded observations: `python -m lvd_analysis matrix --merged merged.json --out competitor-matrix`. Each row cites its evidence runs. The four axes:

| Axis | What it means | How it is measured here |
|---|---|---|
| Storage separation | cookies, cache, filesystem state | R1 planted-token test (`?place=1` then re-read in other units) |
| OS separation | browser runs in a different guest OS | guest-agent OS vs host OS |
| Hardware provenance | physical, virtual or vendor-reported values | environment kind + browser-reported values |
| Network provenance | exit the server actually observed | collector peer address per visit |

## Untested vendor claims (as of 2026-09-27; see claim ledger C05–C06)
| Product | Claimed capability (vendor's words, summarised) | Source | Tested? |
|---|---|---|---|
| Multilogin | multiple isolated browser profiles, fingerprint configuration | [6] | no |
| GoLogin | multiple profiles, fingerprint-related features | [7] | no |
| AdsPower | multiple profiles, fingerprint-related configuration | [8] | no |
| BrowserStack | access to real devices | [9] | no |
