//! Skill system types — the portable markdown instruction packs Warsha ships
//! pre-bundled (PLAN.md Wave 2).
//!
//! A [`SkillDefinition`] is a named, tagged markdown prompt with a declared
//! upstream source and license. The twelve bundled skills come from the two
//! community collections that defined the format: `obra/superpowers` (the
//! original superpowers skill library, MIT) and `anthropics/skills`
//! (Anthropic's public skills repo, Apache-2.0).

use serde::{Deserialize, Serialize};

/// One installable skill: a markdown instruction pack the agent can load.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillDefinition {
    /// Stable identifier, e.g. `test-driven-development`.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// One-line description shown in the picker.
    pub description: String,
    /// Upstream source, e.g. `github.com/obra/superpowers`.
    pub source: String,
    /// SPDX identifier of the upstream license ("MIT" or "Apache-2.0").
    pub license: String,
    /// The full markdown prompt body.
    pub content: String,
    /// Whether the skill is active for new runs.
    pub enabled: bool,
    /// Free-form tags for search and grouping.
    pub tags: Vec<String>,
}

const SUPERPOWERS: &str = "github.com/obra/superpowers";
const ANTHROPIC_SKILLS: &str = "github.com/anthropics/skills";

/// The twelve bundled open-source skills, sources and licenses intact.
pub fn bundled_skills() -> Vec<SkillDefinition> {
    vec![
        superpowers(
            "brainstorming",
            "Brainstorming",
            "Before implementation, refine rough ideas into a validated design through \
             structured questioning — one question at a time.",
            &["planning", "design", "communication"],
            BRAINSTORMING,
        ),
        superpowers(
            "writing-plans",
            "Writing Plans",
            "Break validated designs into small, atomic, test-verifiable implementation \
             plan steps another engineer (or agent) can execute without context.",
            &["planning", "process"],
            WRITING_PLANS,
        ),
        superpowers(
            "test-driven-development",
            "Test-Driven Development",
            "Write the failing test first, watch it fail for the right reason, then \
             implement the minimum code to pass. Red, green, refactor.",
            &["testing", "coding", "quality"],
            TEST_DRIVEN_DEVELOPMENT,
        ),
        superpowers(
            "systematic-debugging",
            "Systematic Debugging",
            "Stop guessing: reproduce, isolate, form a hypothesis, verify it before \
             touching code, and fix root causes rather than symptoms.",
            &["debugging", "process"],
            SYSTEMATIC_DEBUGGING,
        ),
        superpowers(
            "verification-before-completion",
            "Verification Before Completion",
            "Never claim done without evidence: run the checks, read the output, \
             prove the behaviour changed as intended.",
            &["quality", "process", "gates"],
            VERIFICATION_BEFORE_COMPLETION,
        ),
        superpowers(
            "using-git-worktrees",
            "Using Git Worktrees",
            "Isolate parallel agent tasks in dedicated git worktrees so concurrent \
             work never shares a checkout or steps on uncommitted changes.",
            &["git", "isolation", "parallelism"],
            USING_GIT_WORKTREES,
        ),
        superpowers(
            "requesting-code-review",
            "Requesting Code Review",
            "Prepare a review that answers the reviewer's real questions: what \
             changed, why, how it was verified, and what risks remain.",
            &["review", "collaboration"],
            REQUESTING_CODE_REVIEW,
        ),
        superpowers(
            "dispatching-parallel-agents",
            "Dispatching Parallel Agents",
            "Split independent problems across concurrent subagents with crisp \
             contracts, then integrate results instead of babysitting.",
            &["subagents", "parallelism", "orchestration"],
            DISPATCHING_PARALLEL_AGENTS,
        ),
        anthropic(
            "webapp-testing",
            "Webapp Testing",
            "Drive real browsers against local web apps with Playwright: launch the \
             server, script interactions, capture screenshots and console errors.",
            &["testing", "frontend", "browser"],
            WEBAPP_TESTING,
        ),
        anthropic(
            "mcp-builder",
            "MCP Builder",
            "Design and build Model Context Protocol servers: tool schema first, \
             readable descriptions, safe defaults, eval-driven iteration.",
            &["mcp", "tooling", "integration"],
            MCP_BUILDER,
        ),
        anthropic(
            "skill-creator",
            "Skill Creator",
            "Meta-skill for authoring new skills: scope the trigger, write the \
             markdown, package resources, and test that agents actually follow it.",
            &["skills", "meta", "authoring"],
            SKILL_CREATOR,
        ),
        anthropic(
            "frontend-design",
            "Frontend Design",
            "Bold, deliberate interface design: commit to a visual direction, typography \
             and motion instead of default soup.",
            &["design", "frontend", "ux"],
            FRONTEND_DESIGN,
        ),
    ]
}

