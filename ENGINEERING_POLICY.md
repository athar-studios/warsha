# ENGINEERING_POLICY.md — Warsha engineering operating policy · سياسة العمل الهندسي

Binding for every agent (AI or human) doing engineering work in this repository, including any
worker an agent dispatches. This policy **supplements** `AGENTS.md`; it never loosens it. If this
file, `SECURITY.md`, `docs/ARCH_RULES.md` or a `DECISIONS.md` owner decision conflicts with a rule
here, the stricter rule wins and the conflict is logged in `DECISIONS.md`.

Arabic-first is unchanged: any user-visible string produced by any phase still ships only through
the i18n catalogs (ar + en) and stays RTL-safe (logical properties). This policy governs **how**
work is executed and accepted, not what the product does.

## 1. Lifecycle

A unit of work (a "run") moves through exactly these phases, in order. A failed review or
verification returns the run to an earlier phase; a run never skips forward, and a phase is only
entered when the previous phase's evidence exists on disk. The phases are the agent-side
discipline around the production pipeline stages already defined in `crates/warsha-core`
(`Stage`: Idea → Gate A → … → Code → Review/QA/Security → Gate C → Gate D).

### Phase 1 — Intake

- Restate the task in one paragraph; list ambiguous points and resolve them (the pipeline's
  clarifying-question behavior) **before** planning.
- Record in the run state: allowed files/scope, explicit out-of-scope list, definition of done,
  and budget.
- Read-only: intake edits nothing.

### Phase 2 — Plan

- Produce a plan — ordered steps plus machine-readable acceptance gates — before any code change.
  Each gate is a command with an expected result (exit code, test count, check output), not prose.
- The implementer never authors the gates it will be judged against; gates are frozen at plan
  time and editing them later is a repair-loop violation (§5, §6).
- The plan is checkpointed to `state.json` (§3) before implementation starts.

### Phase 3 — Implementation (isolated)

- Every worker executes **only** inside an isolated checkout: a dedicated `git worktree` on its
  own branch from the recorded base commit, or a per-run Docker sandbox where `SECURITY.md`
  already allows it. Writing into the shared/main checkout is forbidden; if isolation cannot be
  created, the run is blocked (§5) rather than implemented in place.
- Read-before-write: the current content of a file is read before it is edited.
- Small commits inside the worktree; `cargo fmt` / `cargo clippy -D warnings` / targeted tests run
  as changes land, per `AGENTS.md`.

### Phase 4 — Review

- A reviewer in a role **separate from the implementer** reads the full diff at one commit and
  checks: scope conformance (no out-of-scope edits), `AGENTS.md` rules, i18n/RTL, architecture
  boundaries (`node scripts/check-arch.mjs`), secret hygiene, correctness and test quality.
- The reviewer records findings; it does not edit the implementation to make its review pass.
  Findings return to the implementer as repair items (§6).

### Phase 5 — Verification

- A verifier in a role **separate from implementer and reviewer** executes the acceptance gates
  exactly as defined in the plan, in the isolated worktree, at the reviewed commit.
- The verdict is read from gate result files only — the 2026-10-29 evidence rule: prose summaries
  and chat claims are not evidence.
- Verification never fixes anything; failures become repair items.

### Phase 6 — Bounded repair

- Any failed gate opens one repair iteration: the implementer addresses findings, then the run
  re-enters Phase 4 (review), never re-runs only verification.
- The loop is bounded by `max_repair_iterations` (default 3) tracked in `state.json`.
- Repair never loosens tests or gates. Forbidden during repair: deleting, skipping, ignoring or
  narrowing tests, weakening assertions, raising thresholds, editing acceptance gates or their
  commands, adding `#[ignore]`/`skip`/`todo!()` stand-ins, or excluding files from CI.
- At exhaustion the run becomes `blocked` with the reason recorded; partial state and evidence are
  preserved for the owner. Re-passing the same gate by redefinition is not a repair.

### Phase 7 — Acceptance

- Acceptance requires every acceptance gate green **and** the evidence bundle (§4) complete.
- Only the owner approves acceptance and merge — agents can never approve gates (`SECURITY.md`);
  acceptance merges the worktree branch under the Gate C rule.
- Without owner approval the work stays "ready for acceptance"; it is never reported as accepted.

## 2. Roles

Separate roles per run; one agent may hold only one role on a given run:

| Role          | Does                                   | Must never do                                    |
| ------------- | -------------------------------------- | ------------------------------------------------ |
| planner       | intake, plan, defines acceptance gates | implement the plan it authored                   |
| implementer   | writes code in the isolated worktree   | author or edit gates; review/verify its own work |
| reviewer      | independent review of the full diff    | edit the implementation                          |
| verifier      | runs the gates, writes the evidence    | repair failures                                  |
| owner (human) | approves gates and acceptance          | —                                                |

If capacity forces a merge of roles, the merge is recorded explicitly in `state.json`
(`roles` map) and shown to the owner — never silently, and never claimed as independent review.

## 3. State and checkpoint schema

Run state lives in `<evidence dir>/state.json` (schema `warsha-run/v1`). It is rewritten wholly on
every phase transition, and each transition also appends an immutable copy under
`checkpoints/<seq>-<phase>.json`:

