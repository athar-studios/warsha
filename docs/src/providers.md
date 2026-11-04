# Providers

Warsha spends your money, so it only ever calls a provider you configured. This page is the surface that
exists today: the app screens, the `warsha` commands, and what each one actually does. Anything not here is
not built.

## What a provider is in Warsha

A provider is two halves kept in two different places:

| Half | Where it lives | Who can read it |
|---|---|---|
| Configuration — name, kind, base URL, enabled flag | a settings row in the daemon's SQLite file (`<data_dir>/warsha.db`) | anything that can read the database |
| Secret — the API key | the OS credential store, service name `warsha-provider`, one account per provider name | your user account only |

That split is deliberate (`crates/warsha-providers/src/secrets.rs:1-27`): a key inside the SQLite file would
be in every backup and every `SELECT *` you ever paste into a bug report. `providers.add` is the **only**
call that carries the key; every later call names the provider and the daemon reads the key from the
keychain itself.

## Which kinds work

The daemon maps a kind string to an adapter in one place (`crates/warshad/src/providers.rs`, `adapter_kind`):

| Kind you pass | Adapter | Notes |
|---|---|---|
| `anthropic` (also matched by `claude`, `anthropic-api`) | Anthropic | key sent as the provider's own auth header |
| `ollama` (also matched by `lm studio`) | Ollama | local; the key is stored and **never sent** — the adapter ignores it |
| `openai`, `open_router`, `deep_seek`, `kimi`, `glm`, `qwen`, `custom`, or any other name | OpenAI-compatible | each named gateway carries its own default base URL; an unknown name is used as-is |

The desktop app offers six of these as one-click choices — OpenRouter, DeepSeek, Kimi, GLM, Qwen and a
custom OpenAI-compatible endpoint where you type the URL — because each has a default base URL and needs
only a key (`apps/desktop/src/components/ProviderSetupWizard.tsx:37-54`).

A name that merely *starts* with a protocol word is not that protocol: `anthropic-proxy` is treated as an
OpenAI-compatible endpoint, on purpose.

## Add a provider — the app (recommended)

This is the only path where the key never enters a shell. See
[First run: adding your provider key](first-run.md) for the whole walkthrough.

1. On the first-run wizard, or in **Settings → Providers**, choose the provider.
2. Paste the key into the key field. It is held in the screen's own state only.
3. Press **Test connection**. The app calls `providers.add` and then `providers.test`, and shows the
   daemon's own answer — passed or refused — as a lamp on the row.
4. The key field is erased as soon as the call is on its way, and the key is scrubbed out of the daemon's
   message before anything is rendered.

## Add a provider — the CLI

`providers add` takes the name and the kind as **positional arguments**, and refuses a provider with no key
because a provider with no key is one every test would refuse:

```bash
warsha providers add main-account openai --key <your-openai-key>
warsha providers add sonnet anthropic --key <your-anthropic-key>
warsha providers list
warsha providers test main-account
warsha providers remove main-account
```

There is no `--name` (the first positional argument is the name), no `--budget`, and no `--base-url` — the
CLI always lets the daemon use the kind's default URL, so a custom endpoint's URL must be set from the app.

**A key passed on a command line is not a secret from your own machine.** It lands in your shell history and
it is visible in the process list while the command runs. Use the app for real keys, or clear the history
entry yourself afterwards.

## Provider health and model catalogs

```bash
warsha providers test <name>          # one provider per call; there is no "test all"
```

`providers.check_models` is the RPC the auto-update drafts are built around — it reports what changed in a
provider's model catalog without overwriting your settings. The screens that would act on it are described
in [launch/provider-auto-update.md](launch/provider-auto-update.md); the row's "auto" mode is not something
the daemon performs by itself.

## Role routing

Every pipeline role resolves to a list of `provider:model` targets. The CLI takes **one** argument holding a
comma-separated list:

```bash
warsha roles list
warsha roles set researcher main-account:gpt-4o
warsha roles set coder sonnet:claude-3-5-sonnet,main-account:gpt-4o
```

The targets are matched to providers by name, so `sonnet:claude-3-5-sonnet` means "the provider called
`sonnet`, model `claude-3-5-sonnet`". Fallback is on in what the CLI sends (`fallback_enabled: true`) — a
declined or unreachable primary moves to the next target. There is no `--fallback` flag and no `--budget`
flag on `roles set`; a per-role `budget_cents_per_run` is a field the daemon can store but the CLI never
fills in, so today a per-role ceiling is set by the desktop app or by an RPC caller, not by `warsha`.

## Budgets

Budgets belong to a **project**, not to a provider, and they are counted in **cents**:

```bash
warsha budget show todo-app           # spent / budget / percent used
warsha budget set todo-app 5000       # $50.00 for this project's runs
```

The run pauses itself at the ceiling: at 80% the daemon records a `BudgetWarning` event, and when spending
reaches the budget it records `BudgetExceeded` and sets the run to `Paused`
(`crates/warsha-pipeline/src/lib.rs:449-470`). Nothing is stopped by a per-provider monthly limit, because
`warsha providers budget` is not a command and the daemon keeps no such row — that was a plan, and it is
still one.

## Not built

- **No environment-variable keys.** `WARSHA_OPENAI_KEY` and friends are read by nothing in the code; the
  only `WARSHA_*` variables that exist tune caches, retries and concurrency (see `.env.example`). A key
  gets in through `providers.add` or the app, or it is not a Warsha provider.
- **No mock provider for users.** `MockProvider` returns deterministic answers and is what the crate's own
  tests run against (`crates/warsha-providers/src/lib.rs:189-260`); it is not a kind you can add from the
  app or the CLI, so there is no zero-cost simulation mode to demo against.
- **No provider list without a daemon.** Every command on this page calls the daemon; with nothing listening
  they answer `Not connected to daemon`. Start it first (`warshad --foreground`) — see
  [Quickstart](quickstart.md).
