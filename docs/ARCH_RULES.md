# Architecture rules — the enforceable set

Six rules with stable ids. Five of them (`R1`–`R5`) are boundary rules over the Rust crate graph and
the app sources, implemented in `scripts/check-arch.mjs`, run by `pnpm arch` locally, by the bridge
(`scripts/wsl-setup.sh`) and by CI (`.github/workflows/ci.yml`). The sixth, `R6 no-token-drift`,
belongs to the design system and is implemented by `packages/ui/src/tokens/tokenDrift.test.ts`, which
`pnpm -r test` runs in CI and in the bridge; it reads `packages/ui` and both app sources
(`apps/desktop/src/**`, `apps/remote/src/**`), and it keeps the same id and message shape, so a
reviewer reads one contract. The reasoning behind the rules is in
[`ARCHITECTURE.md`](ARCHITECTURE.md); this file is the contract.

## Message format

Every violation is one line, in exactly this shape:

```text
<RULE-ID>: <file>:<line> <offence>
```

`<file>` is a repository-relative path with forward slashes, `<line>` is 1-based, and `<offence>` is
one lowercase phrase naming what was found. Examples:

```text
R1: crates/warsha-core/Cargo.toml:14 path dependency warsha-store
R2: crates/warsha-pipeline/Cargo.toml:11 dependency warshad
R3: crates/warsha-store/Cargo.toml:12 dependency warsha-pipeline (tier 3 is above warsha-store tier 1)
R4: crates/warshad/src/lib.rs:41 path warsha_pipeline::agent_workflow (private module)
R5: apps/desktop/src/App.tsx:12 import ../../crates/warsha-core/src/lib (crates are not importable from the UI)
R6: packages/ui/src/components.tsx:34 hardcoded colour `#2563eb` (use a colour token: colorVar('accent'), colorVar('text'), …)
```

R1–R5 are printed by `scripts/check-arch.mjs`, which exits `1` when at least one violation is printed,
and `0` with the summary line `arch: 5 rules, 0 violations` when the tree is clean. R6 is printed by
the UI package's test suite, so it fails the `Test` step of `pnpm -r test` instead — same id, same
shape, same "violations are never warnings" rule.

The ids are stable. Renaming a rule means changing this file, the implementation and CI in the same
commit; the ids are what a failing build prints, so they are part of the interface.

---

## R1 core-is-leaf

- **Rule id**: `R1`
- **Name**: `core-is-leaf`
- **Forbids**: any `path` dependency in `crates/warsha-core/Cargo.toml`. The check flags every
  `path = …` entry in any dependency table of that manifest, including `[dev-dependencies]` and
  per-target tables.
- **Why**: `warsha-core` is the vocabulary crate that every other crate depends on. A single in-repo
  dependency would pull a whole layer into all ten crates, make the leaf impossible to compile in
  isolation, and turn the ring order into a cycle the moment the dependency points sideways. External
  crates are fine (`serde`, `uuid`, `chrono`, `ulid`, `semver` today); in-repo crates are not.
- **Passes today**: `warsha-core` declares only workspace and registry dependencies.
- **Failure message**: `R1: <manifest>:<line> path dependency <name>`

## R2 no-daemon-under-pipeline

- **Rule id**: `R2`
- **Name**: `no-daemon-under-pipeline`
- **Forbids**: `warsha-pipeline` depending on **`warshad`**, **`warsha-cli`**, **`warsha-relay`** or
  **`warsha-backends`**. The check reads `[dependencies]`, `[dev-dependencies]`,
  `[build-dependencies]` and per-target dependency tables of
  `crates/warsha-pipeline/Cargo.toml`, and flags any entry whose name is in that set, whether or not
  it carries a `path` key.
- **Why**: the pipeline is a library that the daemon, the CLI and the tests all drive. If it depended
  on a daemon it could only be tested with a daemon; if it depended on a coding backend, the engine
  would be welded to one implementation of the stage it is supposed to own. `warsha-backends`
  implements pipeline traits and depends on `warsha-pipeline`, so the reverse edge would also be a
  dependency cycle.
- **Passes today**: the pipeline declares `warsha-core`, `warsha-store` and `warsha-providers` only.
- **Failure message**: `R2: <manifest>:<line> dependency <name>`

## R3 no-upward-edges

- **Rule id**: `R3`
- **Name**: `no-upward-edges`
- **Forbids**: a crate depending on a crate that sits later in the ring order:

  ```text
  tier 0  warsha-core
  tier 1  warsha-store
  tier 2  warsha-providers  warsha-git  warsha-remote
  tier 3  warsha-pipeline  warsha-backends
  tier 4  warshad  warsha-cli  warsha-relay
  ```

  A dependency is an upward edge when its tier is **strictly greater** than the depending crate's
  tier. Same-tier edges are allowed, which is what lets `warshad` → `warsha-cli`-style peers exist in
  principle and, concretely, what lets `warsha-backends` sit beside `warsha-pipeline` instead of
  under it.

  **Deviation from the plan text, recorded deliberately**: `PLAN.md` M20 sketched the ring as
  `core < store < providers/git/backends/remote < pipeline < daemons`. That ordering makes the edge
  `warsha-backends` → `warsha-pipeline` (declared in `crates/warsha-backends/Cargo.toml`) an upward
  edge on a tree that is otherwise green. Rather than edit a crate's manifest to satisfy a document,
  the tier map above puts `warsha-backends` beside `warsha-pipeline`, and `R2` forbids the reverse
  edge explicitly. See `DECISIONS.md` (2026-10-31, M20).
- **Why**: an upward edge makes the leaf layers depend on the surface layers. The layering exists so
  that core, store, providers, git and remote can be built and tested without a daemon, and so the
  dependency graph stays acyclic and reviewable.
- **Passes today**: every declared in-repo edge is same-tier or downward.
- **Failure messages**:
  - `R3: <manifest>:<line> dependency <name> (tier <dep-tier> is above <crate> tier <crate-tier>)`
  - `R3: <manifest>:<line> dependency <name> (not in the ring order)` — a `path` dependency whose
    name is not one of the ten known crates.
  - `R3: <manifest>:1 crate <name> is not in the ring order` — a crate directory with no tier.

## R4 no-private-module-reach

- **Rule id**: `R4`
- **Name**: `no-private-module-reach`
- **Forbids**: a `warsha_<name>::<segment>` path in one crate that names a **module** of another crate
  which is not `pub` and is not re-exported from that crate's `lib.rs`. Concretely, the script reads
  every `crates/*/src/lib.rs` and collects:
  - private modules: `<vis> mod <name>;` where `<vis>` is empty, `pub(crate)` or `pub(super)`;
  - re-exported names: the names introduced by `pub use …;`.

  A path is then flagged when `<segment>` is a private module **and** does not appear among that
  crate's re-exported names. Glob paths (`warsha_core::*`) and paths whose segment is a type, trait
  or function (`warsha_store::Store`, `warsha_remote::DeviceIdentity`) are not module reaches and are
  not flagged.
- **Why**: the `pub use` block in a crate's `lib.rs` is the crate's public API. Reaching past it into
  `mod handoff;` couples a caller to an internal layout that the owning crate must then freeze, and it
  silently breaks the moment that module is renamed or made private. `warsha-pipeline` keeps sixteen
  private modules precisely so it can rearrange them.
- **Passes today**: every cross-crate path names a type that the owning crate re-exports.
- **Failure message**: `R4: <file>:<line> path warsha_<name>::<segment> (private module)`

## R5 ui-through-client

- **Rule id**: `R5`
- **Name**: `ui-through-client`
- **Forbids**, in `apps/desktop/src/**` and `apps/remote/src/**` (`.ts`, `.tsx`, `.js`, `.jsx`,
  `.mjs`, `.cjs`):
  1. an import or `require` whose specifier points into `crates/` — either a relative path
     (`../../crates/warsha-core/src/lib`) or a bare `crates/…`;
  2. a `fetch(` call;
  3. a `new WebSocket(` call.

  Comments are not scanned: only import specifiers and call expressions are. `packages/client` is the
  one place allowed to speak to the daemon, and it is not under `apps/`.
- **Why**: the daemon's API is typed, token-authenticated and redacts secrets from errors. A
  hand-written `fetch` or socket in a screen bypasses the token handling, the frame parsing and the
  redaction, and drifts from the typed client the tests cover. A UI that imported a Rust crate would
  have to be built with the Rust toolchain, which the apps are not.
- **Passes today**: no app file imports `crates/`; the only `fetch(` in the workspace is
  `packages/client/src/index.ts:316`, which the rule does not scan by design.
- **Failure messages**:
  - `R5: <file>:<line> import <specifier> (crates are not importable from the UI)`
  - `R5: <file>:<line> fetch( (call daemon through @warsha/client)`
  - `R5: <file>:<line> new WebSocket( (call daemon through @warsha/client)`

## R6 no-token-drift

- **Rule id**: `R6`
- **Name**: `no-token-drift`
- **Implemented by**: `packages/ui/src/tokens/tokenDrift.test.ts` (17 tests), run by `pnpm -r test`
  in CI and by the bridge. It is not in `scripts/check-arch.mjs` on purpose: R1–R5 read Rust
  manifests and app imports, while R6 has to read the TypeScript token modules *and* `tokens.css` to
  compare them, which only the package that owns both can do.
- **Forbids**, in every file that renders UI in `packages/ui` — `src/components.tsx` and
  `src/components/*.tsx`, excluding `*.stories.tsx` and `*.test.tsx`:
  1. a **colour literal** — `#rgb`, `#rrggbb`, `rgb(`, `rgba(`, `hsl(`, `hsla(`;
  2. a **length literal** — any `px`, `rem`, `em`, `pt`, `vh`, `vw`, `ms`, `s` value;
  3. a **physical direction property** — `marginLeft`, `paddingRight`, `borderLeft*`,
     `borderTopLeftRadius`, `left:`, `right:` … (the RTL rule in `eslint.config.js` already covers
     the two apps, not this package);
  4. a **font stack written inline** instead of `fontFamily('sans')` / `fontFamily('mono')`. The CSS
     keywords `inherit`, `initial`, `unset` and `revert` are allowed, because they are not a choice
     of typeface;
  5. a **raw token name** — `--warsha-…`, whether bare or wrapped in `var()`;
  6. a `cssVar(` **call** — the untyped primitive is for the token modules and for Storybook; a
     component uses the typed helpers (`colorVar`, `space`, `radius`, `shadow`, `fontSize`,
     `fontWeight`, `duration`, `easing`), each of which takes only a declared token name.

  Comments are blanked before scanning, so documentation may describe a value ("half-steps of the
  4px base") without tripping the rule; only what renders is scanned.
- **Also scans both apps** — `apps/desktop/src/**/*.{ts,tsx}` and `apps/remote/src/**/*.{ts,tsx}`,
  excluding `*.test.ts(x)`, which assert what renders rather than decide a design value. Apps do not
  import the typed helpers, so their contract is the custom property itself:
  - a `var(--warsha-…)` reference **is allowed** here (it is the app's whole vocabulary), which is
    the one place the rule relaxes rule 5 above;
  - a **colour literal** (`#rgb`, `rgb(`, named colours such as `'white'`) fails;
  - a **spacing literal** fails when the value sits on the 4px scale (`4 8 12 16 24 32 48 64`), and
    the message names the `--warsha-space-*` step; a value **off** the scale (`10px`, `18px`, `40px`)
    is **not** an offence, because the brief is to leave a value the scale cannot express rather than
    force it;
  - a **font-size literal** fails when the value sits on the type scale (`12 14 16 18 20 24 30px`,
    `0.75 0.875 1 1.125 1.25 1.5 1.875rem`), and the message names the `--warsha-font-size-*` token;
  - an **inline font stack** fails; `inherit` and `var(--warsha-font-mono)` pass;
  - the scan reads the *value* of a declaration, so `borderRadius: '8px'` beside
    `padding: 'var(--warsha-space-4)'` is not mistaken for a spacing literal.
