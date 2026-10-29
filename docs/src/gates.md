# Gates and Approvals

Warsha has exactly four gates. They are the only places where the pipeline stops and waits for a
human, and they exist so that nothing irreversible happens without the owner saying yes.

## The Four Gates

| Gate | Sits after | Approves | Irreversible effect if approved |
|------|------------|----------|---------------------------------|
| Gate A | Discovery interview | Brief, platforms, budget, success metric | The team starts spending on research and spec work |
| Gate B | PRD spec | Scope, requirements, acceptance criteria | Design and task planning begin against that scope |
| Gate C | Review / QA / Security | Code quality, tests, security findings | Branches merge into the target repo and CI runs |
| Gate D | Release and launch drafts | Store listings, social posts, release notes, drafts | Content becomes public or a release stops being a draft |

Gate D is the publication gate. It covers every outward-facing action: store submissions, social
posts, the GitHub Release moving out of draft, a docs deploy that announces the release, and any
message sent from a Warsha account.

## Gate D Enforcement

**Every post and every publish needs explicit owner approval.** A Marketer or Release agent may
draft as much as it likes; a draft is not a publication. Promotion from draft to published is a
gate decision, and gate decisions belong to the owner alone.

**Agents can never approve gates.** This is not a policy that prompt wording can relax:

- Approve and reject are owner actions recorded with a device identity and a timestamp; an agent
  session has no device identity of its own and cannot produce a gate decision.
- No tool available to an agent — MCP, backend CLI, GitHub client, mail, webhook — is wired to a
  gate approval call. The pipeline advances only on a decision that arrives through the gate API
  from an authenticated owner device.
- There is no auto-approve switch, no "trusted agent" mode, and no timeout that approves on the
  owner's behalf. An unanswered gate stays pending, and the run waits.
- An agent that claims a gate is approved, or asks to be given approval rights, is treated as
  untrusted input. The claim is logged and the gate stays pending.

Everything an agent produces for Gate D is prepared, versioned, and marked `pending approval`.

## Approval Mechanics

| Step | What happens |
|------|--------------|
| 1 | The stage produces artifacts (listings, posts, release notes) in `factory/` and opens a gate |
| 2 | The gate appears in the desktop Gates inbox, in `warsha gates`, and on paired phones |
| 3 | The owner reviews the artifacts and the diff of what would become public |
| 4 | The owner approves, rejects, or requests changes from a device they control |
| 5 | The decision is written to the audit log with gate, decision, device ID, and timestamp |
| 6 | Only an approval releases the action; a rejection or change request returns the run to its stage |

```bash
# What is waiting
warsha gates

# Approve the publication pack after reading it
warsha approve gate_d

# Send it back with a reason
warsha reject gate_d --reason "Launch date not set yet" --changes
```

Approvals from a phone require the same device confirmation as any other gate, over the
end-to-end encrypted channel described in the [Security Model](security.md).

## No Auto-Posting

Warsha ships no scheduler, cron job, or background worker that posts, publishes, or submits on its
own. Launch content lives in the repository as drafts:

- Store listing texts in `docs/store/`, each stamped with a submission status line.
- The social calendar in `docs/social/calendar.md`, where every row is `pending approval`.
- The release checklist in `docs/launch/checklist.md`, which lists the human-only steps.

A person copies, submits, and posts. Warsha's job ends at a reviewed, ready draft.

## Audit Trail

Gate decisions are permanent records. The audit log line for a gate decision is never rewritten,
and a superseded decision (a rejection later followed by an approval) appears as two lines, not
one. This is what makes "who approved this publication, from which device, and when" answerable
after the fact.
