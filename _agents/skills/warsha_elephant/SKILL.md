---
name: warsha-elephant
description: Load Warsha project context for design and review work (EGM-compatible).
---

# Warsha Elephant — Project Context

Load this context before any design (`/egm-draft`), review (`/egm-review`),
or drift check (`/egm-drift-report`) on the Warsha repo.

## Stack

- Rust workspace (`crates/`: `warshad`, `warsha-store`, `warsha-pipeline`, `warsha-core`, …)
- TypeScript desktop app (`apps/desktop/src/screens/`, 21+ screens, RTL ar/en, light/dark)
- E2E: Playwright (`apps/desktop/e2e/` — `screens.a11y.spec.ts` 188, `states.spec.ts` 252,
  `screens.visual.spec.ts` 308, behaviour 45 across `flows.spec.ts` 30 / `layout.spec.ts` 12 /
  `onboarding.spec.ts` 3; remote `apps/remote/e2e/` 91 — `bench.visual.spec.ts` 84, `flows.spec.ts` 7)
- Visual contract: `playwright.config.ts` (`maxDiffPixelRatio: 0`، `threshold: 0.05`) + Linux fontconfig pin (`scripts/ci/capture-fontconfig.conf`)

## Canonical docs (read first)

- `docs/ARCHITECTURE.md` — system architecture (verified against the tree at `99a7c03`)
- `docs/designs/DESIGN_SYSTEM_V2.md` — Design System v2 (tokens, R6 v2, compound contracts, adoption ladder)
- `docs/design/REDESIGN.md` — redesign spec (S5/S6/§7/§10/§11)
- `docs/UI.md` — desktop UI reference (screens, states, directions)
- `docs/INSTALL.md` — build, install and uninstall transcript with measured hashes
- `docs/DEPLOY.md` — Docker/Caddy deployment, TLS boundary and domainless paths
- `docs/VERIFY.md` — artifact verification, evidence bar and deferred device items
- `docs/SKILLS_AND_HARNESSES.md` — skill bundling rule (Apache-2.0/MIT/BSD can bundle with notices; GPL/AGPL link-only)
- `THIRD_PARTY_NOTICES.md` — declared third-party components
- `docs/designs/SITEMAP.md` — EGM design index for this repo

## Boundaries

- EGM material (`https://github.com/google/elephant-goldfish-model`, Apache-2.0) is **reference/link-only**: never copy its `skills/`, `agents/`, or `resources/` text into Warsha. Only original summaries and links.
- Do not modify functional source code when running `egm-bootstrap` (docs only), do not `git commit`/`git add` from workers; human submits.
- Secrets ride via keychain only (`AGENTS.md`); never log secrets.
- Do not commit, push, publish, or run destructive ops without user authorization.
- Visual baselines: never bulk-update snapshots without explicit approval naming the exact set.

## Verification commands

- Rust: `cargo test` (store guards: migration LF determinism in `crates/warsha-store/src/lib.rs`)
- Desktop unit: `pnpm --filter warsha-desktop test`
- E2E a11y: `pnpm exec playwright test apps/desktop/e2e/screens.a11y.spec.ts --project desktop`
- E2E states (serial, real exit, no `| tail` mask): `pnpm exec playwright test apps/desktop/e2e/states.spec.ts --project desktop --reporter=line > /root/states-true.log 2>&1; echo STATES_TRUE_EXIT:$?`
