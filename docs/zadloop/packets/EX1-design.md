# Packet EX1 — Experts & Flexible Teams (DESIGN)

Status: DESIGN ONLY. No implementation in this packet.
Date: 2026-11-23. Base: `r-next/integration` @ `eaa6839`.
Decision: D-EX1-DESIGN-1.

## 0. Owner framing

Warsha stays harness-agnostic. There is no embedded harness. Experts is a native Warsha feature built on the existing role routing and the existing external-harness path (native pipeline, or opencode / Claude Code / Codex per Settings).

The owner's words: the project is measured first, the Secretary consults HR, they choose the team, then the spec kit and the roster are produced, and only then does work start. A core set is present in every team; the other experts are hired only when the project needs them. The pipeline is generated from the roster instead of being fixed.

This packet delivers the design. Implementation is sequenced after the current fix round.

## 1. What exists today (grounding)

`crates/warsha-core/src/lib.rs:186` defines a closed `Role` enum of 13 values: Intake, Researcher, PM, Designer, Architect, Coder, Reviewer, QA, Security, Release, Marketer, Feedback, Secretary. The pipeline stages are fixed and each stage maps to one of these roles. Settings already route a model per role, and the coding-backend registry already chooses a harness per stage.

An expert cannot be a new `Role` variant without a core change on every call site. So an expert is data that *resolves to* an existing role for routing, plus its own persona.

## 2. Data model

Four records. All text fields carry `ar` and `en`, both written natively. Model and provider names stay in English exactly as their real names.

### 2.1 Expert

| field | type | notes |
| --- | --- | --- |
| id | string | stable, kebab-case, unique |
| name | {ar, en} | native in both |
| category | enum | academic, engineering, design, product, data, security, qa, marketing, hr, other |
| avatar | string | icon key, not a binary |
| description | {ar, en} | 2–3 lines |
| persona | {ar, en} | system prompt, untrusted-content fenced when injected |
| role | Role | one of the 13 existing roles; this is what routing and budget key on |
| model_key | string | a routing key resolved by Settings, never a hardcoded model |
| tools_policy | enum | read-only, workspace-write, full-access (the existing Confinement set) |
| source | enum | builtin, custom, imported |
| enabled | bool | disabled experts cannot be summoned or hired |

### 2.2 Team

A named set of 2–8 expert ids with exactly one lead. Can be enabled and summoned as a unit.

### 2.3 Roster

The approved staffing of one project: `project_id`, `core` (expert ids), `hired` (expert ids), `status` (proposed, approved, restaffed), `approved_at`.

### 2.4 Spec kit

The existing stage artifacts (research, spec, design, plan) grouped as one reviewable bundle produced before work starts. No new artifact format.

## 3. Seed catalog

Built-in experts ship as data, not code. Software-project experts are complete first: one expert per existing role, plus the mandatory HR expert (workforce planning, category `hr`, role `PM` so it routes through an existing role). The wider library (the agency-agents reference spans 331 experts) ships as importable packs, not in the core binary.

The core team preset, owner-adjustable, defaults to: PM (orchestrator), Secretary, Reviewer. A project that skips staffing runs this preset and the current fixed pipeline.

## 4. Staffing flow

1. New project goes through the existing intake.
2. The Secretary produces a project assessment: size, domains, complexity, risks.
3. The Secretary calls the HR expert with the assessment. HR returns a roster: the core set plus project-specific experts drawn from the enabled catalog (a security expert only when the assessment names payments or auth; a data expert only for an analytics project).
4. Before any stage runs, staffing emits two artifacts: the spec kit and the roster. Both appear in Simple mode's decisions inbox. The owner approves, edits the roster, or asks for a re-staff.
5. Mid-project, a change request or a stage outcome can trigger re-staffing through the same inbox. Adding an expert beyond the approved roster always requires approval. Auto-suggest only, never a silent hire.

## 5. Flexible pipeline

The run pipeline is generated from the approved roster: a stage exists only when its role is on the team. The current fixed pipeline remains as the fallback preset for projects that skip staffing.

Every hired expert runs under the existing per-role model routing and the existing external-harness path. No new engine, no lock-in.

Budget: only hired roles consume budget. Per-expert spend is visible in Developers mode.

Factory mode shows only the project's hired experts on its floor.

Summoning: `@expert` in chat pulls an enabled expert into the conversation. A task may raise an auto-suggest card in the decisions inbox; accepting it is the hire.

## 6. Per-mode UX

- Settings → Experts. Header "Experts" with source filters (Built-in, Custom, Imported). Subtitle, native in both languages: "Manage domain expert agents. Summon anytime with @ in chat, or let tasks suggest them automatically." Tabs: Experts (total, enabled) and Expert teams (total, enabled). Filter row: source, category, status, search, batch actions, add. Card grid: avatar, name, category chip, enable toggle, 2–3 line description, view and duplicate. Opening a card edits the definition.
- Simple mode: the staffing proposal card in the decisions inbox, with approve, edit roster, and re-staff.
- Factory and Developers: the approved roster, and per-expert spend in Developers only.

## 7. Acceptance, per piece

1. Catalog: an expert record round-trips through store, list, enable, disable. Proving test: `expert_roundtrip_and_enable_flag`.
2. HR proposal: given an assessment that names payments, the roster includes the security expert; without it, the roster is core only. Proving test: `hr_roster_includes_security_only_when_assessment_names_payments`.
3. Approval gate: a run cannot start while the roster is `proposed`. Proving test: `run_refuses_to_start_on_an_unapproved_roster`.
4. Pipeline generation: a roster without Coder produces a pipeline without the code stage. Proving test: `pipeline_omits_stages_whose_role_is_not_hired`.
5. Fallback: a project that skips staffing gets the core preset and the fixed pipeline. Proving test: `skipped_staffing_uses_the_core_preset`.
6. No silent hire: an auto-suggest creates an inbox card and does not change the roster. Proving test: `auto_suggest_never_mutates_the_approved_roster`.
7. Hands-on GUI pass per OD-PRACTICAL-REVIEW-1: the Experts screen, the staffing card, and the roster in Factory, driven for real, in Arabic (RTL) and English.

## 8. Sequencing

Design lands now. Implementation waits until the current fix round (the R11 swarm) is merged or explicitly paused. Implementation order when it starts: data model and store, catalog seed, HR proposal and inbox approval, pipeline generation, then the Settings screen.
