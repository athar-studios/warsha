//! Harness system types — declarative pipeline definitions and the bundled
//! software-factory presets (PLAN.md Wave 2).
//!
//! A [`HarnessDefinition`] is a whole pipeline shape: ordered stages, each bound
//! to an agent [`Role`](crate::Role), plus the rules that bound repair loops,
//! budget and verification. Presets are shipped in code via
//! [`bundled_harnesses`]; user-authored harnesses are stored with
//! `preset = false`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::Role;

/// A declarative definition of a pipeline harness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessDefinition {
    /// Stable identifier, e.g. `complex-workbench`.
    pub id: String,
    /// Schema version of this definition, e.g. `1.0.0`.
    pub version: String,
    /// Human-readable name.
    pub name: String,
    /// One-paragraph description shown in the picker.
    pub description: String,
    /// Ordered stages the run walks through.
    pub stages: Vec<HarnessStage>,
    /// Rules that bound the whole run.
    pub rules: HarnessRules,
    /// True for the pre-bundled presets; false for user-authored harnesses.
    pub preset: bool,
    /// Whether this harness is currently active for new runs.
    #[serde(default)]
    pub active: bool,
    /// When the definition was created.
    pub created_at: DateTime<Utc>,
}

/// One stage inside a harness: a role, an optional prompt template and an
/// optional gate the supervisor must clear before advancing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessStage {
    /// Stable identifier of the stage within its harness.
    pub id: String,
    /// The agent role that runs this stage.
    pub role: Role,
    /// Human-readable stage name.
    pub name: String,
    /// Optional prompt template; supports `{artifact}` placeholders.
    pub prompt_template: Option<String>,
    /// Optional gate identifier that must be approved to leave this stage.
    pub gate: Option<String>,
    /// Whether the run advances without waiting for a decision when no gate
    /// is configured.
    pub auto_advance: bool,
}

/// Run-wide rules a harness enforces.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HarnessRules {
    /// Upper bound on build-test-repair iterations before the run stops.
    pub max_repair_iterations: u32,
    /// Hard spending limit for the run, in cents; `None` means uncapped.
    pub budget_cap_cents: Option<u64>,
    /// Whether a stage may fan out to parallel subagents.
    pub allow_parallel_subagents: bool,
    /// Whether completion requires a verification receipt on file.
    pub require_verification_receipt: bool,
}

/// A fixed creation timestamp for the shipped presets: 2025-01-01T00:00:00Z.
fn preset_created_at() -> DateTime<Utc> {
    DateTime::from_timestamp(1_735_689_600, 0).unwrap_or_default()
}

/// The seven bundled software-factory presets, in showcase order.
///
/// Each one names a real community pattern (Fabro/Qoder workbench, the Loki +
/// Hard Mode factory, ticket-to-PR, bounded repair graphs, HAR worktree fleets,
/// sealed-envelope blind verification, solo supervisor) so the picker shows
/// the whole spectrum from full supervision to single-agent minimalism.
pub fn bundled_harnesses() -> Vec<HarnessDefinition> {
    vec![
        complex_workbench(),
        autonomous_factory(),
        ticket_to_pr(),
        graph_gated(),
        fleet_worktrees(),
        sealed_envelope(),
        solo_bench(),
    ]
}

fn stage(
    id: &str,
    role: Role,
    name: &str,
    prompt_template: Option<&str>,
    gate: Option<&str>,
    auto_advance: bool,
) -> HarnessStage {
    HarnessStage {
        id: id.to_string(),
        role,
        name: name.to_string(),
        prompt_template: prompt_template.map(str::to_string),
        gate: gate.map(str::to_string),
        auto_advance,
    }
}

fn harness(
    id: &str,
    name: &str,
    description: &str,
    stages: Vec<HarnessStage>,
    rules: HarnessRules,
) -> HarnessDefinition {
    HarnessDefinition {
        id: id.to_string(),
        version: "1.0.0".to_string(),
        name: name.to_string(),
        description: description.to_string(),
        stages,
        rules,
        preset: true,
        active: false,
        created_at: preset_created_at(),
    }
}

