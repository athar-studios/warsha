# Worker prompt — W2 · canonical architecture, deployment, security and index docs (docs only, Wave B)

You are the IMPLEMENTER for packet W2 of run `2026-11-08-design-and-remediation` in the Warsha repo
(main checkout `C:/Users/Dragonfly/Downloads/Warsha`). A separate reviewer and verifier judge your work
against the frozen gates below; you must not edit, weaken or reinterpret them. Never ask questions:
decide, record the decision in your report, continue.

## 0. Read first
`AGENTS.md`, `ENGINEERING_POLICY.md` (§1 Phase 3, §5, §6), `docs/designs/DESIGN_SYSTEM_V2.md` §4.6
(R6 v2), and `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/state.json`.

## 1. Worktree and branch (Git Bash) — Wave B: start only after checkpoint C1
```bash
cd C:/Users/Dragonfly/Downloads/Warsha
git worktree add ../warsha-wt/w2 -b run/2026-11-08/w2-canonical-docs run/2026-11-08/integration
cd ../warsha-wt/w2
BASE=$(git rev-parse HEAD); echo "BASE=$BASE"
# Precondition (W3 and W4 merged) — both must print OK, otherwise stop: out-of-scope blocker "C1 not reached"
grep -q -- '--warsha-line-rule' packages/ui/src/tokens/tokens.css && echo OK-W3
grep -q 'W9' scripts/check-wire-contract.mjs && echo OK-W4
```

## 2. Scope
allowed_files: `docs/ARCHITECTURE.md`, `docs/ARCH_RULES.md`, `docs/DEPLOY.md`, `docs/DEVELOPERS.md`,
`docs/VERIFY.md`, `docs/src/architecture.md`, `docs/src/SUMMARY.md`, new shim files
`docs/src/design-system-v2.md`, `docs/src/skills-and-harnesses.md`, `docs/src/install.md`,
`docs/src/deploy.md`, `docs/src/verify.md`, `docs/designs/SITEMAP.md`,
`_agents/skills/warsha_elephant/SKILL.md`, `SECURITY.md`.

out_of_scope: all code, every README (W1/W3), `docs/designs/DESIGN_SYSTEM_V2.md` (planner-owned),
`PLAN.md`/`PROGRESS.md`/`DECISIONS.md`, `.github/**`.

Every fact must be re-verified at `$BASE` by opening the cited line; numbers you write must be
measured, not copied from this prompt, when the gate measures them.

## 3. Steps
1. `docs/ARCHITECTURE.md`
   - §1 workspace list (`:17-20`): add `apps/mobile` (Capacitor Android wrapper around the remote
     bundle), `docker/` (`Dockerfile`, `compose.yml`), `deploy/` (`docker-compose.yml`, `Caddyfile`).
   - §2.3 (`:64-85`): replace "only `warsha-pipeline` and `warsha-providers` break their code into
     submodules" with the measured module map: `warsha-core` `pub mod` config, harness, plugin,
     redaction, skill (`src/lib.rs:6-10`); `warsha-store` `mod persistence` (`src/lib.rs:30`);
     `warsha-providers` anthropic, env_llm, fake, ollama, openai, provider_setup, provider_update,
     secrets (`src/lib.rs:14-21`); `warsha-remote` `pub mod rate_limit`; `warsha-pipeline` 26 modules
     (23 private + `mcp`, `mcp_transport`, `settings`; `src/lib.rs:18-50`) + test-only `test_util`;
     `warshad` auth, providers, settings, wave2 (`src/lib.rs:60-63`) + test-only `test_util`;
     single-file: `warsha-backends`, `warsha-git`; `lib.rs`+`main.rs`: `warsha-relay`, `warsha-cli`.
   - §5 (`:189`): `warsha-store` is `lib.rs` (measure `wc -l`) + `persistence.rs` (measure).
2. `docs/DEPLOY.md` (`:79-91`): `warshad` serves the remote bundle itself when `remote_assets_dir` /
   `WARSHA_REMOTE_ASSETS_DIR` is set (`crates/warshad/src/lib.rs` field `:575-589`, env `:6192`,
   applied `:5348-5349`, `app.fallback(static_asset_handler)` `:5654-5655`, handler `:6209+`: real
   file → directory `index.html` → SPA history fallback; traversal blocked; never answers `/rpc`,
   `/events`, `/health`). Caddy: `/health` + `/events` → 8765, `/rpc` → 8766, everything else → 8765
   (`deploy/Caddyfile:40-66`). Docker copies the bundle to `/usr/share/warsha/remote` and sets the env
   (`docker/Dockerfile:102,115`).
