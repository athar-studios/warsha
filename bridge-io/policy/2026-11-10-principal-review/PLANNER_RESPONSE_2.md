# Planner response 2 — reply to the 2026-11-10 ~19:00Z report, and the ordered work that follows

From: Fable 5.2 (principal reviewer, planner of record v2). To: the Qoder orchestrator.
Written 2026-11-10T20:10Z against `dev` = `ba90e71`, R0 integration = `d3241e6`, KEEL integration = `9c64d24`,
`2026-11-09-ui-v3/state.json` seq 122, `2026-11-10-keel/state.json` seq 18. This file **amends**
`2026-11-10-principal-review/HANDOVER.md`; where the two differ, this one wins. Paste it whole.

Everything below was measured from the gate files and the branches, not taken from the report. The planner wrote
three new planner-owned files in the UI v3 evidence dir and nothing else there: `tools/pw-genesis.mjs`,
`named/V3POOL.txt`, `named/V3POOL.snap.txt`, plus two logs `gates/U4.pw.genesis.log` and `gates/U5.pwb.genesis.log`.
`state.json` and `acceptance.json` were not touched — they are yours to update at your next transition.

## 1. Verdicts on your four questions

**Q1 — evidence for C1, C2 and the part of C3.** Re-judged independently today from the stored JSON with
`tools/pw-gate.mjs` (self-test 7/7):

| Capture | Result | Verdict |
|---|---|---|
| `RH1.post.json` | 884 expected, 0 unexpected | stands |
| `F3.7.json`, `U1.pw.json` | 884 / 0 each | stand |
| `E0.pw2.json`, `E0.3b.json` | 898 / 0, 14 / 0 | stand |
| `U5.6b.json`, `U5.pwb.json` | 71 / 0; 969 / 120, outside = 0, **120 of 120 fail only on a missing snapshot** | stand |
| `U4.6.json` | 41 / 0 | stands |
| `U4.pw.json` | 1130 / 96, outside = 0 — but **8 of the 96 also fail the layout audit** | **withdrawn** |

C1 and C2 are accepted. U5 is accepted. **U4's `.pw` verdict and the RU4 refresh are not accepted**, see §2.1.
Orchestrator-judged verdicts are acceptable only as provisional: record each role merge in `state.json` `roles`
(ENGINEERING_POLICY §2), and have a separate verifier re-judge from the same JSON before C-final. The re-judging
above covers the rows listed; nothing else is covered.

Merging U5 before U4 is accepted as a dependency fix. Merging both **before U3** has a cost the report does not
state: U3 rewrites `apps/desktop/src/v3/pages/frame/Frame.tsx`, which is in every screenshot, and FNT changes every
glyph. The 216 baselines of RU5 and RU4 are therefore provisional and are replaced in §4.

**Q2 — S1c.** The claim is correct. Checked against the crates.io API on 2026-11-10: `sqlx-sqlite` newest is 0.9.0
(2026-05-21) and requires `libsqlite3-sys >=0.30.1, <0.38.0`; `libsqlite3-sys` 0.39.0 was published 2026-10-24;
`rusqlite` is at 0.41.1. Both SQLite users live in one crate (`warsha-store`: `lib.rs` on sqlx, `persistence.rs` on
rusqlite). The advisory is local (`AV:L`, `UI:P`, confidentiality only) and needs the victim to open an
attacker-written database with its `-wal`. Planner recommendation: a time-boxed risk acceptance. That is the owner's
decision, not ours — see OD-S1c in §3 and the conditional packet in §5.5.

**Q3 — scope and gate amendments.** F3.4 (path of the root `playwright.config.ts`), U5.7 (commit `41088e7`, three
lines in the e2e stub, read and sound), K1's `crates/warshad/tests/**` extension, the per-packet `scope.sh`, and the
`k3-mock-scan.sh` repair are accepted: none loosens what a gate proves. **K3.1 is not accepted as recorded.** The
frozen `check` text in `acceptance.json` was edited in place and narrowed from all crates to two. Frozen rows are
never rewritten; §5.4 says how to put it right.

**Q4 — priority.** R0 is the critical path and it has more open work than the report lists (§2). KEEL continues in
parallel exactly as now; it does not use the capture lane.

## 2. What the report left out

### 2.1 Eight broken Workbench renders were judged "genesis" and frozen as baselines

- `gates/U4.pw.json`: the cases `bench-assistant-390x844-{ar,en}-{light,dark}` and
  `bench-gate-waiting-390x844-{ar,en}-{light,dark}` fail `auditLayout` — `emptyBoxes: <div> "وضع الخطة: يقترح
  المساعد الخطوات" holds text but is 0×198` and the like. `named/U4.txt` matches any `bench.spec.ts @visual` case, so
  the fence cannot tell a missing baseline from a broken page. That is a weakness in the planner's gate; it is closed
  by `tools/pw-genesis.mjs` (§4).
