# Worker prompt — W1 · README truth (docs only)

You are the IMPLEMENTER for packet W1 of run `2026-11-08-design-and-remediation` in the Warsha repo
(main checkout `C:/Users/Dragonfly/Downloads/Warsha`). A separate reviewer and verifier judge your work
against the frozen gates below; you must not edit, weaken or reinterpret them. Never ask questions:
decide, record the decision in your report, continue.

## 0. Read first
`AGENTS.md`, `ENGINEERING_POLICY.md` (§1 Phase 3, §5, §6), and the run state
`C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/state.json`.

## 1. Worktree and branch (Git Bash)
```bash
cd C:/Users/Dragonfly/Downloads/Warsha
git worktree add ../warsha-wt/w1 -b run/2026-11-08/w1-readme-truth run/2026-11-08/integration
cd ../warsha-wt/w1
BASE=$(git rev-parse HEAD); echo "BASE=$BASE"   # record it in your report
```
Work only inside `../warsha-wt/w1`. Never write to the main checkout except your report file.

## 2. Scope
allowed_files (nothing else may change):
`crates/warsha-remote/README.md`, `packages/crypto/README.md`, `apps/remote/README.md`,
`crates/warsha-git/README.md`, `templates/README.md`, `crates/warsha-pipeline/README.md`,
`apps/desktop/README.md`, `README.md`, `README.ar.md`

out_of_scope: all source code, `packages/ui/README.md` (moved to W3), `docs/**` (W2),
`PLAN.md`/`PROGRESS.md`/`DECISIONS.md`, snapshots, `.github/**`.

Every fact you write must be re-verified against the code at `$BASE` (open the cited line).
Keep each README's contract shape (Overview, Interface, Invariants, Side Effects, Verification).
Arabic text in `README.ar.md` is written in Arabic; milestone ids and code names stay Latin.

## 3. Steps
1. `crates/warsha-remote/README.md` (lines 5–18). Keep the TRUE claim: a paired phone authenticates
   with its own pairing secret, never the daemon token (`crates/warshad/src/auth.rs:171-184`). Replace
   the FALSE encryption claims: `EncryptedChannel::initiate`/`respond` (`src/lib.rs:611`, `:640`)
   discard the handshake object; `process_handshake` (`:656-659`) is a stub returning `Ok(false)`;
   `write_message`/`read_message` (`:662-685`) always fail "Handshake not complete"; nothing outside
   the crate uses `EncryptedChannel` or `RelayClient`; therefore relay payloads are **not** end-to-end
   encrypted today. `PairingData::pairing_link` (`:267-279`) returns
   `{origin}/?server=<enc(origin)>&token=<pairing secret>` — the link is a bearer credential. Mention
   `pub mod rate_limit`.
2. `packages/crypto/README.md`: the primitives (X25519, ChaCha20-Poly1305, replay protection,
   revocation — `src/index.ts`) exist and are tested, but **no app or package imports
   `@warsha/crypto` today** (verify: `grep -rl "@warsha/crypto" apps packages --include=*.ts --include=*.tsx`
   finds only the package itself). "The relay only sees ciphertext" is a goal, not current behaviour.
3. `apps/remote/README.md`: `src/bench.tsx` is the data context (`RemoteProvider`/`useRemote`,
   `stageQueue`, `gateWaitsOnOwner`), not layout; the UI is `src/screens/{NeedsYou,Projects,Run,Gates,Settings}Screen.tsx`,
   `src/chrome.tsx`, `src/GatePlate.tsx`, `src/pairing.tsx`. Service worker: `package.json` build =
   `tsc && vite build && node scripts/generate-service-worker.mjs` (`workbox-config.cjs`) emits
   `dist/sw.js`; `registerShellWorker` registers it in production only (`src/main.tsx:13,44`,
   `src/offline.ts:30,96-107`); no push permission is requested. E2E: `apps/remote/e2e/`
   `bench.visual.spec.ts` (84 cases) + `flows.spec.ts` (7).
4. `crates/warsha-git/README.md` (lines 5–7): only `warshad` depends on it (`crates/warshad/Cargo.toml:14`;
   `src/lib.rs:38` import, `:1031` `github` field, constructed `:5415-5416`, never read afterwards);
   `warsha-pipeline` has no dependency on it; HTTP via `reqwest` (`src/lib.rs:409`); embedded project
   templates `ProjectTemplate` (`src/lib.rs:950-1049`: web `:952`, cli `:971`, desktop `:986`,
   android `:1004`, `all()` `:1023`).
5. `templates/README.md` (lines 5–11): the directory holds only this README; the four templates
   (web, cli, desktop, android) are embedded in `crates/warsha-git/src/lib.rs` as `ProjectTemplate`;
   nothing outside `warsha-git` calls `ProjectTemplate` yet.