- **Also checks**, in the same file:
  - `tokens.css` and the six token modules declare **exactly the same names** — no extra property in
    the stylesheet, no token in TypeScript the CSS forgot;
  - every name carries the same **value**, compared separately for `:root` (light) and
    `[data-theme='dark']`, so a dark-mode value cannot drift from its TypeScript twin;
  - every component exported by `components.tsx` has a `*.stories.tsx` (Storybook cannot silently
    lose a component).
- **Why**: the dark theme is only correct if a component asks for a *role* rather than a colour. A
  literal is a value that cannot follow `[data-theme]`, it is invisible in review because it looks
  like every other string, and it silently forks the palette — before this rule `components.tsx`
  carried its own blue (`#2563eb`), three greys, a white card, three radii, a shadow and two
  transition durations. The `--warsha-` half of the check is the second failure mode: a token name
  typed by hand (`var(--warsha-color-surfce-muted)`) renders as nothing and produces an unstyled
  element rather than an error.
- **Self-test**: the same file scans a fixture that plants one violation of each rule and asserts
  each fires, plus a clean fixture that must produce nothing — mirroring
  `node scripts/check-arch.mjs --self-test`, so a rule that silently matches nothing fails instead of
  passing.
- **Passes today**: `Box`, `Text`, `Button` and `Card` reference tokens only; `tokens.css` and the
  token modules agree name for name and value for value; five story files cover the four components
  plus the token layer; and both apps — 41 `.ts`/`.tsx` files (39 under `apps/desktop/src`, 2 under
  `apps/remote/src`) — render from `var(--warsha-*)` references with no colour, on-scale spacing or
  type literal left.
