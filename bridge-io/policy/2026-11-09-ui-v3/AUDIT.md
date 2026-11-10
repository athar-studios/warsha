# Run audit — 2026-11-09-ui-v3 · refreshed 2026-11-09T12:40Z · state seq 20 (R0 done; Wave A implementing)

**R0 closed** at `4c65ead` (58 snapshots, owner word «refresh R0»): frozen Rx step-8 gate attempt 2 = 884/0/0, dirty 0;
attempt 1 = 883/1 flake (`flows.spec.ts` mode-group 390x844 en browser-closed, isolated 30/30 twice); both attempts
and isolation logs preserved, no gate/set edited. **Wave A dispatched** 12:35Z at base `4c65ead` (U0, U2, H1, R1, V1;
five background Coders; P7 deferred). Narrowed Wave C core-RPC inventory landed (`research/served-rpc-core.md`, 12/12
served); broad inventory bare-failed and is not done — a known uncovered aid, not a gate. Landing tooling:
`collect-heads.mjs`, `fill-wave-a.mjs`; resume order in the PROGRESS.md seq-20 entry.

## (previous header, seq 15) R0 committed; Rx 8 re-run in flight

Durable prompt-to-artifact checklist. Refresh on every state move. Verdicts come only from `gates/*` logs and
`acceptance.json`; "not-run" means exactly that. **Blocker cleared**: owner approved OD-F1 (option A, 10:21:35Z) —
scoped waiver for the two v2 mobile-providers defects. **F1 complete and merged at C0.5** (`9cc7751`): implemented
`fbc6351`, review FINAL APPROVE, verification 7/7 (F1.6 scratch `1ff806a` 884/826/58 pixels-only outside=0; F1.7
cases=4 defect-errors=0). **R0 refresh committed** `4c65ead` (58 snapshots only) on the owner word «refresh R0»
(~11:39Z, OD-U1 review-each) after pack `od-visual/R0-post/` presentation; snap fence outside=0 exit 0.
**Rx step 8 full re-run at `4c65ead` in background** (r0-post-rerun.sh, alive at 11:43); on counts 0 + clean
snapshots: fold-refresh.mjs → Wave A dispatch (fill-briefs.mjs 4c65ead). Snap-regex prevalidation persisted
(gates/snap-regex-prevalidation.log): H1=180, U3–U6=0 by design (genesis), U7=763, ALL=763. C-final tooling ready
(int-rel.sh, run-gc.mjs GC.1–12, build-bundle.sh, sweep.sh, cfinal-templates.md); environment risks in
cfinal-environment.md (java/GC.14, docker-Windows/GC.17, actionlint versions, signing validity unverified).

