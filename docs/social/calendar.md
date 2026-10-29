# Launch Calendar — Social Posts

Four weeks around launch: one week of build-up, launch week, then two weeks of follow-through.
Every post below is a **draft**. Nothing in this file posts itself, and no Warsha component has a
publishing integration.

**Every entry is `pending approval`.** The gate line on each post — *Gate D — owner approves before
posting* — is the whole rule: an agent drafts, the owner reads it, and only the owner publishes.

**Date offsets:** `D0` is launch day, the day v0.1.0 stops being a draft release. `D−7` is seven
days before it. Absolute dates are deliberately absent: launch day moves, the offsets do not.

**Placeholders:** anything in `{{double braces}}` is filled by the owner at approval time —
handles, install counts, video links. Nothing measured is pre-filled, because inventing a number
in a draft is how a false claim reaches the internet.

## Channels

| Channel | Account | Owner | Posting method |
|---------|---------|-------|----------------|
| X/Twitter | `@{{x_handle}}` | owner | copy, paste, post by hand |
| LinkedIn | `{{linkedin_page_url}}` (company page) | owner | copy, paste, post by hand |
| Community forum | Reddit `u/{{reddit_user}}`, Hacker News `{{hn_user}}` | owner | manual submission; no scheduling tools |

No Buffer, no Hootsuite, no cron job, no GitHub Action, no bot token. If a draft needs a scheduled
post, the owner schedules it in the platform's own UI, after approving it here.

## Cadence

| Week | Window | X/Twitter | LinkedIn | Forum | Job of the week |
|------|--------|-----------|----------|-------|-----------------|
| −1 | D−7 … D−1 | daily (7) | 2 | 1 | Explain what is coming; collect early questions |
| 0 | D0 … D+6 | daily (7) | 3 | 3 | Launch, demo the gates, answer everything |
| +1 | D+7 … D+13 | daily (7) | 2 | 1 | Show the first week's evidence; teach one workflow |
| +2 | D+14 … D+20 | daily (7) | 2 | 1 | Turn attention into issues and contributors |

Totals: 28 X posts, 9 LinkedIn posts, 6 forum posts, all `pending approval`.

## Voice Rules

- Arabic-first product, so Arabic posts are welcome on X; keep the English posts plain and technical.
- No benchmark, star count, user count, or testimonial that the owner cannot link to.
- No "revolutionary", no emoji walls, no engagement bait, no reply-guy automation.
- Every post carries one link at most, and it points at the docs site or the repository.
- Anything about code signing, stores, or telemetry must match `docs/store/` and `docs/src/security.md`.

---

## Week −1 — Build-Up (D−7 … D−1)

### D−7 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D−7 (7 days before launch)
- **Headline:** What we have been building
- **Body:** One line of idea in. Research, requirements, design, code, review, security, release — out. Twelve AI agents, four gates you approve. Warsha launches in a week.
- **CTA:** Follow along; the docs go live on launch day.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D−7 · LinkedIn

- **Channel:** LinkedIn
- **Date offset:** D−7
- **Headline:** An AI software factory that stops when you say stop
- **Body:** Most AI coding tools optimise for fewer interruptions. We went the other way: Warsha runs twelve role agents through a gated pipeline and stops at four points for a human decision — brief, spec, merge, publish. Arabic-first, local-first, bring your own provider. Launching in one week.
- **CTA:** Follow the page for the launch post and the quickstart.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D−6 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D−6
- **Headline:** The twelve roles
- **Body:** Intake. Researcher. PM. Designer. Architect. Coder. Reviewer. QA. Security. Release. Marketer. Feedback. Twelve roles, twelve versioned prompt files you can read and change. That is the team Warsha runs for you.
- **CTA:** Docs link drops on launch day.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D−5 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D−5
- **Headline:** What we will not build
- **Body:** The list we refuse to add: auto-posting, auto-approved gates, silent self-update, telemetry on by default. A tool that can ship software without asking is a tool that eventually will. Warsha asks.
- **CTA:** One week to launch.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D−5 · Community forum

