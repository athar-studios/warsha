# First run: adding your provider key

This is the guide for entering a provider API key **through the app's own screens**. It is the same
on Windows, macOS and Linux: nothing below asks you to open a terminal, and the key never touches
one.

One thing to know before you start: **there is no installer to download.** The repository has no
release tag and no published release, so the only way to have the app running is to build it —
[Quickstart](quickstart.md) is that path, and a from-source build takes a while on a small machine.
If the app is already on your machine, skip that.

## What the first screen is

The desktop app shows the setup wizard whenever its own settings file has no
`onboarding_complete` mark in it (`apps/desktop/src/App.tsx:201-207`, `:774`). That is the state of
a fresh install, and the wizard is the only screen shown before there is a project. It has five
steps, in this order, and a meter beside them for how much is done:

| Step | On screen (English) | On screen (العربية) | What it does |
|---|---|---|---|
| 1 | Select Language | اختر اللغة | sets the interface locale; Arabic is the default |
| 2 | Choose your first provider | اختر أول مزوّد | reads `providers.list`, and offers the built-in kinds when the daemon knows none |
| 3 | Paste your API key | الصق مفتاح API | one field; sends `providers.add` |
| 4 | Connection test | اختبار الاتصال | sends `providers.test` and shows what the provider answered |
| 5 | Your first project | مشروعك الأول | sends `projects.create` with all three required fields — see below |

The words in that table are the catalog entries the app actually renders
(`packages/i18n/src/index.tsx:54-97` for Arabic, `:940-985` for English), so what you read here is
what you will see. The wizard has no "skip" and no "do this later": step 5 is the only way out of it.

## Entering the key

On step 3 you get one field, labelled **API key** / **مفتاح API**, with the hint
*"The key is never shown in full again"* / *"لن يظهر المفتاح كاملاً مرة أخرى"*. Type or paste into
it, then press **Add the provider and test** / **أضف المزوّد واختبر**.

What happens to those characters:

- **The field masks them.** It is a `type="password"` input with `autoComplete="off"`, no spell
  check and no translation, forced left-to-right in mono even inside an Arabic sentence
  (`apps/desktop/src/screens/Onboarding.tsx:489-507`). There is no "reveal" button to unmask it.
- **It lives in component state only.** No browser or disk storage holds it. The screen itself says
  so: *"The key stays on this screen and goes to the daemon only — never to browser storage."*
- **It is erased as soon as it is on its way.** The wizard trims the key, sends it once as the `key`
  field of `providers.add`, and clears the state before anything else
  (`apps/desktop/src/screens/Onboarding.tsx:232-250`).
- **It is scrubbed out of anything the daemon says back.** If the provider refuses, the error text
  the wizard prints under *What the daemon said* has every occurrence of your key replaced with
  `[redacted]` first (`apps/desktop/src/screens/Onboarding.tsx:120-124`).
- **Nothing logs it.** The keychain seam stores it and returns no value to print
  (`crates/warsha-providers/src/secrets.rs:92-94`); the daemon's own success line names the
  provider, not the key (`crates/warshad/src/lib.rs:1677`: `provider <name> configured`). The
  test double that would hold keys in memory is a test fixture and is never the production store
  (`crates/warshad/src/lib.rs:3112`).

The one hop that is **not** encrypted: the key travels in the body of one JSON-RPC request from the
app to your own daemon on `127.0.0.1`. That request is plain HTTP with no TLS — the daemon has no
TLS dependency — so the secret is in cleartext on a loopback connection nothing outside this
machine can reach. See [Security Model](security.md) for the whole threat model.

## Where the key is kept

In the **OS keychain**, which is a different thing from the app's files:

| Your operating system | Where it lands |
|---|---|
| Windows | Credential Manager (general credential) |
| macOS | Keychain |
| Linux | the freedesktop Secret Service (GNOME Keyring, KWallet, …) |

All entries are filed under one service name, **`warsha-provider`**, and the **account is the name
you gave the provider** (`crates/warsha-providers/src/secrets.rs:38-87`). Two providers cannot
collide, and renaming one means a different entry. The provider's *settings* — name, kind, base URL
— go into `warsha.db`; the *secret* never does, on purpose: a key in a database is a key in every
backup and every pasted `SELECT *` (`crates/warsha-providers/src/secrets.rs:1-27`).

Re-adding a provider under the same name replaces that keychain entry — the store's own contract is
"replacing whatever was there" (`crates/warsha-providers/src/secrets.rs:52-53`) — so fixing a bad key
is step 3 again, not a delete-then-add.

Because the keychain is an OS service, one failure is worth naming: on a machine with no Secret
Service running — a headless Linux box, a container, a WSL shell without D-Bus — the store refuses,
and the wizard shows the daemon's own words: *"the API key could not be stored in the OS keychain"*.
Nothing is saved and nothing is written to a plaintext fallback; there deliberately is no such
option (`crates/warsha-providers/src/secrets.rs:105-110`). Start a keyring, or use a desktop
session.

## Choosing which provider to add

