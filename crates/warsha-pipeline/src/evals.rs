//! Evals — a fixed, offline regression suite per role.
//!
//! The suite never calls a provider: [`run_suite`] takes the responder as a
//! closure, so tests pass a stub and production can pass the mock provider.

use std::collections::HashMap;

use thiserror::Error;
use warsha_core::Role;

/// A failing eval suite blocks the change.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum EvalError {
    /// Two cases in the same role share an id.
    #[error("duplicate eval case id: {0}")]
    DuplicateCase(String),
}

/// One regression case for one role.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvalCase {
    /// Stable case id, unique within a role.
    pub id: String,
    /// The role under test.
    pub role: Role,
    /// Human-readable case name.
    pub name: String,
    /// The prompt handed to the responder.
    pub prompt: String,
    /// Substrings the response must contain (case-insensitive).
    pub must_contain: Vec<String>,
    /// Substrings the response must not contain (case-insensitive).
    pub must_not_contain: Vec<String>,
    /// Optional cost ceiling for the call, in cents.
    pub max_cost_cents: Option<u64>,
}

impl EvalCase {
    /// True when `cost_cents` fits the case's ceiling, if it has one.
    pub fn within_budget(&self, cost_cents: u64) -> bool {
        self.max_cost_cents.is_none_or(|max| cost_cents <= max)
    }
}

/// The result of running one case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvalOutcome {
    /// The id of the case that ran.
    pub case_id: String,
    /// True when every expectation held.
    pub passed: bool,
    /// Human-readable failure reasons, empty when the case passed.
    pub failures: Vec<String>,
}

/// The regression cases, grouped by role.
#[derive(Debug, Clone, Default)]
pub struct EvalSuite {
    cases: HashMap<Role, Vec<EvalCase>>,
}

impl EvalSuite {
    /// Create an empty suite.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a case, rejecting a duplicate id within the same role.
    pub fn add_case(&mut self, case: EvalCase) -> Result<(), EvalError> {
        let bucket = self.cases.entry(case.role).or_default();
        if bucket.iter().any(|existing| existing.id == case.id) {
            return Err(EvalError::DuplicateCase(case.id));
        }
        bucket.push(case);
        Ok(())
    }

    /// The cases for one role, in insertion order.
    pub fn cases_for(&self, role: Role) -> &[EvalCase] {
        match self.cases.get(&role) {
            Some(cases) => cases.as_slice(),
            None => &[],
        }
    }

    /// Every case, ordered by role then by insertion.
    pub fn all_cases(&self) -> Vec<&EvalCase> {
        let mut cases = Vec::with_capacity(self.len());
        for role in Role::all() {
            if let Some(bucket) = self.cases.get(role) {
                cases.extend(bucket.iter());
            }
        }
        cases
    }

    /// Number of cases in the suite.
    pub fn len(&self) -> usize {
        self.cases.values().map(Vec::len).sum()
    }

    /// True when the suite holds no cases.
    pub fn is_empty(&self) -> bool {
        self.cases.is_empty()
    }

    /// The built-in regression suite: one or two static cases per role.
    ///
    /// Case ids are unique by construction; nothing here touches the network.
    pub fn default_suite() -> EvalSuite {
        let mut cases: HashMap<Role, Vec<EvalCase>> = HashMap::new();
        for case in default_cases() {
            cases.entry(case.role).or_default().push(case);
        }
        EvalSuite { cases }
    }
}

/// Run every case in `suite` through `responder` and evaluate the responses.
pub fn run_suite(suite: &EvalSuite, responder: impl Fn(&EvalCase) -> String) -> Vec<EvalOutcome> {
    suite
        .all_cases()
        .into_iter()
        .map(|case| {
            let response = responder(case);
            evaluate_case(case, &response)
        })
        .collect()
}

/// Evaluate one response against one case.
pub fn evaluate_case(case: &EvalCase, response: &str) -> EvalOutcome {
    let haystack = response.to_lowercase();
    let mut failures = Vec::new();

    for needle in &case.must_contain {
        if !haystack.contains(&needle.to_lowercase()) {
            failures.push(format!("missing expected text: {needle}"));
        }
    }
    for needle in &case.must_not_contain {
        if haystack.contains(&needle.to_lowercase()) {
            failures.push(format!("contains forbidden text: {needle}"));
        }
    }

    EvalOutcome {
        case_id: case.id.clone(),
        passed: failures.is_empty(),
        failures,
    }
}