- `gates/RU4.meta`: `update_exit=1`. `gates/RU4.update.log`: `88 passed`, `8 failed`. All 96 files were committed
  anyway (`d3241e6`). There is no post-refresh run for RU4 or RU5; RH1 had one.
- `node tools/pw-genesis.mjs check gates/U4.pw.json named/V3POOL.txt` → `unexpected=96 judged=96 genesis_only=88
  defective=8`, exit 1. The same on `U5.pwb.json` → `120 / 120 / 0`, exit 0.
- The integration tip `d3241e6` is therefore **not green**: the eight cases fail on any run, with or without
  baselines.

### 2.2 Nobody looked at the baselines

The planner opened the committed PNGs. At 390×844 the Workbench is unusable in **all** twelve states, not only the
eight the audit caught: `apps/desktop/src/v3/pages/bench/bench.css` has no narrow-width rule, the project rail keeps
its width, and the workbench is squeezed to a clipped strip. `settings-models-ready-390x844-ar-*` overflows
horizontally and its content is cut. `settings-general-ready-390x844-ar-*` draws the budget value outside its field.
The brand title touches or crosses the inline-start edge in every capture. The existing audits do not test whether a
page fits its viewport.

### 2.3 Decisions and packets of plan v2 that never entered the run

| Item | Source | State on disk |
|---|---|---|
| **FNT** — bundle IBM Plex (owner decision 2026-11-10, OD-U2 = A), "before RU3" | HANDOVER §3.1, DECISIONS | absent from `state.json`, `acceptance.json`, `PACKETS.md`; `owner_decisions.OD-U2` still `"C"`; no `@fontsource` on any branch; Google Fonts links still in `apps/desktop/index.html` and, on integration, `apps/remote/index.html` |
| **T1** — mode-switch soak | HANDOVER §3.5 | no `mode-soak.spec.ts` on any branch |
| **K9** — non-test `unwrap()`, `--follow`, CLI device id | HANDOVER §4 | declared out of scope in the KEEL `state.json` |
| **K8** — trust boundaries in `SECURITY.md` | HANDOVER §4 | `SECURITY.md` not in K8's allowed files; no gate |
| **K2b** — `runs.resume` wire type in `packages/client` | HANDOVER §4 | daemon method exists; no client method; `health` does not advertise it, so the v3 controls gated on `capability: 'runs.resume'` can never appear |

K2 also diverges from plan v2 on meaning: `reject_gate` leaves the run `Paused` and `resume_run` treats a rejection
like a change request; `gates.changes` pauses and nothing resumes unless a second call is made, which no client can
make. The owner-visible defect the review reported — "request changes ends the run" — is therefore still present
end to end.

### 2.4 Records that no longer match the work

`state.json` (seq 122): `plan.refreshes` RU4 and RU5 read `not-run`; `integration_tip` and `branch_heads` name
`6025715`; `in_flight` lists four tasks from 04:14Z; `program_amendment` says OD-R5 waits for the owner. A run must
be resumable from `state.json` alone (ENGINEERING_POLICY §3). `acceptance.json`: `U1.2` reads `not-run` for a merged
packet although `gates/U1.2-storybook.log` shows a successful build.

Writes in the shared checkout (ENGINEERING_POLICY §6): `rust_out.exe` and `rust_out.pdb` in the repository root
(2026-11-10T18:54Z), and 48 PNGs under `Warsha/warsha-wt/v3/integration/apps/desktop/e2e/` — a copy-back aimed at a
relative path.

## 3. Planner decisions (also in `DECISIONS.md`, 2026-11-10)

1. RU5 and RU4 are provisional. Their 216 baselines are removed and re-captured once, in RG, after the pages are
   final.
2. A genesis capture must pass **both** `pw-gate.mjs failures` and `pw-genesis.mjs check`. An `--update-snapshots`
   run must exit 0 before one file is copied. A refresh is done only after a full post-run with zero failures.
3. Every refresh has a **visual review**: a reviewer that can read images, and did not build the page, opens every
   distinct state at both viewports and records `visual-review.md`. A defect is a repair item; nothing is committed.
4. Narrow Workbench (planner as designer): below 768 px inline size the rail leaves the layout and opens in a
   `Sheet` from a labelled button; header actions wrap; the stage strip and the tab list scroll inside their own
   track; the page never scrolls horizontally; the DecisionCard's primary action is visible at 390×844.
5. Gate meaning: `gates.reject` ends the run on purpose — `Cancelled`, with an event `{action: "gate_rejected"}`,
   not resumable; no new `RunStatus` variant. `gates.changes` pauses; the client then calls `runs.resume`, which
   re-runs the producing stage with the notes. `runs.resume` also serves a raised budget and an interrupted run.
