# Worker prompt — W8 · G0 truth repair (a11y, pixel-neutral)

You are the IMPLEMENTER for packet W8 of run `2026-11-08-design-and-remediation` in the Warsha repo
(main checkout `C:/Users/Dragonfly/Downloads/Warsha`). A separate reviewer and verifier judge your
work against the frozen gates below; you must not edit, weaken or reinterpret them. Never ask
questions: decide, record the decision in your report, continue.

## 0. Why this packet exists

G0 measured the baseline at `0772d50` on the authoritative Linux x86_64 capture host:
desktop **785 passed / 8 failed**. All 8 failures are `apps/desktop/e2e/screens.a11y.spec.ts:48`,
screen `settings`, both viewports x both locales x both themes, with
`aria-required-children [critical] — ul: Required ARIA child role not present: listitem`.

Six frozen gates (W3 G3.8, W3 G3.9, W4 G4.9, W5 G5.10, W5 G5.11, GC.10) demand `793 passed, 0 failed`.
Gates may never be edited. The only legitimate way to satisfy them is to fix the defect.

**Circular dependency this packet breaks:** the fix lives in `apps/desktop/src/`, which W5 owns, but
W5 `depends_on: ["C1"]` and C1 requires W3+W4 accepted — whose Linux gates need this fix first.
W8 is therefore a prerequisite packet, merged to the integration branch before Wave A Linux
verification.

## 1. Read first

`AGENTS.md`, `ENGINEERING_POLICY.md` (§1 Phase 3, §5, §6), the run `state.json`, and
`docs/designs/DESIGN_SYSTEM_V2.md` §9 (Phase A pixel-neutral boundary), `DECISIONS.md` 2026-11-08 D1.

## 2. Worktree and branch (Git Bash)

```bash
cd C:/Users/Dragonfly/Downloads/Warsha
git worktree add ../warsha-wt/w8 -b run/2026-11-08/w8-g0-a11y-repair run/2026-11-08/integration
cd ../warsha-wt/w8
BASE=$(git rev-parse HEAD); echo "BASE=$BASE"   # record it in your report
pnpm install --frozen-lockfile
```

Work only inside `../warsha-wt/w8`. Sibling packets W1/W3/W4/W6/W7 are active in their own
worktrees — never enter or modify them.

## 3. Scope

allowed_files (nothing else may change):
- `apps/desktop/src/screens/SettingsScreen.tsx`
- `apps/desktop/src/screens/SettingsScreenIntegrations.test.tsx` (new unit test)

out_of_scope: everything else, explicitly including `packages/ui/**` (W3),
`apps/desktop/e2e/**` (W4 owns harness.ts), `apps/remote/**`, `**/*-snapshots/**`,
`PLAN.md`/`PROGRESS.md`/`DECISIONS.md`, dependencies, lockfiles, `.github/**`.

## 4. The verified root cause (from an independent read-only investigation — re-verify it yourself)

- `apps/desktop/src/screens/SettingsScreen.tsx:318` renders `<Ledger label={connectors.title}>`
  whose direct child at line 319 is `<Text size="xs">`, not an `<li>`.
- `Ledger` is `<ul role="list">` (`packages/ui/src/compounds/Ledger.tsx:179`); `Text` is
  `<span style="display:block">` (`packages/ui/src/components.tsx:132`).
- The e2e stub answers `integrations.list` with `{ok:true,result:[]}`
  (`apps/desktop/e2e/harness.ts:1232`), so `integrations` becomes `[]` not `null`
  (`SettingsScreen.tsx:83-85`), taking the live branch at 318 instead of the four-row
  `SUBSCRIPTIONS` branch at 275. `integrations.map` yields zero rows, so the `ul` contains
  only the `span` and has no `listitem` child.
- Trigger, not the defect: commit `08d61af` added `integrations.list` to the stub. Before it the
  call was rejected, `integrations` stayed `null`, and the clean four-row branch rendered. The
  markup defect is older; the stub exposed it.

