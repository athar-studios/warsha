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
| Design System v2 — tokens, R6 v2, compound contracts, screen architecture, adoption ladder | Draft for implementation (run 2026-11-08, packets W3/W5) | [`./DESIGN_SYSTEM_V2.md`](./DESIGN_SYSTEM_V2.md) |
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
  behaviour 45 across `flows`/`layout`/`onboarding`, remote 91).
- Drift check weekly: `/egm-drift-report docs/designs/` — reconcile doc or code, human picks which.
