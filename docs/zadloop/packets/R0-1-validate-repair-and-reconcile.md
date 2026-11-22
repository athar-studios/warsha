# R0-1 — Validate the CSP repair commit `da7732c` and reconcile the four CSP files

- Packet id: `R0-1`
- Lane: R0-FIX (CSP repair after the bad merge `f474776`)
- Logical change: **one** — make `repair/dev-csp-f474776` provably equal to `dev` plus the CSP delta,
  with no other drift, so it can replace `f474776` on `dev`.
- Owning role: implementer (validation + reconciliation). Reviewer and verifier are separate roles.

## Goal

Prove, by content hash and by a read-only verification build, that `da7732c` restores the `dev`
(`f0920e9`) tree and adds only the security/CSP delta — and that the delta is complete and coherent:

1. `crates/warshad/src/lib.rs` is `f0920e9`'s file plus exactly five CSP hunks (the `HeaderValue`
   import, the CSP/`nosniff`/`X-Frame-Options` response middleware, its `.layer(...)` registration, the
   Windows token-file ACL `restrict_file_to_owner`, and its call in `write_private_file`).
2. `apps/desktop/src-tauri/tauri.conf.json` carries no `'unsafe-inline'`/`'unsafe-eval'` in
   `script-src`/`style-src`, keeps `default-src 'self' data: blob:`, keeps `object-src 'none';
   base-uri 'self'; frame-ancestors 'none'`, and keeps loopback **wildcard** ports
   (`http://127.0.0.1:*`, `ws://127.0.0.1:*`, `http://localhost:*`, `ws://localhost:*`) plus
   `ipc: http://ipc.localhost`.
3. `apps/remote/index.html` declares the same policy string warshad sends as a header, adds
   `font-src 'self'`, and carries **no** `fonts.googleapis.com` / `fonts.gstatic.com` reference.
4. `crates/warshad/Cargo.toml` adds the `windows` feature `Win32_Security_Authorization` (needed by
   `SetNamedSecurityInfoW`, `InitializeAcl`, `AddAccessAllowedAce`) and nothing else.

Then reconcile: the working checkout's four CSP files must either already equal `da7732c` or be a
deliberate superset. Anything else is reported, never merged.

## File targets

Allowed writes (nothing else):

- `docs/zadloop/packets/R0-1-report.md` (new file: the reconciliation record, hashes and gate output)
- `PROGRESS.md` (append one run entry, per `AGENTS.md`)
- `DECISIONS.md` (append one entry only if a reconciliation decision had to be made)

Allowed — and expected to be *byte-copied*, not edited — from `da7732c`:

- `crates/warshad/src/lib.rs`
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/remote/index.html`
- `crates/warshad/Cargo.toml`

Allowed by provenance (already in `da7732c`): `COMPLETION_CHECKLIST.md`, `DECISIONS.md`, `PROGRESS.md`.
Those carry the original CSP-branch docs and may not be edited to make a gate pass.

## Out of scope

- Any other file. Any refactor, reformat or "while I'm here" edit in `lib.rs`, the Tauri config, the
  remote `index.html` or `Cargo.toml`.
- Widening the CSP (adding a third-party origin, re-adding `'unsafe-inline'` to `script-src`, replacing
  the loopback wildcards with fixed ports). Owner decision OD-U2 = A and the repair commit's recorded
  reasoning (`DECISIONS.md` 2026-11-13) fix the end state.
- `main`/`dev` history. No force-push, no rebase of published branches, no `git reset --hard`, no deletion
  of `f474776` or of any worktree (`ENGINEERING_POLICY.md` §6; `AGENTS.md`).
- Dependency updates, Renovate, CI workflow content, lint debt — those belong to `R0-2` and `R0-3`.
- Re-splitting `warshad/src/lib.rs` (that is ENGINE H1, a different milestone).

## Inputs and measured facts (do not re-derive by argument; these are the hashes)

```text
f0920e9  dev == security/csp-fixes, 12197 lines in crates/warshad/src/lib.rs
467594a  the security branch commit; its tree (3244827…) is what f474776 merged
f474776  merge commit, tree 3244827… — identical to 467594a; lib.rs 8997 lines (a main-based copy)
da7732c  repair: one commit on f474776; lib.rs 12330 lines
         git diff --stat f0920e9..da7732c -- <the four CSP files>  => only these 4 files