**The minimal correct fix:** move the `<Text>` description (lines 319-321) OUT of `<Ledger>` so it
precedes it inside the `Panel` body, and render `<Ledger>` only when `integrations.length > 0`.

Rejected alternatives, do not use them:
- Wrapping the description in `<li>` passes axe but announces a description as a list item —
  semantically wrong.
- Leaving the `ul` empty passes axe only via the non-gating `reviewEmpty` path and still announces
  an empty list.

**Pixel-neutrality argument (you must PROVE it with the gate, not argue it):** `Panel`'s body is a
plain block `div` with padding and no flex/gap (`packages/ui/src/compounds/Panel.tsx:77`); the `ul`
carries `margin:0; padding:0; border-block-start:none; background:transparent`; and
`.warsha-ledger { scrollbar-gutter: stable }` (`packages/ui/src/tokens/tokens.css:291`) is inert
because no `.warsha-ledger` has `overflow` anywhere. So the `ul` is geometrically a zero box equal
to the `span` box, and moving it should shift no pixel in either the empty or populated state.
Desktop visual is currently 308/308 green and MUST stay 308/308 green.

## 5. Steps

1. Re-verify every citation above at your `$BASE` by opening the files. If any differs, follow the
   code and record the correction as a decision.
2. Apply the minimal fix to `SettingsScreen.tsx`.
3. Add `SettingsScreenIntegrations.test.tsx`: a unit test that guards the invariant structurally —
   when the integrations list is empty, no `ul`/list is rendered at all (or any rendered list
   contains only `li` children); when populated, every direct child of the list is a `listitem`.
   Follow the existing test conventions in `apps/desktop/src/**/*.test.tsx`. Do not weaken or
   delete any existing test.
4. Run `cargo`-free checks: `pnpm --filter warsha-desktop test`, `pnpm -r typecheck`, `pnpm -r lint`.
5. Commit in small Conventional Commits (`fix(desktop): …`, `test(desktop): …`). Do not push.

## 6. Frozen verification gates (a separate verifier reruns these at your reviewed head)

```bash
# G8.S scope — expect output: 0
git diff --name-only $BASE..HEAD | grep -vE '^apps/desktop/src/screens/SettingsScreen(Integrations\.test)?\.tsx$' | wc -l
# G8.1 — expect exit 0, >= 444 passed, 0 failed
pnpm --filter warsha-desktop test
# G8.2 — expect exit 0
pnpm -r typecheck
# G8.3 — expect exit 0
pnpm -r lint
# G8.4 (linux-capture-host) — expect 793 passed, 0 failed
pnpm exec playwright test --project=desktop --reporter=line
# G8.5 — expect output: 0
git status --porcelain -- '*-snapshots/*' | wc -l
# G8.A / G8.P / G8.W — expect exit 0 each
node scripts/check-arch.mjs
node scripts/check-engineering-policy.mjs
node scripts/check-wire-contract.mjs
```

G8.4 is a **linux-capture-host** gate. You CANNOT satisfy it on Windows and must not try; the
verifier runs it on the Linux host. Never pass `--update-snapshots`. Never edit a snapshot.
G8.4 passing at 793/0 is simultaneously the proof that the 8 a11y cases are fixed AND that the
308 visual cases did not move — that is the pixel-neutral proof.

## 7. Report and stop

Write `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-08-design-and-remediation/packets/W8/report.md`:
BASE, HEAD, `git diff --stat $BASE..HEAD`, each decision, your own run of every worktree gate with
exit codes and test counts (not acceptance evidence — the verifier reruns them), an explicit note
that G8.4 is pending the Linux verifier, and open issues.

If a correct fix needs a file outside allowed_files, stop and write a blocker
`{kind: out-of-scope, reason, needs}`. Do not edit `PLAN.md`/`PROGRESS.md`/`DECISIONS.md`, do not
merge, do not push, do not touch snapshots.