3. `docs/VERIFY.md` (`:267-277`): cite the current `docs/INSTALL.md` values — exe 25,215,488 B
   `f3549485798919c9d81627d52e34c4a897483a3b4483fadfb0590ed45be0e7a9`; NSIS 6,864,766 B
   `294b8e259e88c804275154e8f3bd4ba4e957b15eb912cff3e7f2b9cbb4aabd99`; keep the older 2026-11-05
   measurement only as labelled history and remove the "open disagreement" wording.
4. `docs/src/architecture.md` (`:202-280`): the remote build generates `dist/sw.js` via
   `scripts/generate-service-worker.mjs` and `registerShellWorker` registers it (production);
   `docker/Dockerfile`, `docker/compose.yml`, `deploy/docker-compose.yml` exist; the daemon binds
   loopback by default with opt-in `bind_host` (`lib.rs:543`, `--bind-host` `:1009-1010`,
   `WARSHA_BIND_HOST` `:5899`) and `advertised_host` (`:556`); fix the stale citation to
   `DaemonConfig` (`lib.rs:520-590`) and add `bind_host`, `advertised_host`, `remote_assets_dir` to
   the TOML example.
5. `SECURITY.md` (`:69-71`, `:165-166`): loopback is the default, not the only option — document
   `bind_host`/`advertised_host` as owner opt-in with the TLS/infrastructure boundary from
   `DECISIONS.md` 2026-11-04; a root `deny.toml` exists and CI runs `cargo deny … check`.
6. `docs/DEVELOPERS.md` (`:11`, `:18-39`): remove the "E2E encrypted via Noise XX" claim (the
   handshake is a stub — `crates/warsha-remote/src/lib.rs:656-659`); add `apps/mobile`,
   `packages/crypto` (no consumers yet), `docker/`, `deploy/` to the tree; replace `octocrab` with
   `reqwest` (`octocrab` is declared at root `Cargo.toml:66` and used by nothing); `templates/` is
   empty — templates are embedded in `crates/warsha-git`.
7. `docs/ARCH_RULES.md`: `:132-133` pipeline module count = 26 (23 private + 3 public); `:351-355`
   daemon methods = policy rows = **88** (`#[method(name` in the `WarshaApi` trait vs
   `METHOD_POLICIES` in `auth.rs`), client figures measured from `packages/client/src/index.ts` at
   `$BASE`; R6 section rewritten from the merged `tokenDrift.test.ts` and DS v2 §4.6 (R6.1–R6.10,
   the app-length ratchet and `WARSHA_R6_APP_LENGTH_BUDGET`, test count); R7 section lists the
   merged checks including W9 (client ⊆ harness).
8. Indexes:
   - `docs/designs/SITEMAP.md`: keep the DS v2 row; add rows for `../SKILLS_AND_HARNESSES.md`,
     `../UI.md`, `../INSTALL.md`, `../DEPLOY.md`, `../VERIFY.md`; conventions line keeps a11y 188,
     states 252, visual 308, plus behaviour 45 and remote 91.
   - `docs/src/SUMMARY.md` + shims: each shim is two lines like `docs/src/UI.md` (a source-of-truth
     comment + `{{#include ../<FILE>.md}}`; for DS v2 `{{#include ../designs/DESIGN_SYSTEM_V2.md}}`).
   - `_agents/skills/warsha_elephant/SKILL.md`: canonical docs list gains `DESIGN_SYSTEM_V2.md`,
     `UI.md`, `INSTALL.md`, `DEPLOY.md`, `VERIFY.md`; E2E line = a11y 188, states 252, visual 308,
     behaviour 45 (`flows`/`layout`/`onboarding`), remote `apps/remote/e2e/` 91.
9. Small Conventional Commits (`docs(arch): …`, `docs(security): …`). Do not push.