## A. Every problem in the owner's list → packet / proving gate → current evidence
| # | problem | packet → gate | state |
|---|---|---|---|
| 1 | Simple chat canned 1s reply | U3 dock=runs.followup, U4 assistant=agent.* → U3.4, U4.4 + e2e | not-run (Wave C) |
| 2 | chosen model never reaches runs.start; 4 hard-coded ids | U1.5, U4/U5 → actions-gate A7 | not-run |
| 3 | fast mode/permission chip/Plan badge/slash/@mentions/snapshot restore/terminal input/preflight/deploy dead or fake | not rendered (UI_V3_PLAN §6) → reviewer + actions-gate | not-run |
| 4 | Preview Run/Stop TODO | U3/U4 preview actions → U3.4/U4.4 + e2e | not-run |
| 5 | RunView Advance notice-only | U4 → bench.run.advance → U4.4 | not-run |
| 6 | Gates inbox Approve/Reject never reach daemon | U3 inbox.gate.* → U3.4 + e2e | not-run |
| 7 | top bar raw UUID | U3 ProjectSwitcher names | not-run |
| 8 | Budgets/Devices/Roles/Providers/Artifacts/Run deep-link only | IA → U3/U4/U5 | not-run |
| 9 | retry stream clears banner, never reconnects | U2 useRunEvents → U2.8 | not-run (Wave A) |
| 10 | hard-coded roster/stages/models/workflows | daemon data → A7 | not-run |
| 11 | two composers/selectors/mode switches; fake "verified" stamp | one of each → U3.simplicity, GC.10 | not-run |
| 12 | English labels inside Arabic UI | v3 catalogs → i18n-gate (U*.3) | not-run |
| 13 | failing listRuns sends onboarded owner to onboarding | U2 app/startup.ts → U2.11 | not-run |
| 14 | ArtifactViewer fixture although runs.artifacts exists | U3/U4 artifacts views | not-run |
| 15 | five desktop stubs wrong shapes; crash baselines show daemon error | H1 → H1.6, H1.7 then RH1 | not-run |
| 16 | runs.subscribe camelCase run (remote harness) | H1 | not-run |
| 17 | remote harness no wire check; e2e blind to RPCs | H1 W10 + rpcCalls → H1.1, H1.8 | not-run |
| 18 | v0.2.1 screens changed with no Playwright run | G0 + fenced R0 (+ F1 for the 4 soft-assertion defects) | **G0 pass**; F1 implemented+APPROVE, verify running; R0 completion queued behind C0.5 |
| 19 | pairings.revoke drops error, returns Ok | R1 → R1.5 | not-run |
| 20 | pairings.create / MCP connect-disconnect / DB-error→default harness / corrupt JSON rows | R1 → R1.5 + tests | not-run |
| 21 | preview policy split_whitespace vs quote-aware split_command | R1 → R1.6 | not-run |
| 22 | two non-test unwrap() in pipeline settings | R1 → R1.4 | not-run |
| 23 | sleep 30/120 fixed sleeps (12 sites) | R1 → R1.7 | not-run |
| 24 | BOOTSTRAP_ADMIN_TOKEN via tracing info! | R1 → R1.10 | not-run |
| 25 | Agent RunCommand spawns any program; sh -c bypass | P7 — **only if OD-B4=approve** | OD-B4=defer → NOT dispatched (owner default) |
| 26 | versions drift (0.2.1 vs 0.1.0, versionCode 1) | V1 → V1.1, V1.2 | not-run; drift measured at G0 (gates/G0.versions.log) |
| 27 | release.yml no tag check; workflow-level write perms | V1 → V1.5, V1.6 | not-run |
| 28 | APK asset sync ships stale remote dist | V1 step 4 → reviewer | not-run |
| 29 | root .gitignore no keystore rules | V1 → V1.7 | not-run |
| 30 | mobile README 840513 vs 842,981 | V1 → V1.8 | not-run |
| 31 | Docker no version label; compose tag 0.1.0 | V1 → V1.9, V1.1 | not-run |
| 32 | DAEMON.md false gate_a/gate_b + providers.list claims | V1 → V1.11 | not-run |
| 33 | desktop-bundle.yml:18 stale comment | V1 → reviewer | not-run |
| 34 | Google Fonts links vs IBM Plex design/capture | U0 fonts (OD-U2=C: stack only) + U6.3, U7.5 | not-run (U6 Wave C; U7 owner-gated) |
| 35 | 26 stale worktrees / merged branches | OD-B6=yes only | OD-B6=no → **listed only** (od-b6-*.txt: 27/25 lines) |
| 36 | updater/signing/CI APK-Docker/environment protection | human-only | to list in final report (C-final) |
| 37 | everything ships as LOCAL draft bundle only | C-final | pending; nothing pushed/tagged/published so far |

## B. Build requirements → packets/gates
DS v3 clean slate (tokens both themes, yellow #FFD400 fill + #1B1A17 ink one primary/view, #7A5C00 light indicators,
orange=waiting, Plex stack per OD-U2=C, 4-based space, densities, 46 icons, 19 primitives, 27 composites, 50 AA pairs)
→ U0 (U0.1–U0.11), U1 (U1.1–U1.6); contrast tool self-test green at step 0 (fails 0).
Simple mode measured (≤10 actions fold, ≤1 primary, one composer, no Latin in Arabic) → U3.simplicity + GC.10.
Advanced workbench (rail, controls, 14-stage strip, 10 tabs, real assistant on agent.*) → U4 (U4.1–U4.7).
Settings 12 sections / Inbox / 3-step onboarding → U5, U3. Phone PWA same system → U6 (U6.1–U6.5, flows 7/7).
"Every control works or does not exist" → actions-gate + per-action e2e (U*.4) + E0 support (E0.1–E0.4).
v3 beside v2 (?ui=v3), v2 default + suites green until U7 → U2.9, every .pw gate; U7 only on OD-U3=yes.

## C. HANDOVER steps → state
0 done (seq 4: answers+provenance, self-tests 7/12/8/fails 0, integration branch, hygiene list).
1 G0 done (seq 5, acceptance G0 pass, logs verified on disk). R0: Rx steps 1–4 done (pre/fence/pack/owner release),
step 5 ran (54/58 refreshed; 4 defects) → **blocked seq 6** before steps 6–8; nothing committed.
Waves A–D, C1–C4, C-final: pending. U7 stop = OD-U3 ask-at-U7. Refresh stops RH1/RU3–RU6 = OD-U1 review-each.