- **Failure messages** (one per line, in the `ARCH_RULES` shape):
  - ``R6: packages/ui/src/components.tsx:34 hardcoded colour `#2563eb` (use a colour token: …)``
  - ``R6: packages/ui/src/components.tsx:52 hardcoded length `12px` (use a spacing or radius token: …)``
  - ``R6: packages/ui/src/components.tsx:61 physical direction property `paddingLeft` (use the logical property, RTL-safe)``
  - ``R6: packages/ui/src/components.tsx:70 hardcoded font family `Inter, sans-serif` (use a family token: …)``
  - ``R6: packages/ui/src/components.tsx:78 raw token name `--warsha-…` (call the typed token helper instead)``
  - ``R6: packages/ui/src/components.tsx:80 untyped `cssVar(` call (use the typed helper: …)``
  - ``R6: apps/desktop/src/screens/Budgets.tsx:41 hardcoded colour `#2563eb` (use a token reference: 'var(--warsha-color-accent)', …)``
  - ``R6: apps/desktop/src/screens/Budgets.tsx:52 hardcoded spacing `16px` (use `var(--warsha-space-4)`; a value off the 4px scale may stay a pixel)``
  - ``R6: apps/desktop/src/screens/Budgets.tsx:61 hardcoded font size `0.875rem` (use `var(--warsha-font-size-sm)`)``
  - ``R6: apps/desktop/src/screens/Budgets.tsx:70 hardcoded font family `Inter, sans-serif` (use `var(--warsha-font-sans)` or `var(--warsha-font-mono)`)``