- **Channel:** Community forum (Reddit — r/opensource)
- **Date offset:** D−5
- **Headline:** Building a gated AI pipeline for small software projects — does this gate set make sense?
- **Body:** We are a week from releasing a local-first tool that runs twelve agent roles over a project and pauses at four gates: brief, spec, merge, publish. Before we ship it, we want the gate set criticised. Which gate is missing, and which one would you delete? Non-commercial, source-available license, runs on your own API key.
- **CTA:** Comment with the gate you would add or remove; we will answer every one.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D−4 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D−4
- **Headline:** Arabic first, not Arabic-later
- **Body:** واجهة عربية من أول يوم: الوكلاء والوثائق وبوابات الموافقة كلها بالعربية، مع تبديل إلى الإنجليزية. لا ترجمة لاحقة ولا واجهة نصف عربية. ورشة تُطلق بعد أربعة أيام.
- **CTA:** تابعنا؛ الدليل الكامل يوم الإطلاق.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D−3 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D−3
- **Headline:** Four stops
- **Body:** Warsha stops four times: brief, spec, merge, publish. Each stop is a card you approve or send back with a reason. The run never times out into a yes, and no agent can sign for you.
- **CTA:** Full gate walkthrough on launch day.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D−3 · LinkedIn

- **Channel:** LinkedIn
- **Date offset:** D−3
- **Headline:** Why Arabic-first is a design constraint, not a translation task
- **Body:** An Arabic interface is not English strings in a different font. It is right-to-left layout from the first component, message catalogs where Arabic is the canonical text, and agent output written in the language the owner reads. Warsha treats Arabic as the default and English as the switch — including the artifacts the agents produce.
- **CTA:** Launch post lands in three days.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D−2 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D−2
- **Headline:** Bring your own provider
- **Body:** No Warsha credits, no resold tokens. Plug in OpenAI, Anthropic, DeepSeek, OpenRouter, Azure — or a local Ollama model with no account at all. Keys go to your OS keychain, never to our servers, because there are no our servers.
- **CTA:** Two days to launch.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D−1 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D−1
- **Headline:** Tomorrow
- **Body:** Tomorrow we open the repo and publish the quickstart. Twelve agents, four human gates, budgets that hold, no telemetry, nothing published without you. If a tool should stop and ask before it acts, this is what that looks like.
- **CTA:** Launch post at {{launch_time}} tomorrow.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

---

## Week 0 — Launch (D0 … D+6)

### D0 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D0 (launch day)
- **Headline:** Warsha v0.1.0
- **Body:** Warsha is out. An Arabic-first AI software factory: one idea in, twelve agents working, four gates where you decide. Source-available, local-first, your own API key. Windows, macOS, Linux.
- **CTA:** {{repo_url}}
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D0 · LinkedIn

- **Channel:** LinkedIn
- **Date offset:** D0 (launch day)
- **Headline:** Warsha v0.1.0 is available
- **Body:** Today we release Warsha: an AI software factory that runs a twelve-role agent team through a gated pipeline — discovery brief, product spec, code review, release — and waits for a human at each gate. It is Arabic-first, local-first, non-commercial, and it uses the model provider you already pay for. No telemetry. No auto-publish.
- **CTA:** Quickstart and downloads: {{repo_url}}
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D0 · Community forum

- **Channel:** Community forum (Hacker News — Show HN)
- **Date offset:** D0 (launch day)
- **Headline:** Show HN: Warsha – an Arabic-first AI software factory with human gates
- **Body:** Warsha runs twelve agent roles (intake, research, PM, design, architecture, code, review, QA, security, release, marketing, feedback) over a project and pauses at four gates for the owner. It is local-first, keeps keys in the OS keychain, enforces per-project budgets, and never publishes on its own. Rust daemon, Tauri desktop app, CLI, and an end-to-end encrypted phone pairing for approvals. Non-commercial source-available license. Happy to answer anything about the gate model or how the eval suite gates prompt changes.
- **CTA:** Repository and quickstart in the first comment.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D0 · Community forum

