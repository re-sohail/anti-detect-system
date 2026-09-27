# Reproduction guide (plan Phase 11, items 9–11)

Goal: another team reproduces the pilot and the metrics from the archived package.

## 1. Environment
- A supported host: Apple silicon Mac (macOS), or Linux with `/dev/kvm`, or Windows with WHPX (untested so far).
- Node ≥ 22.13, Python ≥ 3.10, QEMU ≥ 10 (`brew install qemu`), Google Chrome for the host-side tests.
- `npm install` at the repository root.

## 2. Verify the code and data
- Check out the tagged release named in the thesis; compare its commit hash.
- Verify every archived file against its `SHA256SUMS` / `.sha256`.

## 3. Reproduce the test suite
```bash
npm run dev:collector &          # port 4100
npm test                         # shared, collector, app (live tests need the collector)
npm run e2e:r1 -w collector      # R1 across two real Chrome profiles
python3 -m unittest discover -s analysis/tests
```

## 4. Reproduce the pilot
```bash
curl -LO https://cloud.debian.org/images/cloud/trixie/<DATE>/debian-13-generic-arm64.qcow2   # the dated image named in the thesis
cd app && node --import tsx scripts/pilot.mts --image ../debian-13-generic-arm64.qcow2 \
  --sha512 <published SHA-512> --origin <URL> --out ../pilot-repro
```
Compare `pilot-repro/pilot-report.json` with the archived pilot report: milestone order, run status `complete`, compare rows, network checks. Timings will differ by host; report them, don't expect equality.

## 5. Reproduce the metrics
With the archived `release/` (blue files + supervisor key under controlled access), frozen predictions and the preregistration:
```bash
python3 -m lvd_analysis score --out-dir release --set eval-host --prereg prereg.json \
  --predictions predictions.json --receipt receipt.json --detector detector/
```
The scoring output must match the archived `scores/*.json` exactly (same seed, same data).

## 6. Report issues
Record every step that failed or needed guessing in the handoff issue list; fix the documentation (plan Phase 11, item 11).
