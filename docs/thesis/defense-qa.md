# Review questions and prepared answers (brief §13, plan Phase 11 items 26–31)

**What is new relative to existing profile managers?**
A host-level, controlled, reproducible comparison with physical ground truth and a blinded detector evaluation — *if the team completes it*. Profile managers make configuration claims; this study measures profiles, VMs and physical machines with one versioned instrument and reports errors per condition.

**Is the VM a real second computer?**
No. It is a distinct guest environment using virtual resources on one physical host [11][18]. Its disk and browser storage are separate (R1); its CPU, GPU and network exit may be shared or virtual, and the study measures which of these are visible.

**How is different public networking proved?**
Only by what the receiver observed: the collector records the TCP peer address per visit, and each run has start/end egress checks and per-visit checks against the approved exit [22]. Client-supplied forwarding headers are ignored. Runs with an unexpected exit are invalid for that treatment.

**Can two visits be conclusively assigned to one physical host?**
No. The study reports a measured estimate under a defined threat model: confusion matrices, recall/FPR with host-level bootstrap intervals, per condition, for a frozen detector version, with small conditions marked exploratory.

**Can another lab reproduce the result?**
Only with the archive: tagged source, image checksums or recipes, version pins, the data schema and field dictionary, exclusion rules, deviation log, preregistration, frozen predictions and scoring scripts. `docs/thesis/reproduction-guide.md` walks through it, and an external team has to try it before submission.

**A reviewer shows one feature that distinguishes guests. Does the study fail?**
No. It is a substantive finding to investigate and report. The original data is not rewritten; any correction is appended with an annotation.
