# Known limitations

Warsha's documentation describes what the code does today, not what it will do. This page is the
navigable list of the places where that distinction actually bites an owner: what fails, what the
failure looks like, and what is safe to rely on meanwhile.

Everything here is true **as of 2026-11-03** and is split by how it was learned: section A is what
a live daemon answered when it was called; section B is what the code and
[`docs/INSTALL.md` §5](../INSTALL.md) state. Two of the breaks first measured in section A have
since been closed by code that landed in this repository, so they are recorded below as closed, not
carried forward as limitations.

## A. Measured against a running daemon

### 1. Closed: first-run project creation

`createProject` sends all three fields the daemon requires — `name`, `description` and `language`
(`packages/client/src/index.ts:518-523`), matching the three non-`Option` bound arguments at
`crates/warshad/src/lib.rs:668-674`. Both desktop callers supply them from values they already hold:
the project board's new-project dialog passes the idea typed into that same form, and the first-run
wizard passes the name the owner typed, with `language` from the active `@warsha/i18n` locale in each
case (`apps/desktop/src/screens/ProjectsBoard.tsx:256`, `apps/desktop/src/screens/Onboarding.tsx:266`)
— never a hardcoded `"en"` in an Arabic-first app.

### 2. Closed: the gates queue is served

`gates.list` is a registered daemon method (`crates/warshad/src/lib.rs:741-746`) and the client's
`getGates` calls it (`packages/client/src/index.ts:600-601`), so the screens that read the queue —
Simple mode's pending count, the gates inbox and the header bell — now name a method the daemon
answers instead of one that returns `-32601`;
`crates/warshad/tests/gates_list.rs` drives a running `warshad` over HTTP to pin that read at the
transport rather than only in-process. The queue is read from the run's own `Run.gate_states` — the
record `runs.start` seeds and `gates.approve`/`gates.reject`/`gates.changes` mutate — rather than
from a separate `gates` table, because nothing writes that table in production and a table-backed
read would have answered every queue empty.

What is **not** closed by either item, and must not be read as closed: the `/events` live feed is
still refused by a real daemon (section B), so neither desktop mode receives pushed events and each
shows its own "stream offline" state. The `R7` wire gate ([`docs/ARCH_RULES.md`](../ARCH_RULES.md))
guards the two items above only as far as names and required-field counts go — every name the client
puts on the wire is registered by the daemon, and every call supplies each required field, with both
deferral lists empty, so neither break can return silently. It cannot see a response shape, and it
cannot make the socket work.

### 3. What is **not** a limitation: parameter key casing

The claim that the wire breaks because the client sends camelCase keys (`{ projectId }`) while the
daemon binds snake_case Rust arguments was **tested against a live daemon and withdrawn**
(`DECISIONS.md`, the entry marked `WITHDRAWN — Decision (#40 param convention)`). A live
`runs.list` with `{"projectId": <uuid>}` returned `result: []`, exactly as the snake_case form did.
Param casing is not a problem, no rename is wanted, and no screen is broken by it. The wire break
that was real here was the required-fields one in item 1, which is closed.

## B. Also true today

**Install side** — consolidated in [`docs/INSTALL.md` §5](../INSTALL.md), which stays the source
list; do not read this page as a replacement for it:

| Limitation | What it means for you |
|---|---|
| Nothing is published | no release tag, no release page, no installer built on the maintenance host (Linux aarch64). `git tag --list` is empty, and any `.../releases/latest/download/...` URL is a 404. |
| Unsigned installers | when a Windows bundle exists, SmartScreen will warn on every install; there is no certificate. |
| Self-update not wired | `plugins.updater` is configured, but `tauri-plugin-updater` is not a dependency and no signed `latest.json` exists, so nothing updates itself. |
| The live event feed is unreachable from the app | `/events` authenticates from the `Authorization` header alone (`crates/warshad/src/lib.rs:3658`, and `bearer_token` at `:365-372` reads nothing else), which a webview cannot set on a WebSocket handshake; the client already carries the token in a subprotocol (`packages/client/src/index.ts:445`, used at `:1095`) and the middleware ignores it, so the socket is refused. Both desktop modes open it and show their own offline banner (`apps/desktop/src/screens/SimpleMode.tsx:283`, `:676-693`). |
| A provider key needs a real OS keychain | Windows Credential Manager, macOS Keychain or the freedesktop Secret Service. With none running — headless Linux, a container — `providers.add` refuses and there is deliberately no plaintext fallback file (`crates/warsha-providers/src/secrets.rs:105-110`). |
| Ports are not guaranteed | if 8765/8766 are taken the OS picks others and the `warsha` CLI does not learn them ([`docs/INSTALL.md` §5](../INSTALL.md)). |
| Bundle identifier | `dev.warsha.app` ends in `.app`, which Tauri flags against the macOS bundle extension; changing it after the first public release changes the installer's identity. |