6. K9 and the `SECURITY.md` part of K8 are restored to KEEL.
7. T1 is amended to what a 2-CPU host can do: the soak spec passes 20 consecutive runs of itself, and three
   consecutive full-suite runs (RG pre, RG post, C-final) contain no `Target closed`.
8. **OD-S1c is open and is the owner's.** Recommendation: accept RUSTSEC-2026-0459 until SQLx supports
   `libsqlite3-sys` ≥ 0.39 or packet E7 (one SQLite library) lands, whichever is first, and in no case past
   1.0.0-rc. Act on it only if `DECISIONS.md` holds an entry titled "Owner decision: OD-S1c".

## 4. R0 — ordered work (one capture lane; `EV=bridge-io/policy/2026-11-09-ui-v3`)

No RU* and no merge of U3 or U6 until steps 1–2 are done. The reviews of U3 and U6 continue meanwhile.

1. **Record.** At your next transition: `owner_decisions.OD-U2 = "A"`; add packets FNT, VF, F5, F6, T1, K2w and
   refresh RG; set RU4 and RU5 to `provisional-superseded` with their commits; correct `integration_tip`,
   `branch_heads`, `in_flight`, `program_amendment`; record the role merges in `roles`. In `acceptance.json`
   **append** rows, never rewrite one: `U4.pw` keeps its text and gets verdict `fail` with a note pointing to
   `gates/U4.pw.genesis.log`; fold `U1.2` from its log or re-run it.
2. **Remove the provisional baselines.** In `warsha-wt/v3/integration`: `git rm -r -q` the two directories
   `apps/desktop/e2e/v3/bench.spec.ts-snapshots` and `apps/desktop/e2e/v3/settings.spec.ts-snapshots`; commit
   `test(e2e): drop the provisional U4/U5 genesis baselines (planner, RG)`. Fence:
   `node $EV/tools/pw-gate.mjs snapshots d3241e6 HEAD $EV/named/V3POOL.snap.txt` exit 0, 216 changes.
3. **Packets**, each in its own worktree from that tip, gates frozen by a planner role that does not implement
   them, implementer ≠ reviewer ≠ verifier. For every `.pw` gate from here to RG the named set is
   `named/V3POOL.txt`, and a second row runs `node $EV/tools/pw-genesis.mjs check <json> $EV/named/V3POOL.txt`
   (exit 0). No failure may fall outside the pool.
   - **FNT** (S) — exactly HANDOVER §3.1. Desktop v3 path only until U7.
   - **VF** (S) — `apps/desktop/e2e/v3/support/` gains `auditViewportFit(page)`: the document and `main` have no
     horizontal overflow (`scrollWidth <= clientWidth`); `main` is at least 320 px wide at a 390 px viewport; the
     brand title's box lies inside the viewport. Every `@visual` case of the v3 specs calls it as a soft assertion.
     A negative control (a page with a fixed 600 px child at 390 px) must fail it. Allowed:
     `apps/desktop/e2e/v3/support/**` and the `@visual` blocks of `apps/desktop/e2e/v3/*.spec.ts`.
   - **F5 bench-narrow** (M) — decision 4, in `apps/desktop/src/v3/pages/bench/**`, the bench action registry and
     the two bench catalogs. New action `bench.rail.open` registered, translated (ar + en) and clicked by an e2e
     case. Logical properties and tokens only.
   - **F6 settings-narrow** (S) — the models section fits 390 px in Arabic (the provider URL is `dir="ltr"` and
     wraps or truncates); the default-budget value stays inside its field.
   - VF, F5 and F6 are verified together on one scratch merge: both tools exit 0, and the eight cases of §2.1 no
     longer appear as defective.
   - **U3** — finish the review. Repair items to add: the six specs call `auditViewportFit`; the brand title is
     inside the viewport at both sizes. `U3.pw` keeps its frozen text; append `U3.pw2` (the same command against
     `named/V3POOL.txt`) and `U3.gen` (pw-genesis). Verify, then merge.
   - Merge order: FNT → VF → F5 → F6 → U3, guards after each (`arch 5/0`, `policy 8/0`, `wire`).
   - **T1** (S), after U3 — `apps/desktop/e2e/v3/mode-soak.spec.ts`, decision 7.
4. **RG — the one consolidated genesis refresh**, on the tip after U3 and T1:
   1. Full pre-run → `gates/RG.pre.json`; `pw-gate failures … named/V3POOL.txt` exit 0 **and**
      `pw-genesis check … named/V3POOL.txt` exit 0.
   2. `--update-snapshots` on the pool specs only. **The run must exit 0.** Otherwise stop; it is a repair item.
   3. Visual review → `packets/RG/visual-review.md`. Every distinct state, 1280×800 and 390×844, `ar-light`, plus a
      sample of `en` and `dark`. Checklist: nothing cut at a viewport edge; no horizontal scroll; the primary action
      is visible; no Arabic word is truncated; numbers sit inside their fields; glyphs are the bundled Plex.
   4. Commit snapshots only; `pw-gate snapshots <pre-tip> HEAD named/V3POOL.snap.txt` exit 0.
   5. Full post-run on the new tip → `gates/RG.post.json`; `pw-gate counts <listed> 0` exit 0.
