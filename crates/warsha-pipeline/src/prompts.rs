//! Role prompt templates

use std::collections::HashMap;
use std::sync::OnceLock;
use warsha_core::Role;

static PROMPTS: OnceLock<HashMap<Role, String>> = OnceLock::new();

/// Initialize prompts from embedded files
fn init_prompts() -> HashMap<Role, String> {
    let mut map = HashMap::new();

    map.insert(Role::Intake, include_str!("prompts/intake.md").to_string());
    map.insert(
        Role::Researcher,
        include_str!("prompts/researcher.md").to_string(),
    );
    map.insert(Role::PM, include_str!("prompts/pm.md").to_string());
    map.insert(
        Role::Designer,
        include_str!("prompts/designer.md").to_string(),
    );
    map.insert(
        Role::Architect,
        include_str!("prompts/architect.md").to_string(),
    );
    map.insert(Role::Coder, include_str!("prompts/coder.md").to_string());
    map.insert(
        Role::Reviewer,
        include_str!("prompts/reviewer.md").to_string(),
    );
    map.insert(Role::QA, include_str!("prompts/qa.md").to_string());
    map.insert(
        Role::Security,
        include_str!("prompts/security.md").to_string(),
    );
    map.insert(
        Role::Release,
        include_str!("prompts/release.md").to_string(),
    );
    map.insert(
        Role::Marketer,
        include_str!("prompts/marketer.md").to_string(),
    );
    map.insert(
        Role::Feedback,
        include_str!("prompts/feedback.md").to_string(),
    );

    map
}

/// Get the prompt template for a role
pub fn get_prompt(role: Role) -> &'static str {
    let prompts = PROMPTS.get_or_init(init_prompts);
    prompts.get(&role).map(|s| s.as_str()).unwrap_or("")
}

/// Get the role for a stage
pub fn role_for_stage(stage: warsha_core::Stage) -> Option<Role> {
    use warsha_core::Stage;
    match stage {
        Stage::Idea => Some(Role::Intake),
        Stage::Research => Some(Role::Researcher),
        Stage::PrdSpec => Some(Role::PM),
        Stage::Design => Some(Role::Designer),
        Stage::PlanTasks => Some(Role::Architect),
        Stage::Code => Some(Role::Coder),
        Stage::ReviewQaSecurity => Some(Role::Reviewer), // Could also be QA/Security
        Stage::Release => Some(Role::Release),
        Stage::LaunchDrafts => Some(Role::Marketer),
        Stage::Feedback => Some(Role::Feedback),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_prompts_load() {
        for role in Role::all() {
            let prompt = get_prompt(*role);
            assert!(!prompt.is_empty(), "Prompt for {:?} is empty", role);
            assert!(
                prompt.contains("Output Format"),
                "Prompt for {:?} missing output format",
                role
            );
        }
    }

    #[test]
    fn test_role_for_stage() {
        assert_eq!(role_for_stage(warsha_core::Stage::Idea), Some(Role::Intake));
        assert_eq!(
            role_for_stage(warsha_core::Stage::Research),
            Some(Role::Researcher)
        );
        assert_eq!(role_for_stage(warsha_core::Stage::PrdSpec), Some(Role::PM));
        assert_eq!(
            role_for_stage(warsha_core::Stage::Design),
            Some(Role::Designer)
        );
        assert_eq!(
            role_for_stage(warsha_core::Stage::PlanTasks),
            Some(Role::Architect)
        );
        assert_eq!(role_for_stage(warsha_core::Stage::Code), Some(Role::Coder));
        assert_eq!(
            role_for_stage(warsha_core::Stage::ReviewQaSecurity),
            Some(Role::Reviewer)
        );
        assert_eq!(
            role_for_stage(warsha_core::Stage::Release),
            Some(Role::Release)
        );
        assert_eq!(
            role_for_stage(warsha_core::Stage::LaunchDrafts),
            Some(Role::Marketer)
        );
        assert_eq!(
            role_for_stage(warsha_core::Stage::Feedback),
            Some(Role::Feedback)
        );
        assert_eq!(role_for_stage(warsha_core::Stage::GateA), None);
    }
}
