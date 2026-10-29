# winget — Warsha

> **Status: not yet submitted.** No pull request has been opened against
> `microsoft/winget-pkgs`. The manifest is prepared; submission is a human-only step at Gate D.

**Channel:** Windows Package Manager (winget) · **Product:** Warsha 0.1.0 · **Publisher:** Athar Studio
**Arabic tagline:** ورشة: مصنع برمجيات بالذكاء الاصطناعي

## Title

**Copy:** `Warsha`

## Short description (≤ 80 characters)

**Copy:** `AI software factory: twelve agents, four human gates, one repo.`

## Long description

```text
Warsha installs the command-line interface (warsha) and the local daemon (warshad) that together
form the Warsha AI software factory on Windows.

Give it one line of idea and twelve AI agents work through research, requirements, design, code,
review, security, release and launch, pausing at four gates for the owner's approval. Providers are
your own: OpenAI, Anthropic, DeepSeek, OpenRouter, Azure, or a local Ollama with no account. Keys
are stored in the Windows Credential Manager.

Warsha is local-first and collects no telemetry. Nothing is pushed, published, or released without
a human gate.
```

## Manifest fields

Prepare as `manifests/w/AtharStudio/Warsha/0.1.0/` with the three standard files
(`AtharStudio.Warsha.yaml`, `AtharStudio.Warsha.installer.yaml`,
`AtharStudio.Warsha.locale.en-US.yaml`).

| Field | Value |
|-------|-------|
| `PackageIdentifier` | `AtharStudio.Warsha` |
| `PackageVersion` | `0.1.0` |
| `Publisher` | `Athar Studio` |
| `PackageName` | `Warsha` |
| `Moniker` | `warsha` |
| `License` | `PolyForm-Noncommercial-1.0.0` |
| `ShortDescription` (≤ 256) | `AI software factory: twelve agents, four human gates, one repo.` |
| `InstallerType` | `wix` (MSI) for x64, `msi` fallback; `portable` for the CLI-only zip |
| `Architecture` | `x64`, `arm64` |
| `Scope` | `user` |
| `Commands` | `warsha`, `warshad` |
| `ReleaseDate` | set from the tagged release date |

`ShortDescription` is capped at 256 characters by the winget schema; the ≤ 80 character line above
is the version reused in the manifest and the release notes.

## Keywords

The manifest carries discoverability in `Tags`:

```text
ai, agents, software-factory, arabic, developer-tools, automation, github, cli, code-generation
```

## Categories

winget manifests have no category field — the schema stops at `Tags`. The nearest equivalent for
directory listings and the `winget search` experience is **Developer tools**, followed by
**Productivity**; keep the tag list above aligned with those two.

## Privacy note

The installer performs no network calls of its own and installs no telemetry component. Warsha's
daemon binds to localhost only. Provider requests go to the endpoint the user configures, with the
user's own key, stored in the Windows Credential Manager.

## Validation notes

```text
winget validate --manifest manifests/w/AtharStudio/Warsha/0.1.0
winget install --manifest manifests/w/AtharStudio/Warsha/0.1.0
```

Both must pass locally before the pull request is opened. `InstallerSha256` must match the signed
installer produced by the release workflow, not a locally rebuilt one.

The `manifests` job in `.github/workflows/release.yml` emits a **provisional** manifest with
`PackageIdentifier: Warsha.Warsha`, `Publisher: Warsha` and `InstallerSha256: PLACEHOLDER_SHA256`.
Reconcile it with the table above — the publisher identity is an owner decision — before opening the
pull request.

## Status

- [ ] Tagged GitHub Release with signed MSI and published SHA256 (human-only: signing)
- [ ] Manifest validated with `winget validate` on a Windows host
- [ ] Pull request opened to `microsoft/winget-pkgs` (human-only, at Gate D)

**not yet submitted** — no manifest has left this repository.
