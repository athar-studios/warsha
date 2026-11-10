# Frozen gates — U7 cutover (dispatch ONLY after OD-U3 = yes)

Frozen by the planner (2026-11-09T07:03:54Z). The VERIFIER runs them in the packet worktree at the reviewed commit with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3`, `BASE=<packets[U7].base_commit>`, `GATE=<gate id>`; raw output ->
`$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `U7.1` | any | `test ! -e apps/desktop/src/screens && test ! -e apps/desktop/src/App.tsx` | exit 0 |
| `U7.2` | any | `for f in flows layout onboarding screens.a11y screens.visual states; do test ! -e apps/desktop/e2e/$f.spec.ts \|\| { echo "left $f"; exit 1; }; done` | exit 0 |
| `U7.3` | any | `test -z "$(git ls-files 'apps/desktop/e2e/*-snapshots/*' \| grep -v '^apps/desktop/e2e/v3/')"` | exit 0 |
| `U7.4` | any | `test -z "$(git ls-files packages/ui/src \| grep -v '^packages/ui/src/v3/' \| grep -vE '^packages/ui/src/index\.ts$')"` | exit 0 (v2 DS gone) |
| `U7.5` | any | `grep -rnE "from '@warsha/ui'" apps packages --include=*.ts --include=*.tsx; test $? -eq 1 && grep -n "fonts.googleapis" apps/desktop/index.html apps/remote/index.html; test $? -eq 1` | exit 0 |
| `U7.6` | any | `node "$EV/tools"/actions-gate.mjs . && node "$EV/tools"/i18n-gate.mjs . && node scripts/check-arch.mjs && node scripts/check-arch.mjs --self-test && node scripts/check-ds-v3.mjs packages/ui/src/v3 apps/desktop/src apps/remote/src` | exit 0 (full action contract, no --only) |
| `U7.7` | any | `pnpm -r typecheck && pnpm -r lint && pnpm -r test` | exit 0; warsha-desktop passed >= base_counts.warsha-desktop_v3 |
| `U7.8` | capture | `LISTED=$(pnpm exec playwright test --list --project=desktop --project=remote \| grep -oE "Total: [0-9]+" \| grep -oE "[0-9]+"); pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs counts "$EV/gates/$GATE.json" $LISTED 0` | exit 0 |
| `U7.9` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD "$EV/named/U7.snap.txt"` | exit 0 (only deletions of the v2 baseline dirs) |
| `U7.10` | any | `grep -qi "retired" docs/designs/DESIGN_SYSTEM_V2.md && grep -q "DESIGN_SYSTEM_V3" docs/designs/SITEMAP.md` | exit 0 |
| `U7.deps` | any | `git diff $BASE..HEAD -- '*package.json' 'crates/*/Cargo.toml' 'apps/*/src-tauri/Cargo.toml' Cargo.toml \| grep -E '^\+\s*"?[@a-zA-Z0-9_./-]+"?\s*[:=]\s*("[~^=]?[0-9]\|\{[^}]*version)' \| grep -vE '^\+\s*"?(version\|rust-version)"?\s*[:=]'` | exit 1 (no dependency added or bumped) |
