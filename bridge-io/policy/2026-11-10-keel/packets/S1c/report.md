# Packet S1c Report — libsqlite3-sys Advisory Resolution

- Run: `2026-11-10-keel`
- Packet: `S1c` (`libsqlite3-sys` advisory)
- Role: Implementer
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/keel/s1c`
- Branch: `run/2026-11-10-keel/s1c-libsqlite`
- Base commit: `128b59c08cbf5ddbe4de002528a50f451ea74296`
- Head commit: `128b59c08cbf5ddbe4de002528a50f451ea74296`
- Status: **REVERTED** (governed by `PROGRAM_PLAN.md` §7, `PACKETS.md` §S1c, and `state.json` revert rule)

---

## Executive Summary

The coordinated bump of `sqlx` (0.8 -> 0.9) and `rusqlite` (0.32 -> 0.41) was attempted to resolve advisory `RUSTSEC-2026-0459` in `libsqlite3-sys` (which requires `libsqlite3-sys >= 0.39.0`). The bump is blocked upstream by a mutually incompatible version constraint between `sqlx-sqlite 0.9.0` and `rusqlite 0.41.0`:

- `rusqlite 0.41.0` requires `libsqlite3-sys = "^0.39.0"`.
- `sqlx-sqlite 0.9.0` (latest published sqlx release on crates.io) explicitly hard-caps `libsqlite3-sys = ">=0.30.1, <0.38.0"`.
- Both crates link the native library `sqlite3` (`links = "sqlite3"`). Cargo forbids more than one version of a crate providing the same native library link.
- Every version in `sqlx-sqlite 0.9.0`'s permitted range (`<0.38.0`) is vulnerable to `RUSTSEC-2026-0459` (affected: `0.6.0` through `0.38.2`).
- Cargo dependency resolution fails with a hard conflict on `links = "sqlite3"`.

In accordance with run policy ("a failed dependency bump reverts that PACKET, never the run"), packet S1c was reverted and reset to base `128b59c08cbf5ddbe4de002528a50f451ea74296`.

---

## Detailed Root Cause Analysis

### 1. Target Bump Attempted
- Root `Cargo.toml`: bumped `sqlx` dependency from `0.8` to `0.9` (with features `["runtime-tokio", "sqlite", "migrate", "chrono", "uuid", "json"]`).
- `crates/warsha-store/Cargo.toml`: bumped `rusqlite` from `0.32` to `0.41` (features `["bundled"]`).

### 2. Dependency Resolution Failure
Cargo halts at metadata resolution:
```
error: failed to select a version for `libsqlite3-sys`.
    ... required by package `sqlx-sqlite v0.9.0`
    ... which satisfies dependency `sqlx-sqlite = "=0.9.0"` of package `sqlx v0.9.0`
    ... which satisfies dependency `sqlx = "^0.9"` of package `warsha-store v0.2.1`
versions that meet the requirements `>=0.30.1, <0.38.0` are: 0.30.1, 0.37.0, 0.36.0, 0.35.0, 0.34.0, 0.33.0, 0.32.0, 0.31.0

package `libsqlite3-sys` links to the native library `sqlite3`, but it conflicts with a previous package which links to `sqlite3` as well:
package `libsqlite3-sys v0.39.0`
    ... which satisfies dependency `libsqlite3-sys = "^0.39.0"` of package `rusqlite v0.41.0`
```

### 3. Verification of Standalone Upgrade
Even isolating `sqlx 0.9.0` without `rusqlite` fails when targeting the patched `libsqlite3-sys 0.39.0`:
```
error: failed to select a version for the requirement `libsqlite3-sys = ">=0.30.1, <0.38.0"`
candidate versions found which didn't match: 0.39.0
location searched: crates.io index
required by package `sqlx-sqlite v0.9.0`
```
Upstream `sqlx` has not published a patch release relaxing `<0.38.0`.

---

## Gate Measurements

| Gate | Check | Outcome | Note |
|---|---|---|---|
| S1c.1 | `cargo deny --manifest-path Cargo.toml --all-features check advisories` | FAILED | Blocked: bump cannot resolve; base exhibits RUSTSEC-2026-0459 |
| S1c.2 | `cargo deny --manifest-path apps/desktop/src-tauri/Cargo.toml --all-features check advisories` | FAILED | Blocked: cannot resolve new tree; base exhibits RUSTSEC-2026-0459 |
| S1c.3 | `cargo test -p warsha-store -p warsha-git` | BLOCKED | Compilation blocked under bump |
| S1c.4 | `cargo tree -i libsqlite3-sys --manifest-path Cargo.toml -e normal` | FAILED | Cannot lock `v0.39+` due to `sqlx-sqlite 0.9.0` `<0.38.0` limit |
| S1c.5 | `cargo check --workspace --all-targets` | FAILED | Cargo resolver failure (exit 101) |

---

## Action Taken

Per `PACKETS.md` §S1c ("revert the packet, not the run, on failure") and prompt instruction ("REVERT THE PACKET (git reset the packet branch to base / revert commits) and report — never the run"):
1. Working tree in `C:/Users/Dragonfly/Downloads/warsha-wt/keel/s1c` reset to base commit `128b59c08cbf5ddbe4de002528a50f451ea74296`.
2. No breaking commits preserved on branch `run/2026-11-10-keel/s1c-libsqlite`.
3. Upstream blocker documented for orchestration and security review.