```

Per-file content hashes at `da7732c` (sha256 prefix, recorded so a copy can be proven, not argued):

```text
apps/desktop/src-tauri/tauri.conf.json   fecb1396a82c
apps/remote/index.html                   8ab3fefa9348
crates/warshad/Cargo.toml                5c581c3df2f9
crates/warshad/src/lib.rs                1b5a7b9aa503
```

### Uncommitted work found in the shared checkout during this pass (owner or a parallel session)

At the start of this planner pass, `git status --porcelain=v1` in `/home/moe/Downloads/Warsha`
(`security/csp-fixes @ f0920e9`) was empty. By the end of the pass the same checkout showed exactly the
four files this packet names, uncommitted, and they are **not** `da7732c`'s content:

| File | Worktree sha256 | `da7732c` sha256 | What the worktree holds |
| --- | --- | --- | --- |
| `apps/desktop/src-tauri/tauri.conf.json` | `866c13c872d0` | `fecb1396a82c` | CSP **with** `object-src`/`base-uri`/`frame-ancestors` (good) but with **fixed** `127.0.0.1:8765` / `ws://127.0.0.1:8766` / `localhost` ports (the repair deliberately kept wildcards); plus unrelated JSON reformatting (`\u00a9`, `\u0648\u0631\u0634\u0629`, wrapped `depends` array) |
| `apps/remote/index.html` | `290c6664d4a2` | `8ab3fefa9348` | meta CSP added, but **without** `font-src 'self'`, **without** the Google-Fonts removal, and string **not** identical to warshad's header |
| `crates/warshad/Cargo.toml` | `5c581c3df2f9` | `5c581c3df2f9` | identical — `Win32_Security_Authorization` present |
| `crates/warshad/src/lib.rs` | `1dc8055a9fdc` | `1b5a7b9aa503` | 12216 lines: `HeaderValue` import **and** the CSP middleware only. The `.layer(csp_middleware)` registration, the `#[cfg(windows)] fn restrict_file_to_owner` ACL and its call in `write_private_file` are **absent**, and the middleware's policy string is the older `default-src 'self'; script-src 'self'; …` form |

This is an overlapping-write conflict, not something to reconcile: the owner (or a parallel session) is
editing the same four files toward a *different* end state, and `lib.rs` there would leave the CSP
middleware constructed but never layered and the Windows token-file DACL missing. The rule is
`AGENTS.md` / worktree discipline — a change made by someone else is kept and reported, never reverted,
overwritten or stashed. **`R0-1` must not copy `da7732c`'s blobs over these files without the owner's
explicit choice between the two end states** (loopback wildcards + ACL + layering, as in `da7732c`, versus
fixed ports + no ACL). The packet's job is to surface the choice with the diff and the hashes above, then
proceed only on the owner's word; if the owner picks `da7732c`, the copy goes to a *new* branch/worktree
and the shared checkout is left as it is until the owner commits or discards its own work.

Note the standing hazard: `f474776` contains no commit of its own; reverting it naively or merging `dev`
back into a working branch can re-introduce the 8997-line `lib.rs`. Every step that moves content
re-checks `git rev-parse <ref>:crates/warshad/src/lib.rs` lines before trusting it.

## Steps

1. Snapshot the starting state, in a dedicated worktree on this branch (never in the shared checkout):

   ```bash
   git rev-parse --abbrev-ref HEAD
   git status --porcelain=v1
   git log --oneline -3
   for r in f0920e9 f474776 da7732c; do
     printf '%-9s ' "$r"; git show "$r:crates/warshad/src/lib.rs" | wc -l
   done
   ```

