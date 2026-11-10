# Frozen gates — P4 release-truth

Frozen at plan time by the planner (2026-11-09T06:29:36Z). Run by the VERIFIER, in the packet worktree, at the reviewed commit, with
`EV=C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-phase-b-visual-wave`, `BASE=<packets[P4].base_commit>`, `GATE=<gate id>`.
Raw output -> `$EV/gates/<gate id>.log`. The implementer must not edit, narrow or re-word any of them.

| id | host | check | expect |
| --- | --- | --- | --- |
| `P4.1` | any | `node "$EV/tools"/versions.mjs . --expect 0.2.1` | exit 0, "versions: aligned" |
| `P4.2` | any | `node scripts/check-versions.mjs && node scripts/check-versions.mjs --self-test` | exit 0 |
| `P4.3` | any | `pnpm install --frozen-lockfile && cargo metadata --format-version 1 --locked --offline > /dev/null` | exit 0 |
| `P4.4` | capture | `actionlint .github/workflows/release.yml .github/workflows/desktop-bundle.yml` | exit 0 |
| `P4.5` | any | `awk '/^jobs:/{exit} {print}' .github/workflows/release.yml \| grep -nE "(contents\|packages\|id-token): write"` | exit 1 (no write permission at workflow level) |
| `P4.6` | any | `grep -n "draft: true" .github/workflows/release.yml && grep -n "check-versions" .github/workflows/release.yml` | exit 0 (still a draft; tag is checked against the workspace version) |
| `P4.7` | any | `git check-ignore -q some/dir/x.jks && git check-ignore -q some/dir/x.keystore && git check-ignore -q some/dir/keystore.properties && git check-ignore -q some/dir/x.p12` | exit 0 |
| `P4.8` | any | `grep -n "840513" apps/mobile/README.md` | exit 1 |
| `P4.9` | any | `grep -nE "org\.opencontainers\.image\.version" docker/Dockerfile` | exit 0 |
| `P4.10` | any | `test -z "$(git diff --name-only $BASE..HEAD \| grep -vE '^(package\.json\|apps/(desktop\|remote)/package\.json\|packages/(ui\|client\|i18n\|crypto)/package\.json\|pnpm-lock\.yaml\|apps/mobile/android/app/build\.gradle\|apps/mobile/README\.md\|docker/(compose\.yml\|Dockerfile)\|\.gitignore\|\.github/workflows/(release\|desktop-bundle)\.yml\|scripts/check-versions\.mjs)$')"` | exit 0 |
| `P4.snap` | any | `node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -` | exit 0, snapshot_changes=0 |
| `P4.pw` | capture | `pnpm exec playwright test --project=desktop --project=remote --reporter=json > "$EV/gates/$GATE.json"; node "$EV/tools"/pw-gate.mjs failures "$EV/gates/$GATE.json" "$EV/named/EMPTY.txt"` | pw-gate exit 0 (every failure inside named/EMPTY.txt; behavioural specs 100% green); run with the packet merged onto the integration tip, no --update-snapshots |
