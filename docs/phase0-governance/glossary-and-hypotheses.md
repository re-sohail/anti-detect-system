# Units of analysis, labels and hypotheses (plan Phase 0, items 14–18)

## Units (brief §1)
| Unit | Definition | Where it is recorded |
|---|---|---|
| Visit | One page load of `/t/<run token>` and one completed collector submission. | collector `visits` (unique `visit_id`) |
| Session | A continuous period of browser use within one run. | run window (`createdAt`–`finishedAt`) |
| Guest | A VM with a persistent disk. A restored snapshot is a new **condition** of that guest. | app `guests`, `conditionSeq` in the manifest |
| Host | A physical computer. For physical-control runs it is the volunteer's machine (`control:<participant code>`). | ground truth `hostId` / merged `truth.host` |
| Network exit | The public endpoint the collector observes. | collector `peer_ip`; app exit registry |

## Pair labels
`same-guest`, `different-guest-same-host`, `different-host`. The binary positive class is **same host** (the first two labels). A detector that recognises virtualization has not thereby linked two guests to one host; these are scored separately.

## Hypotheses
- **H1 (engineering).** For the same measurement protocol, separate guests on one host show storage separation that is not present between two profiles in one OS installation. *Test:* R1 token test across guests vs across profiles; falsified if any cross-unit token sighting occurs between guests.
- **H2 (measurement).** Some guest observations reveal virtualized or shared resources, so a blinded detector links different-guest-same-host pairs with recall above the class-balanced random baseline, with the host-level bootstrap interval excluding the baseline. *Falsified if* the interval overlaps the random baseline for the preregistered detector.
- **H3 (longitudinal).** A browser or OS update changes part of the observation vector. *Test:* stability report before and after a controlled update; the held-out-time split is scored separately. *Falsified if* no field changes across the update and time-split metrics equal host-split metrics within their intervals.

## Success (brief §1)
The team reproduces the dataset, evaluates a blinded detector, reports successful and failed links, and states the conditions for each conclusion. A reviewer demonstrating one distinguishing feature is a finding to investigate, not grounds to rewrite data.

## Non-goals
No claim of universal non-detectability. No testing on third-party platforms or personal accounts. No evasion guidance: ablations are reported by broad family only.