2. Confirm tree equality between the merge and its side branch, and the full file set of the repair:

   ```bash
   git rev-parse 467594a^{tree} f474776^{tree}
   git diff --name-status f0920e9 da7732c
   git diff --stat f0920e9 da7732c -- crates/warshad/src/lib.rs apps/desktop/src-tauri/tauri.conf.json apps/remote/index.html crates/warshad/Cargo.toml
   ```

   Expected: the two tree ids are identical; `--name-status` lists `COMPLETION_CHECKLIST.md`,
   `DECISIONS.md`, `PROGRESS.md`, the three CSP files and `lib.rs`; the four-file stat shows
   `lib.rs | 137 ++++++++++…`, 150 insertions / 4 deletions in total.

3. Inspect the five `lib.rs` hunks and nothing else:

   ```bash
   git diff f0920e9 da7732c -- crates/warshad/src/lib.rs
   ```

   Expect exactly: `HeaderMap, HeaderValue` in the axum import, `let csp_middleware = tower::ServiceBuilder::new()…`
   inserted before the auth middleware, `.layer(csp_middleware)` above `.layer(auth_middleware)`,
   `#[cfg(windows)] fn restrict_file_to_owner`, and the two-line `#[cfg(windows)]` call inside
   `write_private_file`. Any additional hunk means the copy is not a copy: stop and report.

4. Reconcile the working checkout's four CSP files. For each of the four, compare the working file's
   content hash with the `da7732c` hash listed above. If a file differs **and** `git status` shows it as
   uncommitted, **stop**: an uncommitted edit by the owner or another session is theirs
   (`AGENTS.md`, worktree rules) — report the path, the diff hunks that overlap this packet, and the two
   hashes, and let the owner choose. Do not overwrite, do not `git checkout --`, do not stash.
   The conflict recorded under "Uncommitted work found in the shared checkout" above is the live case: the
   run reports it and waits for the owner's pick, it does not merge the two end states by hand.
   If the working tree is clean at `f0920e9` (as it was when this pass started), no reconciliation is
   needed: record "nothing to reconcile, four files identical to base, `da7732c` is the sole carrier of
   the delta".

5. Prove the four files at `da7732c` are the intended end state, by content, at these exact strings:

   ```bash
   git show da7732c:apps/desktop/src-tauri/tauri.conf.json | grep -o '"csp": *"[^"]*"'
   git show da7732c:apps/remote/index.html | grep -o 'Content-Security-Policy" content="[^"]*"'
   git show da7732c:apps/remote/index.html | grep -c 'fonts\.\(googleapis\|gstatic\)\.com'
   git show da7732c:crates/warshad/Cargo.toml | grep -n 'Win32_Security_Authorization'
   ```

   Expected: the Tauri string has no `unsafe-inline`/`unsafe-eval`; the remote meta string is
   byte-identical to the header literal in `lib.rs` (compare with
   `git show da7732c:crates/warshad/src/lib.rs | grep -o '"default-src .self. data: blob:; script-src[^"]*"' | head -1`);
   the Google-Fonts count is `0`; the Cargo.toml line exists once. Both were measured during this pass:
   the meta string and the header literal are identical byte for byte, and the Google-Fonts count is `0`.

6. Read-only verification build (no `--release`, no network to model providers, no publishing):

   ```bash
   cargo check -p warshad
   cargo check --workspace
   cargo clippy -p warshad --all-targets -- -D warnings
   cargo fmt --all --check
   ```

   `da7732c`'s own message records these as exit 0 at the repair commit; this packet re-earns that
   evidence on the commit that will actually be proposed, and writes the output to
   `docs/zadloop/packets/R0-1-report.md`.

7. Report and hand over: `R0-1-report.md` states (a) the hashes, (b) whether reconciliation was needed,
   (c) every gate's exit code, (d) the recommended disposition — "replace `f474776` on `dev` with the
   `da7732c` tree under owner approval" — and nothing else. **No push, no merge, no branch deletion.**