```json
{
  "schema": "warsha-run/v1",
  "run_id": "2026-11-03-example",
  "task": "one-paragraph restatement from intake",
  "phase": "repair",
  "seq": 14,
  "updated_at": "2026-11-03T09:30:00Z",
  "roles": {
    "planner": "agent:a",
    "implementer": "agent:b",
    "reviewer": "agent:c",
    "verifier": "agent:d"
  },
  "scope": { "allowed_files": ["…"], "out_of_scope": ["…"] },
  "worktree": { "path": "…", "branch": "…", "base_commit": "…", "mode": "git-worktree" },
  "plan": {
    "steps": ["…"],
    "acceptance_gates": [{ "id": "G1", "check": "node scripts/check-arch.mjs", "expect": "exit 0" }]
  },
  "repair": { "iteration": 2, "max_repair_iterations": 3, "open_findings": ["R1"] },
  "blocker": null,
  "evidence": { "dir": "bridge-io/policy/<run_id>", "gates": ["G1"], "logs": ["verify.log"] }
}
```

- `phase` ∈ `intake | plan | implement | review | verify | repair | accept | blocked`.
- `seq` increases monotonically; a transition never rewrites history.
- `blocker`, when set, is `{ "kind": "in-scope" | "out-of-scope", "reason": "…", "needs": "…" }`.
- **Resume rule:** a run is resumable from `state.json` plus the evidence directory alone — no
  chat memory required. Any agent or human picking up a run reads the latest checkpoint first.

## 4. Evidence requirements

Each run writes evidence under `bridge-io/policy/<run-id>/`:

- `state.json` + `checkpoints/` — the resumable trail above.
- `acceptance.json` — the machine-readable gates and the final per-gate verdict
  (`pass` / `fail` / `not-run`, exit code, timestamp, commit hash).
- `gates/<gate-id>.log` — raw stdout/stderr per gate run.
- `diff/` — the exact reviewed patch (`git format-patch`) plus the reviewed commit hash.
- `review.md` — reviewer findings; `verdict.json` — final verdict with reason.

Rules: every artifact is timestamped and tied to `run_id`, commit and gate; evidence is immutable
(a repair iteration adds files, never rewrites old evidence); all artifacts are secret-redacted
before writing; a claim with no artifact behind it is treated as not-done.

## 5. Failure rules and blockers

- Failed gate → bounded repair (§1 Phase 6) → after `max_repair_iterations` → `blocked`;
  evidence kept, owner notified. No unbounded retry loops.
- A gate can only be satisfied by running it, not by argument. Unverifiable work is failed work.
- **In-scope blocker** — resolvable within the allowed files (missing fixture, flag error, lint
  failure): fix it, checkpoint, continue.
- **Out-of-scope blocker** — needs an edit outside allowed files, a credential the run was not
  scoped for, a product decision, or any loosening of tests or acceptance gates: stop immediately,
  write the `blocker` with reason and what is needed, and report. Scope is never quietly widened.
- Crashed or interrupted runs: the next agent resumes from the last checkpoint, increments `seq`,
  and the gap stays visible in the evidence trail.
- Faking any of the above (claimed green gate without a gate log, edit past the allowed scope,
  silent role merge) is a policy failure: stop, mark the run `blocked`, surface it to the owner.

## 6. Security and secret boundaries

- Isolation first: no worker writes to the shared checkout; execution happens in the isolated
  `git worktree` or per-run Docker sandbox, with a restricted environment.
- Secrets exist only via the OS keychain through the `SecretStore` seam
  (`crates/warsha-providers/src/secrets.rs`); an isolated environment receives only explicitly
  scoped credentials, never inherited ones.
- No secret — key, token, or partial key — ever lands in `state.json`, checkpoints, evidence,
  logs, diffs, gate output or a blocker reason; logs and artifacts are redacted automatically.
- No consumer-OAuth token reuse; official vendor CLIs as subprocesses only (`SECURITY.md`).
- Gate and verification test commands make no network calls to real model APIs — the mock
  provider is used; a real-model run happens only behind the owner's explicit `WARSHA_E2E_REAL`
  opt-in.
- No phase publishes, creates a non-draft release, force-pushes to main, or posts anything;
  merges and releases stay owner-approved gate decisions — agents can never approve gates.

## 7. Provenance

The principles in this policy (explicit plan/checkpoint state, isolated worktree execution,
separate implement/review/verify roles, machine-readable acceptance gates, bounded repair loops,
resumable evidence trails) were adopted as Warsha-native rules after observing public descriptions
of four open-source agent-engineering projects — **inspiration only, no upstream content was
copied**:

- Superplane — <https://github.com/superplanehq/superplane>
- Open-Inspect background-agents — <https://github.com/open-inspect/background-agents>
- SWE-AF — <https://github.com/Agent-Field/SWE-AF>
- Zeroshot — <https://github.com/the-open-engine/zeroshot>

No text, code, schema, prompt or asset from those repositories is reproduced in this file or
anywhere in this repository; all wording, phase names, schemas and rules above are Warsha's own.
If future work ever copies upstream material, the license/reference boundary recorded in
`DECISIONS.md` (2026-11-02, B1) applies: retain license/copyright/attribution notices and update
`THIRD_PARTY_NOTICES.md` in the same change.

## Enforcement

`node scripts/check-engineering-policy.mjs` (also `pnpm policy`) validates this document — its
sections, lifecycle phases, required terms and provenance — plus the `AGENTS.md` references and
the `package.json` `policy` script. `--self-test` verifies the validator itself against planted
fixtures. Any edit to this file or to the policy rules in `AGENTS.md` must keep the validator and
its self-test green.
