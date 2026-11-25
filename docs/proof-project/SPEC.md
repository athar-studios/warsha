# proofcalc — proof-project spec

Status: SPEC ONLY. Do not create the crate, do not run it, do not call a model API.
Date: 2026-11-25. Branch: `r-next/clean1-swarm` @ `77dd1ea`.
Decision: D-RN-CLEAN1-PROOF.

This is the small real project a later Warsha run will build end to end and leave as real code.
This document is the spec. Execution waits until the harness lane and the Secretary lane have
landed on `r-next/integration`. Nothing in this packet starts a daemon, enables swarm, or writes
Rust outside this file.

## 1. What it is

`proofcalc` is a tiny Rust library. Four pure functions, four files, no I/O, no network, no
clock, no filesystem, no process spawn. Every function is total over its stated domain or
returns `Option` / `Result` for the one overflow it can hit. No `unwrap()` outside tests.

Crate name: `proofcalc`. Edition: 2021. Toolchain: stable. Library only — no `[[bin]]`.

## 2. Layout

```
proofcalc/
  Cargo.toml
  src/lib.rs
  src/scaffold.rs
  src/domain.rs
  src/engine.rs
  src/provider.rs
  tests/proof.rs
```

`src/lib.rs` is the crate root. It declares the four modules and re-exports their public items.
It contains no other logic. `tests/proof.rs` is an integration test that calls each public item
once. `Cargo.toml` names the package and sets `edition = "2021"`. No dependencies.

## 3. Four disjoint lane files

The four implementation files are disjoint. No file names another, no file shares a path with
another, and none of them is `src/lib.rs` or `tests/proof.rs`. A later plan that feeds the swarm
scheduler must declare them as four numbered items, one `files:` marker each, because a subtask
with no marker runs alone and two subtasks that list the same path are serialized
(`SwarmScheduler::has_overlap` is exact path equality):

```
1. Scaffold the arithmetic helper. files: src/scaffold.rs
2. Implement the money type. files: src/domain.rs
3. Implement the fee engine. files: src/engine.rs
4. Declare the rate source. files: src/provider.rs
```

Those four paths match the markers `FakeProvider` already emits for `plan_tasks`. The crate root
and the integration test are sequential follow-ups, not a fifth parallel lane: they name all
four modules, so they cannot be written in the same wave.

| Lane | Path | Owns | Must not touch |
| --- | --- | --- | --- |
| 1 | `src/scaffold.rs` | `add` | domain, engine, provider, lib, tests |
| 2 | `src/domain.rs` | `Money`, `checked_add` | scaffold, engine, provider, lib, tests |
| 3 | `src/engine.rs` | `apply_fee` | scaffold, domain, provider, lib, tests |
| 4 | `src/provider.rs` | `RateSource` | scaffold, domain, engine, lib, tests |

A lane that writes outside its one path has failed the spec. A lane that imports another lane's
module has failed the spec.

## 4. Contracts

### 4.1 `src/scaffold.rs`

Module file. Public function only:

```rust
pub fn add(a: i64, b: i64) -> i64
```

Returns `a + b` using `i64::checked_add`. On overflow, returns `i64::MAX` when `b` is positive
and `i64::MIN` when `b` is negative. No other item is public.

### 4.2 `src/domain.rs`

```rust
pub struct Money {
    pub cents: i64,
}

impl Money {
    pub fn checked_add(self, other: Money) -> Option<Money>
}
```

`checked_add` adds the two `cents` fields with `i64::checked_add` and returns `None` on
overflow. No currency code, no formatting, no display impl. `cents` is the only field.

### 4.3 `src/engine.rs`

```rust
pub fn apply_fee(amount: i64, bps: u32) -> Option<i64>
```

`bps` is basis points: `10_000` means 100%. The fee is
`(amount.unsigned_abs() as u128 * u128::from(bps)) / 10_000`, computed in `u128`, then applied
with the sign of `amount`. Returns `None` when `bps > 10_000`, when the product does not fit in
`u128`, or when the signed result does not fit in `i64`. No floating point. `amount == 0`
returns `Some(0)` for any allowed `bps`.

### 4.4 `src/provider.rs`

```rust
pub trait RateSource {
    fn rate_bps(&self) -> u32;
}
```

One method. No default body. No associated type. No second method. The file does not implement
the trait. A caller that needs a rate implements `RateSource` itself.

### 4.5 `src/lib.rs`

```rust
pub mod scaffold;
pub mod domain;
pub mod engine;
pub mod provider;

pub use scaffold::add;
pub use domain::Money;
pub use engine::apply_fee;
pub use provider::RateSource;
```

Nothing else.

### 4.6 `tests/proof.rs`

One integration test. It calls `proofcalc::add(2, 3)` and expects `5`. It constructs
`proofcalc::Money { cents: 40 }` and `proofcalc::Money { cents: 2 }`, calls `checked_add`, and
expects `Some` with `cents == 42`. It calls `proofcalc::apply_fee(10_000, 250)` and expects
`Some(10_250)`. It declares a local unit struct that implements `proofcalc::RateSource` and
returns `250` from `rate_bps`, then asserts that value. No I/O.

## 5. Out of scope

No binary, no CLI, no config file, no logging, no error crate, no serde, no async, no feature
flags. No second test file. No benchmark. The four lane files stay free of `use` lines.

## 6. Done when

A later run, after the harness lane and the Secretary lane have landed on `r-next/integration`,
produces this tree as real code and `cargo test -p proofcalc` passes. That run is not this
packet. This packet is done when this file, the D-RN-CLEAN1-PROOF note, and the PROGRESS line
are committed on `r-next/clean1-swarm`.
