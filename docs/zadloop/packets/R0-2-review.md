# R0-2 independent review — CHANGES-REQUIRED (Reviewer lane)

- Packet: `R0-2` (baseline green) · Reviewed range: `57d8de3..78e4429` (branch `zl-r0-2-gates`)
- Reviewer: Reviewer lane (independent of the Coder author), read-only, nothing edited
- Method: the step's `run:` block was extracted and executed end-to-end with a local tarball + fake `cargo-deny 0.20.2` under matched environments (GNU coreutils/GNU tar; real busybox 1.37 `sha256sum`; a no-check shim; a bsdtar-like `tar`; a backslash-bearing `RUNNER_TEMP`).
- Verdict: **CHANGES-REQUIRED** — the security gate is not weakened, but the macOS half of the fix cannot work as written, and the report claims both causes fixed on evidence that does not exercise the real failing form.

## Findings

| file:line | severity | issue | proposed minimal fix |
|---|---|---|---|
| `.github/workflows/ci.yml:176-178` + `:197` | **HIGH** | The capability probe exercises `sha256sum -c` but the verifier it stores is `sha256sum --check` — probe and use are different invocations. The macOS image's `sha256sum` accepts `c` (its logged usage line is `sha256sum [-bctwz] [files ...]`) and rejects the long form — that usage error is the old failure. The probe passes and the real check then dies on `--check`, in the shape of a tampering alarm. Reproduced with real busybox 1.37 (`-c` verifies, `--check` = unrecognized option, exit 1). | `checksum_verify=(sha256sum -c)`, or index the probe off `"${checksum_verify[@]}"` so the two forms cannot drift. |
| `.github/workflows/ci.yml:156` | **MEDIUM** | `good_sha` is taken with `cut -d' ' -f1` from a line whose file name contains backslashes on Windows (`RUNNER_TEMP=D:\a\_temp`); coreutils/shasum prefix the digest with `\` (documented by the step's own comment). The probe lines inherited the escape marker, GNU sha256sum rejects them, and the selection flips to `shasum` — fail-closed, but the Windows leg then depends on perl `shasum` the base version did not need. | Strip the escape prefix (`good_sha="${good_sha#\\}"`) or hash via stdin (`sha256sum < file`), which emits no file name and so no escaping. |
| `docs/zadloop/packets/R0-2-report.md:121-122` | LOW | Cause 3's diagnosis is wrong ("no check mode; `-c FILE` does not verify"). The quoted usage string lists `c`, and every md5sum-family implementation treats `c` as check (busybox proven); the usage error came from `--check`. | Rewrite: the image accepts `-c` but not `--check`; probe and production must use the same form. |
| `docs/zadloop/packets/R0-2-report.md:207` | LOW | The macOS matrix row's "faithful shim (`-c` hashes instead of verifying)" claim is not supported — no implementation in that family behaves that way. | Mark hypothetical, or re-run with a shim that supports `-c` and rejects long options. |
| `docs/zadloop/packets/R0-2-report.md:6,231,298-304` | LOW | "Report written at `01d3401` (the only commit)" / "No other file changed" — the range has two commits. | Say two commits: `01d3401` (workflow) + `78e4429` (report). |
| `docs/zadloop/packets/R0-2-report.md:17` vs `:200` | LOW | "three simulated runner environments" vs "four environments". | Pick one count. |
| `docs/zadloop/packets/R0-2-report.md:118-119` | LOW | "all four assets" vs five pinned digests in `ci.yml:82-88`. | Correct to five (or name which four). |

## Checklist answers (from the reviewer)

- **Verification strength**: no path accepts a tampered archive — real verification always compares `${expected_sha}` (`ci.yml:197`, `:203`), never a probe digest; the `tr '0-9a-f' '1a-f0'` rotation differs in every hex digit so no collision can satisfy it; an empty `good_sha` fails both probes into the loud branch.
- **Fail-closed**: yes in every branch — no `|| true`, no `continue-on-error`, no swallowed error; probe failure, wrong digest, missing archive and unsupported triple all exit non-zero.
- **Tar fix**: sound — `tar --force-local --version` is a real GNU-only capability check (bsdtar lists no such option, so macOS takes the fallback); the `cd`+basename subshell fails fatally under `set -e`; `-xzf … -C "${bindir}" --strip-components=1` unchanged; both the `D:` remote-host failure and `--force-local` success were reproduced; no extraction escape; extraction still follows a pinned-digest check.
- **Structure**: deep YAML comparison shows exactly one changed leaf, `.jobs.rust.steps[5].run` — 6 jobs, matrix, `runs-on`, `continue-on-error: false`, `permissions` and all five pinned digests identical; no new URL, secret or token in any added line.

## Limits

No macOS/Windows runner (the macOS conclusion rests on the logged usage string plus a faithful busybox reproduction); `actionlint` not installed (YAML parsed with PyYAML instead); `shasum` presence on the Windows image unverified (finding 2 stated conditionally).

## Disposition

A repair dispatch (Coder lane) applies the HIGH + MEDIUM fixes and the report corrections, then re-verifies with a faithful busybox-style shim; the repair is re-reviewed before any merge.

## Closure re-review (Reviewer lane, at `43c3271`) — APPROVE

The re-reviewer did not trust the implementer's shims: it re-ran the **shipped** step against real binaries on this host (GNU coreutils 9.12 via a flatpak runtime, busybox 1.37.0, uutils 0.10.0, perl shasum 6.04) with old-code controls.

- **HIGH closed**: probe and production both use `sha256sum -c` (a logging wrapper recorded the exact invocations — digest computation, probe-good, probe-bad, production, no other form); real busybox confirms `-c` verifies and `--check` is rejected; old code exits 1 on the busybox shape, new code exits 0.
- **MEDIUM closed**: escape marker stripped (`good_sha="${good_sha#\\}"`); Windows-shape control: old `good_sha` 65 chars with leading `\` → `file` branch, new 64 clean chars → `stdin` branch.
- **Escaping delta audited correct**: on GNU 9.12, marker + doubled-backslash name → OK; marker + unescaped name → rejected (`no properly formatted checksum lines found`); no marker + literal backslash name → OK — the implementer's justification is accurate, `verifies_stdin`'s direct `printf` is sound, and the escaped check file is accepted by both GNU and shasum 6.04.
- **Fail-closed everywhere**: tampered pins exit 1 on GNU/busybox/shasum branches; an always-exit-0 `sha256sum` is rejected by the wrong-digest probe; no `|| true`, no swallowed status.
- **Structural invariants at `43c3271` vs `57d8de3`**: exactly one changed leaf (`.jobs.rust.steps[5].run`), 6 jobs, 40 steps, job/step key sets identical, five pinned digests byte-identical, no new `continue-on-error`, no new URL/token/`secrets.` on any added line.
- All five prior LOW report items closed; two new LOW nits (scenario count "seven" vs eight table rows; stale `/usr/bin/gnusha256sum` path) — folded in by the PM at `bc5bb16` before merge; the reviewer stated they do not gate merge.
- Observations (no action): uutils 0.10.0 writes but rejects its own marker-escaped output on `-c` (the step is unaffected — probe rejects it, fail-closed); a both-verifiers-absent host exits 127 pre-existing since `01d3401`, unreachable on GitHub runners.

**Verdict: APPROVE** — merged as `98d337a` on `repair/dev-csp-f474776` after the PM folded the two LOW nits (`bc5bb16`). Limits: no macOS/Windows runner (macOS rests on real busybox 1.37.0 matching the logged usage string + GNU/uutils/shasum measurements; real runners come via the draft PR); actionlint not installed (PyYAML parse instead).
