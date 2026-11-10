# Packet U0 Report — Design System Foundation (v3)

## Commits
- Base: `4c65ead4f46cf97eecffd73149a57056e505568c`
- Head: `bae6c0bbb056dccffc78f561b572bb21398a8db3`

## Changes by Step
1. **Tokens (`ff9658e`):**
   - Added semantic tokens (`color`, `type`, `space`, `radius`, `elevation`, `motion`, `layout`).
   - Declared CSS custom properties in `tokens.css` with light `:root`, dark `:root[data-theme="dark"]`, `@media (prefers-color-scheme: dark)`, and density switching `[data-density="compact"]`.
   - Added TS/CSS parity tests and 50 WCAG contrast ratio tests passing WCAG AA / AAA.
2. **Icons (`6b7e6e9`):**
   - Exported all 46 in-house SVG icons per DS §2.5 with 24 viewBox, currentColor stroke 1.75, accessible label support, and RTL mirror class.
3. **Primitives (`a78a154`):**
   - Created all 19 primitives per DS §3.1 (`Button`, `IconButton`, `Link`, `TextField`, `TextArea`, `Select`, `Combobox`, `Checkbox`, `Radio`, `Switch`, `Segmented`, `Tabs`, `Tooltip`, `Badge`, `StatusPill`, `RoleMark`, `Spinner`, `Skeleton`, `ProgressBar`) plus helpers (`Divider`, `Kbd`, `VisuallyHidden`).
   - Created corresponding `.test.tsx` and `.stories.tsx` files for each component.
   - Wired props forwarding for `data-action`, `data-testid`, and `aria-*`.
   - Fixed ESLint unused variables and import order cleanly across primitives and stories.
4. **Package & Docs (`e2e1723`):**
   - Added `./v3` and `./v3/tokens/tokens.css` export subpaths in `packages/ui/package.json`.
   - Added v3 section to `packages/ui/README.md` covering the 5 principles and token references.
5. **CI Linting (`bae6c0b`):**
   - Created `scripts/check-ds-v3.mjs` checking hex colors, length literals, physical directions, numeric z-index, and !important with `--self-test` support.

## Decisions
- OD-U2 font stack option C adopted per owner decision: system font stack with `"IBM Plex Sans Arabic"` and `"IBM Plex Mono"` without new font dependencies (rejected: adding `@fontsource` packages or vendoring woff2 binaries).
- Primitives use CSS custom properties exclusively for styling with logical properties (rejected: hardcoded pixel values or physical left/right properties).
- Checkbox and Radio wrap label and input with dedicated hint and error rendering (rejected: leaving hint prop unused in component signature).

## Measured Unit Counts
- UI package tests: 309 passed (base 181, +128 new tests, requirement >= 221)
- Contrast checks: 50 pairs checked, fails 0
- Icons exported: 46 (requirement >= 44)
- Primitives delivered: 19 with complete .tsx / .test.tsx / .stories.tsx triads
- DS v3 linter violations: 0 across packages/ui/src/v3; self-test passed cleanly
- Storybook build: exit 0
- Typecheck: exit 0 (all packages). Lint: `@warsha/ui` exit 0; workspace-wide `pnpm -r lint` fails on a pre-existing base defect in packages/client/src/index.test.ts (5 no-unused-vars, outside U0 scope, fixed by packet F2).

## Seen But Left Alone
- `packages/ui/storybook-static/`: Storybook build artifacts left untracked and deliberately excluded from git commits per brief instructions.
