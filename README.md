# Local Virtual Desktop Browser Research Platform

Implementation of the research brief `Local_Virtual_Desktop_PhD_Research_Brief.docx`.
This is a controlled, blinded **measurement** platform, not a tool that claims any environment is undetectable.
All traffic goes to the university-controlled collector only.

| Part | Path | What it does |
|---|---|---|
| Shared schemas | `packages/shared` | Instrument field dictionary (v1.0.0), absence reason codes, preset/manifest/payload schemas (zod) |
| Collector | `collector` | Next.js university test service: study page `/t/<token>`, append-only SQLite evidence store, server-observed peer address |
| Control app | `app` | Electron app: host capability probe, image manager, versioned presets, QEMU guest lifecycle, runs, compare view, audit log |
| Guest agent | `guest-agent/lvd-agent.py` | Python (stdlib only) script run inside a guest or control machine to report guest-side facts |

## Run it

```bash
npm install
npm run dev:collector          # http://localhost:4100 (dev admin key: dev-admin-key)
npm run dev:app                # Electron control app
```

To launch guests, install QEMU (`brew install qemu` on macOS, or set `LVD_QEMU_DIR`). Without it the app
still works for external-browser runs, and the Host screen explains why guests cannot launch.

### A pilot run (brief §12 "Feasibility pilot")
1. **Images**: register a base image (e.g. an aarch64 Linux cloud image on Apple silicon) with its origin and published SHA-256.
2. **Presets**: create a preset, *Preview changes*, then *Apply*. Use *Check launch prerequisites*.
3. **Machines**: create a guest, then *Start + open desktop*.
4. **Runs & compare**: start a run. The manifest is written and hashed before the token is registered.
5. In the guest: open the *Study URL (in guest)* in Chrome and run the agent command shown.
6. *Finish and verify*: the run is complete only with a browser visit, an agent report and valid egress checks.
7. *Export bundle* writes the run's files plus `SHA256SUMS`.

## Tests

```bash
npm test                                  # shared + collector unit tests + app service tests
npm run e2e:r1 -w collector               # R1 storage isolation across two Chrome profiles (collector must be running)
npm run smoke -w app                      # build, launch Electron, visit every screen
```

App service tests that need the collector are skipped if it is not running at `COLLECTOR_URL` (default `http://localhost:4100`).

## Design decisions tied to the brief
- **Evidence is immutable**: collector tables and the app's audit/network-check tables reject UPDATE and DELETE at the database level. Corrections are appended.
- **Unknown stays unknown**: every instrument field returns a value or a reason code (`permission-denied`, `disabled-by-protocol`, …).
- **Privacy review gate**: high-sensitivity fields (canvas, WebGL renderer, high-entropy client hints) are defined but `pending-review`, so they are recorded as `disabled-by-protocol` until approved (plan Phase 0, Q6).
- **Peer address from the socket**: a client-supplied `X-Forwarded-For` is ignored unless it comes from a configured `TRUSTED_PROXIES` address.
- **No fallback routes**: the app and agent talk only to the configured collector, and an outage is recorded rather than retried elsewhere.
- **Ground truth separation**: the collector knows only opaque run tokens. Guest and host identity live in the control app's store.
- **Electron hardening**: context isolation, sandbox, no Node in the renderer, one allow-listed `invoke` bridge, zod-validated inputs, sender-origin checks, strict CSP.

## Not built yet (see the plan)
Blinded dataset export and pair construction (Phase 4/5), independent network exits (Phase 6), competitor protocol (Phase 7),
detector scoring and statistics (Phase 8), embedded in-app display (QEMU currently opens its own window or a loopback-only VNC display),
Windows host adapter testing, packaging and signing (Phase 9).
