# Frozen gates — E0 e2e-v3-support

Frozen by the planner (2026-11-09T07:03:54Z). The VERIFIER runs them in the packet worktree at the reviewed commit with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`, `BASE=<packets[E0].base_commit>`, `GATE=<gate id>`; raw output ->
`$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `E0.1` | any | `pnpm --filter warsha-desktop typecheck` | exit 0 (includes tsconfig.e2e.json) |
| `E0.2` | any | `cat apps/desktop/e2e/v3/support/*.ts \| grep -cE "export (async )?function (openV3\|act\|expectRpc\|rpcCalls)\b"` | prints 4 |
| `E0.3` | capture | `pnpm exec playwright test --project=desktop v3/smoke.spec.ts --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"` | exit 0 |
| `E0.4` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^apps/desktop/e2e/v3/(support/\|smoke\.spec\.ts$)')"` | exit 0 |
| `E0.deps` | any | `git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml \| grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]\|\{[^}]*version)' \| grep -vE '^\+\s*"?(version\|rust-version)"?\s*[:=]'` | exit 1 (no dependency added or bumped) |
| `E0.snap` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `E0.pw` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"` | pw-gate exit 0 (every failure inside named/EMPTY.txt; v2 suites and every behavioural spec 100% green); packet merged onto the integration tip in a scratch checkout; no --update-snapshots |
