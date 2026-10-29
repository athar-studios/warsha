# Homebrew — Warsha

> **Status: not yet submitted.** No tap has been published and no cask has been pushed to
> homebrew-core. Submission is a human-only step at Gate D.

**Channel:** Homebrew (macOS; Linux cask support is incidental) · **Product:** Warsha 0.1.0
**Arabic tagline:** ورشة: مصنع برمجيات بالذكاء الاصطناعي

## Title

**Copy:** `Warsha`

## Short description (≤ 80 characters)

**Copy:** `AI software factory: twelve agents, four human gates, one repo.`

Homebrew limits `desc` to 80 characters, so the line above is the exact `desc` value.

## Long description

```text
Warsha is an Arabic-first AI software factory. One line of idea, twelve AI agents (intake,
research, PM, design, architecture, code, review, QA, security, release, marketing, feedback) and
four human approval gates between the idea and a merged, released project.

Add your own provider — OpenAI, Anthropic, DeepSeek, OpenRouter, or a local Ollama — and keep your
keys in the macOS Keychain. Every project has a budget that pauses the run when it is reached.
Nothing is pushed, published, or released without the owner's approval at Gate D.
```

## Why a tap and not homebrew-core

Homebrew core accepts only licenses that pass its free-software test; PolyForm Noncommercial 1.0.0
is a source-available non-commercial license and does not qualify. Warsha therefore ships through a
self-hosted tap:

```bash
brew tap athar-studio/tap
brew install --cask warsha
```

## Cask fields

| Field | Value |
|-------|-------|
| `token` | `warsha` |
| `version` | `0.1.0` |
| `desc` | `AI software factory: twelve agents, four human gates, one repo.` |
| `homepage` | `https://github.com/Warsha/Warsha` |
| `url` | `https://github.com/Warsha/Warsha/releases/download/v#{version}/Warsha_#{version}_universal.dmg` |
| `sha256` | from the generated `checksums.txt` of the tagged release |
| `license` | `PolyForm-Noncommercial-1.0.0` |
| `app` | `Warsha.app` |
| `binary` | `Warsha.app/Contents/MacOS/warsha`, `Warsha.app/Contents/MacOS/warshad` |
| `depends_on` | `macos: ">= :big_sur"` |
| `caveats` | daemon starts on first launch; `warsha doctor` verifies the toolchain |

A CLI-only formula (`warsha` + `warshad` tarballs) can live beside the cask in the same tap for
headless machines.

## Keywords

Homebrew has no keyword field either; the tap README and the cask `desc` carry discoverability. The
tap README lists: `ai`, `agents`, `software-factory`, `arabic`, `developer-tools`, `code-generation`.

## Categories

There is no category field in a cask or formula. The mapping used for directory listings and the
`brew search` description is **Developer tools**, with **Productivity** as the secondary.

## Privacy note

The cask downloads a DMG from GitHub Releases and installs it; no post-install network calls, no
telemetry. Warsha's daemon listens on localhost only, keys live in the macOS Keychain, and the
optional relay sees ciphertext only.

## Validation notes

```text
brew audit --cask --strict warsha
brew install --cask warsha
brew uninstall --cask warsha
```

`brew audit` may flag the license and the self-hosted URL; both are expected for a tap cask and are
the reason this is not a core submission.

The `manifests` job in `.github/workflows/release.yml` currently emits a **formula** that builds from
the source tarball. This listing describes a **cask** that installs the notarized DMG. Pick one
before submitting — the cask gives users a signed app without a Rust toolchain, the formula gives a
source build — and delete the other from the tap.

## Status

- [ ] Tap repository created and pushed (human-only)
- [ ] Notarized universal DMG attached to a tagged release (human-only: Apple Developer ID)
- [ ] `brew audit` clean on the cask
- [ ] Tap announced after the release is public (human-only, at Gate D)

**not yet submitted** — no cask exists outside this document.
