# W1 — README truth · independent review

- Packet: W1 (`readme-truth`), run `2026-11-08-design-and-remediation`
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/w1`, branch `run/2026-11-08/w1-readme-truth`
- Reviewed range: **`0772d502002562505c6438ae712abca7a7328d84..6d9728f52eb096199c4ace208435c8b8927e5140`** (5 commits; BASE confirmed ancestor, `git rev-list --count` = 5, worktree clean at HEAD)
- Reviewer role: reviewer only — no implementation or gate edited.

## Verified diff stat (`git diff --numstat BASE..HEAD`)

| File | + | − |
|---|---|---|
| README.ar.md | 26 | 5 |
| README.md | 32 | 11 |
| apps/desktop/README.md | 54 | 9 |
| apps/remote/README.md | 61 | 16 |
| crates/warsha-git/README.md | 38 | 10 |
| crates/warsha-pipeline/README.md | 89 | 17 |
| crates/warsha-remote/README.md | 61 | 10 |
| packages/crypto/README.md | 51 | 12 |
| templates/README.md | 35 | 9 |
| **Total (9 files)** | **447** | **99** |

## Scope (G1.S)

Ran the exact gate: `git diff --name-only BASE..HEAD | grep -vE '<allowlist>' | wc -l` → **`0`**. Only the 9 allowed READMEs changed. No PLAN.md / PROGRESS.md / DECISIONS.md, no `docs/**`, no `packages/ui/README.md`, no snapshots, no dependency/lockfile, no `.github/**`.

## Gates (reviewer re-run, read-only, at HEAD)

G1.S `0` · G1.1 exit 1 · G1.2 exit 1 · G1.3 exit 0 · G1.4 exit 0 · G1.5 exit 0 · G1.6 exit 0 · G1.7 exit 1 · G1.8 exit 0 · G1.9 exit 0 · G1.A `arch: 5 rules, 0 violations` · G1.P `policy: 8 checks, 0 failures` · G1.W `wire: 8 checks, 0 violations`. All match the frozen expectations. Gate sanity: the sentences each grep lands on are true (notably G1.8's `188` sits in the "188 listed, 180 passed, 8 failed — settings a11y" sentence, which matches `acceptance.json` and the 8 failing case headers in `gates/G0.log:143,179,216,254,290,327,365,401`).

## Findings

| # | Severity | Location | Finding |
|---|---|---|---|
| F1 | **minor** | [README.md:161](file:///C:/Users/Dragonfly/Downloads/warsha-wt/w1/README.md#L161), [README.ar.md:161-162](file:///C:/Users/Dragonfly/Downloads/warsha-wt/w1/README.ar.md#L161) | The data-location FAQ still says the phone reaches the daemon "with the daemon's access token" ("مستخدمًا رمز وصول الخادم"). This contradicts the packet's own corrected claim at [crates/warsha-remote/README.md:6-9](file:///C:/Users/Dragonfly/Downloads/warsha-wt/w1/crates/warsha-remote/README.md#L6) — a phone authenticates with its own pairing secret, never the owner/daemon token (`crates/warshad/src/auth.rs:171-184`). Pre-existing text (unchanged by this diff), and arguably ambiguous rather than strictly false because the pairing secret is a daemon-issued credential — but a truth-remediation packet should disambiguate it ("with its own per-device pairing code"). Suggested for a follow-up or bounded repair. |
| F2 | **nit** | [crates/warsha-remote/README.md:48](file:///C:/Users/Dragonfly/Downloads/warsha-wt/w1/crates/warsha-remote/README.md#L48) | `initiate`/`respond` are cited as `src/lib.rs:611` / `:640`; those are the `let _handshake = builder…` discard statements inside the functions (fn declarations at `:599`/`:628`). **Adjudication: accurate by intent** — the sentence claims the handshake object is discarded, and `:611`/`:640` are exactly the discard lines. Not a defect; citing the signature lines would merely read better. |
| F3 | **nit** | [crates/warsha-remote/README.md:53](file:///C:/Users/Dragonfly/Downloads/warsha-wt/w1/crates/warsha-remote/README.md#L53) | "`write_message` and `read_message` … therefore always fail" is absolute; the next sentence correctly qualifies it (`complete_handshake` inside the crate can install a caller-built `HandshakeState`). True in practice, since no caller exists outside the crate. |
| F4 | **nit** | [apps/desktop/README.md:19](file:///C:/Users/Dragonfly/Downloads/warsha-wt/w1/apps/desktop/README.md#L19) | "stubs **exactly two edges**" — the harness also intercepts the `/events` WebSocket and aborts font hosts (`e2e/harness.ts:1484,1534`; the README itself documents the `/events` transcript three paragraphs later). Defensible if "edges" means Tauri-shell + daemon, but slightly imprecise. |

**Blockers: none. Majors: none.**

## Per-file truthfulness verdict

| File | Verdict | What I checked against the code at BASE |
|---|---|---|
| `crates/warsha-remote/README.md` | **TRUE** | `auth.rs:171-184` owner-token-then-pairing resolve, constant-time, `None` for empty/unknown/revoked; `lib.rs:3` rate_limit, `:125` "One-time secret", `:137-147` redacting Debug, `:161` 10-min expiry, `:202` `is_expired`, `:211` `verify_secret`, `:267-279` `pairing_link` bearer link; `:599/:611` and `:628/:640` discard `_handshake`, `:656-659` `Ok(false)` stub, `:662-685` "Handshake not complete", `:688` only transport setter, `:715/742/747` RelayClient stubs. No `EncryptedChannel`/`RelayClient` use outside the crate (grep over `crates apps packages`); `EncryptedFrame` outside it only in `warsha-relay` forwarding/deserializing (constructors at `warsha-relay/src/lib.rs:1089` are in tests). Consumers = warshad, warsha-cli, warsha-relay (`Cargo.toml:15/11/10`). `DEFAULT_MAX_KEYS = 4096`, `DEFAULT_REFUSAL_LOG_INTERVAL = 60 s`, `rate_key` identity→peer fallback, `caller_digest` one-way. |
| `packages/crypto/README.md` | **TRUE** (incl. "nothing imports it") | `grep -rl '@warsha/crypto' apps packages --include=*.ts --include=*.tsx` → only `packages/crypto/src/index.ts` (line 1 header comment); no workspace `package.json` declares it (only its own `name`); `tsconfig.json:21` is a path mapping, not an import. Exports match the Interface list; `generateNonce` 12 B, `generatePairingSecret` 32 B, `createPairingData` stores secret + public key, 10-min expiry; `deriveChannelSalt` = SHA-256 over lexicographically ordered publics; initiator/responder mirrored `warsha-initiator`/`warsha-responder` keys; replay `check` before `decrypt`; `ReplayProtection` default 10000 FIFO; `serializeFrame` = from/to/nonce/ciphertext/timestamp; 22 tests; btoa/atob, `randomBytes`, `Date.now` only. |
| `apps/remote/README.md` | **TRUE** | `bench.tsx` `BenchApi:103`, `stageQueue:170`, `gateWaitsOnOwner:205`, `RemoteContext:317`, `RemoteProvider:320`, `resyncFromCursor:674`, `useRemote:1056`; five screens + chrome/GatePlate/pairing as listed; `offline.ts:30,96` and `main.tsx:13,44` (`prod` only, `skipped-build`/`skipped-platform`/`failed` outcomes); `package.json:9` build chain; `workbox-config.cjs` no `runtimeCaching`, denylist `/api/`, `/events`, `/healthz`, `navigateFallback`; no `requestPermission`/`pushManager`/`showNotification` anywhere; `dist/sw.js`; 84 + 7 = 91 listed, G0 51/40, flows 7/7, bench 44/84, 40 real diffs, verdict `fail` (matches `acceptance.json`); `remote.no_llm_keys` in `SettingsScreen.tsx:222`; shared `warsha.theme`/`warsha.locale` applied before paint in `main.tsx`. |
| `crates/warsha-git/README.md` | **TRUE** | Only `warshad` depends on it (`crates/warshad/Cargo.toml:14`); `GithubClient` import `:38`, field `:1031`, construction `:5415-5416`, stored `:5500`, never read (no `.github` read exists); `reqwest` `:409`; `octocrab` only root `Cargo.toml:66`, no crate uses it; `ProjectTemplate` `:629`, impl `:950-1049`, web/cli/desktop/android `:952/971/986/1004`, `all :1023`, `by_name :1028`, `scaffold :1033`; `validate_ref_arg :63`; `is_relative_file_path :653`; `authorized :572-577`; `AuthRequired :418`, 300-char truncation `:596`; `status` = `git status --porcelain :140`; `commit.gpgsign=false :182`; `get_github_token` `warshad:6062`. "The pipeline asks this crate" is absent. |
| `templates/README.md` | **TRUE** | `ls templates/` = only `README.md`; no `templates/` reference in `crates/` or `apps/`; four templates embedded in `warsha-git` with `.github/workflows/ci.yml` + `factory/README.md` for web/cli/desktop/android (`:964-965, :979-980, :997-998, :1014-1015`); `ProjectTemplate` has no caller outside the crate. |
| `crates/warsha-pipeline/README.md` | **TRUE** | All 26 modules at `lib.rs:18-50` (23 private + `mcp`/`mcp_transport`/`settings`; `test_util` at `:47-49`) are backticked and named correctly (G1.4 green); `Stage` 14 variants incl. four gates (`warsha-core/src/lib.rs:74-89`); `advance_to_next_gate :740`; `dispatch_chat :640-667`; sampled module descriptions (evals, router_quality, routines, post_launch, run_modes) match each module's own header doc. |
| `apps/desktop/README.md` | **TRUE** | `RPC_METHODS :100`; `real-acceptance.cjs` answers only `get_config`/`set_config` and rejects others (`:42-45`), prints HEADINGS/RPC_METHODS/HAS_CLI_PROJECT/BODY_SNIPPET and writes `real-acceptance.png` (`:60-65`); 793 listed = 188+252+308+30+12+3, behaviour 45 (matches `acceptance.json`); G0 785/793 with exactly 8 `settings` a11y failures across 390×844/1440×900 × ar/en × light/dark (`G0.log:143-401`), so a11y 180/188; `screens.a11y.spec.ts:44`, `screens.visual.spec.ts:57,80-81`, `onboarding.spec.ts:56` hold; `e2e/support/{layout,a11y,fonts}.ts` exist. |
| `README.md` | **TRUE except F1** | Service-worker paragraph corrected and true (`dist/sw.js`, shell-worker registration, no push); "Planned:" gone; provider FAQ matches `provider_setup.rs` (OpenRouter/DeepSeek/Kimi/GLM/Qwen + custom defaults), `openai.rs:226,295` `{base}/chat/completions` + Bearer only (no `api-key`/`api-version`), `anthropic.rs:35,39,136` `x-api-key` + `/v1/messages`, `ollama.rs:26` ignores credentials while `validate_key:168-177` still refuses an empty key, `env_llm.rs:14` default `https://router.sayl.site/v1`, `AdapterKind` = 3 protocols (no Gemini native adapter), CLI tools detected via `all_available()` PATH filter (`warsha-backends/src/lib.rs:263-276`) whose `execute` only runs `--version` (`:191`) and `DaemonState.backends` is never read; roadmap M10–M19 `✅ DONE`, M20 no marker, Wave 2 `COMPLETE` in `PROGRESS.md:155` — statuses as written; a11y row honest (188/180/8). |
| `README.ar.md` | **TRUE except F1** | Real Arabic prose in every changed paragraph (no machine transliteration, no English left in place; only code identifiers/URLs Latin); milestone ids and `Wave 2` stay Latin; roadmap mirrors README.md row-for-row (22 identical ids; M20 `🟡`, rest `✅`); a11y row `١٨٨ مُدرجة، ١٨٠ ناجحًا، ٨ فاشلة` with the same `settings`/`aria-required-children` detail. |

## Verified by running / reading, vs. not verified

- **Ran:** G1.S + all 12 other gates; grep consumer/import scans; `git diff --numstat`, `--check`, secret-pattern scan (none); commit list; branch has no upstream (nothing pushed).
- **Read and matched to code:** every citation listed per file above; G0 per-spec numbers from `acceptance.json` and the 8 failing-case headers in `G0.log`.
- **Not independently re-measured:** the carried-forward historical rows of the root "Verified today" table that this packet did not edit (Rust `725 passed`, TS `1001 passed`, lint/typecheck/build `exit 0`, versions). They are dated 2026-11-05–08 records, not contradicted by anything I saw; the report already lists them as open item 4. The Arabic text's linguistic nuance beyond "genuine Arabic, ids Latin, rows mirrored" was not separately proofread.

## Verdict

**APPROVE**

The packet is scope-clean (G1.S = 0), all 13 frozen gates pass with true intent, every substantive factual claim I sampled against BASE code is accurate, and the measured G0 baseline is stated honestly (desktop 785/793, remote 51/40; no all-green claim anywhere). F1 (pre-existing ambiguous "daemon's access token" in both root READMEs) is a minor follow-up, not a reason to hold the packet; F2–F4 are nits.
