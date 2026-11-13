# R0-1 Evidence Report — validation of CSP repair commit `da7732c`

Worktree branch: `zl-r0-1-validate` at `da7732c`. No product code edits were made; this file is the only new file.

## (a) Measurements

Line counts (`git show <r>:crates/warshad/src/lib.rs | wc -l`):

- `f0920e9` → 12197 (expected 12197)
- `f474776` → 8997 (expected 8997)
- `da7732c` → 12330 (expected 12330)

Tree ids:

- `467594a^{tree}` → 324482701dec1d2ba0310450898e0acf67a662de
- `f474776^{tree}` → 324482701dec1d2ba0310450898e0acf67a662de
- Both equal: confirms the bad merge `f474776` adopted the side branch's whole tree.

File set (`git diff --name-only f0920e9..da7732c | sort`) → exactly 7 paths:

- COMPLETION_CHECKLIST.md
- DECISIONS.md
- PROGRESS.md
- apps/desktop/src-tauri/tauri.conf.json
- apps/remote/index.html
- crates/warshad/Cargo.toml
- crates/warshad/src/lib.rs

Diff stat for the 4 product files → 4 files changed, 150 insertions(+), 4 deletions(-).

5-hunk confirmation (`git diff f0920e9 da7732c -- crates/warshad/src/lib.rs | grep -c '^@@'` → 5):

1. `HeaderValue` added to the axum `http` import.
2. `csp_middleware` construction (map_response inserting Content-Security-Policy, X-Content-Type-Options, X-Frame-Options) before the auth middleware.
3. `.layer(csp_middleware)` above `.layer(auth_middleware)`.
4. `#[cfg(windows)] fn restrict_file_to_owner` (explicit owner-only DACL, inheritance removed).
5. `#[cfg(windows)] restrict_file_to_owner(&temporary)?` call inside `write_private_file`.

No additional hunk: `grep -c '^@@'` printed 5 and the full diff shows only these five hunks.

CSP byte-identity: the remote meta CSP string was extracted from `apps/remote/index.html` (sed between `content="` and the closing `"`) and the `csp_value` literal from `crates/warshad/src/lib.rs` (sed between `let csp_value = "` and the closing `"`); string comparison plus `cmp` of the two via process substitution both report identical (301 chars).

## (b) Gate table

| Command | Exit | Key output |
|---|---|---|
| `git rev-parse 467594a^{tree} f474776^{tree}` | 0 | both `324482701dec1d2ba0310450898e0acf67a662de` |
| `git show da7732c:crates/warshad/src/lib.rs \| wc -l` | 0 | `12330` |
| `git diff --stat f0920e9..da7732c -- <4 product files>` | 0 | `4 files changed, 150 insertions(+), 4 deletions(-)` |
| `git diff --name-only f0920e9..da7732c \| sort` | 0 | the 7 paths above, no more |
| `git diff f0920e9 da7732c -- crates/warshad/src/lib.rs \| grep -c '^@@'` | 0 | `5` |
| `git show da7732c:apps/remote/index.html \| grep -c 'fonts\.\(googleapis\|gstatic\)\.com'` | 1 (grep: zero matches) | `0` (count asserted, not the exit code) |
| `git show da7732c:apps/desktop/src-tauri/tauri.conf.json \| grep -c "unsafe-inline\|unsafe-eval"` | 1 (grep: zero matches) | `0` |
| `git show da7732c:crates/warshad/src/lib.rs \| grep -c "Content-Security-Policy"` | 0 | `2` |
| `git show da7732c:crates/warshad/Cargo.toml \| grep -c "Win32_Security_Authorization"` | 0 | `1` |
| `cargo check -p warshad` | 0 | `Finished dev profile` |
| `cargo check --workspace` | 0 | `Finished dev profile` |
| `cargo clippy -p warshad --all-targets -- -D warnings` | 0 | `Finished dev profile`, no warnings |
| `cargo fmt --all --check` | 0 | no diff output |
| `node scripts/check-arch.mjs` | 0 | `arch: 5 rules, 0 violations` |
| `gitleaks detect --source . --config .gitleaks.toml --no-banner --redact --exit-code 1` | 0 | `no leaks found` (367 commits scanned) |
| `ls docs/zadloop/packets/R0-1-report.md` | 0 | exists (this file) |

Note on the two `grep -c` gates above: `grep` exits 1 when the count is zero, so the asserted value is the printed count (`0`), not the exit code.

## (c) Disposition

replace f474776 on dev with the da7732c tree under owner approval

## (d) Findings

None. All success-command expectations met; the lib.rs delta contains exactly the 5 expected hunks; the remote meta CSP string and the `csp_value` literal are byte-identical; no cargo network errors occurred (all build gates ran); no secrets were printed.