Step 2 offers **five** provider kinds — OpenRouter, DeepSeek, Kimi (Moonshot), GLM (Zhipu) and Qwen
(DashScope), each with its base URL prefilled (`apps/desktop/src/screens/Onboarding.tsx:77-84` with
`ProviderSetupWizard.tsx:37-54`). The names on the buttons are catalog entries
(`packages/i18n/src/index.tsx:66-70`). A sixth kind the code knows, **custom**, is *not* offered in
the wizard: the choice list keeps only entries that carry a default base URL, and `custom` has none
(`defaultBaseUrls.custom` is `null`). If your endpoint is not one of the five, add the provider after
the wizard, in **Settings → Providers**, whose kind list does include `custom` — "Custom endpoint" /
**نقطة نهاية مخصّصة** — with a base-URL field beside it (`apps/desktop/src/screens/ProvidersSettings.tsx:46`,
`:330-384`).

The daemon maps a kind name to a client: `anthropic` (also `claude`), `ollama` (also `lm studio`,
spaces and dashes folded), and anything else as an OpenAI-compatible endpoint
(`crates/warshad/src/providers.rs:97-109`; the kinds and models behind that are in
[Providers](providers.md)).

Two refusals you may hit here, both deliberate:

- a provider named **`mock`** is the daemon's own offline adapter, so the wizard will not let you
  claim that name (`crates/warshad/src/lib.rs:1599-1607`);
- a kind with no known default URL and no URL you typed is refused rather than stored broken
  (`crates/warshad/src/lib.rs:1622-1631`).

Step 4 then calls the provider over your network. That is the first thing in this whole flow that
leaves the machine — until it, every call has been between the app and your own daemon on loopback.
A refusal there is the provider's answer about the key, not the app's.

## Doing it later, or for a second provider

The same `providers.add` path is in the app under **Settings → Providers**
(`apps/desktop/src/screens/ProvidersSettings.tsx:168-192`): same masked field, same keychain, same
rule about never echoing the key back. So the wizard is not the only place — it is just the only
place before you have a project.

## Why not paste it into a terminal

`warsha providers add <name> <kind> --key <key>` works for a hosted kind, and the value it sends is
exactly the key you typed (`crates/warsha-cli/src/lib.rs:884-891`) — which is the problem: that flag
sits in your shell history and is visible in the process table while the command runs. The flag itself
is optional in the parser (`crates/warsha-cli/src/lib.rs:195-204`); whether it is *demanded* is the
kind's own answer — the daemon's adapter maps the tag to a `ProviderKind`, and only a kind called with
a credential makes it required (`crates/warsha-cli/src/lib.rs:875-877`). Ask for a hosted kind with no
`--key` and the CLI refuses before anything leaves the process (`:890`).

The other direction is where the CLI still bites, and it bites as a refusal rather than a silent
mistake: `ollama` and `lm_studio` **are** detected as key-less (`crates/warsha-cli/src/lib.rs:875-877`),
but a key-less kind is not added either — no RPC is made at all, with or without `--key`, and the
refusal says the value you passed is neither sent to the daemon nor stored
(`crates/warsha-cli/src/lib.rs:892-899`, `:922-945`). The missing thing is the daemon's shape for it:
`providers.add` binds `key: String`, not an `Option` (`crates/warshad/src/lib.rs:756-763`). A
substituted key would not have reached the keychain either — a local tag carries no default base URL,
so the daemon refuses at endpoint resolution (`crates/warshad/src/lib.rs:1622-1631`) before it ever
calls `secrets.store` (`:1644`), and an empty key is refused at that same point (`:1640-1642`).
Detection of a local kind works; registering one without a key is the blocked half.

The app has no history file to write into: one masked field, one send. If you use the CLI on a machine
you share, prefer the app for the key and come back to the CLI for everything that is not a secret.

## Step 5 against a real daemon

Step 5 sends `projects.create` with all three fields the daemon requires: the name the owner typed,
that same name as the `description` (the step deliberately asks for a name only), and the active
`@warsha/i18n` locale as `language` (`apps/desktop/src/screens/Onboarding.tsx:266`). So it is no
longer the call that a running daemon refused with `-32602 missing field 'description'` when this
page was measured on 2026-11-03. All three fields are sent over HTTP against a real `warshad` by
`crates/warshad/tests/gates_list.rs:134-140` — there in the daemon's positional form, while the client
sends the named-object form that `R7` counts against the daemon's three required arguments. What has
**not** been done is walking the wizard by hand against a real daemon on this host: the desktop tests
that cover step 5 run against the e2e harness's stub, which now refuses a create missing a required
field the way the daemon does. The mark that hides the wizard on the next launch is written when step
5 succeeds.

The command line path is unchanged: `warsha new "your idea" -n todo-app` sends the same three fields,
with the idea as the description and `language` fixed to `"en"` by the CLI itself
(`crates/warsha-cli/src/lib.rs:409-416`), so a project created that way appears in the app, because
`projects.list` answers correctly.

Still standing after step 5, and not fixed by any of this: the app's live event feed is refused by a
real daemon, so neither desktop mode receives pushed events
([Known limitations](known-limitations.md)).

## Where to go next

- [Known limitations](known-limitations.md) — what else fails today, and what is safe to rely on
- [دليل المستخدم بالعربية](user-guide.ar.md) — the same first steps in Arabic
- [Configure Providers](providers.md) — kinds, models, routing and budgets
- [Quickstart](quickstart.md) — building the app so that this screen exists