- **Channel:** Community forum (Reddit — r/opensource)
- **Date offset:** D0 (launch day)
- **Headline:** Warsha released: gated AI pipeline, PolyForm non-commercial, no telemetry
- **Body:** Released today. A local-first tool that runs twelve AI agent roles over a project and stops at four human gates: brief, spec, merge, publish. Bring your own provider or run Ollama locally; keys live in the OS keychain. PolyForm Noncommercial 1.0.0, so personal and research use is fine, commercial use needs a separate license. Feedback on the gate model is the most useful thing you can give us.
- **CTA:** Repository in the post body; issues open.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+1 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+1
- **Headline:** Gate D
- **Body:** The gate people ask about most is Gate D. Nothing goes public — no release, no store listing, no social post — until a human approves it. Agents draft. You publish. There is no auto-post switch to find.
- **CTA:** See the gates page: {{docs_url}}/gates.html
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+2 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+2
- **Headline:** The brief comes first
- **Body:** Before a line of code, Gate A approves the brief: platforms, audience, language, budget, success metric. Sixteen discovery questions, recorded in the project's brief file. Skipping discovery is how you build the wrong app quickly.
- **CTA:** {{repo_url}}
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+2 · LinkedIn

- **Channel:** LinkedIn
- **Date offset:** D+2
- **Headline:** The four gates, concretely
- **Body:** Gate A approves the discovery brief. Gate B approves the product spec and scope. Gate C approves the merge after review, tests and security checks. Gate D approves anything that becomes public: releases, store listings, posts. The rule is simple — an agent can propose any of them, and only the owner can approve one.
- **CTA:** Full walkthrough: {{docs_url}}/gates.html
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+3 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+3
- **Headline:** Read the prompts
- **Body:** Every one of the twelve roles is a prompt file in the repo, versioned like code. You can read exactly what the PM agent is told, fork it, and diff your change. Prompts that decide how software gets built should not be a trade secret.
- **CTA:** {{repo_url}}/tree/main/crates/warsha-pipeline/src/prompts
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+3 · Community forum

- **Channel:** Community forum (Reddit — r/LocalLLaMA)
- **Date offset:** D+3
- **Headline:** Warsha with Ollama: twelve agent roles on a local model, no cloud key
- **Body:** Warsha auto-detects Ollama on localhost and will run the whole pipeline against it, role by role, with per-role budget accounting and cost estimates at zero. Quality on local models varies by role — the PM and reviewer roles want a bigger model than intake or feedback. Notes on which roles we route to small models, and where the guardrails kick in, are in the thread.
- **CTA:** Tell us which local model you route each role to.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+4 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+4
- **Headline:** No telemetry, and we mean zero
- **Body:** No analytics, no crash beacon, no usage ping, no account. Warsha's daemon binds to localhost and its state lives in your config directory. The only network traffic is the model provider you configured, with your key.
- **CTA:** Threat model: {{docs_url}}/security.html
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+4 · LinkedIn

- **Channel:** LinkedIn
- **Date offset:** D+4
- **Headline:** Local-first, and what that buys you
- **Body:** Every artifact the agents produce — brief, spec, tasks, reviews, release notes — is a file in your project's factory directory, not a row in our database, because there is no our database. That means diffs, backups, code review, and an honest exit path. Local-first is not a slogan; it is the reason you can walk away with everything.
- **CTA:** Architecture notes: {{docs_url}}/architecture.html
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+5 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+5
- **Headline:** Budgets that actually stop the run
- **Body:** Set a budget per project and per role. When it is spent, the run pauses instead of quietly burning your card. Cost is computed per call from model pricing, and the meter is in the same place as the gate cards.
- **CTA:** `warsha budget set 50` — that is the whole setup.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+6 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+6
- **Headline:** Five minutes to first project
- **Body:** Install, `warsha init`, add a provider, `warsha new "your idea"`. That is the whole quickstart. The pipeline starts at Idea and stops at Gate A waiting for you — not at a paywall, not at a signup form.
- **CTA:** {{docs_url}}/quickstart.html
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

---

## Week +1 — Evidence (D+7 … D+13)

