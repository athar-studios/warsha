# Packet K3 Re-Review (repair round) — independent reviewer

- Run: `2026-11-10-keel` · Packet: K3 · Role: REVIEWER (worktree read-only)
- Worktree: `C:/Users/Dragonfly/Downloads/warsha-wt/keel/k3` (branch `run/2026-11-10-keel/k3-no-fakes`)
- Base `e6b3e6d` → Head `bc157e1` — **unchanged since the prior review**; `git status --short` clean, so the product delta reviewed here is byte-identical to `review.md`.
- EV: `C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-10-keel`
- Re-review date: 2026-11-10 · Scope: judge the orchestrator's verifier-tooling repairs (F1, F2), re-confirm the four honesty fixes, dispose of F3.

## Verdict: **APPROVE (LOW note on F3)** — zero blockers

F1 and F2 are fixed in the EV tooling (not product code) and both fixes are proven non-vacuous end-to-end below. The four honesty fixes still hold in the unchanged delta. The only remaining product nit is F3, a stale comment — comment-only, no behavioral impact — dispositioned as LOW (reword text provided; can ride along with the next packet touching `warshad/src/lib.rs`). F4 remains an out-of-packet observation (unchanged, pre-existing at base).

## Tool-fix confirmation

### F1 — `tools/k3-mock-scan.sh` fixed and NON-VACUOUS (was: scanned 0 files)

`bash EV/tools/k3-mock-scan.sh` → verbatim output:

```
no production MockRoutineRunner
K3.2 exit=0
```

Matches acceptance K3.2 (`exit 0; line 'no production MockRoutineRunner'`). Why it is no longer vacuous:

- Pathspecs are now literal and live: `crates/warsha-pipeline/src crates/warsha-core/src crates/warshad/src ':(exclude)**/tests/**'` → **56 files matched** (the old `'crates/*/src'` matched 0).
- Raw hits under those pathspecs: **12**, all in `crates/warsha-pipeline/src/routines.rs`; minimum hit line **586**, first `#[cfg(test)]` in that file at **578** → all 12 are correctly classified test-only (the classifier drops each file's hits from its first `#[cfg(test)]` onward — the old line-filter would have false-failed).
- **Control A (clone of `bc157e1`, unmodified):** `no production MockRoutineRunner`, exit **0**.
- **Control B (same clone, one synthetic `MockRoutineRunner` line injected at line 50, i.e. before `cfg(test)`):** tool prints `crates/warsha-pipeline/src/routines.rs:50:// control-injection MockRoutineRunner (must be flagged)` + `k3-mock-scan: production MockRoutineRunner found`, exit **1**.
  → The tool discriminates: clean tree passes, a production hit fails. Not a rubber stamp.

### F2 — `tools/scope.sh` has a K3 case (was: exit 2)

`bash EV/tools/scope.sh K3` → verbatim output:

```
scope-ok K3: 11 files
scope exit=0
```

- Case `K3`: base `e6b3e6debd23ceb27f6547a483af5392a5faaaaf`, head `bc157e1`, worktree `warsha-wt/keel/k3` (overridable via `KEEL_WORKTREE`).
- Allowlist: `crates/warsha-pipeline/*`, `crates/warshad/src/lib.rs`, `crates/warshad/src/wave2.rs`, `crates/warshad/tests/*`.
- Non-vacuous: `n=11` equals the full `git diff --name-only e6b3e6d..bc157e1` count (11 files); an empty allowlist would have reported `scope-fail K3: 11 files outside allowed globs`. `bad=0`.

## Four honesty fixes re-confirmed (delta unchanged; spot-checked in tree)

1. **Unrouted role honest** — `PipelineError::NoProviderRouted(Role)` (`warsha-pipeline/src/lib.rs:198`); `dispatch_chat` returns it at :802; failure path emits `EventKind::Error` `"action": "provider_required"` (:852) → `Paused`, no fabricated answer.
2. **No production MockRoutineRunner** — `UnavailableRoutineRunner` in production (`routines.rs:173`, explicit refusal); `MockRoutineRunner` confined to `#[cfg(test)]` (first use :586); **zero** `MockRoutineRunner` occurrences in `crates/warshad/src/lib.rs` (e2e tests use `UnavailableRoutineRunner`).
3. **Scout honest** — `trait ScoutRegistryClient` (`scout.rs:117`); production client returns `Err(ScoutError::CatalogUnavailable(...))` (:144); `FixtureRegistryClient` test-only; all four remote sources go through the seam.
4. **Health probes real** — `DaemonState::probe_capabilities` (`warshad/src/lib.rs:1199`, store/settings/keychain probes); `HealthResponse.capabilities` (:1766) wired into both RPC and HTTP handlers; not a constant.

Re-run gates (head unchanged, all as frozen): K3.1 `git grep …` → **exit 1, no output** (PASS); K3.3 `status_truth::` 6 passed; K3.4 `provider_truth::` 4 passed; K3.5 1 passed; STD.1 fmt clean — per `review.md` measurements, unchanged delta.

## F3 disposition — LOW (only remaining product nit)

- **Still present:** `crates/warshad/src/lib.rs:5485-5487` — *"W5's deterministic fake provider: unrouted pipeline stages already answer through it inside the pipeline's dispatch, and registering it here makes it … routable …"*. Post-K3 this is false: unrouted stages now get `NoProviderRouted` unless the owner explicitly sets `WARSHA_LLM_PROVIDER=fake`.
- **Why LOW:** comment-only; behavior is correct and gated. No test, gate, or runtime impact.
- **Disposition:** **APPROVE with a LOW note** (no repair round required). Suggested one-liner for the next packet that touches this file:
  `// W5's deterministic fake provider: only answers when the owner explicitly routes to it (WARSHA_LLM_PROVIDER=fake); unrouted stages now fail with NoProviderRouted.`

## F4 (out of packet, unchanged)

Daemon startup still registers `MockProvider` ("Register mock provider for testing", `warshad/src/lib.rs:5478`); `git diff e6b3e6d..bc157e1` contains **0** `MockProvider` lines → pre-existing at base, untouched by K3, only answers when explicitly routed. Carry forward as before.

## Blockers

None.
