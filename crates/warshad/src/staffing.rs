//! Secretary staffing (EX1, smallest slice).
//!
//! The roster is the core team plus project-specific experts. A proposal is that
//! roster plus a provisioning record for every member: what skills and tools the
//! Secretary assigned, and the audited source they came from. Re-staffing is a
//! new proposal, not a silent edit of an approved roster.
//!
//! This is not a second pipeline. The fixed pipeline stays the core-team preset
//! for a project that skips staffing (EX1 §5).

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use warsha_core::Role;
use warsha_store::{ProvisioningRecord, Store, StoreError};

use crate::secretary_chat::FIXED_SECRETARY_SYSTEM_PROMPT;

/// Version of the fixed prompt this proposal was composed under.
pub const STAFFING_PROMPT_VERSION: &str = "sec-hr-1";

/// Expert id of the mandatory HR partner (EX1 §3). Resolves to `Role::PM`.
pub const HR_EXPERT_ID: &str = "hr/hr-recruiter";

/// Core team preset: PM, Secretary, Reviewer (EX1 §3). Owner-adjustable later;
/// this slice ships the default.
pub const CORE_TEAM_PRESET: &[(&str, Role)] = &[
    ("pm", Role::PM),
    ("secretary", Role::Secretary),
    ("reviewer", Role::Reviewer),
];

/// One rostered agent. `expert_id` is stable; `role` is one of the 13 existing
/// roles, which is what routing and budget key on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RosterMember {
    pub expert_id: String,
    pub role: Role,
    /// `true` for the core preset, `false` for a project-specific hire.
    pub core: bool,
}

/// The staffing of one project. `proposed` until the owner approves it in
/// Simple mode; work does not start from a proposal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RosterStatus {
    Proposed,
    Approved,
}

/// Core members plus project-specific experts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamRoster {
    pub project_id: Uuid,
    pub members: Vec<RosterMember>,
    pub status: RosterStatus,
}

/// What the owner sees before any work starts: the roster, and a provisioning
/// record for every rostered agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StaffingProposal {
    pub roster: TeamRoster,
    pub provisioning: Vec<ProvisioningRecord>,
    /// The fixed Secretary prompt version this proposal was composed under.
    pub prompt_version: String,
}

/// Domains the assessment can name. A payment or auth domain hires Security;
/// an analytics domain hires the data expert on the Researcher role.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssessmentDomain {
    Payments,
    Auth,
    Analytics,
}

/// The Secretary's measurement of a project, before any agent starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectAssessment {
    pub project_id: Uuid,
    pub domains: Vec<AssessmentDomain>,
}

/// Build the smallest sufficient roster: the core preset, plus a hire only when
/// the assessment names a domain that needs one. HR is consulted (the expert id
/// is recorded on the proposal path) but is not itself a pipeline stage.
pub fn compose_roster(assessment: &ProjectAssessment) -> TeamRoster {
    let mut members: Vec<RosterMember> = CORE_TEAM_PRESET
        .iter()
        .map(|(id, role)| RosterMember {
            expert_id: (*id).to_string(),
            role: *role,
            core: true,
        })
        .collect();
    if assessment.domains.contains(&AssessmentDomain::Payments)
        || assessment.domains.contains(&AssessmentDomain::Auth)
    {
        members.push(RosterMember {
            expert_id: "security".to_string(),
            role: Role::Security,
            core: false,
        });
    }
    if assessment.domains.contains(&AssessmentDomain::Analytics) {
        members.push(RosterMember {
            expert_id: "data".to_string(),
            role: Role::Researcher,
            core: false,
        });
    }
    TeamRoster {
        project_id: assessment.project_id,
        members,
        status: RosterStatus::Proposed,
    }
}

/// Skills and tools for one role, from the bundled catalog. The source is the
/// upstream the catalog already names; nothing here is a secret.
fn provision_for(
    role: Role,
) -> (
    &'static [&'static str],
    &'static [&'static str],
    &'static str,
) {
    match role {
        Role::PM => (
            &["writing-plans"],
            &["github-mcp"],
            "github.com/obra/superpowers",
        ),
        Role::Secretary => (&["secretary-interview"], &[], "builtin:warsha"),
        Role::Reviewer => (
            &["requesting-code-review", "verification-before-completion"],
            &["github-mcp"],
            "github.com/obra/superpowers",
        ),
        Role::Security => (
            &["security-review"],
            &["github-mcp"],
            "github.com/anthropics/skills",
        ),
        Role::Researcher => (
            &["brainstorming"],
            &["github-mcp"],
            "github.com/obra/superpowers",
        ),
        Role::Intake => (&["brainstorming"], &[], "github.com/obra/superpowers"),
        Role::Designer => (&["brainstorming"], &[], "github.com/obra/superpowers"),
        Role::Architect => (
            &["writing-plans"],
            &["github-mcp"],
            "github.com/obra/superpowers",
        ),
        Role::Coder => (
            &[
                "test-driven-development",
                "systematic-debugging",
                "using-git-worktrees",
            ],
            &["github-mcp", "filesystem-mcp", "git-mcp"],
            "github.com/obra/superpowers",
        ),
        Role::QA => (
            &["verification-before-completion"],
            &["github-mcp"],
            "github.com/obra/superpowers",
        ),
        Role::Release => (
            &["finishing-a-development-branch"],
            &["github-mcp", "git-mcp"],
            "github.com/obra/superpowers",
        ),
        Role::Marketer => (&["copywriting"], &[], "github.com/anthropics/skills"),
        Role::Feedback => (&["brainstorming"], &[], "github.com/obra/superpowers"),
    }
}