## 4. Frozen verification gates
Each gate is one command (loops wrapped in `( … )`); expected result in the comment above it.
```bash
# G2.S scope — expect output: 0
git diff --name-only $BASE..HEAD | grep -vE '^(docs/(ARCHITECTURE|ARCH_RULES|DEPLOY|DEVELOPERS|VERIFY)\.md|docs/src/(architecture|SUMMARY|design-system-v2|skills-and-harnesses|install|deploy|verify)\.md|docs/designs/SITEMAP\.md|_agents/skills/warsha_elephant/SKILL\.md|SECURITY\.md)$' | wc -l
# G2.1 mdBook — expect exit 0
mdbook build docs
# G2.2 false sentences gone — expect exit 1 (no match)
grep -nE 'Only `warsha-pipeline` and `warsha-providers`|~800 lines|does not yet mount|there is no offline service worker today|no `Dockerfile` or compose file exists|no `deny\.toml` in the repository|There is no flag and no config key that binds another interface|octocrab|Noise XX|sixteen private modules|registers 60 methods|all 32 client call sites|open disagreement' docs/ARCHITECTURE.md docs/DEPLOY.md docs/src/architecture.md SECURITY.md docs/DEVELOPERS.md docs/ARCH_RULES.md docs/VERIFY.md
# G2.3 required facts present — expect exit 0
( for p in 'docs/ARCHITECTURE.md:apps/mobile' 'docs/ARCHITECTURE.md:docker/' 'docs/ARCHITECTURE.md:deploy/' 'docs/ARCHITECTURE.md:persistence.rs' 'docs/ARCHITECTURE.md:wave2' 'docs/DEPLOY.md:WARSHA_REMOTE_ASSETS_DIR' 'docs/src/architecture.md:bind_host' 'docs/src/architecture.md:advertised_host' 'docs/src/architecture.md:remote_assets_dir' 'docs/src/architecture.md:registerShellWorker' 'SECURITY.md:bind_host' 'SECURITY.md:advertised_host' 'SECURITY.md:deny.toml' 'docs/DEVELOPERS.md:apps/mobile' 'docs/DEVELOPERS.md:packages/crypto' 'docs/DEVELOPERS.md:reqwest' 'docs/ARCH_RULES.md:88' 'docs/VERIFY.md:294b8e259e88c804275154e8f3bd4ba4e957b15eb912cff3e7f2b9cbb4aabd99' 'docs/VERIFY.md:f3549485798919c9d81627d52e34c4a897483a3b4483fadfb0590ed45be0e7a9'; do f=${p%%:*}; t=${p#*:}; grep -qF -- "$t" "$f" || { echo "missing $t in $f"; exit 1; }; done )
# G2.4 R6 test count in ARCH_RULES equals the merged test file — expect exit 0
node -e "const fs=require('fs');const n=(fs.readFileSync('packages/ui/src/tokens/tokenDrift.test.ts','utf8').match(/^\s*it\(/gm)||[]).length;const ok=fs.readFileSync('docs/ARCH_RULES.md','utf8').includes('tokenDrift.test.ts\` ('+n+' tests)');console.log(n,ok);process.exit(ok?0:1)"
# G2.5 wire check count in ARCH_RULES equals the script — expect exit 0
( n=$(node scripts/check-wire-contract.mjs | grep -oE '[0-9]+ checks' | head -1); echo "$n"; grep -qF "$n" docs/ARCH_RULES.md )
# G2.6 indexes — expect exit 0
( for t in DESIGN_SYSTEM_V2.md SKILLS_AND_HARNESSES.md UI.md INSTALL.md DEPLOY.md VERIFY.md; do grep -qF "$t" docs/designs/SITEMAP.md || { echo "SITEMAP $t"; exit 1; }; done; for t in design-system-v2.md skills-and-harnesses.md install.md deploy.md verify.md UI.md; do grep -qF "$t" docs/src/SUMMARY.md || { echo "SUMMARY $t"; exit 1; }; done; for t in DESIGN_SYSTEM_V2.md 188 252 308 apps/remote/e2e; do grep -qF "$t" _agents/skills/warsha_elephant/SKILL.md || { echo "SKILL $t"; exit 1; }; done )
# G2.A / G2.P / G2.W — expect exit 0 each
node scripts/check-arch.mjs
node scripts/check-engineering-policy.mjs
node scripts/check-wire-contract.mjs
```

## 5. Report and stop
Write `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W2/report.md`:
BASE, HEAD, `git diff --stat $BASE..HEAD`, decisions, your own gate run with exit codes (not
evidence), open issues. Out-of-scope need → stop with a blocker `{kind: out-of-scope, reason, needs}`.
No edits to `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`; no merge; no push.
