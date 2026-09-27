# Threat model and access control (plan Phase 0, items 26–27)

## Assets
| Asset | Where | Why it matters |
|---|---|---|
| Ground truth (run → host/guest/condition) | app DB per host; `lvd-groundtruth-*.json`; `release/supervisor/key.json` | Leaks would break the blind test (R5). |
| Raw observations incl. full IPs and headers | collector `.data/collector.db` | Personal data for volunteers; retention-limited. |
| Consent register (pseudonymous codes) | app DB | The code-to-name key is held offline by the consent officer. |
| Collector admin key | OS keychain via Electron safeStorage; server env | Allows run registration and raw export. |
| Guest images | app `images/` (read-only, hashed) | Integrity of experimental conditions. |

## Actors
- **Operator** (runs guests): app access on a study host.
- **Supervisor**: collector admin key, merged data, release key.
- **Blue team**: only `release/blue/*`.
- **Volunteers**: run the study page and the agent on their own machine, with consent.
- **Public / examiners**: redacted public dataset only.

## Trust boundaries and controls
| Boundary | Control | Implemented in |
|---|---|---|
| Renderer ↔ privileged main process | contextIsolation, sandbox, no Node, one `invoke` bridge, allow-listed channels, zod-validated input, sender-origin check, strict CSP | `app/src/main/ipc.ts`, `app/src/preload/index.ts` |
| Guest ↔ host | QEMU user NAT; control socket in a 0700 directory; display bound to 127.0.0.1; provisioning server on loopback with a per-guest 128-bit secret | `qemu.ts`, `provisioning.ts` |
| Guest browser ↔ internet | Managed policy allows the collector origin only; proxy pinned for proxy exits | `provisioning.ts` (`chromiumPolicy`) |
| Client ↔ collector | Only registered run tokens accepted; 64 KB body cap; peer address from the socket; client-sent forwarding headers ignored | `collector/server.mjs`, `lib/server.ts` |
| Evidence integrity | Append-only tables (DB triggers); manifests hashed before registration; completion files read-only; exports with SHA256SUMS | `store.ts`, `runs.ts` |
| Supervisor ↔ blue team | Blinding with random IDs, HMAC-pseudonymised IPs, header allow-list, planted token removed; leakage audit must pass; freeze receipts before release | `analysis/lvd_analysis/blind.py`, `leakage.py`, `freeze.py` |

## Residual risks
- A local user with filesystem access to the app data folder can read ground truth. Mitigation: study hosts are university-managed; ground-truth exports are written read-only (0400).
- `clockOffsetS` and `user-agent` are legitimately observable and can help link hosts. This is part of what is measured, not a leak.
- The dev fallback admin key (`dev-admin-key`) must never be used in production. The collector refuses admin calls without `COLLECTOR_ADMIN_KEY` when `NODE_ENV=production`.
