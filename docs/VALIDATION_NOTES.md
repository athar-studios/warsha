# VALIDATION_NOTES.md — Bridge Validation Analysis

Maintained by **debugger** (read-only analysis; this file is the only file debugger writes).
Every FAIL from the latest bridge run is mapped to: file path, exact error message, root cause, exact fix,
and the owning member. Source of evidence: `bridge-io/run-output.log` (the harness writes CRLF/escaped
sequences, so it reads as binary through the file reader; the grep tool reads it fine — line numbers below
are that file's line numbers).

---

## M0 CLOSED — run 7

**`RESULT: M0 validation PASSED — all checks green`** (run-output.log:375), **17 of 17 checks PASS**:

| Check | Evidence (run-output.log line) |
|---|---|
| project layout sanity (4 files) | `:4-7` |
| apt base deps | `:20` |
| rustup stable + rustfmt + clippy | `:25` |
| nvm / Node 20 | `:31` |
| corepack / pnpm 9 | `:35` |
| actionlint installed | `:38` |
| `cargo fmt --all --check` | `:41` |
| `cargo clippy --workspace --all-targets -- -D warnings` | `:69` |
| `cargo test --workspace` — **40 Rust tests**, 0 failed | `:80-250`, `:252` |
| `pnpm install` | `:269` |
| `pnpm -r typecheck` | `:283` |
| `pnpm -r build` | `:315` |
| `pnpm -r test` — **40 TS tests** (client 12, i18n 12, ui 8, remote 4, desktop 4), 0 failed | `:331-369` |
| actionlint `.github/workflows/ci.yml` | `:372` |

Rust test distribution across the 25 `test result:` lines (10 of them non-empty, 15 empty targets):
2 + 1 + 5 + 13 + 3 + 4 + 1 + 4 + 6 + 1 = 40.
The clippy run finished clean (`Finished dev profile [unoptimized + debuginfo] target(s) in 10.24s`, `:68`),
which confirms the `result_large_err` boxing in `warsha-cli` was sufficient as well as correct: `CliError`
came back under the 128-byte threshold.

Both analysis corrections from the M0 cycle are preserved and were accepted into PROGRESS.md:

1. **axum `Binary` retraction** — `axum 0.7.9`'s `ws::Message::Binary` holds `Vec<u8>`, so
   `Message::Binary(vec)` was correct and my `.into()` demand was wrong. The error was asserting a
   version-specific type from memory instead of the resolved registry source.
2. **`request<R, Params>` order** — the return type is the **first** generic, so `request::<_, X>` left `R`
   inferred and placed X in the **Params** slot; `request::<X, _>` is the fix. My `ClientT` diagnosis was
   necessary but not sufficient.

Also preserved: the parts of my analysis that held — the missing `ClientT` import, the `ToRpcParams` gap for
`()` (four sites, one of which I first missed and rust-coder caught), and the pre-flight reads that kept the
relay and `warshad` fixes from needing extra bridge cycles.

---

## Run 6 (history) — 2026-10-28T21:50:47+04:00

- Outcome: **RESULT: M0 validation FAILED** (run-output.log:632) — **13 of 14 checks PASS**
- `cargo fmt --all --check` **PASS** (:41), `cargo test --workspace` **PASS** (:509), `pnpm install` (:526),
  `pnpm -r typecheck` (:540), `pnpm -r build` (:572), `pnpm -r test` (:626) and `actionlint` (:629) all PASS.
- Single failure: `cargo clippy --workspace -- -D warnings` (:325), **21 × `clippy::result_large_err`**,
  every one of them in `crates/warsha-cli` — one root cause, not 21.

### FAIL 8 (run 6) — `clippy::result_large_err` × 21, `crates/warsha-cli`

Sites (all functions returning `Result<_, CliError>`): `248:56`, `259:42`, `283:48`, `306:10`, `333:49`,
`356:81`, `394:60`, `419:47`, `434:63`, `446:78`, `458:62`, `486:54`, `498:57`, `510:35`, `570:50`,
`581:58`, `605:53`, `610:38`, `622:58`, `645:38`, `655:33`.

```
error: the `Err`-variant returned from this function is very large
  --> crates/warsha-cli/src/lib.rs:248:56
   |   ------------------------------------ the largest variant contains at least 128 bytes
   = help: for further information visit .../index.html#result_large_err
   = help: to override `-D warnings` add `#[allow(clippy::result_large_err)]`
```

**Root cause**: `CliError::Daemon` carried `warshad::DaemonError` inline. That enum aggregates the error
types of six other crates (`StoreError`, `ProviderError`, `PipelineError`, `GitError`, `RemoteError`,
`keyring::Error`), so it exceeds clippy's 128-byte threshold, which makes every `Result` in the crate
expensive to return.

**Fix (applied, no `#[allow]`)**: box the variant and add the `From` impl that `#[from]` cannot generate
once the field type differs from the source type:
```rust
#[error("Daemon error: {0}")]
Daemon(Box<warshad::DaemonError>),
...
impl From<warshad::DaemonError> for CliError {
    fn from(err: warshad::DaemonError) -> Self {
        Self::Daemon(Box::new(err))
    }
}
```
Verified on disk at `crates/warsha-cli/src/lib.rs:18-21` and `:42-46`; the `#[from]` is gone from the
variant, so there is no duplicate `From` impl.

**Independent size check**: once `Daemon` is a pointer, the largest remaining variant is
`Remote(RemoteError)` or `Toml(toml::ser::Error)`, whose payloads top out at a `String` (24 bytes) or a
small enum — `serde_json::Error`, `reqwest::Error` and `std::io::Error` are pointer-sized. `CliError` should
settle near 32-40 bytes, well under the 128-byte limit, so this fix should clear all 21 at once.

**Residual risk**: `clippy` runs with `--all-targets`, and `warsha-cli`'s test target (`#[cfg(test)] mod
tests`, `:671-683`) has never been linted because the lib failed first. That module is a single clean test
(`assert_eq!` on `parse_gate_stage`, no lint-worthy constructs), so the risk is low. Nothing depends on
`warsha-cli`, so no crate sits behind it unverified.

**Optional, not for M0**: dropping `#[from]` also drops the implicit `#[source]`, so
`CliError::Daemon` now reports `source() == None`. `Daemon(#[source] Box<warshad::DaemonError>)` would keep
the chain (`Box<T>: Error` when `T: Error`). Worth a DECISIONS.md line rather than pre-green churn.

### Correction to the record: the turbofish order

The `request` fix is `::<X, _>`, and the reason is that `ClientT::request<R, Params>` declares the **return
type first**. So the earlier form `request::<_, X>` did not put X in the return slot — it put X in the
**Params** slot, with `R` left to inference, which is why the tuple/`rpc_params![]` argument then mismatched
the declared `Params`. The fix moves X into the return slot and lets `Params` infer from the argument.
Evidence: all 16 sites at `crates/warsha-cli/src/lib.rs:322-639` now read `::<X, _>` and the crate compiled
and passed `cargo test` in run 6, which would be impossible if the first generic were `Params`.

My own miss to record: I diagnosed the missing `ClientT` import (necessary) and the `()` param impls, but I
never checked the generic slot order, so my fix alone would have left the 13 tuple call sites mismatching
`Params` after the import landed. The lead caught it.

---

## Run 4 (history) — 2026-10-28T21:37:56+04:00

- Outcome: **RESULT: M0 validation FAILED** (run-output.log:729) — **2 FAIL / 12 PASS**
- Big movement in this run: `cargo fmt --all --check` **PASS** (run-output.log:41) and `pnpm -r test` **PASS**
  (:723), so the whole TypeScript side is green end to end for the first time.
- Remaining failures: `cargo clippy` (1 error) and `cargo test --workspace` (warsha-cli, 18 errors).
  `cargo fmt`, `pnpm install` (:623), `pnpm -r typecheck` (:637), `pnpm -r build` (:669) and
  `actionlint` (:726) all PASS.

| # | Check | Status | Owner |
|---|-------|--------|-------|
| 7 | `cargo fmt --all --check` | PASS | – |
| 8 | `cargo clippy --workspace -- -D warnings` | **FAIL** (exit 101) | rust-coder |
| 9 | `cargo test --workspace` | **FAIL** (exit 101) | rust-coder |
| 10-13 | `pnpm install`, `-r typecheck`, `-r build`, `-r test` | PASS | – |
| 14 | actionlint `.github/workflows/ci.yml` | PASS | – |

Relay and providers are now clean: the run reached `Checking warsha-pipeline`, `Checking warsha-backends`
and `Checking warshad` (:67), which it could not do while those two crates failed.

### FAIL 8 — `cargo clippy` (exit 101): `crates/warshad/src/lib.rs:596`

```
error: file opened with `create`, but `truncate` behavior not defined
   --> crates/warshad/src/lib.rs:596:14
    = help: if you intend to overwrite an existing file entirely, call `.truncate(true)`
    = help: alternatively, use `.append(true)` to append to the file instead of overwriting it
    = note: `-D clippy::suspicious-open-options` implied by `-D warnings`
```

**Root cause**: `OpenOptions::new().create(true).write(true)` in `LockFile::try_lock` leaves truncation
undefined; clippy's `suspicious_open_options` fires under `-D warnings`.
**Fix**: explicit `.truncate(false)` — a lock file must not be truncated — which is what the lead
specified. **Status: landed**; `crates/warshad/src/lib.rs:593-602` now reads
`.create(true).truncate(false).write(true)` with a comment explaining the lock semantics.

### FAIL 9 — `cargo test --workspace` (exit 101): `crates/warsha-cli` lib, 18 errors

Three distinct defects; only the first was fixed so far.

**9a. `crates/warsha-cli/src/lib.rs:21` — E0425**
```
error[E0425]: cannot find type `Error` in crate `jsonrpsee::core`
  --> crates/warsha-cli/src/lib.rs:21:34
```
`jsonrpsee` 0.26 has no `core::Error`; the client error lives at `jsonrpsee::core::client::Error`
(jsonrpsee-core 0.26.0 `client` module re-exports `error::Error`). **Fix applied**: line 21 now reads
`Rpc(#[from] jsonrpsee::core::client::Error)`. Correct.

**9b. 16 × E0599 `no method named 'request' found for struct 'HttpClient<S>'`** — lines 312, 321, 340,
362, 372, 383, 398, 421, 438, 450, 461, 473, 573, 584, 595, 629.
```
    = help: items from traits can only be used if the trait is in scope
    = help: trait `ClientT` which provides `request` is implemented but not in scope
```
**Root cause**: `ClientT` is never imported — a `ClientT` grep over the whole file returns zero matches;
line 5 imports only `HttpClient, HttpClientBuilder`. **Fix**: add
`use jsonrpsee::core::client::ClientT;` (rustfmt order: `jsonrpsee::core::client::ClientT` before
`jsonrpsee::http_client::{...}`). **Status: applied** — imports now at `:5-7`.

**9c. latent E0277 once 9b is fixed — four `()` param sites, not three.** `ToRpcParams`
(jsonrpsee-core 0.26.0) is implemented for `&[P]`, `Vec<P>`, `[P; N]`, `Map<String, Value>`, tuples of
1–16 elements, `ArrayParams` and `ObjectParams` — there is **no** impl for `()`. So `("projects.list", ())`
at `crates/warsha-cli/src/lib.rs:383` and `:629`, `("providers.list", ())` at `:461`, and
`("devices.list", ())` inside `cmd_devices` would fail with E0277 right after the trait import lands.
**Fix**: pass `rpc_params![]` at those four sites (add `use jsonrpsee::rpc_params;`). Tuple params at the
other 13 call sites are covered by the trait impls, and `request::<_, ()>` at `devices.pair` /
`devices.revoke` is a *return* type, so those `()` stay. **Status: applied** — `rpc_params![]` now sits at
`:385`, `:463`, `:588`, `:634`.

Correction on my count: I first reported three sites. That was an undercount from grepping for literal
`("…list", ())` patterns — `devices.list` passed `()` through a pre-broken call, so the grep skimmed past it
and I never opened the `cmd_devices` block. rust-coder found the fourth. Lesson: a grep hit list is not a
substitute for reading the function.

**9d. `cargo fmt` risk in the same block (open, unresolvable without running rustfmt).**
The `devices.list` call at `:586-589` is pre-broken vertically because rust-coder measured the inline form
at 101 columns. I measure **99** (20 indent + 14 `.request::<_, ` + 34 `Vec<warsha_remote::DeviceIdentity>` +
2 `>(` + 14 `"devices.list"` + 2 + 12 `rpc_params![]` + 1). There is no `rustfmt.toml`, so defaults apply:
`max_width = 100`; `fn_call_width = 60` is satisfied (args are 30); `chain_width = 60` forces the chain
vertical but not the argument list. At 99 rustfmt would collapse the block and `cargo fmt --check` would
fail on it; at 101 the vertical form is correct. Two characters apart on a boundary I cannot measure.
**Mitigation recommended to rust-coder**: import `DeviceIdentity` and write the call inline with the short
type, which lands at 84 columns and is unambiguous either way.

Other cli facts verified: `DeviceIdentity` is `pub` with `device_id`, `name`, `revoked` at
`crates/warsha-remote/src/lib.rs:48-55`, so `:592-593` is sound; `reqwest::Client`, `dirs`, `Ulid`, `Uuid`,
`Subcommand` are all genuinely used, and `http_client` is read at `:514` and `:610`.

`error[E0599]: no method named 'first' found for type '!'` at `crates/warsha-cli/src/lib.rs:343` is a
cascade of the `:340` failure (the `!` is the poisoned `request` result) and clears itself.

---

## Run history (superseded) — 2026-10-28T17:23:27Z (run 3)

Kept because the mapping below is what drove the fixes that made run 4 green on fmt and pnpm test.

- Outcome: **RESULT: M0 validation FAILED** (run-output.log, previous content; exit 1) — **3 FAIL / 13 PASS**

| # | Check | Status in run 3 |
|---|-------|--------|
| 7 | `cargo fmt --all --check` | **FAIL** (exit 1) |
| 8 | `cargo clippy --workspace --all-targets -- -D warnings` | **FAIL** (exit 101) |
| 9 | `cargo test --workspace` | **FAIL** (exit 101) |
| 13 | `pnpm -r test` | **FAIL** (exit 1) |

Green in run 3: `packages/client` 12/12, `packages/i18n` 12/12, `packages/ui` 8/8 tests.

---

## Run 3 — FAIL 7 — `cargo fmt --all --check` (exit 1)

Exactly **two** diffs in the whole workspace; there is no broad formatting drift.

**7a. `crates/warsha-providers/src/lib.rs:4`**
```
 use thiserror::Error;
-use warsha_core::*;
 use warsha_core::TokenUsage;
+use warsha_core::*;
```
rustfmt wants `use warsha_core::TokenUsage;` before the glob `use warsha_core::*;`.
**Fix**: deleting the redundant line 8 (see FAIL 8a) removes this diff. Do not hand-reorder.

**7b. `crates/warsha-relay/src/lib.rs:10`**
```
-use clap::Parser;
 use chrono::Utc;
+use clap::Parser;
```
**Fix**: deleting the unused top-level `use chrono::Utc;` (see FAIL 8c) removes this diff.

Both fmt failures are symptoms of the same two lines flagged by clippy; fixing clippy fixes fmt.

---

## Run 3 — FAIL 8 — `cargo clippy --workspace --all-targets -- -D warnings` (exit 101)

Four errors, in two files.

### 8a/8b — `crates/warsha-providers/src/lib.rs` — E0252 + unused import (x2)

```
error[E0252]: the name `TokenUsage` is defined multiple times
  --> crates/warsha-providers/src/lib.rs:96:9
   |
 8 | use warsha_core::TokenUsage;
   |     ----------------------- previous import of the type `TokenUsage` here
...
96 | pub use warsha_core::TokenUsage;
   |         ^^^^^^^^^^^^^^^^^^^^^^^ `TokenUsage` reimported here
   = note: `TokenUsage` must be defined only once in the type namespace of this module

error[E0252]: the name `TokenUsage` is defined multiple times
   --> crates/warsha-providers/src/lib.rs:110:9     (same shape)

error: unused import: `warsha_core::TokenUsage`
  --> crates/warsha-providers/src/lib.rs:96:9
error: unused import: `warsha_core::TokenUsage`
   --> crates/warsha-providers/src/lib.rs:110:9
```

**Root cause**: line 7 already has `use warsha_core::*;`, which imports `TokenUsage`. Line 8 is a
redundant `use warsha_core::TokenUsage;`, and lines 96 and 110 are two *identical* `pub use
warsha_core::TokenUsage;` re-exports (each with the same doc comment above it, lines 95 and 109).
Three definitions, two duplicate-diagnostic pairs.

**Exact fix**:
- delete `use warsha_core::TokenUsage;` (line 8);
- delete `pub use warsha_core::TokenUsage;` at line 96 **and** its doc comment at line 95;
- delete `pub use warsha_core::TokenUsage;` at line 110 **and** its doc comment at line 109.

The glob import keeps the type available, so `ChatResponse { usage: TokenUsage }` (line 64) still
resolves. Do **not** keep one re-export and drop the glob, and do **not** add `#[allow(unused_imports)]`.

### 8c — `crates/warsha-relay/src/lib.rs:14` — unused import `chrono::Utc`

```
error: unused import: `chrono::Utc`
  --> crates/warsha-relay/src/lib.rs:14:5
```

**Root cause**: `Utc` is used only at line 208, inside `#[cfg(test)] mod tests`, which gets it via
`use super::*;`. In the non-test lib build the top-level import is dead.

**Exact fix**: delete line 14 **and** add `use chrono::Utc;` immediately after `use super::*;` inside
`mod tests`. Deleting only ("just remove the import") breaks the test build. Keep `chrono` in
`crates/warsha-relay/Cargo.toml`.

### 8d — `crates/warsha-relay/src/lib.rs:126` — E0599 no method `split`

```
error[E0599]: no method named `split` found for struct `axum::extract::ws::WebSocket` in the current scope
   --> crates/warsha-relay/src/lib.rs:126:45
    |
126 |     let (mut sender, mut receiver) = socket.split();
    |                                             ^^^^^ method not found in `axum::extract::ws::WebSocket`
    = help: trait `StreamExt` which provides `split` is implemented but not in scope
```

**Root cause**: `split()` is provided by `futures_util::StreamExt`; the crate has no `futures`
dependency at all, only the workspace-level entry in the root `Cargo.toml`.

**Exact fix**: add `futures = { workspace = true }` to `[dependencies]` of
`crates/warsha-relay/Cargo.toml`, and add `use futures::StreamExt;` to the relay's imports.

### Latent errors that appear *after* 8d is fixed (fix in the same pass)

These are currently masked because `socket.split()` failing turns `sender`/`receiver` into error types.

- `crates/warsha-relay/src/lib.rs:132` — `Message::Binary(vec)`. axum 0.7's
  `axum::extract::ws::Message::Binary` holds `bytes::Bytes`, not `Vec<u8>`. Fix: `Message::Binary(vec.into())`.
- `crates/warsha-relay/src/lib.rs:97` — `if let Err(_) = state.forward(&frame).await`. `clippy::redundant_pattern_matching`
  is warn-by-default and becomes an error under `-D warnings`. Fix: `if state.forward(&frame).await.is_err()`.
- `crates/warsha-relay/src/lib.rs:144-156` — `while let Some(msg) = receiver.recv().await { if let Ok(msg) = msg { ... } else { break; } }`
  may trip a clippy style lint; if it fires, collapse to `while let Some(Ok(msg)) = receiver.recv().await`. Change only on evidence.

---

## Run 3 — FAIL 9 — `cargo test --workspace` (exit 101)

Identical diagnostics to FAIL 8a/8b and 8d, in the same two files
(`crates/warsha-providers/src/lib.rs:96,110`; `crates/warsha-relay/src/lib.rs:126`). Warnings instead of
errors here because `cargo test` has no `-D warnings`, but E0252/E0599 fail the build either way.
**No separate fix** — clears when FAIL 8 clears.

---

## Run 3 — FAIL 13 — `pnpm -r test` (exit 1)

```
apps/remote test:  FAIL  src/App.test.tsx > remote app > renders without crashing
apps/remote test: TestingLibraryElementError: Found multiple elements with the text: ورشة
apps/remote test:      22|     expect(screen.getByText('ورشة')).toBeInTheDocument();
apps/remote test:  Test Files  1 failed (1)
apps/remote test:       Tests  1 failed | 3 passed (4)

apps/desktop test:  FAIL  src/App.test.tsx > desktop app > renders without crashing
apps/desktop test: TestingLibraryElementError: Found multiple elements with the text: ورشة
apps/desktop test:      22|     expect(screen.getByText('ورشة')).toBeInTheDocument();
apps/desktop test:  Test Files  1 failed (1)
apps/desktop test:       Tests  1 failed | 3 passed (4)
```

**Root cause**: `t('app.name')` renders "ورشة" **twice** on the default route — once in the header
(`apps/desktop/src/App.tsx:46-48`, `apps/remote/src/App.tsx:46-48`) and once as the Dashboard title
(`apps/desktop/src/App.tsx:10-12`, `apps/remote/src/App.tsx:10-12`). `getByText` throws when more than
one node matches; the log's DOM dump shows two matching `<span>` nodes.

**Not** a locale problem and **not** an English-vs-Arabic mismatch — the app is correctly Arabic-first,
and the other three tests in each app already pass (Arabic tagline, the three Arabic gate buttons,
`حالة التشغيل: code`).

**Exact fix** (line 22 of each test file only):
`apps/desktop/src/App.test.tsx:22` and `apps/remote/src/App.test.tsx:22`

```ts
// before
expect(screen.getByText('ورشة')).toBeInTheDocument();
// after
expect(screen.getAllByText('ورشة')).toHaveLength(2);
```

Asserting the count keeps the test meaningful (it pins the header + dashboard brand rendering) instead of
loosening it. Do not skip/delete the test, do not use `passWithNoTests`, do not change UI strings to English.

---

## Corrections to earlier failure reports

- There is **no `warsha-backends` compile error** in this run. Both E0252 blocks in `run-output.log`
  (lines 90-111 in the clippy section, 166-186 in the test section) point at
  `crates/warsha-providers/src/lib.rs`.
- The apps failure is **not** "Unable to find an element with the text: Warsha". It is
  `Found multiple elements with the text: ورشة` — an ambiguous query, not a missing/mistranslated string.
- `PROGRESS.md` claims a `clippy.toml` was created that allows unwrap/expect/panic in tests; no
  `clippy.toml` exists in the repo root. This does not fail CI (it would only *widen* allowances), so it
  is recorded only as a documentation discrepancy.

## Structural note (not a blocker for M0)

`[workspace.lints.rust]` / `[workspace.lints.clippy]` in the root `Cargo.toml` (including
`unwrap_used = "deny"`, `expect_used = "deny"`, `panic = "deny"`, `unused_crate_dependencies`) are
**inert**: no member crate declares `[lints] workspace = true`. Effective Rust linting therefore comes
only from `-D warnings` on rustc/clippy defaults. Turning workspace lints on would surface a large new
error set (unused crate deps across crates, `unwrap` in tests), so it is deliberately out of M0 scope —
it should be a logged decision, not a silent omission.

## Fix status (verified by re-reading the files; no commands run)

**FAIL 13 (web-coder) — fixed.** `apps/desktop/src/App.test.tsx:20-25` and
`apps/remote/src/App.test.tsx:20-25` now assert `expect(screen.getAllByText('ورشة')).toHaveLength(2);`
under the renamed test `renders the brand in header and dashboard`. The other three assertions in each
file are unchanged; no `.skip`, no try/catch, no component or `packages/**` edits.

**FAIL 7/8/9 (rust-coder) — applied; both gaps I raised were closed afterwards.**
- `crates/warsha-providers/src/lib.rs`: duplicate `use`/`pub use` of `TokenUsage` removed (515 → 508 lines). Correct.
- `crates/warsha-relay/src/lib.rs`: top-level `chrono::Utc` removed and re-added inside `mod tests`;
  `use futures::{SinkExt, StreamExt};` added; `is_err()`, `receiver.next()` applied, and
  `Message::Binary(vec)` left as-is (axum 0.7.9 takes `Vec<u8>` — see the retraction below). Correct.
- **Gap 1 — closed**: `crates/warsha-relay/Cargo.toml:25` now has `futures = { workspace = true }`.
- **Gap 2 — closed**: `crates/warsha-relay/src/lib.rs:122` is now
  `async fn handle_websocket(socket: WebSocket, device_id: DeviceId, state: Arc<RelayState>)` — the
  unnecessary `mut` is gone.

Cross-checks done on the final tree (read-only):
- No crate referenced the removed `warsha_providers::TokenUsage` re-export (`warsha_providers::TokenUsage` /
  `warsha_providers::*`: zero matches), so deleting it breaks no downstream import.
- `crates/warsha-providers` already depended on `futures`; only relay needed the new dependency.
- Import blocks now sort correctly against rustfmt for both edited files (axum < clap < futures < std <
  thiserror < tokio < tracing < uuid < warsha_core < warsha_remote; async_trait < serde < std < thiserror <
  warsha_core::*), so the two `cargo fmt` diffs stay resolved.
- `chrono` is still a relay dependency but now used only under `cfg(test)`; harmless, because
  `unused_crate_dependencies` is inert (see structural note).

The tree is ready for the bridge re-run.

## CORRECTION — my `Message::Binary` claim was wrong (retracted)

I flagged `crates/warsha-relay/src/lib.rs:132` as a reverted line and asked for `Message::Binary(vec.into())`.
That was **wrong, and the current code is correct as `Message::Binary(vec)`**. The lead rewrote the line and
owned it, and supplied the decisive evidence:

- `axum-0.7.9/src/extract/ws.rs:570` declares `Binary(Vec<u8>)` — `Bytes` for `Binary`/`Ping`/`Pong` is an
  axum **0.8** change. The resolver picked axum 0.7.9 (0.8.9 only listed as available).
- `serde_json::to_vec` already returns `Vec<u8>`, so `.into()` is an identity conversion, which clippy
  rejected at the 21:30 run as `useless_conversion` under `-D warnings`.
- Run 4 linted `warsha-relay` clean with `vec` in place, so the line is not an error.

Root cause of my mistake: I asserted the field type from memory of the axum 0.7 changelog instead of reading
the resolved crate source for the pinned version. **Rule adopted: a resolved-crate source line or a compiler
line from the current run outranks any earlier read of ours.**

## Pre-flight static review of the fix tree (before run 4)

The previous run aborted at name-resolution errors (E0252/E0599), which stops type-checking, so none of the
code depending on the fixed files was ever borrow-checked or lint-checked. I read the reworked regions
directly to catch what the next run would otherwise be the first to discover:

- `crates/warsha-providers/src/lib.rs:327-370` (`chat_with_fallback`) — braces balance: the `Err(e)` arm
  closes at 365, the `match` at 366, the `for` at 367, the `if let Some(budget)` block at 325. The
  `last_error.unwrap_or(...)` fallthrough at 369 matches the `Option<ProviderError>` inferred at 348. No defect.
- The borrow-check trap I expected there does **not** fire: `let routing = self.role_routings.get(&role)`
  borrows `self.role_routings` only, while `*self.spent.entry(...) += cost` borrows `self.spent`; the NLL
  borrow checker splits disjoint fields, so they do not conflict. Do **not** "fix" this with `.cloned()` —
  it is not needed and would be churn.
- `RoleRouting`/`RoutingTarget` (`crates/warsha-core/src/lib.rs:324-338`) both derive `Clone`, so a clone
  stays available if a later refactor genuinely needs it.
- `crates/warsha-relay/src/lib.rs:14` `use futures::{SinkExt, StreamExt};` — both traits are genuinely
  required (`split()`/`next()` from `StreamExt`, `send()` from `SinkExt`), matching rust-coder's correction;
  `receiver.next()` replaces the nonexistent `SplitStream::recv()`.
- `crates/warsha-cli/Cargo.toml:28` pins `which = "6.0"` as a direct version rather than
  `{ workspace = true }` — correct, because the root `[workspace.dependencies]` has no `which` entry, and
  `which = { workspace = true }` would fail with "workspace dependency `which` not found".
- Root `Cargo.toml:55` `jsonrpsee` features are now `server, ws-client, http-client, tracing, macros`;
  `http-client` exists in jsonrpsee 0.26 and is what `warsha-cli`'s `HttpClient`/`HttpClientBuilder` need.
- `crates/warshad/src/lib.rs` and `crates/warsha-cli/src/lib.rs` both have lib targets, so the
  `warsha-cli → warshad` path dependency (`crates/warsha-cli/Cargo.toml:12`) is satisfiable.

Unverifiable without a compiler, and therefore left to the next bridge run: the `#[rpc]` macro expansion in
`warshad`, `rand 0.9` `TryRngCore`/`OsRng` usage, and `warsha-git` / `warsha-backends` / `warsha-store`,
which no run has reached yet.

## M1 — contract drift found while writing `docs/DAEMON.md`

Reading the daemon, store and migrations for DAEMON.md surfaced behaviour that either contradicts the M1
brief or will break as soon as M1's auth and `/events` work lands. Each item is code-verified, with the
source line that proves it. None of these is an M0 regression: all of them predate the green run and were
invisible to fmt/clippy/test.

| # | Drift | Evidence | Consequence |
|---|---|---|---|
| 1 | `warsha` CLI targets the wrong endpoint: it builds `format!("{}/rpc", base_url)` with `base_url` defaulting to `http://127.0.0.1:8765` | `crates/warsha-cli/src/lib.rs:59`, `:257`; daemon RPC binds `127.0.0.1:<ws_port>` = 8766 at the socket root (`crates/warshad/src/lib.rs:476-482`), and the HTTP server on 8765 registers only `/health` (`:500`) | Every CLI RPC call fails on a default install. The M0 suite never exercises it because no test drives CLI→daemon. |
| 2 | CLI sends no bearer token | `crates/warsha-cli/src/lib.rs:256-265` builds `HttpClientBuilder::default().build(...)` with no `set_headers`; nothing reads `config.auth_token` in the CLI | The moment M1 enforces auth (§3 of DAEMON.md), the CLI is rejected — client and server must land together. |
| 3 | `Store::new()` ignores `DaemonConfig::data_dir` | `crates/warsha-store/src/lib.rs:153-159` (was `:68-74` before task-4 reshaped the file) resolves `dirs::config_dir()/warsha/warsha.db` itself; `run_daemon` never passes `config.data_dir` (`crates/warshad/src/lib.rs:437`) | A custom `data_dir` moves the lock file but not the database, so two "installs" can share one DB while holding different locks. **Being fixed in task-5**; `Store::open_at` already exists at `:162` for it. |
| 4 | Artifact layout differs from the brief | `Store::factory_dir()` = `<db parent>/projects/<project_id>/factory` (`crates/warsha-store/src/lib.rs:566`, was `:290` pre-task-4) | The M1 brief said `factory/<project_id>/`; code nests under `projects/`. Adjudicated by the lead: the code wins and the brief's phrasing came from the M3 spec. DAEMON.md documents the code. |
| 5 | HTTP `/health` reports `uptime_seconds: 0` always | `crates/warshad/src/lib.rs:412-418` vs the RPC `health` at `:244-250` which computes real uptime | Two endpoints, same type, different truth; a monitoring client reading HTTP sees uptime 0 forever. |
| 6 | Single-instance lock is advisory only | `crates/warshad/src/lib.rs:604-607` — the comment states advisory locking is not implemented; `try_lock` cannot fail | A second `warshad` currently starts and competes for the same DB. M1 is landing the OS lock; DAEMON.md marks it Pending M1. |
| 7 | `socket_path` is reserved, never used | configured at `:71`, defaulted at `:85`, overridden at `:429-430`, no listener anywhere | The crate doc comment (`:1`) advertises "JSON-RPC over Unix socket / named pipe" that does not exist; transport is TCP only. |
| 8 | `Stage` has no `gate_a` / `gate_b` | `crates/warsha-core/src/lib.rs:56-69` lists `… GateC, Release, GateD …` only | PLAN.md's Gate A/B acceptance flows (rejecting Gate B returns to spec) cannot be expressed in the current model. M3 will hit this. |
| 9 | `providers.list` / `providers.add` / `providers.test` are stubs | `crates/warshad/src/lib.rs:365-380` — returns `vec![]`, `Ok(())`, and a fabricated healthy `HealthCheck` | A client cannot tell a stub from a working provider; `providers.test` always reports healthy, which is misleading in a doctor flow. |
| 10 | `docs/DEVELOPERS.md` says artifacts live in `<repo>/.warsha/` and `factory/` | `docs/DEVELOPERS.md:22` vs `Store::factory_dir()` | Documentation drift only; noted here because DAEMON.md is now the authoritative statement. |
| 11 | Ports saved in `config.toml` can never take effect | `crates/warshad/src/lib.rs:110-115` gives `--http-port` / `--ws-port` clap defaults of `8765`/`8766`, and `:427-428` assigns them unconditionally | `run_daemon` always overwrites `config.http_port`/`config.ws_port` with the clap value, so editing the file is silently ignored unless the same value is also passed as a flag. |

## M1 delta inventory — DAEMON.md edits queued for after run 8

DAEMON.md was written against the tree as it stood before tasks 4, 5, 8 and 9 landed, and the lead's
sequencing is deliberate: the doc gets reconciled against what the bridge run *proves*, not against a
half-landed tree. It now carries a status banner saying so. The queued edits, with the current tree state
that motivates each:

| DAEMON.md section | Queued change | What the tree shows today |
|---|---|---|
| §1 lock | rewrite once the OS lock is real: second-instance behaviour, error raised, release path | still advisory (`crates/warshad/src/lib.rs:604-607`) |
| §2 config | drop the "file ports are ignored" caveat once task-5 lands | still overwritten unconditionally (`:427-428`) |
| §5 `Stage` list | add `gate_a` / `gate_b` and their positions | `crates/warsha-core/src/lib.rs:56-69` has only `GateC`/`GateD`; task-9 is landing the rest |
| §6 table list | six tables → nine | `002_m1_gates_artifacts_costs.sql` adds `gates`, `artifacts`, `costs` |
| §6 data layout | `data_dir` now reaches the store | `Store::open_at` exists (`crates/warsha-store/src/lib.rs:162`); `new()` still ignores `data_dir` (`:153-159`) |
| §7 examples | CLI example once task-8 fixes endpoint and token | CLI still posts to `8765/rpc` with no token |

### Pre-flight for task-5, found while reading the reshaped store

`run_daemon` will call `Store::open_at(config.data_dir.join("warsha.db"))`. Two gaps in `open_at` that this
call pattern will expose, both code-verified:

1. **It does not create the parent directory.** `Store::new()` calls `std::fs::create_dir_all(&config_dir)`
   before delegating (`crates/warsha-store/src/lib.rs:157-158`), but `open_at` assumes the directory exists.
   A `data_dir` set in `config.toml` to a path that has never been created will fail at connect time with
   SQLite's "unable to open database file", surfaced as a store error. `open_at` should do
   `create_dir_all(db_path.parent())` itself, so the guarantee follows the function rather than its current
   caller.
2. **The existence probe still round-trips through a URL and swallows its own failure.**
   `format!("sqlite://{}?mode=rwc", db_path.display())` at `:163` is used for `database_exists` and
   `create_database`, with `.unwrap_or(false)` at `:166` discarding any parse/lookup error before
   `create_database` is called with the same string. The pool itself is already correct — `SqliteConnectOptions::new().filename(&db_path).create_if_missing(true)`
   at `:175-178` is URL-free — so the probe is redundant: SQLite creates the file, and the only thing it adds
   is the parent directory, which item 1 handles explicitly. Removing it also retires the question of how a
   Windows path (`C:\Users\...`) or a path containing `?`/`#` behaves inside a `sqlite://` URL.

Neither gap is currently observable: the M0 tests open stores under `tempfile` directories that already
exist, and no test sets a custom `data_dir`.

## M1 — what the next bridge run must prove

1. **Build + lint stay green** with the new migrations and daemon code: `cargo fmt --all --check`,
   `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, and the unchanged
   pnpm/actionlint set. The M0 baseline to beat is 17/17 with 40 Rust + 40 TS tests; a lower test count is a
   regression, not an improvement.
2. **Migrations apply on an existing database**: the new gates/artifacts/costs migrations must run against a
   DB created by `001_initial.sql` (not only a fresh file), and the store's tests must assert the new tables
   exist and that `Run.gate_states`/`Run.artifacts` still round-trip.
3. **Single-instance lock actually rejects**: an integration test that starts the daemon twice and asserts the
   second exits with `DaemonError::Lock`, plus that `Drop` releases the file.
4. **Auth boundary**: `/health` reachable without a token; `/events` and every JSON-RPC method rejected with
   401 without it and accepted with it. A canary-token test must prove the token never appears in logs — the
   same class of test M2 requires for provider secrets.
5. **`/events` semantics**: click a run, assert `Event` JSON text frames arrive in `created_at` order, that
   the 30 s ping arrives as a transport frame (not an event), and that a closed client unregisters.
6. **CLI↔daemon wiring** (drift 1 and 2): either fixed or explicitly deferred in `DECISIONS.md`; if fixed,
   a test must drive one CLI command end to end against a live daemon.
7. **No silenced checks**: the M1 work must not introduce `#[allow(...)]`, `#[ignore]`, skipped tests or a
   lowered lint level to reach green. If a lint cannot be satisfied, it gets reported, not allowed.

Reminder for sign-off: several writers share this tree with no locking. A "done" or "unchanged" report is a
claim; re-read the files at the moment the bridge is triggered.

---

## Run 8 — 2026-10-28T22:13:30+04:00 (run 8)

- Outcome: **RESULT: M1 validation FAILED** — **2 of 17 checks FAIL**
- `cargo clippy --workspace --all-targets -- -D warnings` **PASS**, `pnpm install`, `-r typecheck`, `-r build`, `-r test`, `actionlint` **PASS**
- `cargo fmt --all --check` **FAIL** (diff not captured in log slice)
- `cargo test --workspace` **FAIL** — 3 `warsha-pipeline` tests panic with "table gates already exists"

### FAIL — `cargo fmt --all --check`

- Status: exit non-zero, diff not captured in the visible log slice
- Root cause: one or more files violate rustfmt defaults (no `rustfmt.toml` in repo)
- Exact fix needed: run `cargo fmt --all` on the tree; commit the formatted result

### FAIL — `cargo test --workspace` (3 panics in `warsha-pipeline`)

- Panics (all at `crates/warsha-pipeline/src/lib.rs`):
  - `tests::test_pipeline_start_run` at `:435:49`
  - `tests::test_gate_rejection` at `:502:49`
  - `tests::test_gate_b_blocks_advance_to_design` at `:544:49`
- Error message (identical for all three):
  ```
  called `Result::unwrap()` on an `Err` value: Migration("while executing migration 2: error returned from database: (code: 1) table gates already exists")
  ```
- Root cause: each test constructs `Store::new()`, which calls `sqlx::migrate!("./migrations")` on the **same default database path** (`dirs::config_dir()/warsha/warsha.db`). Migration 2 (`002_m1_gates_artifacts_costs.sql`) creates the `gates` table. Tests run in parallel (`cargo test --workspace` default), so the second and third tests hit the "table already exists" error from SQLite.
- Exact fix needed: each test must isolate its database by calling `Store::open_at(temp_dir.join("test.db"))` instead of `Store::new()`. `Store::open_at` already exists at `crates/warsha-store/src/lib.rs:162` and takes a `PathBuf`. The task-4 brief expected isolated DBs; the tests did not adopt it.
- Verification: after the fix, `cargo test --workspace` should run all pipeline tests without "table already exists", and the total Rust test count must be ≥ 40 (M0 baseline).

---

## Run 6 (history) — 2026-10-28T21:50:47+04:00