## Acceptance commands (exact)

| # | Command | Expected |
| --- | --- | --- |
| A1 | `git rev-parse 467594a^{tree} f474776^{tree}` | both ids `324482701dec1d2ba0310450898e0acf67a662de` |
| A2 | `git show da7732c:crates/warshad/src/lib.rs \| wc -l` | `12330` |
| A3 | `git diff --stat f0920e9..da7732c -- crates/warshad/src/lib.rs apps/desktop/src-tauri/tauri.conf.json apps/remote/index.html crates/warshad/Cargo.toml \| head -n 20` | exactly 4 files, `150 insertions(+), 4 deletions(-)` |
| A4 | `git diff --name-only f0920e9..da7732c \| sort` | the 7 paths listed in step 2, no more |
| A5 | `git diff f0920e9 da7732c -- crates/warshad/src/lib.rs \| grep -c '^@@'` | `5` hunks, and the same diff's `grep -c '^+'` is `136` (135 code lines + the `+++ b/…` header) |
| A6 | `git show da7732c:apps/remote/index.html \| grep -c "fonts\.\(googleapis\|gstatic\)\.com"` | `0` (grep exits 1 on zero matches — assert the count, not the exit code) |
| A7 | `git show da7732c:apps/desktop/src-tauri/tauri.conf.json \| grep -c "unsafe-inline\|unsafe-eval"` | `0` |
| A8 | `git show da7732c:crates/warshad/src/lib.rs \| grep -c "Content-Security-Policy"` | `2` (line 6312 the comment, line 6325 the `insert`) |
| A9 | `git show da7732c:crates/warshad/Cargo.toml \| grep -c "Win32_Security_Authorization"` | `1` |
| A10 | `cargo check -p warshad` | exit 0 |
| A11 | `cargo check --workspace` | exit 0 |
| A12 | `cargo clippy -p warshad --all-targets -- -D warnings` | exit 0 |
| A13 | `cargo fmt --all --check` | exit 0 |
| A14 | `git status --porcelain=v1` | only this packet's `docs/zadloop/packets/R0-1-report.md`, `PROGRESS.md`, optional `DECISIONS.md` |
| A15 | `node scripts/check-arch.mjs` | `arch: 5 rules, 0 violations`, exit 0 |
| A16 | `gitleaks detect --source . --config .gitleaks.toml --no-banner --redact --exit-code 1` | `no leaks found`, exit 0 |

A10–A13 are read-only with respect to tracked content (`target/` is gitignored); they still write to
`target/`, which is expected and allowed.

## Constraints

- No `unwrap()`/`expect()` in non-test code; `thiserror`/`anyhow` for errors (`AGENTS.md`). The packet
  adds no new code — it must not create any.
- No secrets in the report, the log or the commit message; the token-file ACL work touches owner tokens,
  so never quote a token value, a SID or an ACL dump.
- Licences and public wording: if a report or doc line describes the licence, use **"free and
  source-available"** — never "open source".
- No network calls to real model providers in any test; the mock provider is the only one used.
- Never force-push `main` or `dev`; never delete or move a worktree; never publish or create a release.
- i18n: this packet adds no user-visible string. If a report ends up in a UI surface (it must not), the
  string has to go through the `ar` + `en` catalogs and stay RTL-safe (logical properties).
- Evidence, not prose: a claim of "exit 0" needs the captured command output beside it
  (`ENGINEERING_POLICY.md` §4).
- `crates/warshad/src/lib.rs` is the contended file for this whole program: this packet is the **only**
  one in the R0 set that may move it, and only by copying `da7732c`'s blob verbatim.

## Definition of done

A1–A16 all pass with captured output; `R0-1-report.md` records the disposition; `PROGRESS.md` carries the
run entry; nothing is pushed, merged, reverted or stashed.