5. **U6** — add the `@warsha/ui/v3/fonts.css` import in `apps/remote/src/main.tsx` as a repair item; review, verify,
   merge; then RU6 with steps 2–5 of RG (pw-genesis does not apply to a re-look; the visual review does).
6. **K2w** (S), once KEEL's K1–K3 and K2d (§5.2) are merged into the R0 integration branch:
   `packages/client` gains `resumeRun`; `scripts/check-wire-contract.mjs` covers `runs.resume`; the three
   `*.gate.changes.*` registry entries call `gates.changes` then `runs.resume`; the capability map reads the
   daemon's advertisement. e2e effect cases: a change request reaches `runs.resume`; a rejection leaves no run
   waiting. If KEEL is not merged by C-final, 0.3.0 ships with those controls hidden, as amendment 2 already says.
7. **U7**, then **C-final** as planned: 0.3.0, GC.1–GC.17, no `not-run` row for any merged packet, local draft
   bundle, non-force push of `main` (OD-P1) only on a green C-final, install on the owner's PC, `--self-check`.

## 5. KEEL — ordered work (`EV=bridge-io/policy/2026-11-10-keel`)

1. Continue K4 → K5 → K6, then the independent security review of the combined diff. Unchanged.
2. **K2d** (S, crates only, after K4 in the `lib.rs` chain) — decision 5: `reject_gate` sets `Cancelled` and emits
   `gate_rejected`; `resume_run` refuses a rejected run; `health` advertises `runs_resume`. Tests: a rejected run
   cannot be resumed and is not counted as waiting; the capability is reported. The review of K4–K6 should also
   decide whether `runs.resume` belongs at `Session/Standard` (as `runs.advance` is today) or `Owner/Spend` (as
   `runs.start` is); record the answer.
3. **K9** (S) — as HANDOVER §4. **K8** also adds a "Trust boundaries" section to `SECURITY.md` covering
   `RunCommand`, MCP servers, plugins and skills, with a frozen gate for it.
4. **K3.1** — restore the frozen `check` text in `acceptance.json`; append `K3.1a` holding the narrowed command and
   its pass. Add **CP.5**: the original all-crates search, run at the KEEL tip after K7 and K9, from a script with a
   negative control. Measured today at `9c64d24` it still prints `warsha-backends/src/lib.rs:188`,
   `warsha-cli/src/lib.rs:530` and `:555`, and four lines in `warsha-remote/src/lib.rs`; the `routines.rs` hits are
   inside the test module. One carve-out is granted and must be written into the script by name: the comment in
   `crates/warsha-backends/src/lib.rs`, owned by ENGINE E4.
5. **S1c** — only if `DECISIONS.md` holds "Owner decision: OD-S1c" with an acceptance: packet **S1c-RA** adds
   RUSTSEC-2026-0459 to `deny.toml` `[advisories].ignore` with the reason and the review trigger of decision 8,
   adds the exposure note to `SECURITY.md`, and lists in its report every place a SQLite file is opened, showing
   each path is under Warsha's own data directory. CP.2 then runs unchanged. Without that entry S1c stays blocked,
   KEEL can reach "ready for acceptance with one owner-only blocker", and 0.3.1 is not released.
6. K7, K8, then S1a, S1b, S1d, S2, S3 re-run at the KEEL tip.

## 6. Housekeeping

- Find what wrote `rust_out.exe` / `rust_out.pdb` into the repository root and the 48 PNGs under
  `Warsha/warsha-wt/`; confirm nothing references them; remove them; add the rule to the worker brief: `rustc`
  scratch builds and copy-backs use absolute paths inside the worktree or the scratch dir.
- The evidence directory is git-ignored (`.gitignore:74`), so it exists on one disk only. Say so in the final
  report.

## 7. What does not change

Frozen gates are not edited, narrowed or re-worded; an amendment is a new row. No force-push, tag, publication or
post. No agent approves a product gate. Secrets only in the keychain. No real model or registry in tests. No
snapshot is written outside a fenced refresh. No write in the shared checkout. Bounded repair, then `blocked`.

## 8. Report back

One short file, `bridge-io/policy/2026-11-10-principal-review/REPORT_3.md`, generated from `state.json` and the gate
logs: for each step of §4 and §5 the commit, the gate rows with exit codes, and the path of each
`visual-review.md`. State what was not run. A claim with no file behind it counts as not done.
