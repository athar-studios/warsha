# R-EXT-6 report — RC1 remote channel truth: dead `EncryptedChannel` + `snow` deleted

**Status: IN SCOPE DONE, ONE ACCEPTANCE LINE UNMET — stop-and-report.** The Rust deletion is complete and
every code gate is green on the final tree. The acceptance grep `git grep -n "EncryptedChannel" -- crates`
is **not** empty: it prints 2 lines, both in `crates/warsha-remote/README.md`, which is **not in this
packet's allowed files**. D1 requires deletion only; the packet's own rule is "needing [a not-allowed file]
is a stop-and-report". This lane did not edit that file and did not extend scope silently — the exact
proposed repair is below, for the PM to accept as a one-file scope extension.

- **Branch:** `zl-rext6-remote` (isolated worktree `/home/moe/Downloads/Warsha-rext6`); no push, no tag,
  no publish.
- **Base:** `17bac9d` on `repair/dev-csp-f474776` (the packet text names `04847cf`; `17bac9d` is the
  branch tip this lane was dispatched on and is the base actually measured below).
- **Head:** `d315a17` for code; this report is the only commit after it (listed as "this commit"
  below, so the file never has to name its own hash).

## Commits

| Commit | What |
|---|---|
| `11d55dd` — `refactor(remote): delete the dead EncryptedChannel and its test` | `crates/warsha-remote/src/lib.rs`: `use snow`, `NOISE_PARAMS`, the `EncryptedChannel` struct + impl + `complete_handshake`, the `channel` field and its construction in `RelayClient::new`, `test_encrypted_channel_creation` |
| `d315a17` — `build(deps): drop snow from the workspace and warsha-remote` | `Cargo.toml`, `crates/warsha-remote/Cargo.toml`, `Cargo.lock` |
| this commit — `docs(zadloop): add the R-EXT-6 implementation report` | this file |

## The stop-and-report item (why gate 1 is not 0)

`crates/warsha-remote/README.md` still names the deleted type on lines 10–11 and 17:

```
10: **Relay payloads are not end-to-end encrypted today.** The `EncryptedChannel` handshake is a
11: stub (see below); the phone path that actually runs is authenticated JSON-RPC, not ciphertext.
...
16:   `TrustedPairing`, `RelayTrust` and the `EncryptedFrame` wire type, plus the unfinished
17:   `EncryptedChannel` and `RelayClient`.
```

Those lines were **already inconsistent with the same file** before this change: line 48 states "The
crypto stubs were deleted (OD-R6, KEEL K7): there is no handshake channel or relay client in the tree
today." After the deletion lines 10–11 and 17 are the only remaining references and they are now false
(the stub is gone, not stubbed). Fixing them needs `crates/warsha-remote/README.md`, which the packet
lists under neither *Allowed files* nor *Not allowed* — so it is outside this lane's remit.

Smallest repair, **not applied** — two hunks, docs only, no code:

```diff
-**Relay payloads are not end-to-end encrypted today.** The `EncryptedChannel` handshake is a
-stub (see below); the phone path that actually runs is authenticated JSON-RPC, not ciphertext.
+**Relay payloads are not end-to-end encrypted today.** There is no handshake channel in the tree
+(R-EXT-6 deleted the dead `EncryptedChannel`); the phone path that actually runs is authenticated
+JSON-RPC, not ciphertext.
@@
-  `TrustedPairing`, `RelayTrust` and the `EncryptedFrame` wire type, plus the unfinished
-  `EncryptedChannel` and `RelayClient`.
+  `TrustedPairing`, `RelayTrust` and the `EncryptedFrame` wire type, plus the unimplemented
+  `RelayClient`.
```

With those two hunks applied, gate 1 measures 0 and the packet's acceptance line is met. Nothing else in
the tree under `crates` mentions either symbol.

## Pre / post evidence (the packet's evidence pair)

Measured on the base commit (`17bac9d`) and on the final tree:

| Command | Pre | Post |
|---|---|---|
| `git grep -n "EncryptedChannel" -- crates \| wc -l` | **6** (4 × `src/lib.rs`, 2 × `README.md`) | **2** (2 × `README.md`) — target 0, **blocked** |
| `git grep -n "snow" -- crates Cargo.toml \| wc -l` | **5** (workspace pin, crate dep, `use snow`, 2 × `snow::Error`) | **0** (`git grep` exit **1**, no output) — **met** |
| `cargo tree -p warsha-remote \| grep -c snow` | **1** (`snow v0.9.6`) | **0** — **met** |
| `cargo test -p warsha-remote test_encrypted_channel_creation` | `1 passed; 34 filtered out` (exit 0) — the discrimination case | the name is gone from the tree |

## Gates (final tree, repo root of the worktree; the report commit after `d315a17` changes no code)

| # | Command | Exit | Measured |
|---|---|---|---|
| 1 | `git grep -n "EncryptedChannel" -- crates \| wc -l` | — | **2** (target 0) — README only, see above |
| 2 | `git grep -n "snow" -- crates Cargo.toml \| wc -l` | — | **0** (`git grep` itself exits 1) |
| 3 | `cargo fmt --all --check` | **0** | no diff |
| 4 | `cargo clippy -p warsha-remote -p warsha-relay --all-targets -- -D warnings` | **0** | `Finished` with no warning |
| 5 | `cargo test -p warsha-remote -p warsha-relay --all-targets` | **0** | 4 result blocks: **17 + 0 + 8 + 34 = 59 passed, 0 failed** |
| 6 | `cargo tree -p warsha-remote \| grep -c snow` | tree exit 0 | **0** |
| 7 | `cargo deny check` | **0** | `advisories ok, bans ok, licenses ok, sources ok` |
| 8 | `node scripts/check-engineering-policy.mjs` | **0** | `policy: 8 checks, 0 failures` |
| 9 | `node scripts/check-wire-contract.mjs` | **0** | `wire: 11 checks, 0 violations` (no surface change) |

