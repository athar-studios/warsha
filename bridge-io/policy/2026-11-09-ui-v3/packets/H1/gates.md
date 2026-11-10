# Frozen gates — H1 harness-truth

Frozen by the planner (2026-11-09T07:03:54Z). The VERIFIER runs them in the packet worktree at the reviewed commit with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`, `BASE=<packets[H1].base_commit>`, `GATE=<gate id>`; raw output ->
`$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `H1.1` | any | `node scripts/check-wire-contract.mjs` | exit 0 and output contains "wire: 10 checks, 0 violations" |
| `H1.2` | any | `node scripts/check-wire-contract.mjs --self-test` | exit 0 |
| `H1.3` | any | `pnpm --filter warsha-desktop test` | exit 0 and "Tests N passed" with N >= base_counts.warsha-desktop + 6 |
| `H1.4` | any | `pnpm --filter warsha-remote test` | exit 0 and "Tests N passed" with N >= base_counts.warsha-remote |
| `H1.5` | any | `pnpm -r typecheck && node scripts/check-arch.mjs` | exit 0 |
| `H1.6` | any | `grep -nE "^[[:space:]]+(crashes\|reviews):[[:space:]]*\[\|result: \{ (path\|summary):" apps/desktop/e2e/harness.ts` | exit 1 (no object-wrapped stub left) |
| `H1.7` | any | `test -f apps/desktop/src/harness.contract.test.ts && grep -cE "postlaunch\.crashes\|postlaunch\.reviews\|backend\.export\|handoff\.create\|handoff\.apply" apps/desktop/src/harness.contract.test.ts` | exit 0 and count >= 5 |
| `H1.8` | any | `grep -nE "export (async )?function rpcCalls" apps/desktop/e2e/harness.ts` | exit 0 |
| `H1.9` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^(apps/desktop/e2e/harness\.ts\|apps/remote/e2e/harness\.ts\|scripts/check-wire-contract\.mjs\|apps/desktop/src/harness\.contract\.test\.ts)$')"` | exit 0 |
| `H1.deps` | any | `git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml \| grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]\|\{[^}]*version)' \| grep -vE '^\+\s*"?(version\|rust-version)"?\s*[:=]'` | exit 1 (no dependency added or bumped) |
| `H1.snap` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `H1.pw` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/H1.txt"` | pw-gate exit 0 (every failure inside named/H1.txt; v2 suites and every behavioural spec 100% green); packet merged onto the integration tip in a scratch checkout; no --update-snapshots |
