# FIN3-report: Hygiene

**Status:** Done — 93 branches deleted (all verified fully merged), 72 worktrees removed, bundle + quarantine taken first, nothing protected touched, no remote ref changed.

## 1. Safety bundle (rule 1)

- Path: `/home/moe/r-next-bundles/warsha-fin3-pre-cleanup.bundle` (outside the repository working tree)
- Command: `git bundle create --all`
- SHA-256: `b06d676227248076a3a86109568da2218db7fb2031995da3ee354dfa77712bea`
- `git bundle verify`: OK — "The bundle records a complete history."

## 2. Deleted

**Branches (93 total, every one verified merged into `r-next/integration` first):**
- 24 `git branch -d` in the first pass (fix/k5-pair-review-gates, ph1-a3c-auth-layer, ph1-a4-state, ph1-a5-events-socket, ph1-a6-http, ph1-a8-rpc-core, ph1-graph-map, r-ext-1..5-packet, r-ui-4-packet, r-ui-6-asset-base, r-ui-6b-packet, r-ui-7-origin-pairing, run/2026-11-10-engine/e4-coding-cli, run/2026-11-10-keel/{integration,k5-mcp-spawn,k9-cli,pair-fix,release-finalization}, security/csp-fixes, zl-b2-rbridge).
- 63 more after their worktrees were removed (the `+`-marked set: archify-runtime-map, fix/baseline-green, fix/i18n-import-order, ph1-a1-api, ph1-a10-tests, ph1-a2-skills, ph1-a3-auth, ph1-a7-runtime, ph1-a9-startup, r-ui-6c-packet, r2/x8-mcp-serve, run/2026-11-10-keel/* worktree-bound set, all zl-* set, worktree-agent-general-purpose-bab0f02c).
- 3 unbound stragglers (zl-rui6c-sync, zl-rui7-appassets, zl-ver-030-ab81b46).
- 3 r-next packet branches whose tips ARE ancestors of integration but whose `git branch -d` refused from the main checkout (worktree-HEAD quirk; `merge-base --is-ancestor` verified, deletion succeeded from the integration worktree): r-next/f1-capture-host (9c8bc05), r-next/f3-pairing-boundary (cdb36c0), work/inspect-dev (1d26f27).
- 6 final after their worktrees were force-removed (below): archify-runtime-map, zl-b4a-default, zl-keel-audit, zl-r0-1-validate, zl-r0-3-triage, zl-r0-packets.
- Earlier in the run (already recorded): r-next/n0-cli-usage, r-next/f2-part-a-baselines.

**Worktrees (72 removed, `git worktree remove` throughout; `--force` only where tracked-clean + merged + untracked content verified/quarantined):**
- 65 removed plain (deepest-first for the nested zl-keel/zl-rsec chains).
- 6 removed with `--force` after quarantine of their untracked content to `/home/moe/r-next-bundles/fin3-quarantine/` (19M, 421 files): zl-b4a-default's 408 local-vintage PNG snapshots (they DIFFER from the committed CI baselines — 58628 px / max δ222 on bench-artifacts-ar-dark — so they are kept in quarantine, not deleted), archify-runtime-map's `.archify/` diagram, zl-r0-1-validate + zl-r0-packets `docs/zadloop` trees, and two packet reports verified byte-identical to the main checkout copies (R-KEEL-audit.md, R0-3-triage.md).
- 1 nested stale entry (zl-rengine-audit) pruned via `git worktree prune`.

## 3. Kept (with reason)

- **Protected by rule 4:** `main`, `dev`, `repair/dev-csp-f474776` (current working branch), all `r-next/*` (f0-run-setup, integration, rf2-ci-capture — rf2 keeps its workflow + report; f0 keeps the standing setup worktree), `backup/csp-worktree-2026-11-13`.
- **Unmerged (13 branches):** feat/e3a-git-helpers, feature/clean-work, feature/dirty-work, feature/test, ph1-a0-helpers, ph1-a3-auth (dirty worktree, 2 tracked changes), r-ui-3-packet, r-ui-5-packet, r-ui-plan-6550bb9, run/2026-11-10-keel/coordination, work/integration-2, work/program-integration, worktree-agent-general-purpose-{2f20edd5,7e9eb893,bfb6e3df,da3383e9}.
- **Worktrees kept with their branches:** main checkout (owner's uncommitted `apps/remote/e2e/harness.ts` — untouchable), .qoder/app/c67e26 (work/integration-2), ph1-a3-auth (dirty), r-next-integration / rn-f0 / rn-rf2 (active run), .qoder/agent-general-purpose-2f20edd5 (feature/clean-work), warsha-wt/baseline + r02-wt-15b99f9 (detached HEAD 15b99f9), warsha-wt/keel/coordination (unmerged branch), warsha-wt/keel/k5 (holds `dev`), warsha-wt/keel/review-k4 (detached).

## 4. Acceptance

- `git worktree list`: 12 entries, no stale entries for deleted branches (prune run).
- `git bundle verify`: OK (above).
- No remote touched: `origin/main` = 939a173… (unchanged); `warsha-dev` main = 2f042d1 (pre-existing independent main on that remote, last commit 2026-10-31 — never ours, never touched); only our two authorized r-next branches exist on warsha-dev.
- Branches: 113 → 23. Worktrees: 84 → 12.
