//! B3 rule model — owner-authored tool rules (deny/ask/allow).
//!
//! Rules follow the Claude-Code-style `Tool` / `Tool(pattern)` shape documented
//! in `docs/zadloop/packets/B3-rules-syntax.md`: a pattern is either an exact
//! tool name, a trailing-`*` prefix wildcard (`git-*`), or `*` (everything).
//! Evaluation order is deny → ask → allow, and the axis default (the project's
//! approval mode) applies when no rule matches. Rules never override the
//! command allowlist or the confinement checks — those stay the hard floor
//! evaluated first.

use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use thiserror::Error;

/// What the owner wants done when a tool invocation matches a rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleAction {
    /// Refuse the invocation outright.
    Deny,
    /// Route the invocation to the shared ask-queue.
    Ask,
    /// Admit the invocation without an ask (never past the allowlist).
    Allow,
}

/// A tool-name pattern: exact, trailing-`*` prefix, or `*`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ToolPattern {
    /// Matches every tool.
    #[serde(rename = "*")]
    Any,
    /// Exact name, or a trailing-`*` prefix wildcard (`git-*`).
    Tool(String),
}

impl ToolPattern {
    /// Does this pattern match `tool_name`?
    ///
    /// `*` matches everything; a name ending in `*` is a prefix match; any
    /// other name matches exactly.
    pub fn matches(&self, tool_name: &str) -> bool {
        match self {
            ToolPattern::Any => true,
            ToolPattern::Tool(name) => match name.strip_suffix('*') {
                Some(prefix) => tool_name.starts_with(prefix),
                None => name == tool_name,
            },
        }
    }
}

/// One owner-authored rule: pattern + action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rule {
    pub pattern: ToolPattern,
    pub action: RuleAction,
}

#[derive(Debug, Error)]
pub enum RuleStoreError {
    #[error("failed to add rule: {0}")]
    AddRuleFailed(String),
}

/// Evaluated rules for one tool: the deny/ask/allow lists that matched.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RuleLists {
    pub deny: Vec<String>,
    pub ask: Vec<String>,
    pub allow: Vec<String>,
}

impl RuleLists {
    /// Evaluate deny → ask → allow; `None` when nothing matched (fall through
    /// to the axis default).
    pub fn evaluate(&self, tool_name: &str) -> Option<RuleAction> {
        if self.deny.iter().any(|p| p == tool_name) {
            return Some(RuleAction::Deny);
        }
        if self.ask.iter().any(|p| p == tool_name) {
            return Some(RuleAction::Ask);
        }
        if self.allow.iter().any(|p| p == tool_name) {
            return Some(RuleAction::Allow);
        }
        None
    }
}

/// The owner-authored rule set for one scope: deny/ask/allow pattern lists.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolRules {
    #[serde(default)]
    pub deny: Vec<String>,
    #[serde(default)]
    pub ask: Vec<String>,
    #[serde(default)]
    pub allow: Vec<String>,
}

impl ToolRules {
    /// Evaluate deny → ask → allow; `None` when nothing matched.
    pub fn evaluate(&self, tool_name: &str) -> Option<RuleAction> {
        if self.deny.iter().any(|p| pattern_matches(p, tool_name)) {
            return Some(RuleAction::Deny);
        }
        if self.ask.iter().any(|p| pattern_matches(p, tool_name)) {
            return Some(RuleAction::Ask);
        }
        if self.allow.iter().any(|p| pattern_matches(p, tool_name)) {
            return Some(RuleAction::Allow);
        }
        None
    }
}

/// `*` matches everything; a trailing `*` is a prefix wildcard; else exact.
pub fn pattern_matches(pattern: &str, tool_name: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(prefix) => tool_name.starts_with(prefix),
        None => pattern == tool_name,
    }
}

/// The seam the pipeline holds as `Arc<dyn RuleStore>`: evaluate one tool name.
pub trait RuleStore: Send + Sync {
    fn evaluate(&self, tool_name: &str) -> RuleAction;
}

impl RuleStore for InMemoryRuleStore {
    fn evaluate(&self, tool_name: &str) -> RuleAction {
        self.evaluate_in_project(None, tool_name)
    }
}

/// In-memory rule store: global deny/ask/allow lists + per-project overrides.
///
/// Lookup is project-first: a project rule that matches wins over the global
/// list, EXCEPT a global `deny` always wins (the owner's hard stop). Within a
/// list, order is irrelevant; across lists, deny → ask → allow.
#[derive(Debug, Default)]
pub struct InMemoryRuleStore {
    global: RwLock<ToolRules>,
    projects: RwLock<std::collections::HashMap<String, ToolRules>>,
}

