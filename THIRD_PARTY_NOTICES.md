# THIRD_PARTY_NOTICES.md — Third-Party Notices

Warsha's own source is licensed under the **PolyForm Noncommercial License 1.0.0** (see [`LICENSE`](LICENSE)).
This file records every third-party component Warsha depends on, bundles, links against or documents, the
license that governs it, and where the license text lives. It never reproduces full license texts; follow the
links into the upstream repositories.

Last reviewed: 2026-11-02 (M16 and B0 design-skill intake).

## Declared components

| Component | Pin in Warsha | License | How Warsha uses it | License text |
|---|---|---|---|---|
| **Goose** (agent engine) | Pinned git tag, currently a commented placeholder in the root [`Cargo.toml`](Cargo.toml); Renovate watches the tag | Apache-2.0 | Coding/agent engine and the future routines scheduler. Never forked, never modified. | [`aaif-goose/goose/LICENSE`](https://github.com/aaif-goose/goose/blob/main/LICENSE) |
| **Activepieces Community Edition** | Optional external deployment, pinned tag recorded when enabled (see [`docs/launch/activepieces.md`](docs/launch/activepieces.md)) | MIT (core only) | Optional workflow-automation engine, off by default. **Warsha never uses, copies or links `packages/ee`.** | [`activepieces/activepieces/LICENSE`](https://github.com/activepieces/activepieces/blob/main/LICENSE) |
| **mdBook** | `0.5.4`, installed as a cargo binary | MPL-2.0 | Builds the documentation site in [`docs/`](docs/). Build tool only; not distributed with Warsha. | [`rust-lang/mdBook/LICENSE`](https://github.com/rust-lang/mdBook/blob/main/LICENSE) |

## Reviewed external design skills — reference material only, not bundled

The B0 intake reviewed the following upstream material at the recorded commits. **None of these skills is a Warsha dependency, installed component or bundled/shipped file.** The only Warsha artifacts are original summaries in `bridge-io/skills/DESIGN_BRIEF.md` and the source/license audit in `bridge-io/skills/LOCKFILE.md`; no upstream skill text, code, themes, fonts, icons, datasets, screenshots, PDFs or archives were copied into the product.

| Upstream component | Reviewed commit | License | Actual Warsha use | License evidence |
|---|---|---|---|---|
| Anthropic `frontend-design` | `ca45fc496a3436251f191354091d557da31c15b5` | Apache-2.0 | Read-only review; original design guidance only | [`skills/frontend-design/LICENSE.txt`](https://github.com/anthropics/skills/blob/ca45fc496a3436251f191354091d557da31c15b5/skills/frontend-design/LICENSE.txt) |
| Anthropic `theme-factory` | `ca45fc496a3436251f191354091d557da31c15b5` | Apache-2.0 | Read-only review; original token/theme guidance only | [`skills/theme-factory/LICENSE.txt`](https://github.com/anthropics/skills/blob/ca45fc496a3436251f191354091d557da31c15b5/skills/theme-factory/LICENSE.txt) |
| Anthropic `webapp-testing` | `ca45fc496a3436251f191354091d557da31c15b5` | Apache-2.0 | Read-only review; original browser-QA guidance only | [`skills/webapp-testing/LICENSE.txt`](https://github.com/anthropics/skills/blob/ca45fc496a3436251f191354091d557da31c15b5/skills/webapp-testing/LICENSE.txt) |
| Next Level Builder `ui-ux-pro-max` | `3a13158ff1f32156cbe144108de48eda2ecaed9a` | MIT | Read-only review; original UX/accessibility guidance only | [`LICENSE`](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/3a13158ff1f32156cbe144108de48eda2ecaed9a/LICENSE) |
| Vercel `web-design-guidelines` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` | MIT | Read-only review; original UI-review guidance only | [`README.md` → `License`](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/README.md#license) |
| Vercel `composition-patterns` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` | MIT | Read-only review; original React-composition guidance only | [`README.md` → `License`](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/README.md#license) and [`SKILL.md`](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/composition-patterns/SKILL.md) |
| Vercel `react-best-practices` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` | MIT | Read-only review; original React-performance guidance only | [`README.md` → `License`](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/README.md#license) and [`SKILL.md`](https://github.com/vercel-labs/agent-skills/blob/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/react-best-practices/SKILL.md) |
| Vercel `web-interface-guidelines` (`command.md`, the supporting source fetched by `web-design-guidelines`) | `434b7f91364665f2f733b310ec54809bf8f37937` | MIT | Read-only review of the supporting rules; not a runtime fetch or dependency | [`LICENSE`](https://github.com/vercel-labs/web-interface-guidelines/blob/434b7f91364665f2f733b310ec54809bf8f37937/LICENSE) |

If a later change copies or redistributes any of this material, it must retain the applicable copyright, license and attribution notices, mark modifications to Apache-2.0 files, and update this section to describe that actual use. Separately licensed assets or datasets require their own review; the parent skill's license does not automatically clear them.

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