/// 1. "complex-workbench": Fabro + Qoder interactive multi-stage workbench.
fn complex_workbench() -> HarnessDefinition {
    harness(
        "complex-workbench",
        "Complex Workbench",
        "Fabro + Qoder interactive multi-stage workbench with full developer \
         supervision, live preview, diff inspect, and subagent swarm panel",
        vec![
            stage(
                "intake",
                Role::Intake,
                "Intake",
                Some("Capture the ticket or idea verbatim; do not interpret yet."),
                Some("supervisor-approval"),
                false,
            ),
            stage(
                "architect",
                Role::Architect,
                "Architecture",
                Some(
                    "Produce the architecture document against {artifact:prd-spec}; \
                     mark every decision with rationale.",
                ),
                Some("supervisor-approval"),
                false,
            ),
            stage(
                "code",
                Role::Coder,
                "Implementation workbench",
                Some(
                    "Implement the approved plan in a branch. Keep the live preview \
                     running; every change must be diff-inspectable by the supervisor.",
                ),
                Some("diff-inspect"),
                false,
            ),
            stage(
                "review",
                Role::Reviewer,
                "Review & QA swarm",
                Some(
                    "Dispatch parallel review subagents (correctness, security, tests) \
                     and aggregate findings in the swarm panel.",
                ),
                Some("supervisor-approval"),
                false,
            ),
            stage(
                "release",
                Role::Release,
                "Release preparation",
                Some("Assemble the release draft once the supervisor signs the review."),
                None,
                false,
            ),
        ],
        HarnessRules {
            max_repair_iterations: 5,
            budget_cap_cents: None,
            allow_parallel_subagents: true,
            require_verification_receipt: false,
        },
    )
}

/// 2. "autonomous-factory": Loki + Hard Mode 9-stage pipeline.
fn autonomous_factory() -> HarnessDefinition {
    harness(
        "autonomous-factory",
        "Autonomous Factory",
        "Loki + Hard Mode 9-stage autonomous pipeline with budget cap, automated \
         evaluation, and verification receipt",
        vec![
            stage("intake", Role::Intake, "Intake", None, None, true),
            stage("research", Role::Researcher, "Research", None, None, true),
            stage(
                "prd",
                Role::PM,
                "PRD spec",
                Some("Write the PRD; ambiguities are decided and logged, never asked."),
                None,
                true,
            ),
            stage("design", Role::Designer, "Design", None, None, true),
            stage(
                "architect",
                Role::Architect,
                "Architecture",
                None,
                None,
                true,
            ),
            stage(
                "code",
                Role::Coder,
                "Coding",
                Some(
                    "Implement against the architecture. Budget cap is hard: stop and \
                     report rather than exceed it.",
                ),
                None,
                true,
            ),
            stage(
                "review",
                Role::Reviewer,
                "Automated evaluation",
                None,
                Some("auto-eval"),
                true,
            ),
            stage(
                "qa",
                Role::QA,
                "Verification",
                Some("Run the full suite and emit the verification receipt."),
                Some("verification-receipt"),
                true,
            ),
            stage("release", Role::Release, "Release", None, None, true),
        ],
        HarnessRules {
            max_repair_iterations: 3,
            budget_cap_cents: Some(2_000),
            allow_parallel_subagents: true,
            require_verification_receipt: true,
        },
    )
}

/// 3. "ticket-to-pr": the Minimum Viable Factory.
fn ticket_to_pr() -> HarnessDefinition {
    harness(
        "ticket-to-pr",
        "Ticket to PR",
        "Minimum Viable Factory: intake spec -> architecture -> coding in branch \
         -> automated review & tests -> PR ready",
        vec![
            stage(
                "intake",
                Role::Intake,
                "Intake spec",
                Some("Turn the ticket into a crisp implementation spec."),
                None,
                true,
            ),
            stage(
                "architect",
                Role::Architect,
                "Architecture",
                Some("Choose the minimal change shape that satisfies the spec."),
                None,
                true,
            ),
            stage(
                "code",
                Role::Coder,
                "Coding in branch",
                Some("Implement on a feature branch; keep commits scoped and conventional."),
                None,
                true,
            ),
            stage(
                "review",
                Role::Reviewer,
                "Automated review & tests",
                Some("Review the diff and run the test suite; request changes inline."),
                Some("tests-green"),
                true,
            ),
            stage(
                "release",
                Role::Release,
                "PR ready",
                Some("Open the pull request with the spec, decisions and test evidence."),
                None,
                true,
            ),
        ],
        HarnessRules {
            max_repair_iterations: 2,
            budget_cap_cents: Some(500),
            allow_parallel_subagents: false,
            require_verification_receipt: true,
        },
    )
}

/// 4. "graph-gated": atomic bounded repair loop.
fn graph_gated() -> HarnessDefinition {
    harness(
        "graph-gated",
        "Graph Gated",
        "Atomic bounded repair: iterative build-test-repair loop with max 3 cycles, \
         circuit breaker on error",
        vec![
            stage(
                "code",
                Role::Coder,
                "Build",
                Some(
                    "Make the atomic change; build and test. On failure, repair within \
                 the cycle budget. The circuit breaker trips after the third failed \
                 cycle and the run halts with the error report.",
                ),
                Some("build-green"),
                true,
            ),
            stage(
                "qa",
                Role::QA,
                "Gate verification",
                Some("Confirm the gate receipt before the change is considered done."),
                Some("gate-approved"),
                true,
            ),
        ],
        HarnessRules {
            max_repair_iterations: 3,
            budget_cap_cents: Some(300),
            allow_parallel_subagents: false,
            require_verification_receipt: true,
        },
    )
}

