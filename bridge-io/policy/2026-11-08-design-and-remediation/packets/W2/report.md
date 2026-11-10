# W2 — canonical architecture, deployment, security and index docs (repair 1)

Run `2026-11-08-design-and-remediation` · packet W2 · branch `run/2026-11-08/w2-canonical-docs` ·
worktree `C:/Users/Dragonfly/Downloads/warsha-wt/w2` · implementer · docs only.

## Base and HEAD

| Ref | Commit | Note |
|---|---|---|
| Initial dispatch | `99a7c03` | C1 tip without W3; `state.json` held W3 back |
| **BASE (gates)** | **`406240a5eebf07b7e627859fccce2ef564946c91`** | integration after `merge: run/2026-11-08/w3-ui-v2`; branch rebased onto it |
| **HEAD** | **`e71567a499c435711899643bc676a004ac81eaa2`** | `docs(verify): record the G0 baseline truth and the open OD1 remote decision` |

13 Conventional `docs(...)` commits, none pushed; tree clean at HEAD; final HEAD is gate-clean (all
ten exits below).

`git diff --stat 406240a..HEAD`: 15 files, **348 insertions(+), 178 deletions(-)** —
SECURITY.md 58, SKILL.md 11, ARCHITECTURE.md 50, ARCH_RULES.md 103, DEPLOY.md 42, DEVELOPERS.md 23,
VERIFY.md 62, SITEMAP.md 13, SUMMARY.md 5, src/architecture.md 141, and 5 two-to-ten-line shims.
All paths are in the packet allowlist; no code, test, snapshot, dependency, README, `.github/**` or
`PLAN/PROGRESS/DECISIONS.md` edit. The `97dc93a` tree carries the same 15-file scope with 303/171.

## Decisions

- **D1 — Base moved to `406240a`.** W3 merged mid-packet; staying at `99a7c03` would document R6 v2
  as deferred and fail G2.4 once W3 landed. Rebased locally; both hashes recorded.
- **D2 — R6 is documented from the merged tree:** 35 `it(` tests (measured), R6.1–R6.10 live,
  `APP_LENGTH_BUDGET = 145` (142 R6.9 + 3 R6.10 at W3 base `5abe5ef`), `WARSHA_R6_APP_LENGTH_BUDGET`
  tightens only; 70 non-test app files (68 ts/tsx + 2 css), 28 stories.
- **D3 — Gate numbers derived with the gates' tools:** tokenDrift 35; wire 9; 88 daemon methods =
  88 policy rows; 75 client calls = 75 harness stubs; `warsha-store` 1,414 + 1,818 lines; desktop
  listing 793 (a11y 188, states 252, visual 308, behaviour 45), remote 91.
- **D4 — Citations re-opened:** `DaemonConfig :520-590`; static handler `:6220`; env `:6192`;
  Dockerfile `:102/:115`; Caddy `:39-66`; remote handshake `:587-588`, `:656-659`.
- **D5 — Hashes:** current 2026-11-08 values (`f3549485…`, `294b8e25…`), 2026-11-05 values kept as
  labelled history; "open disagreement" wording gone.
- **D6 — D10 honesty:** no E2E-encryption claim, crypto unconsumed, no green-baseline claim.
- **D7 — Out-of-scope drift recorded, not edited:** `docs/src/security.md` still says "binds 127.0.0.1
  only" / "Noise XX"; not in W2's allowlist.
- **D8 — No gate, prompt, plan or source edit.**
- **D9 — DS v2 status banner:** kept (review n1 accepted as justified); it states the merged tokens
  and honest ratchet, before the planner-owned `{{#include}}`.