6. `crates/warsha-pipeline/README.md` (lines 10–19): list **all 26** modules declared in
   `src/lib.rs:18-50`, one line each, written from each module's own header doc — 23 private:
   `agent_loop`, `agent_tools`, `agent_workflow`, `backend_kit`, `build_cache`, `evals`,
   `guardrails`, `handoff`, `llm_cache`, `observability`, `orchestrator`, `post_launch`,
   `preferences`, `process_spawn`, `prompts`, `provider_setup`, `router_quality`, `routines`,
   `run_modes`, `scale_standards`, `scout`, `skills`, `work_protection`; 3 public: `mcp`,
   `mcp_transport`, `settings`; plus test-only `test_util`. Write each name in backticks.
7. `apps/desktop/README.md` (lines 18–19): the Playwright `desktop` project lists 793 cases —
   `screens.a11y.spec.ts` 188, `states.spec.ts` 252, `screens.visual.spec.ts` 308, behaviour
   `flows.spec.ts` 30 + `layout.spec.ts` 12 + `onboarding.spec.ts` 3 (= 45); `e2e/harness.ts` stubs the
   RPC surface; `real-acceptance.cjs` drives the built bundle against a real `warshad` with only
   Tauri `get_config` injected (no RPC stub). Note that the latest recorded a11y run reported 180
   passed against 188 listed (open item, settled by the run's G0 baseline).
8. `README.md` and `README.ar.md`:
   - lines 93–95 / 93–94: remove "the mobile app registers no service worker"; state that the PWA
     registers an offline shell worker (`dist/sw.js`, production builds) and requests no push permission.
   - line 153: remove the "Planned:" / "المخطط له:" prefix and rewrite the sentence from what
     `crates/warsha-providers/src/` actually implements (`anthropic`, `openai`, `ollama`, `env_llm`, …;
     check whether the OpenAI-compatible client covers DeepSeek/OpenRouter/Azure via base URL) —
     name what works now and what does not.
   - Roadmap table (lines 127–138): add rows `| M10 |` … `| M20 |` and `| Wave 2 |`, one per line in
     the existing `| id | what it delivers | status |` shape, statuses taken from the `PLAN.md`
     headings (M10–M19 delivered; M20 batches; Wave 2 per `PROGRESS.md`). Same rows in Arabic.
9. Commit in small Conventional Commits (`docs(readme): …`). Do not push.

## 4. Frozen verification gates (verifier runs these in the worktree at your head; all must hold)
Each gate is one command (loops are wrapped in `( … )` so `exit` never closes your shell); the expected result is in the comment above it.
```bash
# G1.S scope — expect output: 0
git diff --name-only $BASE..HEAD | grep -vE '^(crates/warsha-(remote|git|pipeline)/README\.md|packages/crypto/README\.md|apps/(remote|desktop)/README\.md|templates/README\.md|README(\.ar)?\.md)$' | wc -l
# G1.1 — expect exit 1 (no match)
grep -nE 'registers no service worker|لا يسجّل خدمة' README.md README.ar.md
# G1.2 — expect exit 1 (no match)
grep -nE '^(Planned:|المخطط له:)' README.md README.ar.md
# G1.3 — expect exit 0
( for f in README.md README.ar.md; do for m in M10 M11 M12 M13 M14 M15 M16 M17 M18 M19 M20 'Wave 2'; do grep -qE "^\| $m \|" "$f" || { echo "$f $m"; exit 1; }; done; done )
# G1.4 — expect exit 0
( for m in agent_loop agent_tools agent_workflow backend_kit build_cache evals guardrails handoff llm_cache observability orchestrator post_launch preferences process_spawn prompts provider_setup router_quality routines run_modes scale_standards scout skills work_protection mcp mcp_transport settings; do grep -q "\`$m\`" crates/warsha-pipeline/README.md || { echo "$m"; exit 1; }; done )
# G1.5 — expect exit 0
grep -q process_handshake crates/warsha-remote/README.md && grep -qiE 'stub|not implemented' crates/warsha-remote/README.md
# G1.6 — expect exit 0
( grep -q ProjectTemplate templates/README.md && for t in web cli desktop android; do grep -qw "$t" templates/README.md || exit 1; done )
# G1.7 — expect exit 1 (no match)
grep -q 'The pipeline asks this crate' crates/warsha-git/README.md
# G1.8 — expect exit 0
grep -q flows.spec.ts apps/desktop/README.md && grep -q real-acceptance.cjs apps/desktop/README.md && grep -q 188 apps/desktop/README.md
# G1.9 — expect exit 0
grep -q registerShellWorker apps/remote/README.md && grep -q RemoteProvider apps/remote/README.md
# G1.A / G1.P / G1.W — expect exit 0 each
node scripts/check-arch.mjs
node scripts/check-engineering-policy.mjs
node scripts/check-wire-contract.mjs
```

## 5. Report and stop
Write `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W1/report.md`:
BASE, HEAD, `git diff --stat $BASE..HEAD`, each decision you made, your own run of every gate with
exit codes (not evidence — the verifier reruns them), open issues. If a fix needs a file outside
allowed_files, stop and write a blocker `{kind: out-of-scope, reason, needs}`. Do not edit
`PLAN.md`/`PROGRESS.md`/`DECISIONS.md`, do not merge, do not push.
