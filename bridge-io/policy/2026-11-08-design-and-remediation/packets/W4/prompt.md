# Worker prompt — W4 · wire-contract cleanup, `WarshaClient` expansion, e2e harness completion — Wave A

You are the IMPLEMENTER for packet W4 of run `2026-11-08-design-and-remediation` in the Warsha repo
(main checkout `C:/Users/Dragonfly/Downloads/Warsha`). A separate reviewer and verifier judge your work
against the frozen gates below; you must not edit, weaken or reinterpret them. Never ask questions:
decide, record the decision in your report, continue.

## 0. Read first
`AGENTS.md`; `ENGINEERING_POLICY.md` (§1 Phase 3, §5, §6); `docs/ARCH_RULES.md` R7;
`scripts/check-wire-contract.mjs` (whole file, incl. the inline self-test fixtures);
`packages/client/src/index.ts` (the strict `wiring*` decoders at ~`2037-2130`, `WarshaWiringApi` at
~`2010-2027`, the `rpc<T>()` transport at `1336`); `packages/client/src/index.test.ts` (fetch mock at
`128-140`, helpers `okResponse`/`errorResponse`/`sentParams`/`sentMethod`); `apps/desktop/e2e/harness.ts`
(`RPC_METHODS` `100-145`, `rpcResult` switch `1016-1326`); the daemon handlers cited below; run state
`C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/state.json`.

## 1. Worktree and branch (Git Bash)
```bash
cd C:/Users/Dragonfly/Downloads/Warsha
git worktree add ../warsha-wt/w4 -b run/2026-11-08/w4-wire-client-harness run/2026-11-08/integration
cd ../warsha-wt/w4
BASE=$(git rev-parse HEAD); echo "BASE=$BASE"
pnpm install --frozen-lockfile
pnpm --filter @warsha/client test   # baseline: 2 files / 112 passed — record it
node scripts/check-wire-contract.mjs # baseline: "wire: 8 checks, 0 violations"
```

## 2. Scope
allowed_files: `scripts/check-wire-contract.mjs`, `packages/client/src/index.ts`,
`packages/client/src/index.test.ts`, `apps/desktop/e2e/harness.ts`.

out_of_scope: `crates/**` (the daemon is the contract — you mirror it, never change it),
`apps/desktop/src/**` (W5 consumes your methods), the e2e specs and `*-snapshots/**`,
`packages/client/src/wire-contract.test.ts`, dependencies, `docs/**`, `.github/**`,
`PLAN.md`/`PROGRESS.md`/`DECISIONS.md`. **Do not change any existing harness stub's return shape**
(the known `postlaunch.*`/`backend.export`/`handoff.*` shape drift is Phase B — it would change
captured screens); list it in your report.

## 3. Steps
1. **Stale comments.** `REQUIRE_NO_KNOWN_DRIFT` is `true` (`check-wire-contract.mjs:143`) and both
   known-drift sets are empty (`:148`, `:155`). Rewrite the comments that say otherwise:
   `check-wire-contract.mjs:24-29` (`--report-only-known` "TypeScript lane is landing"), `:70-80`
   ("RE-OPENED for Wave 2 … is false"), `:133-142` ("FALSE again while the Wave 2 client lane …"), the
   message near `:1464`; `packages/client/src/index.ts:861-864` (Wave 2 names "deferred in
   KNOWN_UNREGISTERED_METHODS") and `:1835-1838` (`skills.list` answers `SlashCommand`; the daemon
   returns `Vec<SkillDefinition>` at `crates/warshad/src/lib.rs:1399-1400` and the writes are
   registered). Comments only — no behaviour change in this step.
2. **Fourteen typed wrappers** on `WarshaWiringApi` + `WarshaClient`, strict `wiring*` decoders, params
   sent in the daemon's snake_case argument names:

   | Method | Wire | Params | Result type |
   |---|---|---|---|
   | `listRoutines()` | `routines.list` | — | `Routine[]` |
   | `getRoutine(id)` | `routines.get` | `{id}` | `Routine \| null` |
   | `runRoutineNow(id)` | `routines.run_now` | `{id}` | `Routine` |
   | `pauseRoutine(id)` | `routines.pause` | `{id}` | `Routine` |
   | `resumeRoutine(id)` | `routines.resume` | `{id}` | `Routine` |
   | `getBackendKit(runId)` | `backend.get` | `{run_id}` | `BackendKit \| null` |
   | `setBackendKit(runId, kit)` | `backend.set` | `{run_id, kit}` | `void` |
   | `startPreview(projectId, command)` | `preview.start` | `{project_id, command}` | `LivePreview` |
   | `stopPreview(projectId)` | `preview.stop` | `{project_id}` | `void` |
   | `previewStatus(projectId)` | `preview.status` | `{project_id}` | `LivePreview` |
   | `listRunModes()` | `runmode.list` | — | `RunModeConfig[]` |
   | `setRunMode(config)` | `runmode.set` | `{config}` | `RunModeConfig` |
   | `listPreferences(projectId)` | `preferences.list` | `{project_id}` | `Preference[]` |
   | `recordPreference(signal)` | `preferences.record` | `{signal}` | `Preference[]` |

   Types mirror the daemon exactly (read the Rust to confirm each field):
   - `Routine` (`crates/warsha-pipeline/src/routines.rs:84-99`, snake_case): `{id, name, description,
     schedule, state, lastRunUnix: number|null}`; `schedule` = `{cron: string} | {intervalSeconds: number}
     | 'manual'` (wire: externally tagged `{"cron":…}` / `{"interval_seconds":…}` / `"manual"`); `state` =
     `'idle'|'running'|'paused'|{failed: string}`.
   - `BackendKit` (`backend_kit.rs:471`): `{config: {kind: 'pocket_base'|'supabase', url, projectName,
     enabledFeatures: ('auth'|'postgres_rls'|'storage'|'push'|'functions')[]}, tables: {name, columns:
     {name, colType, nullable}[]}[], rlsPolicies: {table, policyName, expression, operation:
     'select'|'insert'|'update'|'delete'|'all'}[], storageBuckets: string[], functions: string[]}` —
     array fields default to `[]` when absent; encode back to snake_case for `backend.set`.
   - `LivePreview` (`process_spawn.rs:616`): `{projectId, processId, command, args: string[], status:
     'starting'|'running'|'stopped'|'failed'|'crashed', url: string|null}`.
   - `RunModeConfig` (`run_modes.rs:93`): `{mode: 'local'|'self_hosted'|'hosted', bindHost,
     allowedHosts: string[], relayUrl: string|null}`.
   - `Preference` (`preferences.rs:219`): `{key, score, evidenceCount, lastUpdated}`;
     `PreferenceSignal` (`preferences.rs:129`): `{id, projectId, ownerId, kind:
     'approve'|'reject'|'change_request'|'edit', target, weight, recordedAt}` (all required).
   Export the types and decoders from `index.ts`. Unit tests in `index.test.ts`: per method one success
   test (asserts `sentMethod`, `sentParams`, decoded value) and one failure test (malformed payload →
   typed decode error); plus schedule/state variant decoding and `BackendKit` snake↔camel round trip.
   Target ≥ 28 new tests.
