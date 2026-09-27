# Ethics review submission — DRAFT (plan Phase 0, item 22)

*To be completed by the PI and reviewed by the institution's ethics office. Technical facts below describe the implemented system.*

**Title.** Distinguishing browser profiles, local virtual machines and physical computers from a controlled test service: a blinded measurement study.

**Purpose.** Measure, under documented conditions, how accurately a blinded analyst can tell visits from (A) one browser profile, (B) separate local VMs sharing a host, and (C) separate physical hosts, with quantified errors (brief §1).

**Participants.** Adult volunteers who lend a personal or university computer as a *physical control* (brief §9). Expected number: ≥ 10 machines. No minors. No vulnerable groups targeted.

**What is collected from a volunteer's machine.**
- Per visit to the university test page: the browser properties listed in the field dictionary (instrument v1.0.0, 19 approved fields), HTTP request headers, and the network address the server observed.
- Optionally, if the volunteer runs the guest agent: OS name/version, kernel, time zone, locale, display size, logical CPUs, memory and Chrome version.
- Geolocation is requested only in runs that explicitly ask for it, only with the browser's permission prompt, and is rounded to 2 decimal places (~1 km) before it leaves the page.
- **Not collected:** names or contact details (held offline by the consent officer against a participant code), browsing history, accounts, cookies from other sites, files.

**Where data goes.** Only to the university-hosted collector. The guest browser is restricted by policy to the collector origin. No third-party platforms are contacted (brief §2).

**Security.** Admin access by key; evidence tables are append-only; ground truth is kept apart from observations; the analysis team receives only blinded data with pseudonymised network addresses (see `threat-model.md`).

**Retention.** See `data-retention-policy.md`. Default proposal: network identifiers redacted after 90 days; raw evidence deleted at the end of the approved project period; the published dataset contains no raw IPs or participant codes.

**Withdrawal.** Participants may withdraw at any time. Withdrawal is recorded in the consent register; their runs are excluded from any analysis not yet unblinded, and their raw rows are deleted with the retention tool (`collector` `npm run retention -- --mode delete`, applied to the affected run tokens).

**Risks.** Low: browser properties and a network address could, in combination, be identifying. Mitigations: pseudonymisation, access control, retention limits, suppression of small subgroups in publications.

**Questions for the ethics office.**
1. Does collecting network metadata from volunteers' machines require a formal protocol, and what retention period applies? (brief §9)
2. Is the educational-purpose notice plus the consent form sufficient, or is a participant information sheet also required?
3. May the de-identified dataset be deposited publicly (e.g. Zenodo) after redaction?
