# Feasibility pilot report (plan Phase 2)

**Date:** 2026-09-27 · **Status:** pilot results, *not study data* (treatment `PILOT`, T2 and T4 labels used for pipeline testing only) · Evidence: `evidence/`.

## Setup (measured)
| Item | Value |
|---|---|
| Host | Apple MacBook Pro 18,3, Apple M1 Pro, 8 logical CPUs, 16 GB, macOS 26.6.2 — **not** the 2017 MacBook Air (decision D-004) |
| Hypervisor | HVF (`kern.hv_support=1`), QEMU 11.1.1 (Homebrew) |
| Guest image | Debian 13 generic cloud arm64 (`debian-13-generic-arm64.qcow2`, 431,685,632 bytes), verified against Debian's published SHA-512 |
| Guest preset | 2 vCPU, 3072 MB, 16 GB disk, 1280×800, Europe/London, en-GB, `default-nat` |
| Guest browser | Debian `chromium` 154.0.8037.57 (Google Chrome for Linux arm64 unverified, claim C22) |
| Collector | local development server over HTTP (`http://10.0.2.2:4100` from guests) |

## What worked, hands-off (pilot 2)
- Two guests were created from one preset, booted with hardware acceleration, provisioned by cloud-init from the app (time zone, locale, display, study user with autologin, collector-only browser policy, in-guest runner), rebooted into XFCE, and ran four study runs **without manual intervention**. All four runs verified `complete`.
- Selected vs guest vs browser vs server values were recorded side by side for every run (R2).
- Both guests reached the collector through **one** server-observed exit (claim C17, measured).
- Guest B never saw a storage token (R1, negative side).

## Measured timings and resources
Pilot timings are indicative only: one host, n = 1–2 per guest, **power source changed mid-pilot 2 (DV-003)**.

| Metric | Pilot 1 (1 guest) | Pilot 2 guest A / B |
|---|---|---|
| Start → hypervisor control socket ready | 0.31 s | 0.31 s / 0.31 s |
| First boot incl. cloud-init package install → desktop | 322 s | ≈ 377 s / 322 s (both in parallel) |
| Normal boot → desktop (after provisioning) | — | ≈ 24 s (restart, both guests) |
| Idle RSS of the hypervisor process (median) | 777 MB | 800 MB / 784 MB |
| Active RSS (median / max) | 1236 / 3017 MB | 740 / 2126 MB (p95) · 1138 / 2149 MB (p95) |
| CPU of the hypervisor process (median / p95) | 4 % / 128 % | 12 % / 134 % · 17 % / 120 % |
| Disk growth per guest (provisioning) | 2.8 GB | 2.7 GB / 2.7 GB |
| Thermal state | no warning | no warning |
| Max simultaneous guests observed | 1 | 2 |

Feasibility judgment for this host: two light Linux guests run concurrently with headroom. First-boot provisioning is dominated by package downloads (~700 MB per guest from the Debian mirror; pilot 3 was markedly slower on the same network), so study guests should be created from a **versioned, pre-provisioned base image** (implemented: *Build base image from this guest*).

## Problems found (all fixed or open, none hidden)
| ID | Finding | Evidence | Resolution |
|---|---|---|---|
| F1 | Client could spoof the observed network exit via `X-Forwarded-For` | claim C23 | Fixed: peer address from socket only (D-006) |
| F2 | Next.js dev server blocked the study page's scripts for guest origin `10.0.2.2` | `evidence/pilot1/stuck-page-before-fix.png`, DV-001 | Fixed (D-013) |
| F3 | `crypto.randomUUID` is undefined on insecure pages; page failed to submit | DV-002 | Fixed (D-012) |
| F4 | `deviceMemory` and UA client hints are absent over HTTP; the instrument called them `not-supported` | claim C24 | Reason corrected, instrument **v1.1.0** (D-009); study collector must use HTTPS (D-010) |
| F5 | Preset locale not applied: guest `C`, browser `en-US` | claim C26 | **Resolved.** Root cause (pilot-3 serial log): cloud-init's locale module fails before `locales` is installed and fails the whole Config stage. Fixed by D-011/D-016 and a Chromium language hook; pilot 4: `en-GB` in selected, guest, browser and server columns |
| F6 | Chromium on arm64 Linux reports `navigator.platform = "Linux x86_64"` | claim C25 | Observation, kept as data |
| F7 | Analysis toolkit counted collection timing as a field change (stability 0 %), and reported a lost token as "not measured" | real-data run | Fixed with regression tests |
| F8 | **R1 lost once:** a token planted in guest A's first session after provisioning was not read back after the first restart (pilot 2, ~2 s settle) | DV-004 | Not reproduced: retained in the r1-settle follow-up (later sessions, 5 s and 60 s) and in pilot 4 (first session, 60 s). Cause **undetermined**. Protocol rule: ≥ 60 s settle before a restart (D-015), and R1 must be replicated before it is claimed |
| F10 | Provisioning from the internet is slow and unreliable: 5–6 min (pilot 2), 18 min and > 45 min (pilot 3, guest B's serial output stopped during package configuration) | DV-005 | Versioned, pre-provisioned base images (D-014): pilot 4 first boot to desktop ≈ 25 s |
| F11 | The pilot command's `grep` pipe hid a failing exit code | pilot 3 console | Pilot scripts exit non-zero on failed checks; run them without output filters |
| F9 | Host went from AC to battery during pilot 2 | DV-003 | Recorded; timings marked pilot-only |

## Pilot 3 — provisioning failure (fresh guests from the Debian image)
Guest A provisioned in 18 min; guest B was still installing packages at the 45-minute deadline (apt fetched at ~155 kB/s; serial output stopped at 1117 s uptime during package configuration; cause undetermined). The run phase never started. Report: `evidence/pilot3/pilot3-failed-report.json`. Guest A had never run a study visit, so it served as the builder for a base image.

## Pilot 4 — guests from a derived base image (hands-off)
| Item | Result |
|---|---|
| Base image | built from pilot-3 guest A in 6.6 s: 3,625 MB, flattened, SHA-256 `0b81a35b…`, provenance → Debian image `3fa2da19…`, builder guest, preset v1 |
| First boot to desktop (cloud-init re-run, no package step) | 24.7 s / 24.4 s |
| Normal boot to desktop after restart | 24.0 s / 23.4 s |
| Runs | 4/4 `complete` |
| R1 | A planted, **retained** after restart (60 s settle); B never saw a token |
| C17 | one server-observed exit for both guests |
| R2 locale | `en-GB` in all four columns |
| Remaining mismatches (kept as data) | memory 3072 MB selected vs 2968 MB guest-visible (kernel reservation); `deviceMemory` absent (insecure context); `navigator.platform` "Linux x86_64" on an aarch64 guest |
| Power | battery throughout (see DV-003) |
| Analysis on real data | `merge` 4 visits / 2 guests / 1 host; matrix storage axis "1 planted: 1 retained, 0 lost, 0 cross-unit"; coverage and stability in `evidence/pilot4/` |

## Conclusions for Phase 3 onward
1. The end-to-end system works on this host without manual steps when guests come from a versioned base image.
2. Build one base per preset family, record it, and do not provision from the internet during collection.
3. Serve the collector over HTTPS for the study (fields differ between secure and insecure pages).
4. Treat R1 as a measured property to replicate, not an assumption: one unexplained loss in four restarts.
5. None of these pilot numbers are benchmarks: one host, n ≤ 2 per condition, and the power source changed.
