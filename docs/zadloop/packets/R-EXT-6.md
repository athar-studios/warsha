# R-EXT-6 — RC1 remote channel truth: delete the dead `EncryptedChannel` + `snow`

Status: spec frozen. Base: `04847cf` (repair/dev-csp-f474776, R-EXT-5 merged + E2 fix). Planner lane
rate-limited (three 429 faults, no worker started); PM measured and froze directly from the run plan's
decided default. Pattern: R-BRIDGE-B5 / R-EXT-4.
**Rust: yes (deletion only). New RPC method: no. New wire field: no. New dependency: no (one removed).**

## Scope verdict (read first)

**BUILD the run plan's default (D-EXT-2): state "LAN/TLS only", delete the dead channel and `snow`.**
A real Noise handshake is a separate program, not this queue — the owner may ask for it, but this packet
does not design it.

## Why (measured at `04847cf`)

- **`EncryptedChannel` is dead by its own docs.** `crates/warsha-remote/src/lib.rs:584-601`: "An unfinished
  Noise XX channel. No handshake advances: `initiate` and `respond` build a handshake and discard it,
  `transport` therefore stays `None` … this channel encrypts and verifies nothing." `#[allow(dead_code)]`.
- **`snow` has exactly one user.** `git grep -n "snow" -- crates Cargo.toml`: workspace pin `Cargo.toml:45`
  (`snow = "0.9"`), `crates/warsha-remote/Cargo.toml:16`, and the `use snow::{…}` + two `snow::Error` maps in
  `crates/warsha-remote/src/lib.rs` (l.15, l.610, l.641). No other crate touches it.
- **The touch surface is small and closed.** Inside `lib.rs`: l.15 (`use snow`), l.80-81 (`NOISE_PARAMS`),
  l.584-700 (`EncryptedChannel` struct + impl + `complete_handshake`), l.712 (`channel` field on the
  unimplemented `RelayClient`), l.864 (`test_encrypted_channel_creation`). `RemoteError::Crypto` is still
  used by `DeviceIdentity::generate` (l.99) and `Handshake` stays for the relay's refusal paths — check at
  implementation time and drop only what is orphaned.
- **What stays.** `x25519-dalek` stays: device identity keys are real (`DeviceIdentity::generate` l.96-108,
  `static_public` in pairing). `EncryptedFrame` stays: the relay forwards it bearer-authenticated today.
  `RelayClient` stays (already documented unimplemented). `warsha-relay` stays untouched.
