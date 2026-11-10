# OD1 — what the 40 diffs actually show (observed, not inferred)

I opened two of the diff images and one actual render before handing this pack over, because I had been
*asserting* that the 40 failures were "added product surface". The assertion was partly wrong, and the
correction changes the recommendation.

## Case 1 — `projects 390x844 en light` (diff)

The red (changed) region is precisely the **"Add a project" form**: *Project name*, *Project description*,
*Create this project*. Everything above it — the *Projects Board*, `proj-ull`, `proj-store`, "Open the
run" — is grey, i.e. unchanged.

**Conclusion:** this is genuine added product surface from `b3dc490`. The baseline predates the feature.
Refreshing this case would be correct.

## Case 2 — `run 390x844 en light` (diff + actual)

The actual render is a coherent, deliberate screen: header with the Arabic/English switch, "daemon
online", the budget line, *Current run / Project proj-store*, a *Project runs* list (awaiting a gate;
running Review/QA/Sec), a *Run* panel (run id, run status, stage, last update) and
*Open the gates inbox* with a "1 gate waiting on you" button.

But it also shows a banner I did **not** expect:

> **The event stream stopped.** Nothing you sent was lost. — **Reconnect**

That banner is the client reacting to an event-stream method the **e2e harness does not stub**. It is a
harness gap, not a product defect — and `DESIGN_SYSTEM_V2.md` §9 already assigns "harness stub shapes
made daemon-true (`postlaunch.*`, `backend.export`, `handoff.*`)" to **Phase B**.

## So the recommendation changes

Refreshing all 40 baselines *now* would **enshrine that reconnect banner as the visual truth** — i.e. the
suite would then assert that a stopped event stream is the expected look of the Run screen. That is not a
baseline that should be frozen.

The correct order is:

1. **Close the harness stub gap** so the Run screen does not raise its reconnect banner under test
   (a Phase B item, already specified in §9).
2. **Then** refresh the affected baselines, on the capture host, with the set named.
3. Re-run `GC.10` and `GC.12` at that tip; expect remote 91 passed / 0 failed.

If you prefer to accept the run as-is instead, the honest record is: three remote gates
(`G3.9`, `G5.11`, `GC.10` remote half) remain unsatisfied because the baselines are stale **and** the
harness does not yet stub the event stream.

## What is not in doubt

- No baseline file was created, changed or deleted to build this pack.
- Desktop is unaffected: 793 passed / 0 failed with zero snapshot writes, measured five times.
- The 40 failures are confined to `bench.visual.spec.ts` on needs-you (20), run (12) and projects (8).
