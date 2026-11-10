# Frozen gates — U5 settings

Frozen by the planner (2026-11-09T07:03:54Z). The VERIFIER runs them in the packet worktree at the reviewed commit with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`, `BASE=<packets[U5].base_commit>`, `GATE=<gate id>`; raw output ->
`$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `U5.1` | any | `pnpm --filter warsha-desktop test` | exit 0 and "Tests N passed" with N >= base_counts.warsha-desktop + 30 |
| `U5.2` | any | `pnpm -r typecheck && pnpm --filter warsha-desktop lint && node scripts/check-ds-v3.mjs apps/desktop/src/v3` | exit 0 |
| `U5.3` | any | `node "$EV/tools"/i18n-gate.mjs .` | exit 0 |
| `U5.4` | any | `node "$EV/tools"/actions-gate.mjs . --only settings.` | exit 0 (every action of these areas registered, used, wired to a served RPC and clicked by an e2e case; no fake names anywhere in v3) |
| `U5.5` | any | `for a in settings; do test -d apps/desktop/src/v3/pages/$a && test -f apps/desktop/src/v3/actions/registry/$a.ts && test -f packages/i18n/src/v3/ar/$a.ts && test -f packages/i18n/src/v3/en/$a.ts && test -f apps/desktop/e2e/v3/$a.spec.ts \|\| exit 1; done` | exit 0 |
| `U5.6` | capture | `pnpm exec playwright test --project=desktop v3/settings.spec.ts --grep-invert @visual --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"` | exit 0 (flows, action effects, axe + keyboard in ar/en x light/dark: all green) |
| `U5.7` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^(apps/desktop/src/v3/(pages/(settings)/\|actions/registry/(settings)\.ts$)\|packages/i18n/src/v3/(ar\|en)/(settings)\.ts$\|apps/desktop/e2e/v3/(settings)\.spec\.ts$\|apps/desktop/e2e/v3/support/index\.ts$)$')"` | exit 0 — **amended at planner capacity 2026-11-10T15:20Z**: the verified repair 41088e7 fixes the true root cause (the e2e support invoke stub refused daemon config-key queries, leaving the client null) and the repair brief explicitly allowed `apps/desktop/e2e/v3/support/**`; the frozen regex had not been updated |
| `U5.deps` | any | `git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml \| grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]\|\{[^}]*version)' \| grep -vE '^\+\s*"?(version\|rust-version)"?\s*[:=]'` | exit 1 (no dependency added or bumped) |
| `U5.snap` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `U5.pw` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/U5.txt"` | pw-gate exit 0 (every failure inside named/U5.txt; v2 suites and every behavioural spec 100% green); packet merged onto the integration tip in a scratch checkout; no --update-snapshots |
