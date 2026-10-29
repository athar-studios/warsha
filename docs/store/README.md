# Store Listings — Index

Ready-to-submit listing copy for every distribution channel Warsha targets. This directory is
content only: nothing here is published automatically, and nothing here has been submitted.

> **Global status: not yet submitted.** All six listings below are drafts stamped
> `not yet submitted`. Submission is a human-only step performed by the owner at Gate D.

**Product:** Warsha (ورشة) · **Version:** 0.1.0 · **Publisher:** Athar Studio ·
**License:** PolyForm Noncommercial 1.0.0 · **Repository:** <https://github.com/Warsha/Warsha>

**Arabic tagline (all channels):** ورشة: مصنع برمجيات بالذكاء الاصطناعي

## Listings

| File | Channel | Kind | Draft state | Blocks on |
|------|---------|------|-------------|-----------|
| [microsoft-store.md](microsoft-store.md) | Microsoft Store | MSIX desktop app | `not yet submitted` | Partner Center account, MSIX signing, privacy policy URL |
| [winget.md](winget.md) | winget (Windows Package Manager) | Manifest + PR to `microsoft/winget-pkgs` | `not yet submitted` | Signed installer hash, a tagged GitHub Release |
| [homebrew.md](homebrew.md) | Homebrew | Cask in a self-hosted tap | `not yet submitted` | Tap repo, notarized DMG |
| [scoop.md](scoop.md) | Scoop | Manifest in a self-hosted bucket | `not yet submitted` | Bucket repo, installer hash |
| [crates-io.md](crates-io.md) | crates.io | `warsha` and `warshad` crates | `not yet submitted` | crates.io API token, `cargo package` dry run |
| [npm.md](npm.md) | npm | `@warsha/*` library packages | `not yet submitted` | npm org + publishing token with 2FA |

The desktop installers themselves are produced by the release workflow described in the
[launch checklist](../launch/checklist.md); these files hold the words, not the binaries.

## Shared Copy Blocks

Reuse these so the channels stay consistent. Each listing file adapts them to its channel's
field limits.

**Title:** `Warsha — Arabic-first AI software factory`

**Short description:** `Twelve AI agents, four human gates, one repo: idea to release.`

**Privacy note (short form):** Warsha is local-first. No telemetry, no analytics, no data sent to
the maintainers. Provider API keys live in the OS keychain. Pipeline state stays on your machine.

**License line:** PolyForm Noncommercial 1.0.0 — free for personal, educational, research, and
non-profit use; commercial use requires a separate license.

## Rules For Editing These Files

- Keep the short description at or under 80 characters. It is the field most channels truncate.
- Keep the Arabic tagline verbatim: ورشة: مصنع برمجيات بالذكاء الاصطناعي
- Never claim a store presence, a rating, or a download count that does not exist.
- Never claim code signing or notarization until the certificate is actually in place.
- Leave the status line as `not yet submitted` until the owner submits the listing; the owner
  updates it, not an agent.