/// True when any outcome failed, which blocks the change.
pub fn blocks_change(outcomes: &[EvalOutcome]) -> bool {
    outcomes.iter().any(|outcome| !outcome.passed)
}

/// The static regression cases behind [`EvalSuite::default_suite`].
fn default_cases() -> Vec<EvalCase> {
    vec![
        EvalCase {
            id: "intake-clarify".to_string(),
            role: Role::Intake,
            name: "asks clarifying questions".to_string(),
            prompt: "The owner wants a habit tracker for two people. Ask what you need first."
                .to_string(),
            must_contain: vec!["?".to_string(), "habit".to_string()],
            must_not_contain: vec!["as an ai".to_string()],
            max_cost_cents: Some(2),
        },
        EvalCase {
            id: "researcher-sources".to_string(),
            role: Role::Researcher,
            name: "cites sources".to_string(),
            prompt:
                "Summarise three competitor habit trackers and cite where each claim comes from."
                    .to_string(),
            must_contain: vec!["source".to_string()],
            must_not_contain: vec!["as an ai".to_string()],
            max_cost_cents: None,
        },
        EvalCase {
            id: "pm-acceptance".to_string(),
            role: Role::PM,
            name: "writes acceptance criteria".to_string(),
            prompt: "Turn the brief into user stories with acceptance criteria.".to_string(),
            must_contain: vec!["acceptance criteria".to_string()],
            must_not_contain: vec!["no criteria".to_string()],
            max_cost_cents: None,
        },
        EvalCase {
            id: "designer-flow".to_string(),
            role: Role::Designer,
            name: "describes screens and flow".to_string(),
            prompt: "Describe the screens for the habit tracker and the flow between them."
                .to_string(),
            must_contain: vec!["screen".to_string()],
            must_not_contain: vec!["lorem ipsum".to_string()],
            max_cost_cents: None,
        },
        EvalCase {
            id: "architect-components".to_string(),
            role: Role::Architect,
            name: "names components and tradeoffs".to_string(),
            prompt: "Design the architecture for offline sync and name the tradeoffs.".to_string(),
            must_contain: vec!["component".to_string()],
            must_not_contain: vec!["figure it out later".to_string()],
            max_cost_cents: None,
        },
        EvalCase {
            id: "coder-code-block".to_string(),
            role: Role::Coder,
            name: "answers with a code block".to_string(),
            prompt: "Add a function that formats a streak count in the habit tracker.".to_string(),
            must_contain: vec!["```".to_string(), "fn ".to_string()],
            must_not_contain: vec!["as an ai".to_string()],
            max_cost_cents: None,
        },
        EvalCase {
            id: "coder-tests".to_string(),
            role: Role::Coder,
            name: "adds a test with the change".to_string(),
            prompt: "Make the streak counter ignore duplicate check-ins and cover it.".to_string(),
            must_contain: vec!["test".to_string()],
            must_not_contain: vec!["no tests needed".to_string()],
            max_cost_cents: Some(4),
        },
        EvalCase {
            id: "reviewer-risks".to_string(),
            role: Role::Reviewer,
            name: "calls out risks".to_string(),
            prompt: "Review the diff that adds a retry loop around the sync call.".to_string(),
            must_contain: vec!["risk".to_string()],
            must_not_contain: vec!["looks good".to_string()],
            max_cost_cents: None,
        },
        EvalCase {
            id: "qa-cases".to_string(),
            role: Role::QA,
            name: "writes a test case table".to_string(),
            prompt: "Write the checks for the habit tracker streak screen.".to_string(),
            must_contain: vec!["test case".to_string()],
            must_not_contain: vec!["cannot".to_string()],
            max_cost_cents: None,
        },
        EvalCase {
            id: "security-threats".to_string(),
            role: Role::Security,
            name: "names threats".to_string(),
            prompt: "Review the pairing flow for weak points and name the threat for each."
                .to_string(),
            must_contain: vec!["threat".to_string()],
            must_not_contain: vec!["sk-".to_string()],
            max_cost_cents: None,
        },
        EvalCase {
            id: "security-secrets".to_string(),
            role: Role::Security,
            name: "redacts leaked credentials".to_string(),
            prompt: "The diff includes an API key in the config file. What should change?"
                .to_string(),
            must_contain: vec!["redact".to_string()],
            must_not_contain: vec!["sk-".to_string()],
            max_cost_cents: None,
        },
        EvalCase {
            id: "release-changelog".to_string(),
            role: Role::Release,
            name: "writes the changelog".to_string(),
            prompt: "Prepare the draft release notes for version 0.1.0.".to_string(),
            must_contain: vec!["changelog".to_string()],
            must_not_contain: vec!["force push".to_string()],
            max_cost_cents: None,
        },
        EvalCase {
            id: "marketer-audience".to_string(),
            role: Role::Marketer,
            name: "names the audience".to_string(),
            prompt: "Draft the launch post for the habit tracker.".to_string(),
            must_contain: vec!["audience".to_string()],
            must_not_contain: vec!["guaranteed profit".to_string()],
            max_cost_cents: None,
        },
        EvalCase {
            id: "feedback-summary".to_string(),
            role: Role::Feedback,
            name: "summarises the run".to_string(),
            prompt: "Summarise what shipped and what the owner should decide next.".to_string(),
            must_contain: vec!["summary".to_string()],
            must_not_contain: vec!["cannot".to_string()],
            max_cost_cents: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn passing_response(case: &EvalCase) -> String {
        case.must_contain.join(" ")
    }

    #[test]
    fn default_suite_covers_every_role_with_unique_ids() {
        let suite = EvalSuite::default_suite();

        assert!(!suite.is_empty());
        assert_eq!(suite.len(), 14);
        for role in Role::all() {
            assert!(
                !suite.cases_for(*role).is_empty(),
                "default suite is missing a case for {role:?}"
            );
        }

        let mut ids: Vec<&str> = suite
            .all_cases()
            .iter()
            .map(|case| case.id.as_str())
            .collect();
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), total);
        assert!(suite.cases_for(Role::Coder).len() == 2);
        assert!(suite.cases_for(Role::Security).len() == 2);
    }

    #[test]
    fn a_good_responder_passes_the_whole_suite() {
        let suite = EvalSuite::default_suite();
        let outcomes = run_suite(&suite, passing_response);

        assert_eq!(outcomes.len(), suite.len());
        assert!(outcomes.iter().all(|outcome| outcome.passed));
        assert!(outcomes.iter().all(|outcome| outcome.failures.is_empty()));
        assert!(!blocks_change(&outcomes));
    }

    #[test]
    fn a_bad_responder_fails_and_blocks_the_change() {
        let suite = EvalSuite::default_suite();
        let outcomes = run_suite(&suite, |_| "as an ai I cannot help with that".to_string());

        assert!(outcomes.iter().any(|outcome| !outcome.passed));
        assert!(blocks_change(&outcomes));

        let coder_case = suite
            .cases_for(Role::Coder)
            .first()
            .cloned()
            .expect("coder has a case");
        let outcome = evaluate_case(&coder_case, "as an ai I cannot help with that");
        assert_eq!(outcome.case_id, coder_case.id);
        assert!(!outcome.passed);
        assert!(outcome
            .failures
            .iter()
            .any(|failure| failure.starts_with("missing expected text")));
    }

    #[test]
    fn forbidden_text_fails_the_case() {
        let case = EvalCase {
            id: "secret-leak".to_string(),
            role: Role::Security,
            name: "never echoes a key".to_string(),
            prompt: "Review the config.".to_string(),
            must_contain: vec!["redact".to_string()],
            must_not_contain: vec!["sk-".to_string()],
            max_cost_cents: Some(3),
        };

        let failing = evaluate_case(&case, "redact the value sk-live-abcdef123456");
        assert!(!failing.passed);
        assert_eq!(
            failing.failures,
            vec!["contains forbidden text: sk-".to_string()]
        );

        let passing = evaluate_case(&case, "Redact the value before it is logged.");
        assert!(passing.passed);
        assert!(passing.failures.is_empty());
        assert!(case.within_budget(3));
        assert!(!case.within_budget(4));
    }

    #[test]
    fn duplicate_case_ids_are_rejected() {
        let mut suite = EvalSuite::new();
        let case = EvalCase {
            id: "pm-acceptance".to_string(),
            role: Role::PM,
            name: "writes acceptance criteria".to_string(),
            prompt: "Turn the brief into user stories.".to_string(),
            must_contain: vec!["acceptance criteria".to_string()],
            must_not_contain: Vec::new(),
            max_cost_cents: None,
        };

        assert!(suite.add_case(case.clone()).is_ok());
        assert_eq!(
            suite.add_case(case),
            Err(EvalError::DuplicateCase("pm-acceptance".to_string()))
        );
        assert_eq!(suite.len(), 1);
        assert_eq!(suite.cases_for(Role::PM).len(), 1);
        assert!(suite.cases_for(Role::Coder).is_empty());
    }
}