**Repo and CLI**, read from the code (not measured by a live call, and labelled as such):

- The repository has **never run a CI workflow**: Actions is enabled with zero runs, because every
  push in this stage went to a branch the trigger did not name (`DECISIONS.md`, measured
  2026-11-03). Nothing in CI has a green baseline to regress from.
- `warsha approve` / `warsha reject` invent a fresh device id for every call
  (`crates/warsha-cli/src/lib.rs:532-550`), while the daemon records the *session's* device and
  refuses a request that names another (`crates/warshad/src/lib.rs:1304-1318`). On that reading the
  CLI's gate decisions are refused with `-32003`; **this has not been confirmed against a running
  daemon**, unlike items A1 and A2. The app path sends `device_id: null`
  (`packages/client/src/index.ts:604-606`), which the same code accepts.
- `warsha init --lang ar` is accepted and ignored: `cmd_init` never uses the argument
  (`crates/warsha-cli/src/lib.rs:381`), and the daemon takes the language per call.
- `warsha logs <run> --follow` prints the events it already has and then
  `Following... (WebSocket not implemented)` (`crates/warsha-cli/src/lib.rs:510-513`). The flag
  exists; the tail does not.
- The mobile PWA has **no push notifications on any platform**: no service worker is registered, no
  notification permission is requested, no `PushManager` is used
  ([Quickstart](quickstart.md) carries the measurement). Its pairing channel is not end-to-end
  encrypted either ([Security Model](security.md)).
- `docs/src/changelog.md` says some M17–M19 features "do not exist in the repository"
  (crash reports, the backend kit). That line has aged: `backend.export` (`crates/warshad/src/lib.rs:805`),
  `backend.get` and `backend.set` (`:908-:911`), `postlaunch.crashes` (`:820`) and
  `postlaunch.reviews` (`:823`) are registered daemon methods, and the app already calls one of them
  (`apps/desktop/src/App.tsx:438`). Whether those screens are wired end to end is open work; the
  changelog wording is flagged for the owner rather than rewritten here.

## What is safe to rely on today

- Reading that was **answered live** on 2026-11-03: `projects.list` returns `[]` on an empty store
  and `runs.list` answers with a camelCase `projectId` (`DECISIONS.md`). The other reads
  (`projects.get`, `runs.get`, `runs.events`, `providers.list`) are registered handlers
  (`crates/warshad/src/lib.rs:665-749`) that were not individually probed; treat them as
  code-present, not as measured.
- Provider setup through the app: `providers.add` stores the key in the OS keychain under the
  service name `warsha-provider` and `providers.test` reports what the provider said
  ([First run](first-run.md)).
- The CLI's create-and-run path: `warsha new` sends the three fields the daemon demands.
- The UI itself: the desktop screens are covered by an axe + keyboard walk
  (`apps/desktop/e2e/screens.a11y.spec.ts`) and by the Playwright visual baseline — but those run
  against the e2e harness's stubbed daemon, which answers the RPC calls locally, so a green render
  still says nothing about the live socket in the table above. The stub is at least honest about the
  one create path it used to fake: it refuses a `projects.create` that omits a required field with
  the daemon's own `-32602 missing field '<x>'` (`apps/desktop/e2e/harness.ts:940-947`). Trust the
  tests for layout and interaction; trust this page for the wire.
- i18n parity: the Arabic and English catalogs carry the same keys, and Arabic is the default locale
  (`packages/i18n/src/index.tsx:17`).

## Where else to look

- [`docs/INSTALL.md`](../INSTALL.md) — install, uninstall, data locations, and §5 for the gaps this
  page consolidates.
- [Changelog](changelog.md) — what landed, in which milestone, and what it refuses to claim.
- [Quickstart](quickstart.md) — the commands that work from source today.
- `PROGRESS.md` and `DECISIONS.md` at the repository root — the running state and the reasoning
  behind each decision above, including the withdrawn claim in item A3.
