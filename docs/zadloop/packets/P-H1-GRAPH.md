# P-H1-GRAPH — Split `crates/warshad/src/lib.rs` by dependency graph (pure moves only)

Status: spec frozen. Base: `121cf87` (repair/dev-csp-f474776). This packet supersedes the stale line map in `docs/zadloop/packets/R-ENGINE-audit.md` §2 (that map was drawn at 13,451 lines; the file is now ~15,684 lines). The audit's target layout (§2.2) and invariants (§2.4) still stand.

## Mission

Split `crates/warshad/src/lib.rs` (~15,684 lines) into the target module layout using a **dependency-graph-first** method, with **zero behaviour change**. Purpose: cut per-turn token cost permanently (agents read one small module instead of the whole monolith) and unlock parallel work on the remaining queue (B5, R-UI, R-EXT). Speed matters, but a green gate is worth more than a fast red one: this packet is done when the split is complete AND the full gate suite passes with **no test modified in content**.

## Hard rules (any violation = STOP and report, do not improvise)

1. **Pure moves only.** No logic edits, no renames, no "small cleanups", no signature changes. If a move seems to require a logic change, STOP: that is hidden coupling — record it in the graph map and report to PM.
2. **Tests move verbatim.** Test code may change file, never content. If a test fails after a move and the fix is anything other than a `mod`/`use`/ visibility adjustment, STOP and report.
3. **Public API and wire contract unchanged.** `lib.rs` ends as a facade: module declarations + the same `pub use` surface as today.
4. **Never retype code through the model.** Moves are mechanical: extract exact line ranges with a script (python/sed), then hand-edit only the seams (`mod` declarations, `use` lines, `pub(crate)` visibility where the graph requires it). A step whose diff is not move-shaped (deletions from lib.rs ≈ additions in the new file, modulo seam lines) fails review automatically.
5. **Token discipline.** Never read `lib.rs` wholesale. Work only from the graph map (Phase 0) plus targeted line ranges of the region you are moving and its direct graph neighbours. Keep reports in the terse packet format.

## Phase 0 — Build the graph before touching code (PM gate)

1. Inventory every top-level item in `lib.rs` with **current** line ranges.
2. Build the item-level dependency graph: for each region, which items it references in other regions (count cross-region references — that count is the coupling weight of the edge).
3. Cluster regions into the audit §2.2 target modules (`state.rs`, `api.rs`, `rpc/{mod,runs,gates,providers,processes,mcp,plugins}.rs`, `events.rs`, `http.rs`, `startup.rs`, `tests/…`), adjusting for modules that already exist (`auth.rs`, `events.rs`, `providers.rs`, `settings.rs`, `state.rs`, `mcp_approvals.rs`, `wave2.rs` — note what each already holds vs. what `lib.rs` still holds inline, e.g. `DaemonState` and the `WarshaApi` trait and the `WarshaRpc` impl are still inline).
4. Derive the extraction order topologically: leaves (no outgoing coupling) first, the `runs` RPC section last (largest blast radius: E2/E3/E5 wiring). Mark which extractions are independent of each other (= parallel-safe).
5. Deliverable: `docs/zadloop/packets/P-H1-graph-map.md` — region inventory, coupling matrix, extraction order, parallel groups. Commit the map alone. **No code moves until PM has spot-checked the map's line ranges against the file and approved it.**

## Phase 1 — Execute the split (one module per step)

For each module in the Phase-0 order:

1. Script-extract the exact line ranges into the target file; leave the facade (`mod` + `pub use`) in `lib.rs`.
2. Fix only seams: imports, visibility, `super::` paths.
3. Fast gates for this step: `cargo fmt --check`, `cargo clippy -p warshad`, `cargo test -p warshad`. All green → commit (`refactor(warshad): extract <module> (P-H1, pure move)`).
4. Move the tests that belong to the module in the same step, mirroring the layout under `tests/` or as sibling `*_tests.rs`, following the existing `auth_tests.rs` / `wave2_tests.rs` precedent.
5. Update the graph map with the module's final line count and mark it done.

**Parallelism (for speed):** modules in the same parallel group from Phase 0 may be extracted simultaneously in separate worktrees off the same base commit. PM merges them one at a time and re-runs the fast gates after each merge. The RPC impl sections and anything touching `DaemonState` are sequential, never parallel.

## Phase 2 — Close-out

1. Full gates on the merged tree: fmt, clippy, wire contract check, policy check, `cargo test -p warshad` (full), plus the workspace test suite.
2. Verify the facade: `lib.rs` contains only module declarations, re-exports, and truly shared leaf items — target ≤ ~300 lines. `grep` proof in report.
3. Report in `PROGRESS.md`: final module tree with line counts, total lines before/after (15,684 → same ± seam lines), gate results, and any coupling surprises found in Phase 0 (these feed B5 / R-UI planning).

## Done means

- [ ] Graph map committed and PM-approved before any move
- [ ] Every target module extracted, one commit each, move-shaped diffs
- [ ] Zero test-content changes (`git diff` on test bodies is empty)
- [ ] Full gates green on the final tree
- [ ] `lib.rs` is a facade (≤ ~300 lines)
- [ ] PROGRESS.md entry with before/after line counts per module