`cargo check --locked -p warsha-remote` also exits **0**, so the committed `Cargo.lock` is consistent.

`cargo fmt --all --check` failed once (exit 1) mid-run: the deletion left `Self {\n url,\n device_id,\n }`
in `RelayClient::new`, which rustfmt wants on one line. `cargo fmt --all` was applied to that file only
(the check named no other file) and the gate re-ran at exit 0. That is the whole of the 1 insertion in
the `src/lib.rs` diff.

## Deletion inventory and the keep-or-drop calls (packet step 2)

| Item | Decision | Why (grep on the final tree) |
|---|---|---|
| `use snow::{NoiseParams, Builder, HandshakeState, TransportState}` | removed | all four names occur only inside the deleted block |
| `NOISE_PARAMS` | removed | its only reader was the deleted `initiate`/`respond` |
| `EncryptedChannel` + impl + `complete_handshake` | removed | nothing but its own test constructed it |
| `RelayClient::channel` field + `Arc::new(Mutex::new(None))` | removed | its type no longer exists; no other reader |
| `test_encrypted_channel_creation` | removed | the packet names it; it asserted a device id on a channel that never handshook |
| `RemoteError::Crypto` | **kept** | still used by `DeviceIdentity::generate` (l.95) and `PairingData::new` (l.145) |
| `RemoteError::Handshake` | **kept** | still used by `RelayClient::credential` (l.605, l.611) |
| `Arc`, `Mutex`, `OsRng`, `PublicKey`, `StaticSecret` | **kept** | `DeviceRegistry` (`Arc<Mutex<HashMap<…>>>`), `DeviceIdentity::generate`, pairing |
| `x25519-dalek`, `EncryptedFrame`, `RelayClient`, `warsha-relay`, pairing/trust | **untouched** | per frozen design §5 |
| `SECURITY.md` | **untouched** | D3: lines 169–181 already say the handshake is "not built", "run it behind HTTPS or a tunnel you control", "no live encrypted channel" — after the deletion the doc is true as written; no line implied a channel that now needs correcting |
| `snow` in `Cargo.toml` (workspace + crate) | removed | `git grep` showed no other user after the lib.rs change |
| `Cargo.lock` | regenerated by cargo | D2: loses `snow` and its orphaned subtree (`aes-gcm`, `aes 0.8.4`, `blake2`, `ctr`, `ghash`, `polyval`); the surviving `aes 0.7.5` dependency entry drops its version disambiguation (`"aes 0.7.5"` → `"aes"`). Lock-only, no version movement. |

Test-count check for D1 (no behaviour change): `warsha-remote` had 35 unit tests before (`1 passed; 34
filtered out`) and has 34 now — exactly the one deleted test, no other test lost, none rewritten. The
`warsha-relay` suites are byte-identical (`git diff --name-only` touches no relay file) and pass: 17 lib
cases + 0 in `src/main.rs` + 8 in `tests/relay_endpoints.rs`. The wire gate still reports 11 checks / 0
violations.

## What is true about the remote path now

`EncryptedChannel` is gone, so there is no longer any type in the tree that could be mistaken for an
end-to-end channel; `EncryptedFrame` is still forwarded by `crates/warsha-relay` under bearer
authentication with no key to decrypt it, and `RelayClient` is still the documented stub. State remains
**LAN/TLS only** (D-EXT-2 default). "The relay only sees ciphertext" stays a design goal, not today's
behaviour — exactly what `SECURITY.md:169-181` says.

## Out-of-scope observations (not touched, for the PM)

- `docs/src/architecture.md:51` — the `warsha-remote` row still says "`EncryptedChannel` exists but its
  handshake is a stub". This change makes it a dangling reference. Outside the gate scope
  (`-- crates Cargo.toml`) and outside the allowed files.
- `PROGRESS.md:724` and `DECISIONS.md:1287` also name `EncryptedChannel`; both are the PM's to update at
  merge, and both were left alone per the dispatch instruction.
- `packages/crypto` (TypeScript) has its own unrelated `EncryptedChannel` class
  (`packages/crypto/src/index.ts:260`) with its own tests. Different language, different code, out of
  scope; the gate scopes to `crates` so it is not counted.
- `apps/desktop/src-tauri/Cargo.lock` still contains `snow`. That directory declares its own
  `[workspace]` and is deliberately not a member of the root workspace, so it resolves independently;
  the root-pin removal does not reach it. Left untouched (it is not in the allowed files).

## Verification limits

- Gates 1–9 above were each run on `d315a17`; nothing outside `warsha-remote`/`warsha-relay` was built or
  tested (`cargo test` was not run workspace-wide, matching the packet's gate list).
- `cargo deny check` prints one `warning[advisory-not-detected]` for `RUSTSEC-2024-0370`
  (`proc-macro-error` via tauri → gtk) which the root workspace graph does not contain. Verified
  pre-existing: the same single warning and the same `advisories ok, bans ok, licenses ok, sources ok`
  verdict at base `17bac9d` in a throwaway detached worktree. Unrelated to this change.
- No `git grep` line matched `snow` anywhere outside `docs/`, `*.md` and `apps/` after the change, so the
  removal did not leave a code reference behind.
- `OD-EXT6-a` (real Noise handshake) untouched: not scheduled, own program, per the packet.