- **D10 — Repair findings:** B1 added to `docs/VERIFY.md` §1.3 (full truth) and
  `docs/designs/SITEMAP.md` (totals pointer), because VERIFY owns verification evidence and the
  SITEMAP convention was the place advertising the totals; ARCHITECTURE stays build-time. M2 fixed
  with real lines (`EncryptedChannel :587-588`, `process_handshake :656-659`, replay cache `:594`;
  pairing/identity citations also corrected, see SECURITY.md). m1 fixed: `internal.ts` **is**
  scanned; only `index.ts`/stories are excluded. m3: 75 call sites = **70 literal names + 5
  same-file consts** (a literal-name-only parse sees 70); the 60-object/15-none split includes the
  5 const-resolved sites. Reproduce with the gate's own parser:

  ```js
  const fs = require('fs');
  const src = fs.readFileSync('scripts/check-wire-contract.mjs', 'utf8').split('\n');
  const sl = (a, b) => src.slice(a - 1, b).join('\n');
  const parse = new Function(['const toPosix=p=>p;', sl(161,168), sl(186,200),
    sl(243,340), sl(415,488), 'return parseClient;'].join('\n'))();
  const c = parse(fs.readFileSync('packages/client/src/index.ts', 'utf8'));
  const k = {}; c.forEach(x => k[x.paramKind] = (k[x.paramKind] || 0) + 1);
  console.log(c.length, new Set(c.map(x => x.name)).size, JSON.stringify(k));
  // -> 75 75 {"none":15,"object":60}
  ```

  m2: the earlier non-clean commits are history; this HEAD is the reviewed, gate-clean one.

## Gates at HEAD e71567a / BASE 406240a

| Gate | Exit | Result |
|---|---|---|
| G2.S | **0** | `0` out-of-scope paths |
| G2.1 | **0** | mdBook v0.5.4 built |
| G2.2 | **1** | expected: no forbidden sentence |
| G2.3 | **0** | all 19 facts present |
| G2.4 | **0** | **N = 35** (`35 true`) |
| G2.5 | **0** | `9 checks`; doc contains `wire: 9 checks, 0 violations` |
| G2.6 | **0** | indexes complete |
| G2.A | **0** | `arch: 5 rules, 0 violations` |
| G2.P | **0** | `policy: 8 checks, 0 failures` |
| G2.W | **0** | `wire: 9 checks, 0 violations` |

## G0 / OD1 — exact sentences added (VERIFY.md §1.3)

> The recorded **G0** baseline at the planner commit `0772d50` on the authoritative Linux x86_64
> capture host is **not an all-green run**, and no document may present it as one:

> All 8 desktop failures were the **`settings` screen** failing axe
> `aria-required-children [critical]` — `Required ARIA child role not present: listitem`. G0's
> verdict is recorded as **`fail`** (`acceptance.json`, exit 1, log `gates/G0.log`, SHA-256
> `3c3ff820…`): G0 is a **baseline truth record**, not a green gate, and nothing was fixed,
> refreshed or re-run to improve it.

> Those 8 desktop failures were **fixed by packet W8** (now merged). Three independent capture-host
> re-measurements prove it with zero snapshot writes: **G8.4** (`0b8a7e8`, 793 passed / 0 failed),
> **G3.8** (`0f82973`, 793/0) and **G4.9** (`73b1331`, 793/0); each recorded `snapshot_writes 0`, and
> G4.9/G8.4 also `dirty_after 0`.

> The **40 remote failures remain OPEN** and are blocked on **OWNER DECISION OD1**:
> - the 40 baselines are **stale product images**, last refreshed at `ddb8074` on an aarch64 host;
> - six later commits changed `apps/remote/src`, including `b3dc490`, which added visible
>   create-project / start-run panels and run controls;
> - the failures are **selective, which disproves host raster noise**: gates 20/20, settings 8/8 and
>   flows 7/7 pass, while run 12/12, projects 8/8 and needs-you 20/36 fail (12 + 8 + 20 = 40);
> - refreshing them is **Phase B**, requiring an **owner-named baseline set** (decision D1). No
>   agent may refresh them, and no document may imply the remote suite is green.

> Until OD1 is decided and a named refresh lands, the truthful statement is: desktop is 793 passed /
> 0 failed on the capture host after W8; **remote is 91 listed / 51 passed / 40 failed**.

The VERIFY table records desktop 793/785/8 (a11y 188/180/8; states 252/252; visual 308/308; flows
30/30; layout 12/12; onboarding 3/3) and remote 91/51/40 (bench.visual 84/44/40; flows 7/7).
SITEMAP marks the listed totals as not-green and points to §1.3.

## Repair iteration 2 — `mdbook test` (HEAD `5a2834d`)

**Finding.** Integration gate GC.4 runs `pnpm -r test`; the `@warsha/docs` test script is
`mdbook test`, which compiles every code fence with no language as Rust. G2.1 is `mdbook build docs`,
which compiles nothing, so the frozen gate set could not see it. Reproduced here first: pre-fix
`mdbook test docs` exited **101** with exactly 4 failing fences.

