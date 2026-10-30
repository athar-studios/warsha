//! Scale standards — the baseline every generated app must meet (PLAN.md M20).
//!
//! A generated app that works on the owner's laptop and falls over at fifty users
//! is not finished, and the failure is almost never exotic: an unindexed foreign
//! key, a list endpoint that returns every row, a query inside a loop, a pool that
//! opens a connection per request, no body ceiling, no deadline, printf logs, no
//! health route. This module is that list, as data.
//!
//! - [`ScaleStandard`] is one check: a stable `id`, a [`ScaleCategory`], a
//!   `description` of the rule and a `check` a reviewer can perform.
//! - [`SCALE_STANDARDS`] is the table: eight standards, at least one in every
//!   category.
//! - [`ScaleStandards::all`] returns the table, [`ScaleStandards::by_category`]
//!   filters it, [`ScaleStandards::get`] looks one up by id, and
//!   [`ScaleStandards::checklist`] renders it as the lines a Coder or Reviewer
//!   prompt carries and a gate report quotes.
//!
//! **Why a table and not prose** — the same eight lines have to reach three
//! places that cannot drift apart: the Coder's prompt (build it this way), the
//! Reviewer's prompt (reject it if it does not), and the spec template (say it in
//! the PRD). One source of truth means a standard added here appears in all
//! three, and the gate can quote the id that failed. `docs/src/scale-standards.md`
//! is the long form of this file: the rationale per standard and how each one is
//! meant to reach the prompt.
//!
//! Nothing here reviews a repository: the table describes the checks, and the
//! callers that inject [`ScaleStandards::checklist`] into a role prompt do not
//! exist yet — the prompt files are versioned assets outside this module's
//! change set, and this module does not claim they were edited.

use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

/// Which part of an app a standard governs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScaleCategory {
    /// Schema shape, indexes and query patterns.
    Database,
    /// Endpoint contract: shape, limits and deadlines.
    Api,
    /// What an operator can see when it breaks.
    Observability,
    /// What an attacker can reach.
    Security,
}

impl ScaleCategory {
    /// Every category, in table order.
    pub fn all() -> [ScaleCategory; 4] {
        [
            ScaleCategory::Database,
            ScaleCategory::Api,
            ScaleCategory::Observability,
            ScaleCategory::Security,
        ]
    }

    /// Stable snake_case tag; also the id prefix of every standard in it.
    pub fn as_str(self) -> &'static str {
        match self {
            ScaleCategory::Database => "database",
            ScaleCategory::Api => "api",
            ScaleCategory::Observability => "observability",
            ScaleCategory::Security => "security",
        }
    }

    /// Readable name for a checklist heading or a gate report.
    pub fn label(self) -> &'static str {
        match self {
            ScaleCategory::Database => "Database",
            ScaleCategory::Api => "API",
            ScaleCategory::Observability => "Observability",
            ScaleCategory::Security => "Security",
        }
    }
}

/// One scale standard: what it is, and how to check it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScaleStandard {
    /// Stable id, `<category>.<rule>`, e.g. `database.foreign_key_indexes`.
    pub id: String,
    /// The part of the app it governs.
    pub category: ScaleCategory,
    /// The rule, one sentence.
    pub description: String,
    /// What a reviewer does to verify it.
    pub check: String,
}

impl ScaleStandard {
    /// Build a standard.
    pub fn new(
        id: impl Into<String>,
        category: ScaleCategory,
        description: impl Into<String>,
        check: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            category,
            description: description.into(),
            check: check.into(),
        }
    }

    /// True when the id is namespaced under its own category.
    pub fn is_namespaced(&self) -> bool {
        self.id
            .strip_prefix(self.category.as_str())
            .and_then(|rest| rest.strip_prefix('.'))
            .is_some_and(|rule| !rule.is_empty())
    }
}

/// The eight standards every generated app is reviewed against.
///
/// `String` fields cannot live in a `const`, so the table is a `static`
/// [`LazyLock`] of a fixed-size array: it is built once on first use, `Deref`
/// makes `SCALE_STANDARDS.iter()` and `SCALE_STANDARDS[0]` work, and
/// [`ScaleStandards::all`] hands out the same data as `&'static [ScaleStandard]`.
pub static SCALE_STANDARDS: LazyLock<[ScaleStandard; 8]> = LazyLock::new(|| {
    [
        ScaleStandard::new(
            "database.foreign_key_indexes",
            ScaleCategory::Database,
            "Every foreign-key column has its own index.",
            "For each REFERENCES column in the migrations, confirm an index on the \
             referencing side — not the referenced side.",
        ),
        ScaleStandard::new(
            "database.no_n_plus_one",
            ScaleCategory::Database,
            "A list screen issues a bounded number of queries, not one per row.",
            "Count the queries the list endpoint runs for ten rows and for a hundred: \
             the count must not grow with the row count.",
        ),
        ScaleStandard::new(
            "database.connection_pooling",
            ScaleCategory::Database,
            "The app reaches the database through one bounded pool with an acquire timeout.",
            "Find the pool constructor and confirm a maximum size and an acquire timeout; \
             confirm no code path opens a connection per request.",
        ),
        ScaleStandard::new(
            "api.pagination",
            ScaleCategory::Api,
            "Every list endpoint takes a page size and a cursor or offset, with a hard maximum.",
            "Call each list endpoint with no page size and again with an absurd one; both \
             responses must be bounded and must carry a way to fetch the next page.",
        ),
        ScaleStandard::new(
            "api.timeout_budget",
            ScaleCategory::Api,
            "Every request has a deadline, and that deadline is shorter than its caller's.",
            "Find the per-request timeout and compare it with the client's own timeout: the \
             server must give up first.",
        ),
        ScaleStandard::new(
            "observability.structured_logs",
            ScaleCategory::Observability,
            "Logs are structured records carrying a request id, never concatenated sentences.",
            "Grep the request path for formatted log lines; each one must carry fields \
             (request id, route, status, duration), not a built string.",
        ),
        ScaleStandard::new(
            "observability.health_endpoint",
            ScaleCategory::Observability,
            "A health endpoint answers without touching the data path.",
            "Stop the database and call the health endpoint: it must still answer, and must \
             report the database as unhealthy rather than hang.",
        ),
        ScaleStandard::new(
            "security.request_size_limit",
            ScaleCategory::Security,
            "Request bodies have a size ceiling, and an oversized body is refused before parsing.",
            "POST a body above the ceiling and confirm a 413-class refusal that never reaches \
             the parser or the database.",
        ),
    ]
});