- **`SECURITY.md:169-181` already states LAN/TLS-only truth** ("not built", "run it behind HTTPS or a tunnel
  you control", "no live encrypted channel"). This packet makes the tree match the doc: after deletion the
  doc needs no change unless the implementer finds a line that still implies a channel exists (then it is a
  one-line doc fix inside the allowed files, reported not silently extended).
- **Not blocked behind R-UI-7b.** The 7b gap is the Android `@JavascriptInterface`/Keystore pairing boundary;
  this packet deletes dead Rust and changes no pairing flow, so it runs any time.

## Goal

`git grep -n "EncryptedChannel\|snow" -- crates Cargo.toml` prints nothing (exit 1); the workspace builds,
all gates green; `SECURITY.md` truth unchanged or tighter.

## Frozen design

Deletion only, in `crates/warsha-remote/src/lib.rs`:

1. Remove l.15 `use snow::{…}`; l.80-81 `NOISE_PARAMS`; the whole `EncryptedChannel` block (struct l.594-601
   + impl through l.700, exact range re-anchored at implementation time by item identity, not line numbers);
   the `channel: Arc<Mutex<Option<EncryptedChannel>>>` field (l.712) and its construction in `RelayClient::new`;
   `test_encrypted_channel_creation` (l.864).
2. Remove `snow = { workspace = true }` from `crates/warsha-remote/Cargo.toml:16` and `snow = "0.9"` from
   workspace `Cargo.toml:45` **iff** `git grep` shows no other user after step 1 (it should show none).
3. `RemoteError::Crypto` / `Handshake`: keep iff still referenced (generate + relay paths are); drop a variant
   only if the deletion orphans it, and only then.
4. `Mutex`/`Arc` imports: keep iff still used elsewhere in the file (the replay cache and RelayClient use them;
   verify, do not guess).
5. `x25519-dalek`, `EncryptedFrame`, `RelayClient`, `warsha-relay`, pairing/trust code: untouched.

Frozen decisions:

- **D1 (no behaviour change):** this packet deletes a struct nothing constructs (outside its own test). Any
  gate that changes behaviour beyond "dead code gone" stops and reports.
- **D2 (`Cargo.lock`):** removing `snow` from the graph changes `Cargo.lock`. That is expected and allowed;
  the gate is `cargo deny check` clean and `cargo tree -p warsha-remote` showing no `snow`, not "lock
  unchanged".
- **D3 (SECURITY.md):** read-only unless a line still implies a channel exists. The "not built" paragraph
  already covers the post-deletion world.

## Allowed files

- `crates/warsha-remote/src/lib.rs` (the deletion above only)
- `crates/warsha-remote/Cargo.toml`, `Cargo.toml`, `Cargo.lock` (snow removal only)
- `docs/zadloop/packets/R-EXT-6-report.md` (new)

**Not allowed** — needing one is a stop-and-report: `crates/warsha-relay/**`, pairing/trust code, `x25519`
lines, `EncryptedFrame`, `SECURITY.md` (beyond D3), any UI/TS, any new dependency.

## Out of scope

A real handshake (own program); relay encryption proofs; SSRF hardening (`mcp.connect` surface unchanged,
R-EXT-4 decision stands); TLS termination work; R-UI-7b; anything the relay forwards.

## Constraints

Isolated worktree, `zl-rext6-*` branch; small Conventional Commits; `cargo fmt`, `cargo clippy -D warnings`,
no `unwrap()` in non-test code (the deleted test goes away with the struct); no test weakening — the rest of
the remote/relay suites must pass unmodified; mock provider only; no secrets. No push, tag, or publish.

## Steps

1. Re-verify at the worktree base: the `git grep` lines from *Why*, `cargo tree -p warsha-remote | grep snow`.
2. Delete per the frozen design; keep-or-drop check for each shared item (error variants, imports).
3. Run the gates; write the report with the pre/post `git grep` (both must be shown: pre non-empty, post empty).

## Gates (exact commands; repo root)

```
git grep -n "EncryptedChannel" -- crates | wc -l          # pre: 4+; post: 0
git grep -n "snow" -- crates Cargo.toml | wc -l           # pre: 5+; post: 0
cargo fmt --all --check                                    # 0
cargo clippy -p warsha-remote -p warsha-relay --all-targets -- -D warnings   # 0
cargo test -p warsha-remote -p warsha-relay --all-targets  # 0 failures
cargo tree -p warsha-remote | grep -c snow                 # 0
cargo deny check                                           # clean
node scripts/check-engineering-policy.mjs                  # 8 checks, 0 failures
node scripts/check-wire-contract.mjs                        # wire: 11 checks, 0 violations (prove no surface change)
```

Discrimination: pre-deletion `cargo test -p warsha-remote test_encrypted_channel_creation` passes (it tests
nothing real); post-deletion the name is gone from the tree. That pair plus the pre/post `git grep` is the
evidence.

## Acceptance

- `git grep -n "EncryptedChannel\|snow" -- crates Cargo.toml` prints nothing.
- All gates above green; no other file changed (`git diff --name-only` shows only the allowed files).
- `SECURITY.md` still reads true (touched only if a line implied a channel).

## Open points

- **OD-EXT6-a** — Real Noise handshake. Default: not scheduled (own program with owner approval). Alternative
  rejected: designing it inside this deletion packet (different risk, different review).
