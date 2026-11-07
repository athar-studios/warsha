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
| _(next design)_ | Draft | `./FEATURE.md` (create per feature) |

## Conventions

- One file per feature under `docs/designs/`, named `FEATURE.md`.
- Sections: Overview, Problem, Goals, Non-Goals, Open Questions, CUJs, Technical Plan, Alternatives, Verification.
- Verification must name real commands and E2E spec totals (a11y 188, states 252, visual 308).
- Drift check weekly: `/egm-drift-report docs/designs/` — reconcile doc or code, human picks which.