| Fence (as `mdbook test` reported it) | Real location | Content | What changed |
|---|---|---|---|
| `design-system-v2.md` line 85 | `DESIGN_SYSTEM_V2.md:76-103` (planner-owned include) | ASCII layout diagram | re-fenced as `text` **in the shim** (Option 1) |
| `deploy.md` line 54 | `DEPLOY.md:53` | topology diagram `Internet ──▶ host …` | ` ```text ` |
| `deploy.md` line 167 | `DEPLOY.md:166` | bootstrap-token output block | ` ```text ` |
| `deploy.md` line 329 | `DEPLOY.md:328` | `/var/lib/warsha/` directory tree | ` ```text ` |

**Scope correction applied.** The scope notice was right that a literal reading of the first brief
would mean editing `docs/designs/DESIGN_SYSTEM_V2.md:76`, which is planner-owned and outside W2's
allowlist. That file was **never touched**: its blob is identical to BASE (`3c79a6e3…` at both
`406240a` and HEAD). Option 1 was taken, because it is the only in-scope route: `docs/book.toml` is
not in the allowlist (G2.S would flag it), `mdbook test --help` in v0.5.4 offers only `--chapter`
and `--library-path` (no skip), and rustdoc has no per-file opt-out. Option 2 (banner + link, no
include) was rejected because it would drop the complete design specification from the book the
shim exists to publish; Option 3 is therefore unnecessary.

**How the 4th fence is fixed.** `docs/src/design-system-v2.md` publishes source lines `1:75`,
re-opens exactly the diagram fence as ` ```text ` around source lines `77:103`, and then includes
`104:`. The source's **own closing fence** closes the wrapper, so no fence is duplicated. A comment
in the shim records the reason and the pinning. Only the source's opening/closing fence lines are
excluded; the diagram is untouched.

**Drift hardening (why `77:103`, not an explicit closing fence).** I ran a matrix of the plain
include, my first wrapper, and this one against 1/2/13/26/27/28/50 inserted lines and the same
removed above the diagram, in a throwaway mini-book. The first wrapper silently garbled the diagram
at +1 line (mdbook test 0, diagram no longer a code block); closing on the source's own fence fails
**loudly** in every one of the 12 drift cases (test 101). A drift now breaks GC.4 instead of
printing box-drawing characters as prose.

**Audit.** All fences in `architecture.md`, `VERIFY.md`, `INSTALL.md`, `UI.md`,
`SKILLS_AND_HARNESSES.md`, `ARCHITECTURE.md`, `ARCH_RULES.md` already carry a language.
`docs/DEVELOPERS.md:18` (a directory tree not in the book) was annotated `text` preventively.
Rendered text before/after is identical (0 lines lost, 0 gained for both changed pages).

**Proof (real exits, this worktree, HEAD `5a2834d`, BASE `406240a`):** `mdbook test docs` **0**
(0 `FAILED`); `pnpm --filter @warsha/docs test` **0**. Ten gates: G2.S **0** (0 paths) · G2.1 **0** ·
G2.2 **1** (expected) · G2.3 **0** · G2.4 **0** (N=35) · G2.5 **0** (`9 checks`) · G2.6 **0** ·
G2.A **0** · G2.P **0** · G2.W **0**. Tree clean; `git merge-tree c2709169 HEAD` exits 0.

**Note — gate gap.** G2.1 only exercises `mdbook build`; it never compiles a fence. `mdbook test` is
the check that matters for any packet that adds book pages, and should be added beside G2.1. This
repair did not edit any gate. Three new commits on top of the already merged `e71567a`:
`498405e` (DEPLOY.md, DEVELOPERS.md fences), `2fbd620` (design-system-v2 wrapper), `5a2834d`
(close the wrapper on the source fence so drift fails loudly).

## Open issues

1. **OD1** — 40 stale remote baselines, owner-gated; never claim remote green.
2. **G0 history** — desktop 8 failures fixed by W8 and re-proven at 793/0 (G8.4/G3.8/G4.9); G0's
   record remains `fail` as a baseline truth.
3. **`docs/src/security.md`** (out of scope) still has the pre-W2 "127.0.0.1 only" / "Noise XX" text.
4. **`DESIGN_SYSTEM_V2.md`** remains a planner-owned spec; status is carried by the shim/SITEMAP.
5. No blocker. Nothing pushed, merged, published or released.
