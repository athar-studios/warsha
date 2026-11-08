# Architecture rules — the enforceable set

Seven rules with stable ids. Five of them (`R1`–`R5`) are boundary rules over the Rust crate graph and
the app sources, implemented in `scripts/check-arch.mjs`, run by `pnpm arch` locally, by the bridge
(`scripts/wsl-setup.sh`) and by CI (`.github/workflows/ci.yml`). The sixth, `R6 no-token-drift`,
belongs to the design system and is implemented by `packages/ui/src/tokens/tokenDrift.test.ts`, which
`pnpm -r test` runs in CI and in the bridge; it reads `packages/ui` and both app sources
(`apps/desktop/src/**`, `apps/remote/src/**`), and it keeps the same id and message shape, so a
reviewer reads one contract. The seventh, `R7 no-rpc-drift`, is the JSON-RPC wire contract between the
daemon, its policy table, `packages/client` and the e2e harness stubs; it lives in
`scripts/check-wire-contract.mjs` (with `--self-test` and `--report-only-known`) and runs as the
`Wire contract` CI step next to `Architecture boundaries`, because it compares Rust and TypeScript
sources that neither `check-arch.mjs` nor any test file reads (DECISIONS.md 2026-11-03). The
reasoning behind the rules is in [`ARCHITECTURE.md`](ARCHITECTURE.md); this file is the contract.

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
W1: packages/client/src/index.ts:581 method "gates.queue" (the client can put it on the wire and the daemon registers no such name — a live call answers -32601)
```

R1–R5 are printed by `scripts/check-arch.mjs`, which exits `1` when at least one violation is printed,
and `0` with the summary line `arch: 5 rules, 0 violations` when the tree is clean. R6 is printed by
the UI package's test suite, so it fails the `Test` step of `pnpm -r test` instead — same id, same
shape, same "violations are never warnings" rule. R7 is printed by `scripts/check-wire-contract.mjs`
under its own stable check ids `W1`–`W9` (the nine checks of the one rule), which exit `1` on any
violation and `0` with the summary line `wire: 9 checks, 0 violations` when the tree is clean — same
shape, same ids in the same positions, so a reviewer reading a build log sees one contract.

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
  silently breaks the moment that module is renamed or made private. `warsha-pipeline` keeps
  twenty-three private modules (twenty-six modules in total; `mcp`, `mcp_transport` and `settings`
  are public) precisely so it can rearrange them.
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
  `packages/client/src/index.ts:478`, which the rule does not scan by design.
- **Failure messages**:
  - `R5: <file>:<line> import <specifier> (crates are not importable from the UI)`
  - `R5: <file>:<line> fetch( (call daemon through @warsha/client)`
  - `R5: <file>:<line> new WebSocket( (call daemon through @warsha/client)`

## R6 no-token-drift

- **Rule id**: `R6`
- **Name**: `no-token-drift`
- **Implemented by**: `packages/ui/src/tokens/tokenDrift.test.ts` (35 tests), run by `pnpm -r test`
  in CI and by the bridge. It is not in `scripts/check-arch.mjs` on purpose: R1–R5 read Rust
  manifests and app imports, while R6 has to read the TypeScript token modules *and* `tokens.css` to
  compare them, which only the package that owns both can do. The 35 is measured from the merged
  file at `406240a` (`grep -cE '^\s*it\('`), not copied from the design document.
- **Forbids**, in every file that renders UI in `packages/ui` — `src/components.tsx`,
  `src/components/*.tsx` (stories and tests excluded), `src/compounds/*.{ts,tsx}` (the barrel
  `index.ts` and story files excluded; `internal.ts` **is** scanned) and `src/storySupport.tsx`:
  1. `R6.1` a **colour literal** — `#rgb`, `#rrggbb`, `rgb(`, `rgba(`, `hsl(`, `hsla(`;
  2. `R6.2` a **length literal** — any `px`, `rem`, `em`, `pt`, `vh`, `vw`, `ms`, `s` value;
  3. `R6.3` a **physical direction property** — `marginLeft`, `paddingRight`, `borderLeft*`,
     `borderTopLeftRadius`, `left:`, `right:` … (the RTL rule in `eslint.config.js` already covers
     the two apps, not this package);
  4. `R6.4` a **font stack written inline** instead of `fontFamily('sans')` / `fontFamily('mono')`.
     The CSS keywords `inherit`, `initial`, `unset` and `revert` are allowed, because they are not a
     choice of typeface;
  5. `R6.5` a **raw token name** — `--warsha-…`, whether bare or wrapped in `var()`;
  6. `R6.6` a `cssVar(` **call** — the untyped primitive is for the token modules and for Storybook;
     a component uses the typed helpers (`colorVar`, `space`, `radius`, `shadow`, `fontSize`,
     `fontWeight`, `duration`, `easing`), each of which takes only a declared token name;
  7. `R6.7` a **unitless design literal** — `fontWeight: <n>` or `zIndex: <n>` (use `fontWeight()` /
     `layer()`). A weight or a layer is a design value even without a unit.

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
  `R6.9` and `R6.10` are a second, independent app scan: they read `.ts`, `.tsx` and `.css` (tests
  and comments excluded) and count every absolute length and literal `var()` fallback against the
  ratchet, so the on-scale tolerance above cannot hide an off-scale length forever.
- **Also checks**, in the same file:
  - `R6.8` — a raw colour may appear in `tokens.css` only inside a block whose selector list is
    exactly `:root, [data-theme='light']` or `[data-theme='dark']`. `compounds/internal.ts` is
    scanned by the package rules above, so `:root :focus-visible` cannot smuggle a raw colour past
    them;
  - `R6.P` — `tokens.css` and the token modules declare **exactly the same names** — no extra
    property in the stylesheet, no token in TypeScript the CSS forgot. It covers the DS v2 families
    `lines.ts` and `elevation.ts`; `breakpoints.ts` is explicitly exempt because a media query cannot
    read a custom property;
  - every name carries the same **value**, compared separately for `:root` (light) and
    `[data-theme='dark']`, so a dark-mode value cannot drift from its TypeScript twin;
  - `R6.S` — every component exported by `components.tsx` (and by the compound modules) has a
    `*.stories.tsx` (Storybook cannot silently lose a component).
- **R6 v2 is live** (`docs/designs/DESIGN_SYSTEM_V2.md` §4.6; W3 merged at `406240a`):
  - `R6.9` — the **app length ratchet**: every `px`/`rem`/`em` length in
    `apps/{desktop,remote}/src/**/*.{ts,tsx,css}` (comments and tests excluded), outside an `@media`
    prelude whose value is in the `breakpoints.ts` px set, is an offence. The live count may not
    exceed `APP_LENGTH_BUDGET = 145` (142 R6.9 lengths plus 3 R6.10 literal fallbacks, measured at
    W3's base `5abe5ef`);
  - `R6.10` — a literal `var()` fallback (`var(--warsha-x, 4px)`).

  The ratchet's frozen mechanics: `WARSHA_R6_APP_LENGTH_BUDGET` can only **tighten** the budget
  (`Math.min(APP_LENGTH_BUDGET, env)`), never raise it; W5 drives the apps to zero at `=0`, and INT-2
  pins the constant to `0`. Every rule ships with a planted-violation fixture that must fire and a
  clean fixture that must stay clean.
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
- **Passes today** (measured at `406240a`): the primitives and the compound components reference
  tokens only; `tokens.css` and the token modules agree name for name and value for value; 28 story
  files cover the exported components and the token layer; both apps — 70 non-test source files (68
  `.ts`/`.tsx` plus 2 `.css`, 51 under `apps/desktop/src` and 19 under `apps/remote/src`) — carry no
  colour, on-scale spacing or type literal; and the ratchet's live count is within
  `APP_LENGTH_BUDGET = 145`. The test file's measured `it(` count is 35.
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

## R7 no-rpc-drift

- **Rule id**: `R7`
- **Name**: `no-rpc-drift`
- **Implemented by**: `scripts/check-wire-contract.mjs` (dependency-free Node, `--root <dir>`,
  `--self-test`, `--report-only-known`), run as the `Wire contract` CI step immediately after
  `Architecture boundaries` and by hand before touching any of the four sources it reads. It is not
  in `scripts/check-arch.mjs` on purpose: the wire contract lives in four files across Rust and
  TypeScript that share no import graph, and only a purpose-built parser sees all four at once.
  The permanent guard for what text parsing *cannot* see — parameter type- and shape-level drift,
  e.g. a string where the daemon deserialises an object — is the boot-the-real-daemon-and-drive-it
  test named in `DECISIONS.md` (2026-11-03, #40 restated), not this script.
- **Reads four sources**: the `#[method(name = "…")]` attributes of the `WarshaApi` trait in
  `crates/warshad/src/lib.rs` (whitespace-tolerant, so a multi-line attribute cannot be skipped)
  with each method's bound argument names; every `method: "…"` row of `METHOD_POLICIES` in
  `crates/warshad/src/auth.rs`; every JSON-RPC name `packages/client/src/index.ts` can put on the
  wire — literal `rpc('a.b', …)` calls, generic `rpc<T>('a.b', …)` calls (the generic branch
  balances one nested `<…>`, so `rpc<Record<string, string>>('a.b')` is still a call), and names
  passed through a same-file `const X = 'a.b'` indirection (five call sites do exactly that; a naive
  `'…'` regex silently drops `backend.export`, `handoff.*` and `postlaunch.*`) — **each of them
  matched in either quote style**, plus a template literal in the name position: a parser that reads
  only `'…'` gates on the formatter's quote preference instead of on the wire, and measured on a
  copied tree an injected `rpc("made.up", { x: 1 })` left the check reporting `0 violations, exit 0`
  while the same name in single quotes fired `W1` and exited 1. With the size of each call's params
  object **and the names of its top-level keys** — a quoted key `{ "name": … }` counts as an entry
  exactly as an unquoted one does, and a key is read whether it is written as `{ run_id: x }`,
  `{ "run_id": x }` or the shorthand `{ run_id }` — and the `RPC_METHODS` stub table of
  `apps/desktop/e2e/harness.ts`, whose entries are matched in either
  quote style for the same reason (the harness view has no count cross-check behind it, so a table
  the parser cannot read makes `W2` pass vacuously).
- **Checks** (stable ids, one line per offence in the message format above):
  - `W1` client-method-unregistered — every name the client can put on the wire is registered by the
    daemon. A live call to an unregistered name answers `-32601 Method not found`, and the harness
    stubs hid exactly that for the whole visual suite.
  - `W2` harness-method-unregistered — every harness stub name is registered too; a stub the daemon
    does not serve is a screen measured against a fiction.
  - `W3` daemon-method-without-policy — every daemon method has a row in `METHOD_POLICIES`, the
    same invariant `every_registered_method_has_a_policy_and_no_policy_names_a_missing_one` asserts
    at runtime, checked statically so CI sees it without compiling.
  - `W4` policy-row-without-daemon-method — the other half of set equality; a stale row plus a
    missing row would cancel out in `W6`'s count.
  - `W5` method-without-extensions — every `#[method]` declares `with_extensions`, the structural
    half of re-audit LOAD-1 finding 1: a method not handed its caller cannot reach `authorize()`.
  - `W6` view-integrity — the parsed daemon count equals the policy-table count, every source file
    exists, every region marker is found, and no parser matches zero (two independent views of one
    set; a parser that silently misses a method fails loudly instead of reporting clean).
  - `W7` required-field-drift — each client call's literal params object supplies at least as many
    entries as the daemon method has required (non-`Option`) bound arguments. This is the failure
    measured live against a running daemon: `projects.create { name }` answered `-32602 "missing
    field 'description'"`, which is why the app could read an empty world but not create its first
    project; the client now sends all three, so the check fires on today's tree only when a call goes
    one entry short again. **Key CASING is deliberately not an offence**: the earlier plan to require
    snake_case key equality was retracted by running the daemon (`DECISIONS.md` 2026-11-03, #40
    WITHDRAWN — `{"projectId": …}` and `{"project_id": …}` both reach the store; a gate that fails
    working code is worse than no gate), and the self-test guards that retraction with a `clean:`
    mutant that camelCases every key of one call and must leave the tree at zero violations. `W7`
    counts, so it is blind to the one thing `W8` exists for: `{ id }` against an argument bound as
    `run_id` is 1 sent against 1 required and passes `W7` while the daemon answers `-32602` with
    `missing field 'run_id'`.
  - `W8` param-name-drift — every key of a resolvable literal params object must be one of the two
    spellings the generated decoder accepts for some bound argument of that method. Those spellings
    come from the macro, not from taste: `src/render_server.rs:398-421` of `jsonrpsee-proc-macros`
    v0.26.1 — the crates.io dependency `Cargo.lock` pins, not a file in this repository; a reader opens
    the vendored copy at `~/.cargo/registry/src/index.crates.io-*/jsonrpsee-proc-macros-0.26.1/src/render_server.rs`
    after any cargo build, or the same published source from crates.io — where the `decode_map` block
    emits `#[serde(rename = "<arg>")]` plus an `alias` for `heck::ToSnakeCase` and one for
    `heck::ToLowerCamelCase` of every argument name, and serde ignores fields that match neither. So
    `run_id`, `runId` and the shorthand `{ run_id }` / `{ runId }` bind, and a key that is no spelling
    of any argument binds nothing — the value is dropped, and when the argument it was meant for is
    required the call dies with `-32602 "missing field …"`. Two shipped calls were exactly this shape
    (`runs.get { id }`, `devices.pair { qrData }`) and `W7` could not see either; they were found by
    hand-running the daemon (`DECISIONS.md` #54). Like `W1`, `W8` refuses to guess: a params argument
    it cannot resolve to an object literal — a variable, a call, a spread, a computed `[k]:` key, or a
    positional array — is reported as a not-name-checkable finding rather than skipped. A positional
    array is the one shape that is legal on the wire and still not name-checkable (jsonrpsee matches
    it by position), and the finding text says so instead of accusing the call. `W8` has no
    deferral set: a key no argument binds is a name one side or the other can be corrected to.
  - `W9` client-method-without-harness-stub — every method the client can put on the wire has an
    entry in the harness's `RPC_METHODS` table (`DECISIONS.md` 2026-11-08 D8). It is the other
    direction from `W2`: a stub the daemon cannot serve is fiction, while a client call with no stub
    renders the error state in every visual case that reaches it — the 2026-11-07 "32 visual
    failures" class. Nothing is deferrable: a stub for a registered method is always the fix, and a
    name the daemon does not serve is `W1`'s to delete. An unresolvable call site is `W1`'s finding
    and is skipped here, so each broken call is reported once.
- **Known drift: there is none, and it can no longer be bought back**: `KNOWN_UNREGISTERED_METHODS`
  and `KNOWN_PARAM_DRIFT_METHODS` are both empty since the #25/#40 client work landed — `budget.get`
  became `budget.show` (cents→USD at the client edge), `devices.remove` became `devices.revoke`,
  `runs.status` folded into `runs.get`, `runs.logs` folded into `runs.events`, and `projects.delete`,
  `providers.budget`, `providers.budget.status` and `roles.assign` were deleted rather than aliased,
  while `projects.create` now sends all three fields the daemon requires. `REQUIRE_NO_KNOWN_DRIFT` is
  `true` in the script's header, and strict mode **escalates** rather than excuses: a name
  re-added to either list still fails the check, because `run()` routes listed items to `defer()` only
  while the flag is off. `--report-only-known` therefore prints zero deferred items today, and
  deferring something again means flipping that flag back in the same commit — a visible decision, not
  a silent one. The self-test guards it by planting the two drift shapes as
  `enforcedInBothModes` mutants, which must fire in the shipped mode as well with nothing deferred.
- **Why**: 836 Playwright cases passed against a harness stubbing nine method names no daemon
  served, while the installed app could not create a project or read a gates queue. A visible
  `-32601` is honest; a green suite over a broken seam is not. This rule is the machine-checkable
  statement that the daemon registry, its policy table, the client's calls and the harness stubs
  are one contract, not four.
- **Self-test**: `node scripts/check-wire-contract.mjs --self-test` plants one mutation per check id
  in a temp fixture tree (including the const-indirect, generic-`rpc<T>` and multi-line-`#[method]`
  parse modes, and one mutant per quote style the parser must not be able to miss — a `"a.b"` client
  call, a `rpc<T>("a.b")` call, a `"a.b"` const, a `"a.b"` harness stub, a `Record<string, string>`
  generic and a quoted params key, each of which fails the self-test if the parsing narrows back to
  `'…'`-only), asserts each fires, asserts the clean fixture reports clean in **both** modes (it
  carries a `"a.b"` call and a quoted-key params object on the legal side, so a parser that
  mis-reads those fails here rather than in CI), and asserts the two drift shapes the known sets
  used to defer — a `{ name }`-only `projects.create` and a client call on an unregistered name —
  fire **in the shipped mode as well with nothing deferred** (`enforcedInBothModes`), which is the
  guard against the whitelist quietly coming back. `W8` is proved from both sides, because a name
  check that only proved its happy path would be worthless here: a `renamed-param-key` mutant sends
  `{ inputValue }` for the argument `input` (one entry against one required, so `W7` is silent by
  construction) and must fire `W8`, while an `aliased-casing-is-not-an-offence` mutant marked
  `clean:` rewrites every key of one call to its camelCase alias and must leave the tree at **zero**
  violations in both modes — the retraction guard, so a future tightening that reads casing as drift
  fails here instead of failing working code. Four more mutants cover the shapes whose names cannot
  be read (a params variable, a spread, a computed key, a positional array), and one parser-mode
  assertion reads the four shapes whose names can be (snake, alias, shorthand, quoted) straight off
  `parseClient`, so the check is proven to parse and not merely to match — mirroring
  `node scripts/check-arch.mjs --self-test`.
- **Passes today** (measured at `406240a`): the daemon registers 88 methods and the policy table
  names 88, the two daemon views agree, and every method is declared `with_extensions`. The client
  has 75 call sites over 75 distinct methods — 70 written with a literal method name and 5 resolving
  through a same-file `const`, of which 60 pass an object-literal params argument and 15 pass none,
  with zero unresolvable and zero positional — and every one is stubbed by the harness's 75-entry
  `RPC_METHODS` table, so `W9` (client ⊆ harness) is clean. Every literal params object supplies
  each required bound argument **and names only spellings the generated decoder binds**. Both known
  sets are empty: `wire: 9 checks, 0 violations` with zero deferred items.
- **Failure messages** (one per line, in the `ARCH_RULES` shape; none of these fire on today's tree —
  each is the offence the check prints when that drift is present, and the first two are the shapes
  the client used to ship):
  - ``W1: packages/client/src/index.ts:581 method "gates.queue" (the client can put it on the wire and the daemon registers no such name — a live call answers -32601)``
  - ``W2: apps/desktop/e2e/harness.ts:113 stub "gates.queue" (the harness answers a name the daemon does not register)``
  - ``W3: crates/warshad/src/lib.rs:682 method "runs.get" has no row in METHOD_POLICIES (it would be served unpoliced)``
  - ``W4: crates/warshad/src/auth.rs:281 policy row for "gates.gone" names no daemon method (the table and the registry drifted)``
  - ``W5: crates/warshad/src/lib.rs:662 method "health" is declared without with_extensions (its handler cannot reach authorize())``
  - ``W6: crates/warshad/src/lib.rs:1 the daemon view parsed 59 methods and the policy view parsed 60 rows (two parsers must see one set)``
  - ``W7: packages/client/src/index.ts:515 method "projects.create" sends 1 param entry but it requires 3 bound arguments {name, description, language} — the live daemon answered -32602 "missing field" for exactly this shape``
  - ``W8: packages/client/src/index.ts:552 method "runs.get" sends param key "id", which is no accepted spelling of any bound argument of the daemon method (it binds {run_id} — accepted: run_id / runId); the live daemon skips it and answers -32602 "missing field 'run_id'"`` — printed by the copied-tree control that planted `{ id }` back into the shipped `{ run_id: id }` call, where `W7` stayed silent (1 entry, 1 required)
  - ``W8: packages/client/src/index.ts:552 method "runs.get" sends params as the value of `this.runParams` — a variable, an expression or a call, not an object literal, so its param NAMES cannot be checked against the daemon's bound arguments here and the parser refuses to guess them``
  - ``W9: packages/client/src/index.ts:1389 client method "projects.list" has no e2e harness stub (apps/desktop/e2e/harness.ts RPC_METHODS)`` — the shape a client lane shipping ahead of its harness update produces

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

`R6` and `R7` carry the same discipline in their own runners: `R6` scans planted fixtures in
`packages/ui/src/tokens/tokenDrift.test.ts`, and `R7` runs
`node scripts/check-wire-contract.mjs --self-test` before the real check in the same CI step, each
asserting every check fires and a clean fixture is reported clean. A silently broken parser can never
report a green tree in any of the three.

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
