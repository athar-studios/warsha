# REVIEW — packet V1 (release-truth) — run 2026-11-09-ui-v3

- Reviewer: independent REVIEWER (not implementer, not verifier). No implementation edits made.
- BASE `4c65ead4f46cf97eecffd73149a57056e505568c` → HEAD `017ffb9d98f63181ec73d9b00a8b81df1e0b29dc`
- Worktree `C:/Users/Dragonfly/Downloads/warsha-wt/v3/v1` clean at HEAD before and after review.
- Full patch read: 15 files, +454/−46 (matches report).

## Adjudication of orchestrator observations

1. **.gitignore stray blank lines** — The hunk adds the four keystore rules plus two trailing blank
   lines (`…keystore.properties\r\n\r\n\r\n\r\n`). The file remains well-formed: gitignore treats
   blank lines as no-ops, all rules are on their own lines, CRLF endings match the rest of the file.
   Cosmetic only. Not a defect.

2. **`--set` first-`"version"`-occurrence risk** — Verified in the actual files: `tauri.conf.json`
   contains exactly **one** `"version"` key, at line 4 (top level). Each of the seven `package.json`
   files has its first `"version"` at line 3, before any nested content. So the first-occurrence
   replace edits the top-level version everywhere today. (Latent fragility if a nested `"version"`
   were ever added above line 3 — worth a comment, not a change request.)

3. **`readVersions()` vs `apps/desktop/src-tauri/Cargo.lock` gap** — Real asymmetry: `setVersions()`
   rewrites both locks; `readVersions()` only reads the root one. Does **not** break the gate's
   intent: (a) the src-tauri lock currently holds `warsha-desktop 0.2.1` (verified), (b) the src-tauri
   `[package] version` itself is checked by row 2 of `readVersions()`, and (c) Gate V1.3's
   `cargo metadata --locked --offline` in `apps/desktop/src-tauri` (exit 0) fails on any lock/manifest
   drift, which is exactly what a stale lockfile would cause. Minor non-blocking observation: a
   hand-edit of the src-tauri lock version alone would not be flagged by `check-versions.mjs` itself.
   Also note `warsha-desktop` appears in `WORKSPACE_CRATES` but not in the root `Cargo.lock`
   (src-tauri is not a workspace member), so that entry is silently skipped by the root-lock loop —
   harmless, since it is covered by the src-tauri `cargo metadata --locked` gate.

4. **V1.5/V1.6 semantics (verified in `release.yml`)** — Top-level `permissions:` is exactly
   `contents: read` (line 19–20), no write before `jobs:`. The `release` job (line 517) carries
   `permissions: contents: write` (521–522) — the only job needing it (`softprops/action-gh-release@v2`
   at 571; no other job pushes or publishes; `manifests`/`docs` only generate files + upload-artifact).
   `draft: true` kept (line 576). Fail-early tag check present in `prepare` **before** the
   "Extract version from tag" step: `node scripts/check-versions.mjs --expect "${GITHUB_REF_NAME#v}"`.

5. **docs/DAEMON.md spot-check (code, not prose)** —
   - `Stage` enum is at `crates/warsha-core/src/lib.rs:74-89` (enum line 74, closing brace 89) with
     exactly 14 variants: Idea, GateA, Research, PrdSpec, GateB, Design, PlanTasks, Code,
     ReviewQaSecurity, GateC, Release, GateD, LaunchDrafts, Feedback — all 14 listed in DAEMON.md,
     `snake_case` matches the `#[serde(rename_all = "snake_case")]`. The stale "no gate_a/gate_b"
     and "providers.list returns an empty vector" claims are gone (grep exit 1).
   - `providers.*` claims verified against `crates/warshad/src/lib.rs`: `list` → `load_providers()`
     (line 2603–2611); `add` → validates name/kind/URL/key, `secrets.store` (keychain), `save_provider`,
     registers `DeferredProvider` (2613–2711); `test` → `resolve_test_model`, keychain `secrets.load`,
     `probe_endpoint` (2727–2775); `remove` → `secrets.delete`, `delete_provider`, registers
     `RemovedProvider` refusal adapter (2920–2958). Every DAEMON.md claim matches the code.

## Gate re-runs (reviewer, verbatim results)

- `node scripts/check-versions.mjs` → `versions: aligned`, exit 0
- `node scripts/check-versions.mjs --expect 0.2.1` → `versions: aligned (expected 0.2.1)`, exit 0
- `node scripts/check-versions.mjs --self-test` → `4 assertions, 0 failures`, exit 0
- `node scripts/check-arch.mjs` → `arch: 5 rules, 0 violations`, exit 0
- `node scripts/check-engineering-policy.mjs` → `policy: 8 checks, 0 failures`, exit 0
- `pnpm install --frozen-lockfile` → exit 0 (`Done in 2.2s`), `pnpm-lock.yaml` untouched
- `cargo metadata --locked --offline` at root → exit 0; in `apps/desktop/src-tauri` → exit 0
- V1.10 scope regex → exit 0 (all 15 files allowed; `docs/DAEMON.md` is in the V1.10 allow-list)
- V1.11 → exit 0 (stale claims gone, all 14 stages present)
- `actionlint .github/workflows/release.yml .github/workflows/desktop-bundle.yml` → exit 0

## Other checks

- Scope: no out-of-scope files; no `*-snapshots`, no PLAN/PROGRESS/DECISIONS edits, no dependency
  added, no `skip`/`#[ignore]`/`todo!()`, no weakened assertions (self-test's 4 assertions are real
  and throw on failure). No secrets in the diff; keystore rules *add* hygiene.
- Reject-on-sight list: not applicable (no UI/controls/strings in this packet); all four relevant
  items (data-action, registry, fake handlers, hard-coded replies) have no surface here.
- `build.gradle`: `Sync` task type, unconditional `pnpm --filter warsha-remote build` in `doFirst`,
  loud `GradleException` on missing `dist/index.html`, and `exclude '**/*.map'` all kept.
- desktop-bundle.yml comment now says `tauri.conf.json:38` sets `createUpdaterArtifacts` to **false** —
  verified: line 38 is `"createUpdaterArtifacts": false` at both BASE and HEAD; the old comment's
  "to true" was the false claim. The runtime `tauri.ci.unsigned.json` override is generated in the
  same file (line 142), so the new comment is accurate.
- mobile README: `840513` contradiction and stale UTC build date removed; `842981` consistent with
  the recorded SHA-256 block; v0.2.0 facts kept as a dated record.
- Report accuracy: stage citation `crates/warsha-core/src/lib.rs:74-89` correct; measured counts
  match (15 files, +454/−46; 13 version rows + versionCode).

## Findings

- **F1 (cosmetic, non-blocking):** `.gitignore` ends with two stray blank lines after
  `keystore.properties`. File is well-formed; clean up opportunistically.
- **F2 (non-blocking, hardening):** `readVersions()` does not read
  `apps/desktop/src-tauri/Cargo.lock` although `setVersions()` writes it; add the row for symmetry so
  `--expect` alone would catch a hand-edited src-tauri lock (V1.3's `cargo metadata --locked` already
  covers manifest-vs-lock drift, so the gate intent holds today).
- **F3 (non-blocking, hardening):** first-occurrence `"version"` replace is safe for every current
  file (verified), but fragile by construction; a top-level-anchored match would be more robust.

None of F1–F3 violates the reject-on-sight list, weakens a test, or breaks any frozen gate.

FINAL verdict: APPROVE