## D. Non-negotiables → compliance evidence
implementer≠reviewer≠verifier: G0 verifier = Test engineer (separate); rehearsal implementer = Coder, diff reviewed
by orchestrator (rehearsal is not a packet); packet roles assigned at dispatch from 33 prebuilt role briefs.
Gates satisfied only by running with logs: acceptance G0 logs all exist (audited); no verdict without log.
No gate edited/skipped/narrowed/re-worded: gates.md + named/* untouched (proposals/ holds drafts only); build-plan.mjs
never run. Repairs ≤3 via review: none opened yet. No implementer touches *-snapshots/**: none dispatched; refresh
only via Rx (pending). No new dependency (OD-U2=C): none. v2 untouched until U7: run branches clean at ba90e71;
only scratch/od-f1-rehearsal (labelled, unmerged) carries v2 edits. No secret in evidence: logs carry none (token
print defect is R1's target, not present in logs). No real model API in gates: harness/mock only. Nothing
pushed/tagged/published/posted: git remote untouched; local branches/commits only.

## E. Owner decisions recorded
OD-U0 yes (utterance "consider it yes", provenance seq 4); OD-U1 review-each, OD-U2 C, OD-U3 ask-at-U7, OD-B3 0.3.0,
OD-B4 defer, OD-B6 no (defaults, blanks). R0 review-each stop released by owner goal "continue" 09:43Z (DECISIONS.md).
**OD-F1 approve-scoped** (structured answer «A», 10:21:35Z): waiver of v2-untouched-until-U7 for exactly the two
mobile-providers defects; sequence F1 → C0.5 → R0 completion → Wave A approved with it; generic continue waives nothing.
RH1 and RU3–RU6 keep their own review-each stops; U7 keeps OD-U3.

## F. Orchestrator's own errors & corrections (durable)
1. WSL `$?` exit markers are hook-expanded and lie (UPDATE_EXIT=0 with 4 failed; member's g0.done empty). Authority
   switched to Playwright JSON stats + pw-gate logs; markers kept only as labelled hints.
2. named-F1 first validation premise wrong (expected exit 0 against G0's 58 failures). Corrected: selector check =
   inside 4/outside 54; F1.6 fence must be named/R0.txt because the 54 drift cases are still red at F1 verify time.
3. Two owner reports contained stray non-Arabic tokens (CJK/Hebrew). Corrected; proofread rule adopted.
4. R0 pack note said "3 of 58 opened, intended surface, no error states" — true for the 3 opened, but the 4 defect
   cases were not among them; the defect discovery came from the update-run log bodies. INDEX cause line ("no packet
   of this run caused these") remains correct; "intended surface" applies to the 54 drift cases only.
5. G0 delegated turn ended with runs in flight; collected from disk via Monitor without re-running (no collision).

## G. Uncovered / risks now
- **C-final environment (inventory landed ~10:52Z, `cfinal-environment.md`, lane closed at seq 10):**
  cargo-cyclonedx 0.5.9 matches the pin; NSIS 3.13 / WiX 3.14.1 / tauri-cli 2.12.4 present; gitleaks 8.30.1;
  docker present on Windows but **MISSING in WSL** → GC.17 runs on Windows; **java/JAVA_HOME absent** →
  apksigner.bat (GC.14) at risk, aapt2 fine — resolve or record uncovered at C-final, never fake;
  actionlint Win 1.7.12 vs WSL 1.7.7 (record both with V1.4 log); signing keystore+properties exist outside the
  repo (local signed APK not owner-blocked; validity unverified); `scripts/check-versions.mjs` absent until V1
  delivers it; release.yml workflow-level write perms confirmed as V1.5/V1.6's target.
- The 4 v2 defects + shared latent patterns on other screens (Researcher list) stay unfixed unless owner chooses A;
  under B they ship in v2 until U7. Latent patterns are green at G0 widths but unproven at others.
- Rehearsal measured only desktop providers grep (29+24); full-suite proof comes at F1 verify + R0 re-run.
- Capture-host font audit accepts mixed Plex+DejaVu at wide widths (documented); v3 genesis baselines will inherit
  the host's pinned fonts — RU3–RU6 owner reviews remain the check.
- Human-only items (signing, updater, CI APK/Docker, environment protection) cannot be closed by this run.