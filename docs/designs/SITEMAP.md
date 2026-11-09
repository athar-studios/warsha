# Warsha Design Index (EGM `docs/designs/`)

Index of design specifications for Warsha. New designs follow the
Elephant-Goldfish Model flow (`/egm-brainstorm` → `/egm-draft` →
`/egm-review` → human review → implement → `/egm-drift-report` weekly).

> EGM upstream (`https://github.com/google/elephant-goldfish-model`,
> Apache-2.0) is reference/link-only. This directory holds **original**
> Warsha designs only; no upstream skill/agent text is vendored here.
> Template reference: upstream `skills/egm-draft/references/design_doc.md`.

| Design | Status | Path |
|---|---|---|
| Redesign baseline (S5/S6/§7/§10/§11) | Canonical reference | `../design/REDESIGN.md` |
| Design System v2 — `lines.ts`/`elevation.ts`/`breakpoints.ts`, R6.1–R6.10 with the `APP_LENGTH_BUDGET = 145` ratchet, compound contracts, screen architecture, adoption ladder | Implemented in part: W3 merged at `406240a`; W5 (app adoption) pending | [`./DESIGN_SYSTEM_V2.md`](./DESIGN_SYSTEM_V2.md) |
| Design System v3 «حِرفة» — clean-slate system: principles, measured palette (both themes), type, space, icons, 19 primitives, 27 composites, the action contract | Spec, awaiting owner approval (OD-U0, run `2026-11-09-ui-v3`) | [`./DESIGN_SYSTEM_V3.md`](./DESIGN_SYSTEM_V3.md) |
| UI v3 plan — every page, every action id, the 14→5 stage map, what is not built and why | Spec, awaiting owner approval (OD-U0) | [`./UI_V3_PLAN.md`](./UI_V3_PLAN.md) |
| UI v3 static preview — Home, Project, Workbench, Settings, the system; light/dark | Visual reference, not product code | [`./v3-preview.html`](./v3-preview.html) |
| Skills and harnesses policy | Canonical policy | [`../SKILLS_AND_HARNESSES.md`](../SKILLS_AND_HARNESSES.md) |
| Desktop UI reference | Canonical reference | [`../UI.md`](../UI.md) |
| Install manual (build, install, uninstall) | Canonical reference | [`../INSTALL.md`](../INSTALL.md) |
| Deployment manual (Docker, Caddy, TLS, tunnels) | Canonical reference | [`../DEPLOY.md`](../DEPLOY.md) |
| Verification guide (artifacts, hashes, evidence bar) | Canonical reference | [`../VERIFY.md`](../VERIFY.md) |
| _(next design)_ | Draft | `./FEATURE.md` (create per feature) |

## Conventions

- One file per feature under `docs/designs/`, named `FEATURE.md`.
- Sections: Overview, Problem, Goals, Non-Goals, Open Questions, CUJs, Technical Plan, Alternatives, Verification.
- Verification must name real commands and E2E spec totals (a11y 188, states 252, visual 308,
  behaviour 45 across `flows`/`layout`/`onboarding`, remote 91). Those are **listed** totals, not a
  green baseline: G0 recorded desktop 793 listed / 785 passed / 8 failed (the 8 settings a11y cases,
  fixed by W8) and remote 91 / 51 / **40 failed** (stale remote baselines, open under owner decision
  OD1). See `../VERIFY.md` §1.3 before quoting any suite as green.
- Drift check weekly: `/egm-drift-report docs/designs/` — reconcile doc or code, human picks which.
