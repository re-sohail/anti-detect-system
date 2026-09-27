# Local Virtual Desktop Browser Research Platform

Implementation of `Local_Virtual_Desktop_PhD_Research_Brief.docx`: a controlled, blinded **measurement** study of whether browser profiles, local VMs and physically separate computers can be distinguished by a university test service. It makes no claim that any environment is undetectable. All study traffic goes to the university collector only.

Plan status per phase, and what still needs people: **[docs/README.md](docs/README.md)**. Pilot results: **[docs/phase2-pilot/feasibility-report.md](docs/phase2-pilot/feasibility-report.md)**.

| Part | Path | What it does |
|---|---|---|
| Shared schemas | `packages/shared` | Instrument field dictionary (v1.1.0), absence reason codes, preset / manifest / exit / consent / payload schemas |
| Collector | `collector` | Next.js university test service: study page `/t/<token>`, append-only SQLite evidence, socket-derived peer address, annotations, raw export, retention tool |
| Control app | `app` | Electron app: host capability probe, image manager (+ base-image builder), versioned presets, QEMU guests with cloud-init provisioning and in-guest runner, runs, compare view, network exits, consent register, performance sampling, ground-truth and host-inventory exports, audit log |
| Guest agent | `guest-agent/lvd-agent.py` | Stdlib Python: guest-side facts; `--watch` runner mode used inside provisioned guests |
| Analysis | `analysis/lvd_analysis` | Stdlib Python: merge, coverage/stability, preregistration, blinding, leakage audit, freeze/release, baselines, scoring with host-level bootstrap, ablation, schedule, four-axis matrix |
| Documents | `docs/` | Governance, evidence (claim ledger, 31 archived sources), protocol, competitor protocol, validation, thesis |

## Run it

```bash
npm install
npm run dev:collector          # http://localhost:4100 (dev admin key: dev-admin-key)
npm run dev:app                # Electron control app
brew install qemu              # to launch guests (or set LVD_QEMU_DIR)
```

A pilot without the UI (real QEMU guest, verified Debian image, full run):
```bash
cd app && node --import tsx scripts/pilot-two-guests.mts --image debian-13-generic-arm64.qcow2 \
  --sha512 <published> --origin <url> --out ../pilot-out --settle 60
```

For studies, serve the collector over **HTTPS** (decision D-010): several instrument fields are only exposed in secure contexts.

## Tests

```bash
npm run dev:collector &                   # live service tests need it
npm test                                  # shared (5) + collector (7) + app (17)
npm run e2e:r1 -w collector               # R1 across two real Chrome profiles
npm run smoke -w app                      # build, launch Electron, visit all 11 screens
python3 -m unittest discover -s analysis/tests   # 14 analysis tests
```

## Supervisor analysis workflow
```bash
python3 -m lvd_analysis merge --collector export.json --ground-truth gt-host1.json gt-host2.json --out merged.json
python3 -m lvd_analysis coverage --merged merged.json --out coverage
python3 -m lvd_analysis prereg --author NAME --out prereg.json      # edit, then never change
python3 -m lvd_analysis blind --merged merged.json --prereg prereg.json --out-dir release
python3 -m lvd_analysis leakage --merged merged.json --blue-dir release/blue    # must pass
# blue team: develop on release/blue/dev.json, then `freeze` BEFORE:
python3 -m lvd_analysis release --out-dir release --set eval-host
python3 -m lvd_analysis score --out-dir release --set eval-host --prereg prereg.json --predictions preds.json --receipt receipt.json --detector detector/
python3 -m lvd_analysis baselines --out-dir release --set eval-host
python3 -m lvd_analysis ablation --out-dir release --set eval-host
```
(run from `analysis/`)

## Design decisions tied to the brief
See `docs/phase0-governance/decision-log.md` (D-001 … D-013). In short: evidence is append-only at the database level; unknown values carry reason codes; high-sensitivity fields wait for privacy review; the network exit comes only from the TCP socket; there are no fallback routes; ground truth is kept apart from observations; guest browsers are pinned by policy to the collector; the Electron renderer has no Node access.