fn superpowers(
    id: &str,
    name: &str,
    description: &str,
    tags: &[&str],
    content: &str,
) -> SkillDefinition {
    skill(id, name, description, SUPERPOWERS, "MIT", tags, content)
}

fn anthropic(
    id: &str,
    name: &str,
    description: &str,
    tags: &[&str],
    content: &str,
) -> SkillDefinition {
    skill(
        id,
        name,
        description,
        ANTHROPIC_SKILLS,
        "Apache-2.0",
        tags,
        content,
    )
}

fn skill(
    id: &str,
    name: &str,
    description: &str,
    source: &str,
    license: &str,
    tags: &[&str],
    content: &str,
) -> SkillDefinition {
    SkillDefinition {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        source: source.to_string(),
        license: license.to_string(),
        content: content.trim().to_string(),
        enabled: true,
        tags: tags.iter().map(|tag| tag.to_string()).collect(),
    }
}

const BRAINSTORMING: &str = r#"
# Brainstorming

Before any implementation, turn a rough idea into a design the user actually
endorses. The default failure mode is jumping to code on the first plausible
answer; this skill forbids it.

## Process

1. Understand the project context first — read files, docs and recent changes
   before asking anything.
2. Ask **one question at a time**. Prefer concrete options over open-ended
   prompts ("A or B, and what would change your mind?" beats "what do you
   think?").
3. Once the problem shape is clear, propose **2-3 candidate designs** with
   explicit tradeoffs: complexity, performance, reversibility.
4. Present the design in sections small enough to react to, and let the user
   cut, merge or redirect each section.
5. End with a written design summary that becomes the input to
   `writing-plans`. Unvalidated designs do not get implemented.

## Anti-patterns

- Ten questions in one message.
- A design the user never agreed to, presented as a decision.
- Refactoring the idea into "what they obviously meant".
"#;

const WRITING_PLANS: &str = r#"
# Writing Plans

A plan is a contract between the architect and the implementer — and the
implementer may be a fresh agent with zero context. Write plans that survive
that handoff.

## Rules

1. Break work into **small, atomic tasks**. Each task is one verifiable change:
   a failing test, an implementation, a confirmation it passes.
2. Every task names the **files it touches** and the **check that proves it**.
   "Improve error handling" is not a task; "return 422 with field errors from
   `validate_signup` and cover it in `test_signup_validation`" is.
3. Order tasks by dependency, not by excitement. The plan is walkable top to
   bottom without foresight.
4. Include a **done definition** for the whole plan: what a reviewer runs to
   believe the work is finished.
5. Record deliberate omissions — what the plan explicitly does *not* do — so
   the implementer does not quietly re-scope.

## Template

- [ ] Task: <one sentence, imperative>
  - Touches: <files>
  - Test: <command and expected result>
  - Depends on: <task or none>
"#;

const TEST_DRIVEN_DEVELOPMENT: &str = r#"
# Test-Driven Development

Write the test first. Watch it fail for the right reason. Implement the
minimum. Refactor only against green.

## The cycle

1. **Red.** Add one test that describes the behaviour you are about to build.
   Run it. It must fail — and it must fail because the behaviour is missing,
   not because the test is broken. A test that passes before you wrote the
   code tests nothing.
2. **Green.** Write the smallest change that makes the test pass. Resist
   generalising; the next red step will tell you where generality is real.
3. **Refactor.** With the safety net green, remove the duplication the last
   two steps exposed. Tests do not change behaviour here; if a refactor
   breaks a test, the test was over-coupled — fix the test deliberately.

## Why it matters for agents

TDD gives an agent a verification receipt at every step. It is the cheapest
known defence against confident, broken code: the loop cannot lie about what
passed, because "passed" is a test you wrote before the code existed.
"#;

const SYSTEMATIC_DEBUGGING: &str = r#"
# Systematic Debugging

Random fixes cost more than slow ones. Debug in a loop of evidence, not
vibes.

## Process

1. **Reproduce.** Get a deterministic (or at least measurable) repro before
   touching anything. No repro, no fix — only guesses.
2. **Isolate.** Shrink the failure: half the inputs, half the code path,
   bisect commits. Every halving is information.
3. **Hypothesise.** State the suspected root cause in one sentence, with the
   observation that makes it plausible.
4. **Verify before fixing.** Prove the hypothesis with a targeted experiment —
   a log line, an assertion, a debugger stop. Only then change code.
5. **Fix the cause, not the symptom.** Ask what allowed the bug, and whether
   the same class of failure has friends elsewhere.
6. **Close the loop.** Re-run the original repro and the regression test. If
   either still fails, the hypothesis was wrong; go back to step 2 with what
   you learned.

## When to stop

Three failed hypotheses on the same bug is not persistence, it is thrashing.
Zoom out, re-read the code that works (the contrast is a signal), and rewrite
the problem statement — the bug is often a misunderstanding wearing a costume.
"#;

const VERIFICATION_BEFORE_COMPLETION: &str = r#"
# Verification Before Completion

"Done" is a claim, and claims need evidence. Never report completion from
intention; report it from observation.

## The checklist

1. Run the exact command you told the user would prove the work. **Read its
   full output** — not the exit code alone, not the first line.
2. Confirm the *behaviour* changed, not just that the test count grew. A green
   suite that never exercised the new path is a rubber stamp.
3. Check the edges: the empty case, the error case, the case you told yourself
   was "obviously fine".
4. Diff your own changes once, as a reviewer would. Ask whether every line
   serves the stated task; revert the ones that do not.
5. State plainly what is verified, what is assumed, and what is untested.
   Honest scope beats confident vagueness every time.

## The rule

If you cannot show the receipt, the work is not finished — it is unfinished
with good progress. Report it that way and continue.
"#;

const USING_GIT_WORKTREES: &str = r#"
# Using Git Worktrees

Parallel agent work on one repo needs isolation, and isolation is what
`git worktree` was born for.

## Why worktrees

Two agents sharing a checkout corrupt each other: uncommitted edits, branch
switches underfoot, test fixtures fighting over one working directory. A
worktree gives each task its own directory, its own HEAD, and a shared object
store — cheap, disposable, safe.

## Process

1. One worktree per task lane, named for the task
   (`git worktree add ../repo-task-42 -b task-42 main`).
2. Set up the lane inside the worktree only: dependencies, env files, build
   caches. Never mutate anything the lanes share.
3. Keep each lane's scope small enough that the merge is a formality. If two
   lanes must touch the same file, they were not independent — re-split.
4. On completion: run the lane's verification, merge (or open the PR), then
   `git worktree remove` the directory. Stale worktrees are landfill.

## Gate

No merge without a green lane. Worktrees make "it worked on my machine" true
in the best sense: each machine was the same repo, run separately.
"#;

const REQUESTING_CODE_REVIEW: &str = r#"
# Requesting Code Review

A review request is a piece of writing. Its job is to make the reviewer fast,
not to impress them.

## What the reviewer needs, in this order

1. **Context.** The task, the constraint that mattered, the decision you made
   because of it. One paragraph.
2. **The shape of the change.** Which files moved and why, before line noise.
   Name the one or two files that carry the logic.
3. **Evidence.** What you ran, what it printed, what you verified by hand.
   Paste the receipt; do not say "tests pass" and leave.
4. **Risk and scope.** What this change could break, what you did not test and
   why you believe that is acceptable. Ask specific questions where you are
   genuinely unsure — a reviewer's energy spent on settled questions is wasted.

## Anti-patterns

- 2,000-line diffs with "PTAL".
- Hiding the controversial part in the middle of the stack.
- Arguing with feedback in the request instead of waiting for it.
"#;

const DISPATCHING_PARALLEL_AGENTS: &str = r#"
# Dispatching Parallel Agents

Concurrency is leverage when the work truly splits — and a merge-hell
generator when it does not.

## When to fan out

1. The subtasks are **independent**: neither reads the other's output, neither
   writes the same files. If you cannot state the boundary in one sentence,
   the split is wrong.
2. Each subtask has a **contract**: inputs given, output expected, the check
   that proves it. The agent must be completable without asking questions.
3. The cost of coordination is below the cost of waiting. One more agent on a
   two-file task is pure overhead.

## How to dispatch

- Give every agent the shared context once, verbatim, rather than paraphrasing
  it four times.
- Isolate the workspaces (see `using-git-worktrees`) and name the merge owner.
- Collect results against the contracts, not against vibes: the integrator
  checks receipts, then merges.

## Integration

The dispatching agent owns the merge. Conflicts are information that the split
was imprecise — record them, and sharpen the next split with that knowledge.
"#;

const WEBAPP_TESTING: &str = r#"
# Webapp Testing

Test the web app the way a user uses it: a real browser, a running server,
scripted interactions, and artifacts (screenshots, console logs) that make the
result reviewable.

## Setup

1. Start the dev server and wait for readiness on its real port; never race
   the first request.
2. Use Playwright (or equivalent) from a scratch script for exploration and a
   committed test file for the flows worth keeping.
3. Prefer `data-testid` hooks; fall back to role- and label-based selectors.
   CSS-path selectors break when design does design.

## Flow

1. Load the page, assert no console errors on first paint.
2. Drive the golden path one interaction at a time, screenshotting each state
   transition you care about.
3. Drive the failure paths: invalid input, empty state, double submit.
4. Watch the network: an interaction that fires unexpected requests is a bug
   you have not seen yet.

## Cleanup

Kill the server, keep the screenshots with the PR. A test that leaves a port
bound has taught the next engineer to distrust green output.
"#;

const MCP_BUILDER: &str = r#"
# MCP Builder

Build Model Context Protocol servers that agents can trust: few tools, sharp
descriptions, safe defaults.

## Design first

1. List the **actions the model actually needs**; every extra tool is a
   decision you outsourced to chance. Aim for 5-15 tools.
2. Name tools as verbs on nouns the model already knows
   (`create_issue`, not `ci`).
3. Write each `description` as a mini contract: when to use it, what the
   parameters mean, what the result looks like. The description is the only
   documentation the caller reads.
4. Make parameters explicit and validated. Prefer enums and bounded types over
   free strings when the shape is known.

## Build

1. Scaffold with the official SDK for your language; stdio transport is the
   default, HTTP only when remote access is a requirement.
2. Return useful errors: a failed tool call should say *why* and *what next*,
   in text the model can act on.
3. Guard destructive operations behind confirmations or dry-run flags.
4. Never log or echo secrets the server received.

## Evaluate

Write 3-5 realistic prompts that should use the server, run them against a
fresh model session, and measure: correct tool chosen, correct arguments, task
completed. Iterate on descriptions before iterating on code — most MCP failures
are documentation failures.
"#;

const SKILL_CREATOR: &str = r#"
# Skill Creator

Skills are prompts with a trigger. Create them the way any good instruction is
written: scoped, testable, and honest about what it does not cover.

## Structure

```
my-skill/
├── SKILL.md        # frontmatter (name, description) + the body
├── scripts/        # optional deterministic helpers
└── references/     # optional docs loaded only when needed
```

## Process

1. **Scope the trigger.** Write the description as "Use when <conditions>";
   imagine the transcripts that should match and the near-misses that must
   not.
2. **Write the body** in three parts: the process steps, the rules that bind
   them, and the anti-patterns. Imperative voice, short sections, one skill
   one job.
3. **Progressive disclosure.** Keep SKILL.md under a page; push depth into
   reference files the agent loads on demand.
4. **Test it.** Run real tasks that should invoke the skill with a fresh
   agent. Did it load? Did the behaviour change in the intended direction?
   Fix the skill, not the test.
5. **Version the lessons.** When the skill fails in a new way, add the
   boundary case to it — that is how a skill compounds.
"#;

const FRONTEND_DESIGN: &str = r#"
# Frontend Design

Interfaces get remembered for their point of view. Choose one and commit —
default-soup designs are not neutral, they are forgettable.

## Direction first

1. Pick a **concept word** for the surface (e.g. "ledger", "atelier",
   "terminal") and let it drive palette, typography, and layout vocabulary.
2. **Typography carries the page**: one distinctive display face for headings,
   one readable workhorse for body. Establish a size scale and use it; avoid
   middle-of-the-road defaults everywhere.
3. **Palette with intent**: a restrained base, one committed accent, purposeful
   gradients over flat fills where depth helps. Colour is hierarchy before
   decoration.
4. **Motion is feedback**: transitions tied to state changes, generous
   spacing, unusual layouts that still respect reading order. Animate the
   unusual parts, not the text.

## Craft

1. Wire the real interaction first, then style; a beautiful component that
   cannot be operated is a mockup.
2. Contrast, focus states, keyboard paths and reduced-motion are part of the
   design, not a compliance pass.
3. Screenshot at 3 widths. If one of them makes you wince, the layout is not
   done.
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_skills_ship_eight_superpowers_and_four_anthropic() {
        let skills = bundled_skills();
        assert_eq!(skills.len(), 12);
        let from_superpowers = skills.iter().filter(|s| s.source == SUPERPOWERS).count();
        let from_anthropic = skills
            .iter()
            .filter(|s| s.source == ANTHROPIC_SKILLS)
            .count();
        assert_eq!(from_superpowers, 8);
        assert_eq!(from_anthropic, 4);
    }

    #[test]
    fn licenses_match_sources() {
        for skill in bundled_skills() {
            let expected = match skill.source.as_str() {
                SUPERPOWERS => "MIT",
                _ => "Apache-2.0",
            };
            assert_eq!(skill.license, expected, "skill {}", skill.id);
        }
    }

    #[test]
    fn every_skill_has_real_content() {
        for skill in bundled_skills() {
            assert!(
                skill.content.len() > 200,
                "skill {} carries a descriptive prompt",
                skill.id
            );
            assert!(skill.content.starts_with('#'));
            assert!(!skill.tags.is_empty());
            assert!(skill.enabled);
        }
    }

    #[test]
    fn skills_round_trip_through_json() {
        for skill in bundled_skills() {
            let encoded = serde_json::to_string(&skill).expect("encodes");
            let decoded: SkillDefinition = serde_json::from_str(&encoded).expect("decodes");
            assert_eq!(decoded, skill);
        }
    }
}