3. **Harness** (`apps/desktop/e2e/harness.ts`): append to `RPC_METHODS` (44 → **75**) the 17 Wave-2
   names (`harness.get`, `harness.import`, `harness.select`, `harness.delete`, `skills.import`,
   `skills.toggle`, `skills.delete`, `plugins.install`, `plugins.toggle`, `plugins.configure`,
   `plugins.remove`, `models.add`, `models.remove`, `integrations.connect`, `integrations.disconnect`,
   `integrations.test`, `files.read`) and the 14 wires above, each with an `rpcResult` case returning a
   **daemon-shaped** value that the matching client decoder accepts (read `crates/warshad/src/wave2.rs`
   for Wave-2 result shapes). Values that keep current renders identical: `routines.list` → `[]`,
   `routines.get` → `null`, `backend.get` → `null`, `backend.set`/`preview.stop` → `null`,
   `runmode.list` → `[]`, `preferences.list`/`preferences.record` → `[]`; mutations echo a minimal valid
   object built from params.
4. **Wire check W9** (`check-wire-contract.mjs`): every method name the client sends (the same parse
   W1 uses) must appear in harness `RPC_METHODS`; message in the `ARCH_RULES` shape
   (`W9: packages/client/src/index.ts:<line> client method \`x.y\` has no e2e harness stub
   (apps/desktop/e2e/harness.ts RPC_METHODS)`). Add a planted fixture case that fires and keep the clean
   fixture clean; the summary line becomes `wire: 9 checks, 0 violations`.
5. Small Conventional Commits (`docs(wire): …`, `feat(client): …`, `test(client): …`,
   `test(e2e): …`, `feat(wire): …`). Do not push.

## 4. Frozen verification gates
Each gate is one command; expected result in the comment above it. G4.9 runs on the Linux capture host.
```bash
# G4.S scope — expect output: 0
git diff --name-only $BASE..HEAD | grep -vE '^(scripts/check-wire-contract\.mjs|packages/client/src/index(\.test)?\.ts|apps/desktop/e2e/harness\.ts)$' | wc -l
# G4.1 — expect exit 0 and >= 140 passed, 0 failed
pnpm --filter @warsha/client test
# G4.2 / G4.3 — expect exit 0 each
pnpm --filter @warsha/client typecheck
pnpm --filter @warsha/client lint
# G4.4 — expect exit 0
node scripts/check-wire-contract.mjs --self-test
# G4.5 — expect exit 0 and output containing "wire: 9 checks, 0 violations"
node scripts/check-wire-contract.mjs
# G4.6 — expect exit 0
pnpm --dir apps/desktop exec tsc --noEmit -p tsconfig.e2e.json
# G4.7 — expect exit 0 (prints 75)
node -e "const h=require('fs').readFileSync('apps/desktop/e2e/harness.ts','utf8');const m=h.match(/RPC_METHODS\s*=\s*\[([\s\S]*?)\]\s*as const/);const n=(m[1].match(/'[^']+'/g)||[]).length;console.log(n);process.exit(n===75?0:1)"
# G4.8 stale wording gone — expect exit 1 (no match)
grep -nE 'REQUIRE_NO_KNOWN_DRIFT is false|FALSE again|RE-OPENED for Wave 2|deferred in .KNOWN_UNREGISTERED_METHODS' scripts/check-wire-contract.mjs packages/client/src/index.ts
# G4.9 (Linux capture host) — expect 793 passed, 0 failed, equal to G0
pnpm exec playwright test --project=desktop --reporter=line
# G4.10 no snapshot touched — expect output: 0
git status --porcelain -- '*-snapshots/*' | wc -l
# G4.A / G4.P — expect exit 0 each
node scripts/check-arch.mjs
node scripts/check-engineering-policy.mjs
```

## 5. Report and stop
Write `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W4/report.md`:
BASE, HEAD, `git diff --stat $BASE..HEAD`, decisions (incl. each Wave-2 stub shape and where in
`wave2.rs` it comes from), the Phase B stub-shape drift list, your own gate run with exit codes (not
evidence), open issues. Out-of-scope need → stop with a blocker `{kind: out-of-scope, reason, needs}`.
No edits to `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`; no merge; no push.
