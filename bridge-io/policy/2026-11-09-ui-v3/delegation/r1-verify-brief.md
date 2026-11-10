# R1 verification brief — run 2026-11-09-ui-v3 (verifier role)

Target: Test engineer (independent of the Coder implementer and the debugger reviewer).
Dispatch ONLY after the R1 re-review verdict is APPROVE (packets/R1/review-repair.md).

EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3
Packet worktree: C:/Users/Dragonfly/Downloads/warsha-wt/v3/r1
BASE=4c65ead4f46cf97eecffd73149a57056e505568c
HEAD=<the re-review-approved head; currently 7fec7a04d91fc3ba9fd6ddc2cb963d12e0d03c62 — confirm from review-repair.md>

Read EV/packets/R1/gates.md VERBATIM and run EVERY gate (R1.1–R1.10, R1.deps) exactly as written with EV, BASE, GATE set.
All R1 gates are host=windows/any — run them in the packet worktree on Windows (export CARGO_TARGET_DIR=<wt>/target, warm).
There is NO capture gate for R1; do not touch the WSL capture host.

Grep/sed negative-control gates (R1.4–R1.7, R1.9, R1.10, R1.deps): write each command to a script file and run the file
(the RTK hook rewrites inline grep and heredoc backslashes). The gate text is frozen — the script wraps it verbatim.

Raw stdout/stderr -> EV/gates/<gate id>.log. Then set verdict/exit_code/commit/timestamp(UTC)/log for each R1 gate id in
EV/acceptance.json (verdict fields only; never edit check/expect). R1.3 authority = the cargo test summary lines
(passed >= 754, ignored <= 10); read the log body, not an echo marker.

Never fix anything; failures become repair items returned to the orchestrator. Never edit gates, named sets, snapshots,
state.json, PLAN.md, PROGRESS.md, DECISIONS.md.

Deliverables: all logs, acceptance.json entries, EV/packets/R1/verify.md (per-gate table + uncovered scope + blockers).
Final answer UNDER 300 words: per-gate pass/fail table with exit codes and log paths, the cargo test counts, any blocker
classified (product vs environment vs permission).