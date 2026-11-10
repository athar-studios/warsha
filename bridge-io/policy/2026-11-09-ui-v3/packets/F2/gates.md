# Frozen gates — F2 client-test-lint (base defect found during Wave A)

Frozen by the orchestrator in planner capacity (2026-11-09) after V1's report and a direct re-run confirmed five
`@typescript-eslint/no-unused-vars` errors in `packages/client/src/index.test.ts` **already at base `4c65ead`**
(unused: `ALL_ROLES`, `decodeModelCatalogDiff`, `decodeModelInfo`, type `ModelCatalogDiff`, type `ModelInfo`). No
Wave A packet owns that file, and the final `pnpm -r lint` gate cannot pass while it is red. The fix is confined to
that one test file (remove the unused imports; if any is genuinely used later in the file, keep it and say so).
No waiver of any run non-negotiable is involved. Merge at C1 before the Wave A packets.

The VERIFIER runs these in the packet worktree at the reviewed commit with `EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`, `BASE=<packets[F2].base_commit>`, `GATE=<gate id>`; raw output -> `$EV/gates/<gate id>.log`.
The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `F2.1` | any | `pnpm --filter @warsha/client lint` | exit 0, no eslint errors |
| `F2.2` | any | `pnpm --filter @warsha/client test` | exit 0 and "Tests N passed" with N >= base_counts."@warsha/client" (149) |
| `F2.3` | any | `pnpm -r typecheck` | exit 0 |
| `F2.4` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^packages/client/src/index\.test\.ts$')"` | exit 0 (only that file) |
| `F2.5` | any | `git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml \| grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]\|\{[^}]*version)' \| grep -vE '^\+\s*"?(version\|rust-version)"?\s*[:=]'` | exit 1 (no dependency added or bumped) |
| `F2.6` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
