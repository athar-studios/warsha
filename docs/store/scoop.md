# Scoop — Warsha

> **Status: not yet submitted.** No bucket exists yet. The manifest is prepared; publishing the
> bucket and opening a `scoop-directory` entry are human-only steps at Gate D.

**Channel:** Scoop (Windows) · **Product:** Warsha 0.1.0 · **Publisher:** Athar Studio
**Arabic tagline:** ورشة: مصنع برمجيات بالذكاء الاصطناعي

## Title

**Copy:** `warsha`

## Short description (≤ 80 characters)

**Copy:** `AI software factory: twelve agents, four human gates, one repo.`

## Long description

```text
Warsha brings an Arabic-first AI software factory to the terminal on Windows. One line of idea
becomes a gated pipeline: twelve AI agents handle intake, research, requirements, design,
architecture, code, review, QA, security, release, marketing and feedback, pausing at four gates
for owner approval.

Install pulls in no runtimes: warshad (the local daemon) and warsha (the CLI) are plain binaries.
Bring your own provider — OpenAI, Anthropic, DeepSeek, OpenRouter, or a local Ollama — with keys
kept in the Windows Credential Manager. Local-first, no telemetry, nothing published without a
human gate.
```

## Manifest fields (`warsha.json`)

| Field | Value |
|-------|-------|
| `version` | `0.1.0` |
| `description` | `AI software factory: twelve agents, four human gates, one repo.` |
| `homepage` | `https://github.com/Warsha/Warsha` |
| `license` | Identifier `PolyForm-Noncommercial-1.0.0`, URL to the repository LICENSE |
| `architecture.64bit.url` | `.../releases/download/v0.1.0/warsha-x86_64-pc-windows-msvc.zip` |
| `architecture.64bit.hash` | SHA256 from the tagged release `checksums.txt` |
| `architecture.arm64.url` | `.../releases/download/v0.1.0/warsha-aarch64-pc-windows-msvc.zip` |
| `bin` | `[["warsha.exe", "warsha"], ["warshad.exe", "warshad"]]` |
| `checkver` | `github: https://github.com/Warsha/Warsha` |
| `autoupdate` | templated from `checkver`, arch-specific URLs |

Users install with `scoop bucket add warsha https://github.com/Warsha/scoop-bucket` then
`scoop install warsha`.

## Keywords

Scoop manifests have no tags field. The bucket README carries the discoverability list:
`ai`, `agents`, `software-factory`, `arabic`, `developer-tools`, `cli`, `code-generation`.

## Categories

There is no category field in a Scoop manifest. The mapping used when listing the bucket is
**Developer tools**, with **Productivity** as the secondary.

## Privacy note

Scoop downloads a release zip from GitHub and extracts it; nothing runs at install time beyond
unpacking, and no telemetry ships with it. Warsha keeps state locally under `%APPDATA%` and binds
its daemon to localhost.

## Validation notes

```text
scoop install .\warsha.json
warsha --version
warsha doctor --json
scoop uninstall warsha
```

`checkver`/`autoupdate` must be tested against a real tagged release before the bucket is
announced, otherwise the first version bump fails for users.

The generated manifest in `.github/workflows/release.yml` ships a placeholder hash and the
single-binary `warsha-windows.exe`; the fields above expect the zip that also carries `warshad.exe`,
so the daemon ships alongside the CLI. Fix the artifact reference before publishing the bucket.

## Status

- [ ] Bucket repository created (human-only)
- [ ] Release zip and SHA256 published on a tagged release
- [ ] Manifest installs cleanly on x64 and ARM64
- [ ] Entry proposed to `scoop-directory` (human-only, at Gate D)

**not yet submitted** — no bucket has been created.