impl InMemoryRuleStore {
    /// An empty store (no rules — every tool falls through to the axis default).
    pub fn new() -> Self {
        Self::default()
    }

    /// Replace the global rule set (owner-authored; the agent never writes it).
    pub fn set_global(&self, rules: ToolRules) {
        if let Ok(mut guard) = self.global.write() {
            *guard = rules;
        }
    }

    /// Replace the rule set for one project (empty clears the override).
    pub fn set_project(&self, project_id: &str, rules: ToolRules) {
        if let Ok(mut guard) = self.projects.write() {
            if rules.deny.is_empty() && rules.ask.is_empty() && rules.allow.is_empty() {
                guard.remove(project_id);
            } else {
                guard.insert(project_id.to_string(), rules);
            }
        }
    }

    /// Evaluate for a tool in a project's context (deny → ask → allow,
    /// project first, global deny wins).
    pub fn evaluate_in_project(&self, project_id: Option<&str>, tool_name: &str) -> RuleAction {
        let global = self.global.read().ok();
        let project = project_id.and_then(|id| {
            self.projects
                .read()
                .ok()
                .and_then(|map| map.get(id).cloned())
        });
        // Global deny is the owner's hard stop — it wins over everything.
        if let Some(rules) = global.as_ref() {
            if rules.deny.iter().any(|p| pattern_matches(p, tool_name)) {
                return RuleAction::Deny;
            }
        }
        if let Some(rules) = project.as_ref() {
            if let Some(action) = rules.evaluate(tool_name) {
                return action;
            }
        }
        if let Some(rules) = global.as_ref() {
            if let Some(action) = rules.evaluate(tool_name) {
                return action;
            }
        }
        RuleAction::Allow // no rule matched — caller falls through to the axis default
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn exact_pattern_matches_only_that_tool() {
        assert!(pattern_matches("git", "git"));
        assert!(!pattern_matches("git", "github"));
        assert!(!pattern_matches("git", "cargo"));
    }

    #[test]
    fn prefix_wildcard_matches_the_prefix() {
        assert!(pattern_matches("git-*", "git-push"));
        assert!(pattern_matches("git-*", "git-"));
        assert!(!pattern_matches("git-*", "git"));
        assert!(!pattern_matches("git-*", "cargo"));
    }

    #[test]
    fn any_pattern_matches_everything() {
        assert!(pattern_matches("*", "anything"));
        assert!(pattern_matches("*", ""));
    }

    #[test]
    fn tool_rules_eval_deny_first_then_ask_then_allow() {
        let rules = ToolRules {
            deny: vec!["rm".into()],
            ask: vec!["git-push".into()],
            allow: vec!["git-*".into()],
        };
        assert_eq!(rules.evaluate("rm"), Some(RuleAction::Deny));
        assert_eq!(rules.evaluate("git-push"), Some(RuleAction::Ask));
        assert_eq!(rules.evaluate("git-commit"), Some(RuleAction::Allow));
        assert_eq!(rules.evaluate("npm"), None);
    }

    #[test]
    fn project_rule_wins_over_global_except_global_deny() {
        let store = InMemoryRuleStore::new();
        store.set_global(ToolRules {
            deny: vec!["curl".into()],
            ask: vec!["git".into()],
            allow: vec![],
        });
        store.set_project(
            "proj-1",
            ToolRules {
                deny: vec![],
                ask: vec![],
                allow: vec!["git".into()],
            },
        );
        // Project allow beats the global ask.
        assert_eq!(
            store.evaluate_in_project(Some("proj-1"), "git"),
            RuleAction::Allow
        );
        // Global deny cannot be overridden by the project.
        assert_eq!(
            store.evaluate_in_project(Some("proj-1"), "curl"),
            RuleAction::Deny
        );
        // No project context → the global list applies.
        assert_eq!(store.evaluate_in_project(None, "git"), RuleAction::Ask);
        // Unknown tool → fall through (Allow = no rule matched).
        assert_eq!(
            store.evaluate_in_project(Some("proj-1"), "npm"),
            RuleAction::Allow
        );
    }

    #[test]
    fn clearing_a_project_override_removes_it() {
        let store = InMemoryRuleStore::new();
        store.set_project(
            "proj-1",
            ToolRules {
                deny: vec!["npm".into()],
                ask: vec![],
                allow: vec![],
            },
        );
        store.set_global(ToolRules {
            deny: vec![],
            ask: vec!["npm".into()],
            allow: vec![],
        });
        assert_eq!(
            store.evaluate_in_project(Some("proj-1"), "npm"),
            RuleAction::Deny
        );
        store.set_project("proj-1", ToolRules::default());
        assert_eq!(
            store.evaluate_in_project(Some("proj-1"), "npm"),
            RuleAction::Ask
        );
    }
}
