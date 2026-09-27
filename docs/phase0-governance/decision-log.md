# Decision log (append-only)

Rules: never edit or delete an entry. To change a decision, add a new entry that says which entry it supersedes.
Status values: *proposed* (by the engineering side, awaiting the team), *accepted*, *superseded*.

| ID | Date | Decision | Rationale | Owner | Status | Supersedes |
|---|---|---|---|---|---|---|
| D-001 | 2026-09-27 | Control app is Electron + React/TypeScript; collector is Next.js with append-only SQLite; analysis is stdlib-only Python. | Brief §5 names Electron. Stdlib analysis avoids dependency drift for reproduction. | engineering | proposed | |
| D-002 | 2026-09-27 | Backend is QEMU with native acceleration only (HVF/KVM/WHPX). Foreign-architecture emulation is not offered as a study condition. | Emulated guests would not be comparable conditions; brief §4 asks for capability checks, not promises. | engineering | proposed | |
| D-003 | 2026-09-27 | First guest is Debian 13 generic arm64 (cloud-init) on Apple silicon; the browser in the guest is Debian's `chromium` package. | Free licence; cloud-init lets the app apply presets. Google Chrome availability for Linux arm64 is **unverified** in the claim ledger, so Chromium is used and recorded as the actual browser. | engineering | proposed | |
| D-004 | 2026-09-27 | The development machine (Apple M1 Pro, 16 GB) replaces the 2017 MacBook Air for the automated pilot. The 2017 Air remains a pilot-only host per brief §4. | Hardware on hand; the app labels hosts by measured capability. | engineering | proposed | |
| D-005 | 2026-09-27 | Three high-sensitivity fields ship as `pending-review` and are recorded as `disabled-by-protocol`. | Brief §8: every field needs a privacy assessment; Q6 is open. | engineering | proposed | |
| D-006 | 2026-09-27 | Only the TCP peer address (or a configured trusted proxy's X-Forwarded-For) counts as the server-observed exit. | A client-supplied header could fake the exit (found in testing). Brief §7/R3. | engineering | accepted (security fix) | |
| D-007 | 2026-09-27 | A run is `complete` only with ≥1 browser visit, ≥1 guest-agent report, and valid egress checks. Anything else is `invalid` or `interrupted` with a recorded reason. | Brief §11 and R4. | engineering | proposed | |
| D-008 | 2026-09-27 | In the guest, Chromium is pinned by managed policy to the collector origin only (URLBlocklist `*`). | Enforces the research boundary (brief §2) inside the guest, not only by instruction. | engineering | proposed | |
| D-009 | 2026-09-27 | Instrument bumped to **v1.1.0**: secure-context-only fields report `insecure-context` (not `not-supported`) on insecure pages. Pilot-1 data (v1.0.0) is not pooled with later data. | Pilot 1 showed `navigator.deviceMemory` and UA client hints absent over plain HTTP; the old reason code was wrong. Brief §9: a changed method means a new version. | engineering | accepted | |
| D-010 | 2026-09-27 | The study collector must be served over **HTTPS** with a certificate the guests trust. Plain HTTP is for development only. | Over HTTP, deviceMemory, client hints and geolocation are unavailable (pilot 1), which would silently change the instrument. | engineering | proposed | |
| D-011 | 2026-09-27 | Provisioning generates the preset locale after package installation (`/opt/lvd/set-locale.sh`). | Pilot 1: preset en-GB, guest session `C`, browser en-US; cloud-init's locale step runs before `locales` is installed. | engineering | accepted | |
| D-012 | 2026-09-27 | The study page generates IDs with `crypto.getRandomValues` (not `crypto.randomUUID`). | Pilot 1: `randomUUID` is undefined in insecure contexts and the page failed. | engineering | accepted | |
| D-013 | 2026-09-27 | The dev collector allows `10.0.2.2` as a dev origin (`allowedDevOrigins`). | Pilot 1: Next.js dev mode blocked the page's scripts for guest requests. | engineering | accepted | |
