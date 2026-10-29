# Launch Checklist

Everything that has to be true before v0.1.0 stops being a draft release, and who does each part.
The split is simple: **agents prepare, the owner executes.** No line here runs automatically, and
every "publish" line sits behind Gate D.

Reference: the release workflow is `.github/workflows/release.yml`; the listing copy lives in
`docs/store/`; social drafts live in `docs/social/calendar.md`.

## 0. Gates Green

Nothing below matters if the tree is red. Run these on a clean checkout first.

| Check | Command | Expected |
|-------|---------|----------|
| Format | `cargo fmt --all --check` | no diff |
| Lints | `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| Rust tests | `cargo test --workspace` | all pass |
| TS install | `pnpm install --frozen-lockfile` | no lockfile drift |
| TS typecheck | `pnpm -r typecheck` | clean |
| TS tests | `pnpm -r test` | all pass, including `mdbook test` |
| Docs build | `mdbook build` in `docs/` | no `ERROR` line |
| Workflows | `actionlint .github/workflows/ci.yml` | clean |

- [ ] All eight green, on all three OSes in CI

## 1. Installers Per OS

Produced by the `desktop-build` matrix and the `rust-build` matrix, then collected into the draft
release.

| OS | Artifact | Job | Notes |
|----|----------|-----|-------|
| Windows | `Warsha_<version>_x64_en-US.msi` | `desktop-build` | MSI, per-user install |
| Windows | `Warsha_<version>_x64-setup.exe` | `desktop-build` | NSIS fallback |
| macOS | `Warsha_<version>_x64.dmg` | `desktop-build` | Intel |
| macOS | `Warsha_<version>_aarch64.dmg` | `desktop-build` | Apple Silicon |
| Linux | `warsha_<version>_amd64.deb` | `desktop-build` | Debian/Ubuntu |
| Linux | `warsha_<version>_amd64.AppImage` | `desktop-build` | distro-independent |
| CLI | `warsha-linux`, `warsha-macos`, `warsha-windows.exe` | `rust-build` | stripped on Linux/macOS |
| Daemon | `warshad-linux`, `warshad-macos`, `warshad-windows.exe` | `rust-build` | starts with the CLI or the app |

- [ ] Every artifact present in the draft release for the target version
- [ ] Each one installed on a machine that never had Warsha, and the app or `warsha --version` opens
- [ ] Desktop app spawns its bundled `warshad` sidecar without a port conflict
- [ ] Uninstall removes the app; project data in the config directory is left alone (documented)

## 2. Checksums

The `artifacts` job writes `checksums.sha256` over every file it downloaded.

```bash
# verify on Linux
sha256sum -c checksums.sha256

# verify on macOS
shasum -a 256 -c checksums.sha256

# verify on Windows
Get-FileHash .\Warsha_0.1.0_x64_en-US.msi -Algorithm SHA256
```

- [ ] `checksums.sha256` attached to the release and covers every listed artifact
- [ ] One hash re-verified by hand on Windows and one on Linux
- [ ] The hash published in the announcement matches the file people download

## 3. SBOM

The `artifacts` job attempts a CycloneDX SBOM with `cyclonedx-bom` and is allowed to fail
(`|| true`), so **an absent `sbom.xml` is not an error the pipeline reports** — it must be checked
by eye.

- [ ] `sbom.xml` present in the draft release and non-trivial (contains the crate list)
- [ ] If it is missing: run `cargo install cyclonedx-bom --locked && cyclonedx-bom -o sbom.xml` locally
      and attach the result by hand
- [ ] `Cargo.lock` and `pnpm-lock.yaml` are the versions that produced the binaries
- [ ] `THIRD_PARTY_NOTICES.md` reflects the current dependency set (Goose stays Apache-2.0)

## 4. Draft GitHub Release

The `release` job creates it with `draft: true`. It stays a draft until Gate D.

- [ ] Release notes name the version, the three OS targets, and the license line
- [ ] Notes include the Arabic summary first, then the English one
- [ ] Breaking changes and known issues are listed, not hidden
- [ ] Checksums and SBOM are attached
- [ ] Release is still a draft at this point — publishing is a Gate D decision

## 5. Package Manager Manifests — Prepared, Not Submitted

The `manifests` job emits `manifests/winget/warsha.yaml`, `manifests/homebrew/warsha.rb` and
`manifests/scoop/warsha.json` as build artifacts. They contain `PLACEHOLDER_SHA256` hashes and a
provisional `PackageIdentifier: Warsha.Warsha`, so they are **starting points, not submissions**.

| Channel | Artifact | State | Final copy |
|---------|----------|-------|------------|
| winget | `manifests/winget/warsha.yaml` | prepared, not submitted | `docs/store/winget.md` |
| Homebrew | `manifests/homebrew/warsha.rb` | prepared, not submitted | `docs/store/homebrew.md` |
| Scoop | `manifests/scoop/warsha.json` | prepared, not submitted | `docs/store/scoop.md` |

- [ ] Real SHA256 inserted from the signed installers, not from a local rebuild
- [ ] Publisher identity (`Athar Studio` vs the provisional `Warsha`) settled before opening a PR
- [ ] `winget validate` / `brew audit --cask` / `scoop install` run on a clean machine
- [ ] Nothing submitted to any registry — submission is a human-only step at Gate D

## 6. Docs Site

- [ ] `mdbook build` in `docs/` completes with no `ERROR` line (the landing page is the home)
- [ ] `mdbook test` passes every chapter
- [ ] Landing page renders right-to-left, with the Arabic sections first
- [ ] `custom.css` is linked from the built pages (a missing `[output.html]` field silently drops it)
- [ ] Quickstart, Providers, Security, Gates and Approvals, Architecture and Terms all reachable
- [ ] Stray `*.md#anchor` files created by earlier mdBook runs are absent from `docs/src/`
- [ ] Hosting and the docs URL are decided (human-only: domain and hosting account)

