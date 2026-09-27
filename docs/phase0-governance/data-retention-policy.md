# Data retention, redaction and access policy — PROPOSAL (plan Phase 0, items 24–26)

| Data | Location | Access | Retention (proposal) | Tool |
|---|---|---|---|---|
| Raw observations, headers, peer IPs | collector DB | supervisor | Network identifiers redacted after **90 days**; all raw rows deleted at project end + 1 year or as ethics requires | `npm run retention -w collector -- --mode redact-network --older-than-days 90 --operator NAME --apply` |
| Ground truth (per host) | app DB; `lvd-groundtruth-*.json` (0400) | supervisor | until thesis acceptance + archive period | app → Study data |
| Consent register | app DB (codes only) | consent officer, supervisor | as ethics requires | app → Consent |
| Code-to-name key | paper/offline | consent officer | as ethics requires | — |
| Blinded release | `release/blue` | blue team | until thesis acceptance | `lvd_analysis blind` |
| Public dataset | repository | public | permanent | derived from blinded set; no raw IPs, no participant codes, subgroups with < 3 hosts suppressed |

**Redaction rules for public exports.**
- Replace IP addresses with dataset-specific HMAC pseudonyms (key never published) — implemented in `blind.py`.
- Remove `host`, `origin`, `referer` and other non-allow-listed headers — implemented (allow-list in the preregistration).
- Remove the planted study token (`storage.testToken`) — implemented.
- Do not publish participant codes, guest names, preset labels or run tokens — enforced by the leakage audit.

**Every retention action** is logged in the collector's `retention_log` table (who, when, cutoff, rows). The append-only triggers are lifted only inside that transaction.