/// Reads the standard table.
pub struct ScaleStandards;

impl ScaleStandards {
    /// The whole table, in declared order.
    pub fn all() -> &'static [ScaleStandard] {
        SCALE_STANDARDS.as_slice()
    }

    /// The standards in one category, in declared order.
    pub fn by_category(category: ScaleCategory) -> Vec<&'static ScaleStandard> {
        Self::all()
            .iter()
            .filter(|standard| standard.category == category)
            .collect()
    }

    /// One standard by id.
    pub fn get(id: &str) -> Option<&'static ScaleStandard> {
        Self::all().iter().find(|standard| standard.id == id)
    }

    /// The table as reviewable lines: `[id] rule — check`.
    ///
    /// One line per standard, in table order, so a prompt can embed the list and
    /// a gate report can quote the line that failed.
    pub fn checklist() -> Vec<String> {
        Self::all()
            .iter()
            .map(|standard| {
                format!(
                    "[{}] {} — {}",
                    standard.id, standard.description, standard.check
                )
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The eight rules PLAN.md M20 names, by id.
    const REQUIRED: [&str; 8] = [
        "database.foreign_key_indexes",
        "database.no_n_plus_one",
        "database.connection_pooling",
        "api.pagination",
        "api.timeout_budget",
        "observability.structured_logs",
        "observability.health_endpoint",
        "security.request_size_limit",
    ];

    #[test]
    fn the_table_carries_every_required_standard_with_a_unique_namespaced_id() {
        let all = ScaleStandards::all();
        assert_eq!(all.len(), REQUIRED.len());

        for id in REQUIRED {
            assert!(
                ScaleStandards::get(id).is_some(),
                "standard `{id}` is missing"
            );
        }

        for standard in all {
            assert!(
                standard.is_namespaced(),
                "`{}` is mis-namespaced",
                standard.id
            );
            assert!(!standard.description.trim().is_empty());
            assert!(!standard.check.trim().is_empty());
            let matches = all.iter().filter(|other| other.id == standard.id).count();
            assert_eq!(matches, 1, "`{}` appears {matches} times", standard.id);
        }
        assert!(ScaleStandards::get("database.nope").is_none());
    }

    #[test]
    fn every_category_has_at_least_one_standard() {
        let mut total = 0;
        for category in ScaleCategory::all() {
            let in_category = ScaleStandards::by_category(category);
            assert!(
                !in_category.is_empty(),
                "category `{}` has no standard",
                category.as_str()
            );
            assert!(in_category
                .iter()
                .all(|standard| standard.category == category));
            total += in_category.len();
        }
        assert_eq!(total, ScaleStandards::all().len());
    }

    #[test]
    fn the_checklist_has_one_reviewable_line_per_standard() {
        let all = ScaleStandards::all();
        let checklist = ScaleStandards::checklist();
        assert_eq!(checklist.len(), all.len());

        // One line per standard, no embedded newlines: the table's own text is
        // wrapped with `\` continuations so the rendered line stays single.
        assert_eq!(checklist.len(), checklist.join("\n").lines().count());
        for (line, standard) in checklist.iter().zip(all) {
            assert!(line.contains(&format!("[{}]", standard.id)));
            assert!(line.contains(&standard.description));
            assert!(line.contains(&standard.check));
        }
    }

    #[test]
    fn categories_have_stable_names_and_serde() {
        let expected = [
            (ScaleCategory::Database, "database", "Database"),
            (ScaleCategory::Api, "api", "API"),
            (
                ScaleCategory::Observability,
                "observability",
                "Observability",
            ),
            (ScaleCategory::Security, "security", "Security"),
        ];
        assert_eq!(ScaleCategory::all().len(), expected.len());
        for (index, (category, tag, label)) in expected.iter().enumerate() {
            assert_eq!(ScaleCategory::all()[index], *category);
            assert_eq!(category.as_str(), *tag);
            assert_eq!(category.label(), *label);
        }

        let json = serde_json::to_value(ScaleCategory::Observability).expect("serialises");
        assert_eq!(json, serde_json::json!("observability"));

        let standard = SCALE_STANDARDS[0].clone();
        let json = serde_json::to_value(&standard).expect("serialises");
        assert_eq!(json["id"], "database.foreign_key_indexes");
        assert_eq!(json["category"], "database");
        let back: ScaleStandard = serde_json::from_value(json).expect("deserialises");
        assert_eq!(back, standard);
    }
}