### D+7 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+7
- **Headline:** Week one
- **Body:** Seven days in: {{install_count}} installs, {{issue_count}} issues, and one clear theme — people want the gates auditable, not just visible. Every gate decision is already logged with device and timestamp; the audit view is the top request.
- **CTA:** Open an issue if your request is missing.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+8 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+8
- **Headline:** Give us the gate audit view
- **Body:** The most requested thing from week one: a screen showing who approved which gate, from which device, when, and what changed since. The data is already logged with device ID and timestamp. Surfacing it is next.
- **CTA:** {{repo_url}}/issues
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+8 · LinkedIn

- **Channel:** LinkedIn
- **Date offset:** D+8
- **Headline:** What shipped in week one
- **Body:** A week of launch feedback produced {{shipped_list}}. The interesting part is what we did not ship: nothing that publishes automatically, nothing that approves a gate without a person, nothing that phones home. Those three constraints held under pressure, which is the only test that matters.
- **CTA:** Release notes: {{repo_url}}/releases
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+9 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+9
- **Headline:** Three commands to a provider
- **Body:** `warsha providers add openai --name mine --key sk-...` then `warsha providers test mine`. The key goes to your keychain, the alias is what the pipeline routes roles to, and `warsha doctor` tells you what is missing on the machine.
- **CTA:** Provider guide: {{docs_url}}/providers.html
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+10 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+10
- **Headline:** Skills, MCP, and a scout that asks first
- **Body:** Warsha can propose skills and MCP servers per role, with source, version, license and permissions shown. Copyleft bundles are filtered out of anything we would ship. Nothing installs until you approve it, and every install lands in a lockfile you can read.
- **CTA:** {{docs_url}}
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+11 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+11
- **Headline:** Local models, role by role
- **Body:** Point Warsha at Ollama on localhost and the pipeline runs offline: no cloud key, no bill. Send the cheap roles to a small model and the PM or reviewer to a bigger one. Routing is per role, and the eval suite tells you when a swap breaks output.
- **CTA:** {{docs_url}}/providers.html
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+11 · Community forum

- **Channel:** Community forum (Reddit — r/opensource)
- **Date offset:** D+11
- **Headline:** Week one of a gated AI pipeline: what we got wrong
- **Body:** Three things we misjudged. One, people want to see the gate audit trail, not just the pending card. Two, "twelve agents" reads as eleven too many until you show the roles doing different work on the same artifact. Three, the local-model path matters more than we priced in. Full notes and what changed, in the thread.
- **CTA:** Tell us which of the three matches your experience.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+12 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+12
- **Headline:** Source-available, on purpose
- **Body:** Warsha is PolyForm Noncommercial 1.0.0: free for personal, research, education and non-profit work; commercial use needs a license. Readable code and honest funding, not a permissive license with a surprise in the footer.
- **CTA:** {{docs_url}}/tos.html
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+12 · LinkedIn

- **Channel:** LinkedIn
- **Date offset:** D+12
- **Headline:** On the non-commercial license
- **Body:** Warsha is PolyForm Noncommercial 1.0.0: personal, educational, research and non-profit use is free; commercial use needs a separate license from Athar Studio. We picked source-available over permissive on purpose — it keeps the project honest about who funds it while leaving the code readable to everyone who wants to learn from it.
- **CTA:** Licensing questions: licensing@warsha.dev
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+13 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+13
- **Headline:** What is next
- **Body:** Next up: routines on a real scheduler, an optional automation engine, dependency updates through PRs, and a feedback loop where the PM agent turns issues into a ranked backlog that re-enters at the spec stage. Same rule applies to all of it: nothing acts without a gate.
- **CTA:** {{repo_url}}/blob/main/PLAN.md
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

---

## Week +2 — Conversion (D+14 … D+20)

### D+14 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+14
- **Headline:** Good first issues
- **Body:** The issues labelled good-first-issue are real work, scoped to one file, with the failing case written down first. Arabic docs fixes count. So do provider adapters and gate-audit improvements.
- **CTA:** {{repo_url}}/issues?q=label%3Agood-first-issue
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+15 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+15
- **Headline:** Feedback in, ranked backlog out
- **Body:** Issues, opt-in crash reports and in-app notes land in one queue. The PM agent clusters them, scores severity, reach, cost and risk, and proposes a ranked backlog. You approve what enters, and approved items re-enter at the spec stage, never straight into code.
- **CTA:** {{docs_url}}
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+15 · LinkedIn

