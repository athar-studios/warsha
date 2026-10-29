# THIRD_PARTY_NOTICES.md — Third-Party Notices

Warsha's own source is licensed under the **PolyForm Noncommercial License 1.0.0** (see [`LICENSE`](LICENSE)).
This file records every third-party component Warsha depends on, bundles, links against or documents, the
license that governs it, and where the license text lives. It never reproduces full license texts; follow the
links into the upstream repositories.

Last reviewed: 2026-10-30 (M16).

## Declared components

| Component | Pin in Warsha | License | How Warsha uses it | License text |
|---|---|---|---|---|
| **Goose** (agent engine) | Pinned git tag, currently a commented placeholder in the root [`Cargo.toml`](Cargo.toml); Renovate watches the tag | Apache-2.0 | Coding/agent engine and the future routines scheduler. Never forked, never modified. | [`aaif-goose/goose/LICENSE`](https://github.com/aaif-goose/goose/blob/main/LICENSE) |
| **Activepieces Community Edition** | Optional external deployment, pinned tag recorded when enabled (see [`docs/launch/activepieces.md`](docs/launch/activepieces.md)) | MIT (core only) | Optional workflow-automation engine, off by default. **Warsha never uses, copies or links `packages/ee`.** | [`activepieces/activepieces/LICENSE`](https://github.com/activepieces/activepieces/blob/main/LICENSE) |
| **mdBook** | `0.5.4`, installed as a cargo binary | MPL-2.0 | Builds the documentation site in [`docs/`](docs/). Build tool only; not distributed with Warsha. | [`rust-lang/mdBook/LICENSE`](https://github.com/rust-lang/mdBook/blob/main/LICENSE) |

### Activepieces: MIT core only, `packages/ee` is never used

The Activepieces repository mixes the MIT-licensed Community Edition with an enterprise tier under
`packages/ee`, governed by a separate commercial license. Warsha integrates only the MIT core: the CE
server image or a CE checkout with `packages/ee` excluded. No file, schema, type or bundle from
`packages/ee` is vendored, imported or required at runtime. If a future change needs enterprise-only
features, it becomes an owner decision with its own license review — it does not happen by accident.

### Not used, on purpose

* **n8n** is deliberately absent. Its Sustainable Use License forbids end users from building workflows on
  top of it, which is exactly what Warsha would offer, so it is excluded by design (see
  [`DECISIONS.md`](DECISIONS.md)).

## Transitive dependencies

The authoritative list of everything compiled into or shipped with Warsha is in [`Cargo.lock`](Cargo.lock)
(Rust) and [`pnpm-lock.yaml`](pnpm-lock.yaml) (TypeScript). License compliance for that set is enforced in CI
by `cargo-deny` ([`deny.toml`](deny.toml) if present, otherwise the default policy) and by the pnpm audit
step. Adding a dependency means adding a row above when it is a declared, user-visible component.

## Keeping this file current

Update this file in the same change that adds, removes, upgrades or re-pins a declared component. A license
that changes upstream is a release blocker: record the new license, or drop the component.
