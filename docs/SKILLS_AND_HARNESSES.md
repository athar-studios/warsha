# Skills, MCP servers and agent harnesses for Warsha

Research date: 2026-10-28. Star counts, licenses and last push dates come from the GitHub API on that date. Licenses must be re-checked at pin time.

**Bundling rule.** Warsha is PolyForm Noncommercial 1.0.0. MIT, Apache-2.0 or BSD content can be bundled, keeping its LICENSE and NOTICE in `THIRD_PARTY_NOTICES.md`. GPL/AGPL, noncommercial, "NOASSERTION"/no license or mixed licenses are **link-only**: the user can fetch them at runtime if they choose to, and Warsha never vendors them.

## A. Collections and harnesses

| Repo | Stars | License (API) | Last push | What it gives | Warsha use |
|---|---|---|---|---|---|
| [phuryn/pm-skills](https://github.com/phuryn/pm-skills) | 27.4k | MIT | 2026-10-16 | ~70 PM skills in 9 plugins (list below) | **Bundle**: PM base pack |
| [anthropics/skills](https://github.com/anthropics/skills) | 184k | none at root (per-skill; some source-available) | 2026-10-09 | Reference Agent Skills: frontend-design, webapp-testing, mcp-builder, skill-creator, brand-guidelines, theme-factory, docx/pdf/pptx/xlsx… | Link-only, except skills whose folder is Apache-2.0 (check each) |
| [obra/superpowers](https://github.com/obra/superpowers) | 307k | MIT | 2026-10-23 | Engineering workflow skills: brainstorming, writing plans, TDD, systematic debugging, code review, verification | **Bundle**: engineer/reviewer pack |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | 57k | MIT | 2026-10-27 | Marketing skills: CRO, copywriting, SEO, launch, email, social | **Bundle**: marketer/social pack |
| [wshobson/agents](https://github.com/wshobson/agents) | 41.9k | MIT | 2026-10-26 | Large catalog of role subagents and plugins (devops, security, cost, docs…) | **Bundle** selected roles |
| [github/spec-kit](https://github.com/github/spec-kit) | 143k | MIT | 2026-10-28 | Spec-driven development: constitution → specify → plan → tasks → implement | **Bundle** flow ideas/templates for Spec + Plan stages |
| [buildermethods/agent-os](https://github.com/buildermethods/agent-os) | 5.6k | MIT | 2026-10-07 | Standards + spec workflow for coding agents | Reference/bundle templates |
| [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) | 54.7k | NOASSERTION | 2026-10-27 | Agile agent team (analyst, PM, architect, dev, QA) with workflows | Link-only; borrow concepts only |
| [FoundationAgents/MetaGPT](https://github.com/FoundationAgents/MetaGPT) | 71k | MIT | 2026-01-21 | "Software company" multi-agent SOPs (PM → architect → engineer) | Reference for role SOPs |
| [OpenBMB/ChatDev](https://github.com/OpenBMB/ChatDev) | 34.6k | Apache-2.0 | 2026-10-16 | Virtual software company with chat chains | Reference |
| [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | 92k | MIT | 2026-10-28 | Coding agent platform | Already a planned backend (M7) |
| [aaif-goose/goose](https://github.com/aaif-goose/goose) (was block/goose) | 55.9k | Apache-2.0 | 2026-10-28 | Agent engine, MCP extensions, recipes | Core dependency (pinned) |
| [AntonOsika/gpt-engineer](https://github.com/AntonOsika/gpt-engineer) | 55k | MIT | 2025-05-14 (**archived**) | Early idea→code generator | Reference only |
| [anthropics/claude-code-security-review](https://github.com/anthropics/claude-code-security-review) | 6.6k | MIT | 2026-02-11 | AI security review GitHub Action | **Bundle** in template CI |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | 78k | none | 2026-09-18 | Curated skills list | Discovery source (scout) |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | 15.6k | none | 2026-04-28 | Curated skills list | Discovery source (scout) |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | 91.6k | NOASSERTION (mixed) | 2026-10-27 | Reference MCP servers (filesystem, git, fetch, memory…) | Run as external processes; link/fetch |
| [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry) | 7.4k | NOASSERTION | 2026-10-28 | Official MCP Registry API | Scout's primary MCP source |
| [github/github-mcp-server](https://github.com/github/github-mcp-server) | 34k | MIT | 2026-10-28 | GitHub issues, PRs, actions | Default MCP |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | 38.8k | Apache-2.0 | 2026-10-22 | Browser automation | QA/designer MCP |
| [GLips/Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP) | 16.1k | MIT | 2026-10-27 | Figma layouts for agents | Designer MCP |
| [cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare) | 4.4k | Apache-2.0 | 2026-10-22 | Workers/Pages/DNS | DevOps MCP |
| [getsentry/sentry-mcp](https://github.com/getsentry/sentry-mcp) (now under getsentry/toolkit) | 0.9k | NOASSERTION | 2026-10-28 | Errors/issues | Feedback MCP, link-only |
| [stripe/agent-toolkit](https://github.com/stripe/agent-toolkit) (now stripe/ai) | 2k | MIT | 2026-10-28 | Stripe API tools/MCP | Finance MCP (read-only by default) |

**phuryn/pm-skills, plugin → skills:**
- pm-product-discovery: analyze-feature-requests, brainstorm-ideas-new/existing, brainstorm-experiments-new/existing, identify/prioritize-assumptions, interview-script, summarize-interview, opportunity-solution-tree, prioritize-features, metrics-dashboard
- pm-product-strategy: product-vision, product-strategy, value-proposition, business-model, lean-canvas, startup-canvas, monetization-strategy, pricing-strategy, swot, pestle, porters-five-forces, ansoff-matrix
- pm-market-research: competitor-analysis, market-sizing, market-segments, user-personas, user-segmentation, customer-journey-map, sentiment-analysis
- pm-execution: create-prd, user-stories, job-stories, wwas, outcome-roadmap, sprint-plan, brainstorm-okrs, prioritization-frameworks, pre-mortem, strategy-red-team, stakeholder-map, test-scenarios, release-notes, retro, summarize-meeting, dummy-dataset
- pm-go-to-market: gtm-strategy, gtm-motions, beachhead-segment, ideal-customer-profile, competitive-battlecard, growth-loops
- pm-marketing-growth: marketing-ideas, positioning-ideas, product-name, value-prop-statements, north-star-metric
- pm-data-analytics: ab-test-analysis, cohort-analysis, sql-queries
- pm-ai-shipping: code-review, intended-vs-implemented, shipping-artifacts
- pm-toolkit: privacy-policy, draft-nda, grammar-check, review-resume

## B. Starter packs per role

| Role | Skills (repo/path) | MCP servers |
|---|---|---|
| Orchestrator | superpowers (brainstorming, writing-plans, dispatching-parallel-agents, subagent-driven-development); pm-skills pm-execution/stakeholder-map; Warsha discovery-interview (own) | Warsha internal (gates, events), MCP Registry (scout), memory (modelcontextprotocol/servers) |
| Project Manager | **pm-skills: all 9 plugins**; spec-kit flow | GitHub MCP (issues/milestones), memory |
| Researcher | pm-market-research/*, pm-product-strategy/swot, competitor-analysis | fetch (reference servers), Playwright MCP |
| Product / Spec | pm-execution/create-prd, user-stories, job-stories, test-scenarios; spec-kit specify/plan/tasks | GitHub MCP |
| Designer | anthropics/skills frontend-design, theme-factory, brand-guidelines (link-only unless licensed) | Figma-Context-MCP, Playwright MCP (screenshots) |
| Architect | superpowers writing-plans; agent-os standards; wshobson/agents architecture roles | GitHub MCP, filesystem |
| Software Engineer | superpowers test-driven-development, systematic-debugging, verification-before-completion | Goose built-ins, filesystem, git, GitHub MCP |
| Reviewer | superpowers requesting/receiving-code-review; pm-ai-shipping/code-review, intended-vs-implemented | GitHub MCP (PR review) |
| QA | anthropics/skills webapp-testing (link-only check); pm-execution/test-scenarios | Playwright MCP |
| Security | claude-code-security-review (CI); wshobson/agents security roles | GitHub MCP (code scanning alerts) |
| DevOps / Release | wshobson/agents devops/deployment roles; pm-execution/release-notes; pm-ai-shipping/shipping-artifacts | GitHub MCP (Actions/Releases), Cloudflare MCP |
| Marketer | marketingskills (launch, marketing-plan, seo-audit, ai-seo, aso, cro, emails); pm-go-to-market/*, pm-marketing-growth/* | fetch, Playwright |
| Social Media Manager | marketingskills social, content-strategy, copywriting, image, video; Warsha approval-queue skill (own) | Per-platform official APIs only, behind approval gate |
| Cost & Finance Manager | pm-product-strategy/pricing-strategy, business-model; Warsha cost-meter skill (own) | Warsha cost meter; Stripe MCP (read-only) |
| Feedback / Support | pm-product-discovery/analyze-feature-requests, summarize-interview; pm-market-research/sentiment-analysis; pm-data-analytics/* | Sentry MCP (link-only), GitHub MCP (issues) |

## C. Product requirements

**R1. Discovery interview (Gate A input).** For every new project the Orchestrator, helped by the PM, asks the owner clarifying questions one batch at a time until every required field is answered: problem, audience, platforms (web only / + mobile / + desktop / + social pages), languages, monetization (none / ads / paid / later), branding (name, logo, colors), integrations, data and privacy, budget cap, success metric, out-of-scope. Output: `factory/brief.md`, signed off at Gate A. Unknowns stay as explicit "assumptions" the owner accepts.

**R2. Skill/MCP scout.** After Gate A, and whenever the plan changes, the scout searches the MCP Registry, the bundled catalog and the curated lists. It proposes skills/MCPs per project and per agent, with the source URL, the pinned version/commit, the license class (bundle/link-only) and the permissions requested. Nothing is installed without approval for each item. Installs are sandboxed, pinned (by commit/hash), recorded in `factory/skills.lock` and removable. Each MCP tool needs approval the first time it is used, and its access can be narrowed.

**R3. A-to-Z delivery.** The pipeline extends past release: store listing, landing page, launch posts and social pages for the platforms chosen in R1. Every outbound post, account creation and publish goes through Gate D (owner approval), with a calendar view. No auto-posting.

**R4. Continuous development loop.** After release the PM runs a scheduled review: feedback, issues, error reports, analytics (whatever the owner connected). It proposes a ranked backlog (fixes + features), and approved items re-enter the pipeline at Spec → Gate B → … → Gate C. Every loop iteration is logged.

**R5. Role packs.** Each role ships with its default pack from section B, which can be edited in Settings → Roles. Packs are versioned, and updates are shown as diffs for approval.

**R6. Supporting requirements.** An explicit Orchestrator agent. A simple mode (team cards, side panel with plain summaries, chat with the Orchestrator, gate buttons) and an advanced mode (event stream, diffs, logs, costs), switched by one toggle. Only official subscription routes (API keys, local models, official CLIs), with no consumer-token reuse.

**Milestone fit.** M0–M9 stay as planned and reach v0.1.0. Later milestones toward v1.0.0 add skills/MCP and the scout, the two UI modes, discovery, marketing/social and the dev loop. Self-hosting (Warsha builds Warsha) comes after v1.0.0.
