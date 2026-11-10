# Frozen gates — U6 remote-v3

Frozen by the planner (2026-11-09T07:03:54Z). The VERIFIER runs them in the packet worktree at the reviewed commit with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`, `BASE=<packets[U6].base_commit>`, `GATE=<gate id>`; raw output ->
`$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `U6.1` | any | `pnpm --filter warsha-remote test` | exit 0 and "Tests N passed" with N >= base_counts.warsha-remote |
| `U6.2` | any | `pnpm -r typecheck && pnpm --filter warsha-remote lint && node scripts/check-ds-v3.mjs apps/remote/src` | exit 0 |
| `U6.3` | any | `grep -rnE "from '@warsha/ui'" apps/remote/src; test $? -eq 1 && grep -n "fonts.googleapis" apps/remote/index.html; test $? -eq 1` | exit 0 (only @warsha/ui/v3; no Google Fonts) |
| `U6.4` | capture | `pnpm exec playwright test --project=remote flows.spec.ts --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"` | exit 0 (7/7 remote flows) |
| `U6.5` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^apps/remote/(src/\|index\.html$)')"` | exit 0 |
| `U6.deps` | any | `git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml \| grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]\|\{[^}]*version)' \| grep -vE '^\+\s*"?(version\|rust-version)"?\s*[:=]'` | exit 1 (no dependency added or bumped) |
| `U6.snap` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `U6.pw` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/U6.txt"` | pw-gate exit 0 (every failure inside named/U6.txt; v2 suites and every behavioural spec 100% green); packet merged onto the integration tip in a scratch checkout; no --update-snapshots |
