# Provider Software Auto-Update

Warsha drives other people's tools: Claude Code, Codex CLI, Gemini CLI, Cursor CLI, opencode, OpenHands,
Ollama and Goose. Their flags and output formats move, and a stale install quietly breaks runs. Warsha can
watch their official release channels and offer (or, if the owner insists, perform) the update.

It is **off by default**. Updating a program the owner relies on is never silent, never unattended and never
happens while a run is active.

Owner decision and reasoning: `DECISIONS.md` (2026-10-28, "Provider-software auto-update,
off by default").

## Modes

| Mode | What Warsha does | What it never does |
|---|---|---|
| `Off` (default) | Nothing. The planner returns no actions at all. | Detect-and-nag on every launch |
| `NotifyOnly` | Shows "update available: 1.4.2 → 1.5.0" with the changelog link in **Settings → Providers** | Download or install anything |
| `AutoInstall` | For providers the owner enabled individually: runs the vendor's own installer or package manager, then a health check | Touch a provider without its own toggle, touch anything during a run, or update without a rollback path |

A provider counts as enabled only when it has an explicit `true` in the per-provider toggle. Missing means
disabled, so a fresh install never updates anything even if the mode is later flipped to `AutoInstall`.

## Pin and Skip

* **Pin** — one version the owner wants to stay on. While the channel reports a different version, the
  provider is skipped with the reason `pinned`. Pin matching ignores a leading `v` (`v1.0.0` equals `1.0.0`).
* **Skip** — a list of versions never to install, for example a release that broke someone's setup. If the
  channel reports a skipped version, the provider is skipped with the reason `skipped`.

Both are honoured before the mode is considered: `pinned` and `skipped` win over `NotifyOnly` and
`AutoInstall`.

## Never While a Run Is Active

If any pipeline run is active, every planned action becomes a skip with the reason `run active`. Replacing a
CLI binary mid-run is how a working run turns into an unexplained failure, so Warsha waits for the run to
finish and re-plans afterwards. The check is a plain flag on the plan input, not a timing heuristic.

## Health Check and Rollback

`AutoInstall` is a three-step sequence, and each step can stop it:

1. **Install** with the vendor's own installer or package manager (`npm i -g`, `brew upgrade`, the vendor's
   install script, `ollama pull`, …). Warsha never rewrites a provider binary itself.
2. **Health check**: the CLI answers its version command and a cheap self-check (for example
   `<cli> --version` plus the adapter's availability probe). A provider that does not answer is treated as
   broken, whatever the exit code of the installer said.
3. **Rollback** to the previous version when the health check fails, and report both versions. If the rollback
   itself fails, the provider is marked broken in **Settings → Providers** with the exact commands the owner
   needs, and no run may be started with it until it is fixed.

The changelog is shown before the install in `AutoInstall` and links out in `NotifyOnly`. Warsha never
summarises a changelog as if it had read it.

## Where This Lives

| Piece | Location |
|---|---|
| Modes, policy, actions, planner | `crates/warsha-providers/src/provider_update.rs` |
| Detection interface (installed CLIs/runtimes) | `ProviderDetector` in the same module |
| Release-channel interface | `ProviderUpdateChecker` in the same module |
| Schedule | A Warsha routine (`crates/warsha-pipeline/src/routines.rs`), so the check runs on the same scheduler as every other routine |
| Owner UI | Settings → Providers (toggle, mode, pin, skip, changelog, last result) |

The module only *plans*: it produces `Notify`, `Install` or `Skip` decisions with a reason
(`pinned`, `skipped`, `disabled`, `run active`, `unknown version`). The installer and the health check are
driven by the caller, which is what keeps the decision logic testable without touching a real machine.

## Boundaries

* Warsha **never** updates itself through this path; that is the Tauri updater configured in
  `apps/desktop/tauri.conf.json`, which verifies a signed release before installing.
* Warsha **never** installs a provider the owner does not have; detection only reports what exists.
* Warsha **never** pulls a version from an unofficial mirror. Only the vendor's own release channel.
* Network access follows the provider's own consent model: an update downloads from the vendor, not through
  Warsha's relay.

## Status

| Item | State |
|---|---|
| Modes, policy, planner, detection and checker interfaces with tests | Done (M16) |
| Settings → Providers UI wiring | Not implemented yet |
| Real release-channel clients per provider | Not implemented yet (human-only decision on rate limits/tokens) |
| Signed releases and the updater pubkey | Human-only, recorded in `PROGRESS.md` |
