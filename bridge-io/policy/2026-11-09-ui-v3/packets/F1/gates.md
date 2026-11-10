# Frozen gates — F1 v2-mobile-providers-truth

Frozen by the orchestrator in planner capacity on the owner's OD-F1 approval (structured answer «A»,
2026-11-09T10:21:35Z). The VERIFIER runs them in the packet worktree at the reviewed commit with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`, `BASE=<packets[F1].base_commit>`, `GATE=<gate id>`; raw output ->
`$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `F1.1` | any | `pnpm --filter warsha-desktop test` | exit 0 and "Tests N passed" with N >= base_counts.warsha-desktop |
| `F1.2` | any | `pnpm -r typecheck && pnpm --filter warsha-desktop lint` | exit 0 |
| `F1.3` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^(apps/desktop/src/index\.css\|apps/desktop/src/screens/ProvidersSettings\.tsx)$')"` | exit 0 |
| `F1.4` | any | `git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml \| grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]\|\{[^}]*version)' \| grep -vE '^\+\s*"?(version\|rust-version)"?\s*[:=]'` | exit 1 (no dependency added or bumped) |
| `F1.5` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `F1.6` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/R0.txt"` | pw-gate exit 0 (every failure inside named/R0.txt: the 58 drift cases incl. the four fixed renders); packet merged onto the integration tip in a scratch checkout; no --update-snapshots |
| `F1.7` | any | `node "$EV/tools"/f17-check.mjs "$EV/gates/F1.6.json"` | exit 0 and "f17: cases=4 defect-errors=0" (the two defects proven gone; only pixel drift may remain) |