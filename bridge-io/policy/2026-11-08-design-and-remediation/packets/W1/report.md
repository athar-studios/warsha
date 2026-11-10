# W1 — README truth · implementer report

- Packet: W1 (`readme-truth`), run `2026-11-08-design-and-remediation`, Wave A
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/w1`, branch `run/2026-11-08/w1-readme-truth`
- BASE: `0772d502002562505c6438ae712abca7a7328d84` (`run/2026-11-08/integration`)
- HEAD: `6d9728f52eb096199c4ace208435c8b8927e5140`
- Status: implementation complete; all 13 frozen gates run green in this worktree. Nothing pushed, merged, published or released. `PLAN.md` / `PROGRESS.md` / `DECISIONS.md`, snapshots, dependencies, lockfiles and `.github/**` were not touched.

## Commits (BASE..HEAD)

| Commit | Subject |
|---|---|
| `a9e5a4d` | docs(readme): correct the remote-path encryption and crypto-consumer claims |
| `260a013` | docs(readme): state the app e2e listed counts and the measured G0 baseline |
| `763f6ff` | docs(readme): correct crate consumers and list all 26 pipeline modules |
| `84472ff` | docs(readme): correct the service-worker, provider and baseline claims and complete the roadmap |
| `6d9728f` | docs(readme): name the default WARSHA_LLM_* base URL |

`a9e5a4d`–`763f6ff` are the preserved work of the interrupted session (steps 1–7); `84472ff` and `6d9728f` complete step 8. The working tree was clean at HEAD when the gates were run.

## `git diff --stat 0772d50..HEAD`

```
 README.ar.md                     |  31 ++++++++++--
 README.md                        |  43 ++++++++++++----
 apps/desktop/README.md           |  63 +++++++++++++++++++----
 apps/remote/README.md            |  77 ++++++++++++++++++++++------
 crates/warsha-git/README.md      |  48 ++++++++++++++----
 crates/warsha-pipeline/README.md | 106 ++++++++++++++++++++++++++++++++-------
 crates/warsha-remote/README.md   |  71 ++++++++++++++++++++++----
 packages/crypto/README.md        |  63 ++++++++++++++++++-----
 templates/README.md              |  44 ++++++++++++----
 9 files changed, 447 insertions(+), 99 deletions(-)
```

Only the 9 `allowed_files` changed.

## State found on resume (and what I did about it)

This was a resume. I did not start over. Judged state only from `git log`, `git diff` and file content (the repo has content filters, so raw file hashes are not evidence; the worktree was clean by `git diff HEAD`).

- `git log 0772d50..HEAD` showed the three commits above; `git diff --stat HEAD` showed `README.md` +12/−4 uncommitted.
- Steps 1–7 (the seven subsystem READMEs) were committed and I re-audited every factual claim in them against the code at BASE (see "Verification of preserved work"). No rewrites were needed; every cited line number and behaviour held.
- Step 8 was partly done: the README.md service-worker paragraph and the "Planned:" provider answer were edited but uncommitted; README.ar.md was untouched; the roadmap rows were missing in both languages; the `a11y` row of "Verified today" still said a bare "180 passed".
- Single-writer discipline: I ran `git log 0772d50..HEAD` + `git diff --stat HEAD` before my first edit and before every commit. No foreign commits or edits appeared at any point. No blocker.

## Decisions

1. **Kept the preserved uncommitted README.md text after verifying it**, rather than reverting: every claim in it was checked against code (service worker: `apps/remote/package.json` build line, `workbox-config.cjs` (no `runtimeCaching`, shell precache, `navigateFallback` denylist), `src/offline.ts:30,96`, `src/main.tsx:13,44`; providers: `crates/warsha-providers/src/provider_setup.rs` preset table (`OpenRouter`, `DeepSeek`, `Kimi`, `GLM`, `Qwen`, `Custom`) and default URLs/models, `openai.rs:30,35,226,295` (`{base}/chat/completions`, `Authorization: Bearer`), `anthropic.rs:30,35,136` (`x-api-key`, `/v1/messages`), `ollama.rs:270,339` (`/api/chat`), `env_llm.rs:14-53`, `warsha-pipeline/src/lib.rs:640-667` `dispatch_chat`, `crates/warshad/src/providers.rs:97-108,149-185`).
2. **Corrected two overstatements in the preserved draft.**
   - "Official coding tools … Each is used only when its command is on your PATH" → `CliBackend::execute` runs only `<cmd> … --version` (`crates/warsha-backends/src/lib.rs:188-194`) and `DaemonState.backends` is built (`crates/warshad/src/lib.rs:5412,5499,6897`) but never read. The README now says the daemon detects a tool on `PATH` at start-up and its adapter is still being built; an install is recorded, not yet handed coding work.
   - "keys stay in your system keychain" → qualified, because the `WARSHA_LLM_*` path reads its key from the environment (`env_llm.rs:47-53`) and is the one connection whose key is not in the keychain.
3. **Documented the local-server key requirement honestly.** `providers.add` refuses an empty key (`validate_key`, `provider_setup.rs:167-177`, reached through `test_connection` at `crates/warshad/src/lib.rs:2672-2678`), while `OllamaProvider::new` ignores the credential. The README says the local adapter needs no real key but the add form still asks for one, rather than "no key at all".
4. **OpenAI and Anthropic are entered by URL.** `OneClickProvider` has defaults only for OpenRouter, DeepSeek, Kimi, GLM, Qwen and Custom (`provider_setup.rs:233-282`); `providers.add` refuses a kind with neither a default nor an `api_base` (`crates/warshad/src/lib.rs:2658-2667`). Step 3 of both READMEs now says "any other endpoint (OpenAI, Anthropic) entered by its own URL".
5. **Gemini has no native adapter.** The live factory recognises three protocols (`AdapterKind` at `crates/warshad/src/providers.rs:66-108`); `ProviderKind::GoogleGemini` exists in `warsha-core` but neither the daemon factory nor `warsha-providers::create_provider` (`lib.rs:1064-1100`) handles it. A `gemini` row therefore needs an OpenAI-compatible URL; Gemini's own API is not implemented.
6. **Azure OpenAI has no native adapter either.** `openai.rs` sends only `Authorization: Bearer` and never an `api-key` header or `api-version` query, so it works only where the endpoint accepts that bearer form, not Azure's deployment-scoped `api-key` form.
7. **Root "Verified today" a11y row corrected to the recorded G0 result** — "188 listed, 180 passed, 8 failed — all on the `settings` screen (axe `aria-required-children`)" — because a bare "180 passed" hid 8 real failures in the same file that now documents G0. Numbers checked against `gates/G0.log:30` (`8 failed, 785 passed, 0 skipped (793 listed)`) and `:36` (`40 failed, 51 passed, 0 skipped (91 listed)`).
8. **Fixed a garbled pre-existing sentence** in the data-location FAQ ("… so the relay cannot read messages is a design goal, not today's fact") while it was already being edited for the keychain qualifier.
9. **Roadmap statuses taken from `PLAN.md` headings / `PROGRESS.md`.** M10–M19 are `✅ DONE` in `PLAN.md` → `✅ Delivered`, with the concrete caveats each heading itself records (M16 owner-only steps, M17 no collector/store client/push, M18 mentions carry targets, M19 not driven through MCP). M20's heading has **no** ✅ marker and its follow-up batches are open → `🟡 Delivered in batches`. Wave 2 is `COMPLETE` in `PROGRESS.md:155` → `✅ Delivered`. Arabic rows are written in Arabic with the milestone ids Latin (`M10`…`M20`, `Wave 2`).
10. **Default `WARSHA_LLM_*` base URL named** (`https://router.sayl.site/v1`, `env_llm.rs:14`) with the advice to set `WARSHA_LLM_BASE_URL` before exporting a key: without it, a developer's key would be sent to a host they did not choose.
11. **Scope discipline over convenience.** `packages/ui/README.md` (W3), `docs/**` (W2) and all source were left alone even where a claim could be sharpened; only the 9 allowed READMEs changed. No dependency, lockfile, snapshot or workflow was touched.
12. **No questions asked** (per the brief and `AGENTS.md`): decisions are recorded here and implementation continued.

## Verification of preserved work (steps 1–7 claims re-checked at BASE)

- `crates/warsha-remote/README.md`: `EncryptedChannel::initiate`/`respond` discard `let _handshake` and return `transport: None` (`src/lib.rs:611,640`); `process_handshake` is `Ok(false)` (`:656-659`); `write_message`/`read_message` fail "Handshake not complete" (`:662-685`); `complete_handshake` `:688`; `pairing_link` `:267-279` builds `{origin}/?server=<enc>&token=<secret>`; `Debug` redacts `:137-147`; `pub mod rate_limit` `:3`. No production code outside tests constructs `EncryptedFrame` (only `warsha-relay` tests construct it; the relay forwards it). Consumers are `warshad`, `warsha-cli`, `warsha-relay`.
- `packages/crypto/README.md`: `grep -rl "@warsha/crypto" apps packages --include=*.ts --include=*.tsx` returns exactly `packages/crypto/src/index.ts`; no `package.json` declares it; `src/index.test.ts` has 22 tests.
- `apps/remote/README.md`: `bench.tsx` line refs `103,170,205,317,320,674,1056`; `offline.ts:30,96`; `main.tsx:13,44`; `workbox-config.cjs` has no `runtimeCaching` and the stated denylist; no `pushManager` / `Notification.requestPermission` / `showNotification` anywhere in `apps/remote`.
- `crates/warsha-git/README.md`: only `warshad` depends on it (`crates/warshad/Cargo.toml:14`); import `:38`; field `:1031`; construction `:5415-5416`; never read; `reqwest` `:409`; `ProjectTemplate` struct `:629`, `web :952`, `cli :971`, `desktop :986`, `android :1004`, `all :1023`, `by_name :1028`, `scaffold :1033`; `octocrab` only at root `Cargo.toml:66`.
- `templates/README.md`: directory holds only the README; the four templates are the Rust constants above; no caller outside `warsha-git`.
- `crates/warsha-pipeline/README.md`: 26 module declarations at `lib.rs:18-50` (23 private, 3 public `mcp`/`mcp_transport`/`settings`), `#[cfg(test)] pub(crate) mod test_util` `:47-49`; `Stage` has 14 variants, 4 gates (`warsha-core/src/lib.rs:74-89,117-122`); `advance_to_next_gate` `:740`; `dispatch_chat` `:640-667`.
- `apps/desktop/README.md`: `RPC_METHODS` declared at `harness.ts:100` (44 methods at this base); `real-acceptance.cjs` injects only `get_config`/`set_config` and rejects others; `screens.a11y.spec.ts:44`, `screens.visual.spec.ts:57,80-81`, `onboarding.spec.ts:56` hold as cited; listed counts check against G0 (`793` desktop, `91` remote).

## My own gate run (not acceptance evidence — the verifier must rerun)

Run in the worktree at `6d9728f`, commands verbatim from the packet prompt.

| Gate | Command (as written in the prompt) | Result | Expected |
|---|---|---|---|
| G1.S | `git diff --name-only $BASE..HEAD \| grep -vE '<allowed>' \| wc -l` | output `0` | 0 |
| G1.1 | `grep -nE 'registers no service worker\|لا يسجّل خدمة' README.md README.ar.md` | exit **1** (no match) | exit 1 |
| G1.2 | `grep -nE '^(Planned:\|المخطط له:)' README.md README.ar.md` | exit **1** (no match) | exit 1 |
| G1.3 | roadmap-row loop for M10…M20, `Wave 2` in both READMEs | exit **0** | exit 0 |
| G1.4 | loop over the 26 pipeline modules in `crates/warsha-pipeline/README.md` | exit **0** | exit 0 |
| G1.5 | `process_handshake` present and `stub\|not implemented` present | exit **0** | exit 0 |
| G1.6 | `ProjectTemplate` + `web cli desktop android` in `templates/README.md` | exit **0** | exit 0 |
| G1.7 | `grep -q 'The pipeline asks this crate' crates/warsha-git/README.md` | exit **1** (no match) | exit 1 |
| G1.8 | `flows.spec.ts` + `real-acceptance.cjs` + `188` in `apps/desktop/README.md` | exit **0** | exit 0 |
| G1.9 | `registerShellWorker` + `RemoteProvider` in `apps/remote/README.md` | exit **0** | exit 0 |
| G1.A | `node scripts/check-arch.mjs` | exit **0** — `arch: 5 rules, 0 violations` | exit 0 |
| G1.P | `node scripts/check-engineering-policy.mjs` | exit **0** — `policy: 8 checks, 0 failures` | exit 0 |
| G1.W | `node scripts/check-wire-contract.mjs` | exit **0** — `wire: 8 checks, 0 violations` | exit 0 |

(13/13 as specified. `G1.W` printing "8 checks" is the base state; W4 owns the raise to 9.)

## Open issues (recorded, not fixed — outside W1's allowed scope)

1. **`warsha-backends` does not yet run coding tools.** `CliBackend::execute` runs `<cmd> --version` as a placeholder and `DaemonState.backends` is never read. The README now states this; wiring it is a product packet, not docs.
2. **The `WARSHA_LLM_*` default endpoint is a third-party router** (`https://router.sayl.site/v1`). Documented in the FAQ; whether that default should exist at all is an owner/product decision.
3. **G0 is still red** (desktop 785/793, remote 51/91). The nine READMEs now state the measured baseline; the fixes are W8 (a11y) and OD1 (owner-authorized remote baseline refresh) per `state.json`. No README claims an all-green run.
4. **Pre-existing measurements outside the packet's edit list were not re-measured** by me: the Rust `725 passed`, TypeScript `1001 passed`, lint/typecheck/build `exit 0` and `--self-check 11/11` rows of "Verified today", and the version numbers. They were carried forward as historical records; the verifier may want to re-measure them separately.
5. **`apps/desktop/README.md` still describes the harness as stubbing "exactly two edges".** Verified true at this base (`get_config` + the RPC surface); W4 will change `harness.ts`, so the sentence must be re-checked when W4 lands (it is not wrong today).
6. **Remote baseline provenance (aarch64 vs x86_64) is only in `state.json`**, not in `apps/remote/README.md`; the README states the measured 40 diffs without claiming a cause. Deeper provenance belongs to W2's canonical docs.
7. **Arabic numbering in the "Verified today" table stays Arabic-Indic** as the file already used; the new a11y cell keeps that convention so the table is internally consistent.
