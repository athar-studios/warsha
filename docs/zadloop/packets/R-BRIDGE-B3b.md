# R-BRIDGE-B3b — MCP approval in the Inbox and Settings (G3) · after B3a and B1

Status: spec frozen. Base: `ff3788f` (repair/dev-csp-f474776). Depends on B3a
(daemon `mcp.approvals.list` / `mcp.approvals.allow_once`; B3b starts only
after the independent Reviewer pass reports no open HIGH) and B1 (Workbench
patterns). Licence wording: "free and source-available".

## Why

B3a gives the owner a daemon path to answer an agent's MCP question, but no
screen shows it: the Inbox knows only gate decisions (`InboxDecisionItem`,
`pages/inbox/index.tsx:43-51`, no `kind` field), and no Settings section
lists permissions (`SettingsSectionId`, `pages/settings/types.ts:1-13`, no
`permissions`/`mcp`). The client carries no `mcp.*` call and the harness no
`mcp.*` stub (both measured absent). This packet adds the Inbox item and the
Settings table per OD-B3's two-packet split. No Rust.

## Goal

Inbox item showing server, tool, role and the daemon's summary, with allow
once, allow always and deny. Settings gets the permissions table
(`mcp.permissions.list`) with revoke (`mcp.permissions.set`). Registry
entries, ar and en strings, component and e2e tests, DAEMON.md rows. The
summary is rendered as a "redacted preview" (B3a O8: a non-key-named,
non-schema-marked, non-token-shaped secret cannot be recognised by any
redactor — the UI must not imply more).

## Allowed files

- `packages/client/src/index.ts` and its test (add `mcpApprovalsList`,
  `mcpAllowOnce`, `mcpPermissionsList`, `mcpPermissionsSet` + decoders;
  both B3a methods are new wire shapes — the wire checker runs in this
  packet)
- `apps/desktop/e2e/harness.ts` (add `mcp.approvals.list`,
  `mcp.approvals.allow_once`, `mcp.permissions.list`,
  `mcp.permissions.set` to the known-method list + stub fixtures; per
  `harness.ts:285` an unimplemented method fails the case)
- `apps/desktop/src/v3/actions/registry/inbox.ts`,
  `apps/desktop/src/v3/actions/registry/settings.ts`
- `apps/desktop/src/v3/pages/inbox/index.tsx`,
  `apps/desktop/src/v3/pages/inbox/Inbox.test.tsx`,
  `apps/desktop/e2e/v3/inbox.spec.ts`
- `apps/desktop/src/v3/pages/settings/index.tsx`,
  `apps/desktop/src/v3/pages/settings/SettingsNav.tsx`,
  `apps/desktop/src/v3/pages/settings/types.ts`, a new
  `sections/McpPermissionsSection.tsx` (modelled on the
  `DevicesSection.tsx:137-163` row-list pattern, NOT a `<table>`),
  `settings/settings.css` (row classes only)
- `packages/i18n/src/v3/{ar,en}/inbox.ts`,
  `packages/i18n/src/v3/{ar,en}/settings.ts`
- `docs/DAEMON.md` (client-side rows: the two approval methods +
  `mcp.permissions.list/set` if absent), plus the packet report. No Rust.

## Out of scope

Daemon or wire-shape changes beyond the client wrappers; suspending turns
(O2); phone approval (O3); persisting grants; changing `ToolPermission`
semantics; v3 default (B4a); preview (B5). No test weakening: every claim
stays 1:1.

## Steps

1. Client: the four methods + decoders for `McpApproval[]`
   (`{id, run_id, server, tool, role, summary, requested_at}`) and
   `McpPermissionsReply`; decoder tests (missing/mistyped field errors).
2. Inbox: `kind: 'gate' | 'mcp'` beside `InboxDecisionItem` (`:43`); second
   collector merged before the sort (`:125`); item renders server/tool/role +
   summary in the `v3-inbox-item-actions` div pattern (`:595-640`) with
   allow-once / allow-always / deny; feeds the empty-state check and the
   total badge (`:451`); pending entries from `mcp.approvals.list`.
3. Settings: `McpPermissionsSection.tsx` row-list with revoke
   (`mcp.permissions.set`); section registration in `types.ts` + `index.tsx`
   + `SettingsNav.tsx` icon; capability flag if the pattern needs one
   (`capabilities.ts:4-15` + defaults + its test).
4. Registry entries (`inbox.mcp.allow_once`, `inbox.mcp.allow_always`,
   `inbox.mcp.deny`, `settings.mcp.revoke`) + ar/en strings.
5. Harness stubs + e2e: approve-once through the stub; revoke in Settings.
6. Discrimination: new tests fail on the base commit, pass on the new code;
   save outputs under `target/`.

## Acceptance (frozen gate table excerpt; full table in §7 of the run brief)

- Component tests: pending item renders summary; allow-once / always / deny
  call the right method with the right id; empty-state includes MCP items.
- E2e collects an approval through the stub; revoke changes the table.
- `node scripts/check-wire-contract.mjs` 11/0 with the new rows green
  (W1/W2/W9 satisfied: client + harness + daemon all know the methods).
- T1–T8 quoted (no Rust touched — explicitly not re-run); T9 `pnpm lint &&
  pnpm typecheck && pnpm -r test && pnpm build` 0 with counts not below
  baseline; T10 action/i18n checks 0.

## Constraints

Small Conventional Commits on a `zl-b3b-*` branch from the B3a merge tip;
implementer never authors gates; reviewer separate, never edits; verifier
separate, never repairs; no force push/tag/publish; mock provider only.
`packages/client/src/index.ts` and `harness.ts` are shared with B5: one lane
at a time per file.
