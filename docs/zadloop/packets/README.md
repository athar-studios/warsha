# R0-FIX packet index — CSP repair on `security/csp-fixes` (planner lane)

Status: **specifications only**. Nothing in this directory is code, evidence or a gate verdict. It was
written by the Architect/planner role in a read-only pass (no product code touched, no commit, no push,
no build). An implementer packet run turns each file below into work; a verifier — a role separate from
implementer and reviewer, per `ENGINEERING_POLICY.md` §1 Phase 5 — turns its gates into evidence.

Base facts this index is built on (measured 2026-11-13, see `R0-1` for the commands):

| Fact | Value |
| --- | --- |
| Local checkout | `/home/moe/Downloads/Warsha`, branch `security/csp-fixes`, commit `f0920e9` |
| `dev` tip | `f0920e9` (same commit — `dev` and `security/csp-fixes` point at one commit locally) |
| Bad remote merge | `f474776` "Merge branch 'security/csp-fixes' into dev", parents `f0920e9` + `467594a` |
| `f474776` tree | `3244827…` — **byte-identical to `467594a`'s tree**: the merge took the side branch's whole tree |
| Repair branch | `repair/dev-csp-f474776` = `da7732c`, single commit on top of `f474776`; never pushed |
| `crates/warshad/src/lib.rs` | `f0920e9` 12197 lines, `f474776` 8997, `da7732c` 12330 (+135/−2 vs `f0920e9`) |
| Uncommitted files in the shared checkout | at the start of this pass: **none**; by the end of the pass: the four CSP files, edited by the owner or a parallel session toward a *different* end state — see `R0-1` |

Two measurements that change how the packets should be read:

- **`f474776` is a content-less merge.** Its tree hash equals `467594a`'s
  (`324482701dec1d2ba0310450898e0acf67a662de`) *and* `f0920e9`'s merge base equals `f0920e9` itself, yet the
  tree differs from `f0920e9` — so the merge commit adopted the side branch's entire tree, `lib.rs`
  included. Nothing in `f474776` is "ours"; there is no conflict resolution to preserve, and any repair
  that keeps a hunk of its `lib.rs` is keeping a main-based copy.
- **`gix` is declared and used by nothing.** `Cargo.toml:65` says `gix = "0.70"`, no crate manifest or
  Rust source references it, and `gix` appears in no `Cargo.lock` on any ref (`dev`, `f0920e9`, `main`,
  `939a173`, `f474776`, `da7732c`). Renovate PR `#5` is therefore a manifest-hygiene decision, not the
  security fix its `[security]` label implies.

The R0 dependency order is `R0-1` → (`R0-2` ∥ `R0-3`). `R0-2` and `R0-3` may run in parallel **only** if
their file sets stay disjoint — `R0-2` owns `packages/client/src/index.ts`, `deny.toml` and
`.github/workflows/ci.yml`; `R0-3` owns `Cargo.toml`/`Cargo.lock`/`pnpm-lock.yaml`/`package.json` and the
Renovate branches. Neither may touch `crates/warshad/src/lib.rs`; if a gate forces a change there, the run
stops and reports (`ENGINEERING_POLICY.md` §5, out-of-scope blocker). Renovate `#16` also edits
`.github/workflows/ci.yml`, so it must follow `R0-2` rather than race it.