- **Channel:** LinkedIn
- **Date offset:** D+15
- **Headline:** How feedback becomes the next release
- **Body:** Issues, opt-in crash reports and in-app feedback all land in one queue. The PM agent clusters them, scores each on severity, reach, cost and risk, and proposes a ranked backlog. The owner approves what enters, and approved items re-enter the pipeline at the spec stage — never straight into code. The loop is documented, not improvised.
- **CTA:** {{docs_url}}
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+16 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+16
- **Headline:** شكراً
- **Body:** أسبوعان من الملاحظات والأخطاء والتصحيحات. شكراً لكل من فتح مشكلة أو جرّب على نموذج محلي أو صحّح نصاً عربياً. النسخة القادمة تُبنى من قائمتكم، وبوابات الموافقة تبقى كما هي.
- **CTA:** {{repo_url}}/issues
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+17 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+17
- **Headline:** Doctor before you file a bug
- **Body:** `warsha doctor` checks git, docker, node, pnpm, rustc, cargo and the coding CLIs it can drive. Half the bug reports we get are a missing tool; doctor says which one, in your language, with a `--json` mode for pasting into an issue.
- **CTA:** Run it, then open the issue.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+18 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+18
- **Headline:** Docs were the weak part
- **Body:** Two weeks of real installs found what our CI could not: a missing toolchain step and one confusing quickstart section. Both fixed, and `warsha doctor` is now part of the first run. Launch posts lie about docs; issue threads do not.
- **CTA:** {{docs_url}}/quickstart.html
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+18 · Community forum

- **Channel:** Community forum (Reddit — r/opensource)
- **Date offset:** D+18
- **Headline:** Two weeks later: the gate model held, the docs did not
- **Body:** Post-launch retrospective. Gate model: no regressions, no requests to bypass it, one request to audit it (shipped). Docs: the quickstart assumed a toolchain people do not have. What changed, what is still broken, and the checklist we now run before a release.
- **CTA:** Comments and corrections welcome; we will fold them into the next release notes.
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+19 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+19
- **Headline:** What stays off the roadmap
- **Body:** Routines, automation, dependency PRs, signed self-update the user approves: yes. Auto-posting, agent-approved gates, silent updates, default-on telemetry: no, permanently. A roadmap is also a list of things you have decided never to build.
- **CTA:** {{repo_url}}/blob/main/PLAN.md
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+19 · LinkedIn

- **Channel:** LinkedIn
- **Date offset:** D+19
- **Headline:** The roadmap, and what it refuses to include
- **Body:** Routines, optional automation, dependency updates through pull requests, signed self-update the user approves, and a feedback loop that ranks issues before they become work. What stays out: auto-posting, auto-approving gates, silent self-update, and any telemetry that is on by default.
- **CTA:** Read the plan: {{repo_url}}/blob/main/PLAN.md
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

### D+20 · X/Twitter

- **Channel:** X/Twitter
- **Date offset:** D+20
- **Headline:** After the launch window
- **Body:** The launch calendar ends here; the release notes do not. From next week it is one post per shipped feature, one per fixed bug class, and a monthly release summary — all drafted by the Marketer agent, all approved by a human, all `pending approval` until then.
- **CTA:** {{repo_url}}/releases
- **Approval gate:** Gate D — owner approves before posting
- **Status:** `pending approval`

---

## Approval Workflow

1. The Marketer agent updates this file and adds the post to the Gate D pack.
2. The owner reads each draft, fills the `{{placeholders}}`, and edits or rejects.
3. `warsha approve gate_d` records the decision with device ID and timestamp.
4. The owner copies the approved text into the platform and posts it by hand.
5. Nothing in this file changes state by itself; a row marked `pending approval` stays
   `pending approval` until a human posts it.

Rejected drafts are kept, not deleted: a rejected post is evidence about what the audience should
not hear, and the next week's drafts are written against it.

## What Is Deliberately Missing

- No scheduling integration, no API keys for any social platform in this repo.
- No engagement automation: no auto-follow, no auto-reply, no DM bot.
- No claimed metrics. Every number is a placeholder until the owner pastes a real one.