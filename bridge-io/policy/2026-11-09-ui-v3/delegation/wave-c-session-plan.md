# Wave C session-split plan — run 2026-11-09-ui-v3 (orchestrator planning, de-risks the 150-turn ceiling)

Binding planner rule (PLANNER_RESPONSE §2.4): ONE page area per Coder session; if a packet covers more, split into
sub-sessions with their own commit; commit after every plan step; continuations use the fixed brief (last commit ·
finished steps · next step · frozen gates · files allowed · "edit first, explore second"). U3/U4/U5/U6 run in parallel
(distinct branches/worktrees); sub-sessions WITHIN a packet are sequential on that packet's branch (disjoint area files,
no overlap). Base = C2 tip. Rebase rule: if a sibling merges first, U4/U5 rebase onto the new tip; conflicts are their
repair items. Genesis @visual baselines are written only by the fenced RUx refresh, never by an implementer.

## U3 — simple-pages (6 areas → 6 sequential sub-sessions on run/2026-11-09-ui-v3/u3-simple-pages)
Order (Frame first — the others render inside it):
1. frame — replaces the placeholder Frame.tsx: TopBar, inbox count from gates.list, ProjectSwitcher, ToastProvider wired
   to U2 notify(). Verify in crates/warsha-pipeline whether gate approval auto-continues the run; register
   project.gate.approve/inbox.gate.approve with or without runs.advance accordingly (state it in report.md).
2. onboarding  3. home (home.start = projects.create → budget.set → runs.start, in that order)
4. projects  5. project (Simple)  6. inbox
Each sub-session owns: pages/<area>/**, actions/registry/<area>.ts, i18n v3 {ar,en}/<area>.ts, e2e v3/<area>.spec.ts
(journeys + one test per action id + axe/keyboard ar/en×light/dark + @visual screenshots 1280×800 & 390×844). Commit per area.
Gates judging the packet: U3.1–U3.7, U3.deps, U3.snap, U3.pw (named/U3.txt), U3.simplicity.

## U4 — workbench (1 large area → 3 sequential sub-sessions on u4-workbench)
a. rail + header run-controls + 14-stage strip + ten-tab skeleton + terminal (read-only).
b. «المساعد» real chat on agent.turn / agent.plan_mode / agent.approve_mode / agent.state (Plan↔Agent, owner click =
   approval, NO fake replies) + advanced composer.
c. remaining tabs wired to real data hooks; every control registered + e2e-proven.
Gates: U4.1–U4.7, U4.deps, U4.snap, U4.pw (named/U4.txt).

## U5 — settings (1 large area → 3 sequential sub-sessions on u5-settings)
a. SideNav + first 4 sections (Simple mode shows four + «إعدادات متقدّمة»).
b. next 4 sections.  c. final 4 sections.
Every destructive action through a Dialog; API keys type=password, never logged/URL/snapshot.
Gates: U5.1–U5.7, U5.deps, U5.snap, U5.pw (named/U5.txt).

## U6 — remote-v3 (5 screens + pairing → per-screen sub-sessions on u6-remote-v3)
Needs you · Projects · Run · Gates · Settings · pairing. Keep behaviour/routes/test ids (remote-screen-*, remote-nav,
remote-pair-submit); remote flows 7/7; remove Google Fonts links from apps/remote/index.html; only @warsha/ui/v3.
Gates: U6.1–U6.5, U6.deps, U6.snap, U6.pw (named/U6.txt).

## Dispatch hygiene (every sub-session)
- Brief = PACKETS.md COMMON + the packet section + packets/<P>/gates.md verbatim, with <branch>/<base=C2 tip>/<wt>.
- Continuation after a ceiling hit: salvage (commit what compiles), then the fixed brief; never discard.
- Review + verify per PACKET (not per sub-session) once all its areas land; .pw on a scratch merge onto the integration tip.
- Merge order C3: U3 (+RU3 genesis) → U4 (+RU4) → U5 (+RU5) → U6 (+RU6), each refresh fenced (OD-U1 pre-authorised).
- The tracked H1 flows flake MUST be stabilised before Wave C dispatch (research/h1-flake-rootcause.md → a small fix packet).