---

## Self-test

`node scripts/check-arch.mjs --self-test` builds two fixture repositories under the OS temp
directory and asserts the rules on them, then deletes them:

- a **violating** fixture that plants one violation of each rule;
- a **clean** fixture whose edges mirror the real tree (core leaf, store → core,
  pipeline → store/providers, backends → pipeline, warshad → everything), which proves the ring order
  and R4 do not fire on the layout we actually have.

It prints one line per rule proving the planted violation was detected:

```text
self-test R1 core-is-leaf: detected path dependency warsha-store
self-test R2 no-daemon-under-pipeline: detected dependency warshad
self-test R3 no-upward-edges: detected dependency warsha-pipeline
self-test R4 no-private-module-reach: detected path warsha_pipeline::private_thing
self-test R5 ui-through-client: detected crates import + fetch( + new WebSocket(
self-test clean fixture: 0 violations
```

and exits `1` if any rule fails to fire, or if the clean fixture produces a false positive.

## What is out of scope

- **Test-only files** are checked like any other file; the rules apply to `#[cfg(test)]` code too.
- **`Cargo.lock`** is not read; only declared `path` edges matter.
- **Same-tier** edges are allowed by `R3`, so the daemon crates may declare each other; today none
  do.
- **Dead code and duplication** (for example the two `provider_setup` modules) are review questions,
  not boundary violations, and no rule here fires on them.
- **App stylesheets** — `apps/desktop/src/index.css` and `apps/remote/src/index.css` — are outside the
  R6 scan, which reads `.ts`/`.tsx` only. Both import `tokens.css` once and reference the custom
  properties; a colour added there would be caught in review, not by this rule. Widening the scan to
  `.css` is a one-line change to `APP_DIRECTORIES`' filter when a batch owns those files.
- **Off-scale values** in the apps are deliberately allowed (see the app rules above): `10px`,
  `13px`, `18px`, `40px`, `0.8125rem` and `0.8rem` have no token, so the rule does not ask for one.
  It therefore cannot prove that a screen has no literal at all — only that every literal it *could*
  have expressed as a token was expressed as one.
- **Radii, widths and heights** in the apps stay literals: the batch that migrated colours, spacing
  and type sizes did not touch radius or layout sizing, and R6's app scan does not flag them.
- **Story files** are not scanned by R6: a story exists to show a token in context (a demo grid, a
  centred layout, a swatch), and scanning them would force fixtures into a vocabulary that exists to
  be looked at.
- **App test files** are not scanned for the same reason this package's tests are not: an assertion
  may name a rendered value, and `toHaveStyle({ backgroundColor: 'var(--warsha-color-surface-muted)' })`
  is a claim about output, not a design decision.
- **`tokens.css` itself** is not scanned for literals — it is the one file where the values are
  allowed to live, and it is compared against the TypeScript modules instead of being censored.