## 7. `warsha doctor` Smoke

Install from the built artifact — not from the dev tree — then run the diagnostic.

```bash
warsha doctor
warsha doctor --json
```

- [ ] Runs on Windows, macOS and Linux from the release artifact
- [ ] Reports the toolchain probes (git, docker, node, pnpm, rustc, cargo) as present or missing
- [ ] Reports the coding CLIs it can drive (Claude Code, Codex, Gemini, Cursor, OpenHands) without
      failing when they are absent
- [ ] `--json` output contains no secret material and no absolute home paths
- [ ] A machine missing one tool gets a readable, localized message naming it

## 8. Demo Video

Script and shot list: [demo-script.md](demo-script.md).

- [ ] Recorded against a local Ollama model (no cloud key), or a throwaway key that never appears on screen
- [ ] No API key, token, or personal path visible in any frame
- [ ] Uploaded, captioned in Arabic and English, and the link added to the launch post drafts
- [ ] Screenshots for the landing page and store listings pulled from the same session
- [ ] Duration under three minutes, with the gate approval shown on camera

## 9. Known Human-Only Steps

These cannot be done by an agent, by design or by access. They are tracked in `PROGRESS.md` too.

| Step | Why it is human-only | Where it is recorded |
|------|----------------------|----------------------|
| Create the GitHub org/repo and CI secrets | Account ownership | `PROGRESS.md` human-only list |
| Windows code signing certificate | Purchased identity, hardware token | `docs/store/microsoft-store.md`, `winget.md` |
| Apple Developer ID + notarization | Paid account, 2FA | `docs/store/homebrew.md` |
| Partner Center submission | Legal agreement click-through | `docs/store/microsoft-store.md` |
| winget / Homebrew / Scoop submissions | Registry account + review | `docs/store/*.md` |
| crates.io and npm publishing tokens | Account ownership, 2FA OTP | `docs/store/crates-io.md`, `npm.md` |
| Domain, docs hosting, relay hosting | Billing and DNS | this file, section 6 |
| Privacy policy page | Legal text owned by the owner | `docs/store/microsoft-store.md` |
| Every social post | Gate D | `docs/social/calendar.md` |
| Publishing the release out of draft | Gate D | section 4 |

## 10. Gate D Sign-Off

- [ ] Owner has read every artifact that becomes public: release notes, store listings, social drafts
- [ ] Owner approves with `warsha approve gate_d`, from a device they control
- [ ] Decision recorded in the audit log with device ID and timestamp
- [ ] Owner publishes by hand; the release leaves draft only after this point
- [ ] No agent action appears anywhere in the chain above as an approval

If any item on this page is unchecked, the release stays a draft. That is the intended failure mode.

## Rollback

| Situation | Action |
|-----------|--------|
| Wrong binary published | Re-upload the artifact, re-generate checksums, edit the release notes to say so |
| Bad release notes | Edit the draft; it is still a draft until approved |
| Broken install on one OS | Pull that artifact from the release, leave the rest, document it in known issues |
| crates.io mistake | `cargo yank --version 0.1.0` — published crates cannot be deleted |
| npm mistake | `npm unpublish` within the policy window, then publish a fixed patch |
| Store listing error | Edit in the store dashboard; store reviews are the slowest channel, so read twice |