/// 5. "fleet-worktrees": HAR isolated slots.
fn fleet_worktrees() -> HarnessDefinition {
    harness(
        "fleet-worktrees",
        "Fleet Worktrees",
        "HAR isolated slots: parallel isolated worktree execution, concurrent task \
         lanes, merge queue",
        vec![
            stage(
                "intake",
                Role::Intake,
                "Task split",
                Some("Split the fleet request into independent task lanes."),
                None,
                true,
            ),
            stage(
                "architect",
                Role::Architect,
                "Isolation plan",
                Some("Assign each lane its own worktree slot and define the merge order."),
                None,
                true,
            ),
            stage(
                "code",
                Role::Coder,
                "Parallel lanes",
                Some(
                    "Each lane runs in its isolated worktree; lanes never share a \
                     checkout and each keeps its own build-test-repair budget.",
                ),
                Some("lanes-green"),
                true,
            ),
            stage(
                "review",
                Role::Reviewer,
                "Merge queue review",
                Some("Review lanes in merge order; a failing lane is parked, not skipped."),
                Some("merge-approved"),
                true,
            ),
            stage(
                "release",
                Role::Release,
                "Merge & release",
                Some("Drain the merge queue and publish the combined result."),
                None,
                true,
            ),
        ],
        HarnessRules {
            max_repair_iterations: 3,
            budget_cap_cents: Some(5_000),
            allow_parallel_subagents: true,
            require_verification_receipt: true,
        },
    )
}

/// 6. "sealed-envelope": Dark Factory blind verification.
fn sealed_envelope() -> HarnessDefinition {
    harness(
        "sealed-envelope",
        "Sealed Envelope",
        "Dark Factory: hidden test suite, blind verification before sign-off",
        vec![
            stage(
                "intake",
                Role::Intake,
                "Sealed spec",
                Some(
                    "Write the spec envelope. The hidden acceptance suite is prepared \
                     by QA and is never shown to the coder.",
                ),
                None,
                true,
            ),
            stage(
                "architect",
                Role::Architect,
                "Architecture",
                None,
                None,
                true,
            ),
            stage(
                "code",
                Role::Coder,
                "Blind implementation",
                Some(
                    "Implement against the spec only. You will not see the tests; \
                     the envelope is opened at verification time.",
                ),
                None,
                true,
            ),
            stage(
                "qa",
                Role::QA,
                "Blind verification",
                Some(
                    "Run the hidden suite exactly once per envelope; record the receipt \
                     whether it passes or fails.",
                ),
                Some("envelope-open"),
                true,
            ),
            stage(
                "release",
                Role::Release,
                "Sign-off",
                Some("Sign off only on a passing verification receipt."),
                Some("sign-off"),
                false,
            ),
        ],
        HarnessRules {
            max_repair_iterations: 2,
            budget_cap_cents: Some(1_000),
            allow_parallel_subagents: false,
            require_verification_receipt: true,
        },
    )
}

/// 7. "solo-bench": minimalist single-agent supervisor flow.
fn solo_bench() -> HarnessDefinition {
    harness(
        "solo-bench",
        "Solo Bench",
        "Minimalist single-agent supervisor flow for quick prototypes",
        vec![stage(
            "solo",
            Role::Coder,
            "Solo prototype",
            Some(
                "You are the whole pipeline: decide, implement, test and report in one \
                 session. Keep it small, keep it running.",
            ),
            None,
            true,
        )],
        HarnessRules {
            max_repair_iterations: 1,
            budget_cap_cents: Some(100),
            allow_parallel_subagents: false,
            require_verification_receipt: false,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_harnesses_have_the_seven_presets() {
        let ids: Vec<String> = bundled_harnesses().into_iter().map(|h| h.id).collect();
        assert_eq!(
            ids,
            [
                "complex-workbench",
                "autonomous-factory",
                "ticket-to-pr",
                "graph-gated",
                "fleet-worktrees",
                "sealed-envelope",
                "solo-bench",
            ]
        );
        assert!(bundled_harnesses().iter().all(|h| h.preset));
    }

    #[test]
    fn graph_gated_caps_repair_at_three_cycles() {
        let graph = bundled_harnesses()
            .into_iter()
            .find(|h| h.id == "graph-gated")
            .expect("the preset exists");
        assert_eq!(graph.rules.max_repair_iterations, 3);
    }

    #[test]
    fn autonomous_factory_is_the_nine_stage_preset() {
        let factory = bundled_harnesses()
            .into_iter()
            .find(|h| h.id == "autonomous-factory")
            .expect("the preset exists");
        assert_eq!(factory.stages.len(), 9);
        assert!(factory.rules.require_verification_receipt);
    }

    #[test]
    fn harness_definitions_round_trip_through_json() {
        for harness in bundled_harnesses() {
            let encoded = serde_json::to_string(&harness).expect("encodes");
            let decoded: HarnessDefinition = serde_json::from_str(&encoded).expect("decodes");
            assert_eq!(decoded, harness);
        }
    }
}