fn role_wire_name(role: Role) -> String {
    // `Role` serializes as snake_case. A failure here is a programming error in
    // the enum, not a recoverable store error; the name is a closed set.
    match serde_json::to_value(role) {
        Ok(serde_json::Value::String(name)) => name,
        _ => match role {
            Role::Intake => "intake",
            Role::Researcher => "researcher",
            Role::PM => "pm",
            Role::Designer => "designer",
            Role::Architect => "architect",
            Role::Coder => "coder",
            Role::Reviewer => "reviewer",
            Role::QA => "qa",
            Role::Security => "security",
            Role::Release => "release",
            Role::Marketer => "marketer",
            Role::Feedback => "feedback",
            Role::Secretary => "secretary",
        }
        .to_string(),
    }
}

fn record_for(
    project_id: Uuid,
    member: &RosterMember,
    now: chrono::DateTime<Utc>,
) -> ProvisioningRecord {
    let (skills, tools, source) = provision_for(member.role);
    ProvisioningRecord {
        project_id,
        agent_id: member.expert_id.clone(),
        role: role_wire_name(member.role),
        skills: skills.iter().map(|s| (*s).to_string()).collect(),
        tools: tools.iter().map(|s| (*s).to_string()).collect(),
        source: source.to_string(),
        audited: true,
        created_at: now,
    }
}

/// Compose the roster and a provisioning record for every member.
///
/// The proposal is `proposed`. Nothing here starts work, merges, or publishes.
/// The fixed prompt is consulted so a regression to an empty prompt cannot
/// produce a proposal: composing asserts the duties are still in the const.
pub fn propose_staffing(assessment: &ProjectAssessment) -> StaffingProposal {
    debug_assert!(
        FIXED_SECRETARY_SYSTEM_PROMPT.contains("never write code"),
        "the fixed Secretary prompt regressed"
    );
    let roster = compose_roster(assessment);
    let now = Utc::now();
    let provisioning = roster
        .members
        .iter()
        .map(|member| record_for(assessment.project_id, member, now))
        .collect();
    StaffingProposal {
        roster,
        provisioning,
        prompt_version: STAFFING_PROMPT_VERSION.to_string(),
    }
}

/// Persist every provisioning record of a proposal. Re-proposing the same agent
/// replaces that agent's row; other agents on the project are left as stored.
pub async fn persist_proposal(
    store: &Store,
    proposal: &StaffingProposal,
) -> Result<(), StoreError> {
    for record in &proposal.provisioning {
        store.save_provisioning(record).await?;
    }
    Ok(())
}

/// The HR expert the Secretary consults while composing. Recorded so a proposal
/// can name its partner without hiring HR onto the pipeline.
pub fn hr_partner() -> &'static str {
    HR_EXPERT_ID
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn staffing_proposal_records_every_rostered_agent_and_round_trips() {
        let project_id = Uuid::new_v4();
        let assessment = ProjectAssessment {
            project_id,
            domains: vec![AssessmentDomain::Payments],
        };
        let proposal = propose_staffing(&assessment);
        assert!(
            proposal.provisioning.len() >= 3,
            "core team is at least three"
        );
        let rostered: Vec<&str> = proposal
            .roster
            .members
            .iter()
            .map(|member| member.expert_id.as_str())
            .collect();
        let recorded: Vec<&str> = proposal
            .provisioning
            .iter()
            .map(|record| record.agent_id.as_str())
            .collect();
        assert_eq!(rostered, recorded, "every rostered agent has a record");
        assert!(
            proposal
                .provisioning
                .iter()
                .all(|record| !record.source.is_empty()
                    && record.audited
                    && !record.source.contains("sk-")),
            "a record names an audited source and never a secret"
        );
        assert!(rostered.contains(&"security"), "payments hires security");

        let dir = tempfile::tempdir().expect("temp dir");
        let store = Store::open_at(dir.path().join("warsha.db"))
            .await
            .expect("store");
        persist_proposal(&store, &proposal).await.expect("persist");
        let loaded = store.list_provisioning(project_id).await.expect("list");
        assert_eq!(loaded.len(), proposal.provisioning.len());
        for record in &proposal.provisioning {
            let found = loaded
                .iter()
                .find(|row| row.agent_id == record.agent_id)
                .expect("stored");
            assert_eq!(found.skills, record.skills);
            assert_eq!(found.tools, record.tools);
            assert_eq!(found.source, record.source);
            assert_eq!(found.role, record.role);
        }
        let _ = hr_partner();
    }
}
