//! Router quality — difficulty classification, model-tier choice, a response
//! cache and a cost sink that feeds the existing cost accounting.
//!
//! Nothing here talks to a provider: the types are pure and the
//! [`ResponseCache`] is deliberately not wired into the engine yet.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use warsha_core::Role;

/// How much reasoning a task looks like it needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TaskDifficulty {
    /// One-line answer, no reasoning.
    Trivial,
    /// Small, well-scoped edit.
    Easy,
    /// Multi-step work that still fits one prompt.
    Moderate,
    /// Architecture, migration or review work that needs the strong model.
    Hard,
}

impl TaskDifficulty {
    /// True when the difficulty maps to the strong model tier.
    pub fn needs_strong_model(self) -> bool {
        matches!(self, TaskDifficulty::Moderate | TaskDifficulty::Hard)
    }

    /// Stable snake_case tag for logs and UI.
    pub fn as_str(self) -> &'static str {
        match self {
            TaskDifficulty::Trivial => "trivial",
            TaskDifficulty::Easy => "easy",
            TaskDifficulty::Moderate => "moderate",
            TaskDifficulty::Hard => "hard",
        }
    }
}

/// Which class of model a step should run on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ModelTier {
    /// Cheap, fast model for trivial and easy work.
    Small,
    /// Expensive reasoning model for moderate and hard work.
    Strong,
}

impl ModelTier {
    /// Stable snake_case tag for logs and UI.
    pub fn as_str(self) -> &'static str {
        match self {
            ModelTier::Small => "small",
            ModelTier::Strong => "strong",
        }
    }
}

/// Phrases that push a prompt into [`TaskDifficulty::Hard`].
const HARD_KEYWORDS: &[&str] = &[
    "architect",
    "architecture",
    "migrate",
    "migration",
    "security review",
    "threat model",
    "concurrency",
    "distributed",
    "refactor",
    "performance",
    "benchmark",
];

/// Phrases that push a prompt into [`TaskDifficulty::Moderate`].
const MODERATE_KEYWORDS: &[&str] = &[
    "implement",
    "design",
    "test",
    "api",
    "schema",
    "review",
    "bug",
    "fix",
    "debug",
];

/// Router policy: per-role default tiers, owner overrides and the difficulty
/// heuristic that connects them.
#[derive(Debug, Clone)]
pub struct RouterPolicy {
    defaults: HashMap<Role, ModelTier>,
    overrides: HashMap<Role, ModelTier>,
}

impl Default for RouterPolicy {
    fn default() -> Self {
        Self::new()
    }
}

impl RouterPolicy {
    /// Build the default policy: cheap roles on the small tier, engineering and
    /// review roles on the strong tier.
    pub fn new() -> Self {
        let defaults = Role::all()
            .iter()
            .map(|role| {
                let tier = match role {
                    Role::Intake | Role::Marketer | Role::Feedback | Role::Release => {
                        ModelTier::Small
                    }
                    Role::Researcher
                    | Role::PM
                    | Role::Designer
                    | Role::Architect
                    | Role::Coder
                    | Role::Reviewer
                    | Role::QA
                    | Role::Security => ModelTier::Strong,
                };
                (*role, tier)
            })
            .collect();
        Self {
            defaults,
            overrides: HashMap::new(),
        }
    }

    /// The default tier for `role` when the owner has not overridden it.
    pub fn default_tier(&self, role: Role) -> ModelTier {
        self.defaults
            .get(&role)
            .copied()
            .unwrap_or(ModelTier::Small)
    }

    /// Pin `role` to `tier`, overriding both the default and the difficulty map.
    pub fn set_override(&mut self, role: Role, tier: ModelTier) {
        self.overrides.insert(role, tier);
    }

    /// Remove the owner override for `role`, if any, returning it.
    pub fn clear_override(&mut self, role: Role) -> Option<ModelTier> {
        self.overrides.remove(&role)
    }

    /// The owner override for `role`, if any.
    pub fn owner_override(&self, role: Role) -> Option<ModelTier> {
        self.overrides.get(&role).copied()
    }

    /// Deterministic difficulty heuristic over the prompt text.
    ///
    /// Long prompts, code fences and hard keywords raise the difficulty; very
    /// short prompts lower it.
    pub fn classify(&self, prompt: &str) -> TaskDifficulty {
        let trimmed = prompt.trim();
        if trimmed.is_empty() {
            return TaskDifficulty::Trivial;
        }
        let lower = trimmed.to_lowercase();
        let mut score: u32 = 0;

        let chars = trimmed.chars().count();
        if chars > 500 {
            score += 2;
        } else if chars > 200 {
            score += 1;
        }

        if lower.matches("```").count() >= 2 {
            score += 1;
        }

        let hard_hits = HARD_KEYWORDS
            .iter()
            .filter(|keyword| lower.contains(**keyword))
            .count() as u32;
        let moderate_hits = MODERATE_KEYWORDS
            .iter()
            .filter(|keyword| lower.contains(**keyword))
            .count() as u32;
        score += hard_hits.saturating_mul(2) + moderate_hits;

        if trimmed.split_whitespace().count() <= 2 {
            score = score.saturating_sub(1);
        }

        match score {
            0 => TaskDifficulty::Trivial,
            1 => TaskDifficulty::Easy,
            2..=3 => TaskDifficulty::Moderate,
            _ => TaskDifficulty::Hard,
        }
    }

    /// Choose the model tier for `role` at `difficulty`; an owner override wins
    /// over the difficulty mapping.
    pub fn choose_tier(&self, role: Role, difficulty: TaskDifficulty) -> ModelTier {
        if let Some(tier) = self.owner_override(role) {
            return tier;
        }
        if difficulty.needs_strong_model() {
            ModelTier::Strong
        } else {
            ModelTier::Small
        }
    }

    /// Convenience: classify `prompt` and choose the tier for `role` in one go.
    pub fn tier_for(&self, role: Role, prompt: &str) -> ModelTier {
        self.choose_tier(role, self.classify(prompt))
    }
}

/// A response cache keyed by a deterministic hash of (role, model, prompt).
#[derive(Debug, Clone, Default)]
pub struct ResponseCache {
    entries: HashMap<u64, String>,
    hits: u64,
    misses: u64,
}

impl ResponseCache {
    /// Create an empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// The deterministic cache key for a (role, model, prompt) triple.
    pub fn key(role: Role, model: &str, prompt: &str) -> u64 {
        let mut hasher = DefaultHasher::new();
        role.hash(&mut hasher);
        model.hash(&mut hasher);
        prompt.hash(&mut hasher);
        hasher.finish()
    }

    /// Store `response` under the key for (role, model, prompt).
    pub fn insert(&mut self, role: Role, model: &str, prompt: &str, response: String) {
        self.entries
            .insert(Self::key(role, model, prompt), response);
    }

    /// Look up a cached response, counting the hit or the miss.
    pub fn get(&mut self, role: Role, model: &str, prompt: &str) -> Option<String> {
        match self.entries.get(&Self::key(role, model, prompt)) {
            Some(cached) => {
                let response = cached.clone();
                self.hits += 1;
                Some(response)
            }
            None => {
                self.misses += 1;
                None
            }
        }
    }

    /// Number of cache hits so far.
    pub fn hits(&self) -> u64 {
        self.hits
    }

    /// Number of cache misses so far.
    pub fn misses(&self) -> u64 {
        self.misses
    }

    /// Number of cached responses.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when nothing has been cached yet.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

/// One recorded model spend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CostEntry {
    /// The role that spent the money.
    pub role: Role,
    /// The tier the call ran on.
    pub tier: ModelTier,
    /// The cost of the call, in cents.
    pub cost_cents: u64,
}

/// Records per-call costs so callers can feed the existing cost accounting.
#[derive(Debug, Clone, Default)]
pub struct CostSink {
    entries: Vec<CostEntry>,
}

impl CostSink {
    /// Create an empty sink.
    pub fn new() -> Self {
        Self::default()
    }

    /// Record one call's cost.
    pub fn record(&mut self, role: Role, tier: ModelTier, cost_cents: u64) {
        self.entries.push(CostEntry {
            role,
            tier,
            cost_cents,
        });
    }

    /// Every recorded entry, in recording order.
    pub fn entries(&self) -> &[CostEntry] {
        &self.entries
    }

    /// Total spend in cents.
    pub fn total_cents(&self) -> u64 {
        self.entries.iter().map(|entry| entry.cost_cents).sum()
    }

    /// Total spend in cents for one role.
    pub fn total_for(&self, role: Role) -> u64 {
        self.entries
            .iter()
            .filter(|entry| entry.role == role)
            .map(|entry| entry.cost_cents)
            .sum()
    }

    /// Total spend in cents for one tier.
    pub fn total_for_tier(&self, tier: ModelTier) -> u64 {
        self.entries
            .iter()
            .filter(|entry| entry.tier == tier)
            .map(|entry| entry.cost_cents)
            .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_prompt_difficulty() {
        let policy = RouterPolicy::new();

        assert_eq!(policy.classify(""), TaskDifficulty::Trivial);
        assert_eq!(
            policy.classify("rename a variable"),
            TaskDifficulty::Trivial
        );
        assert_eq!(
            policy.classify("fix the typo in the README header"),
            TaskDifficulty::Easy
        );
        assert_eq!(
            policy.classify("implement the settings screen and design the schema for it"),
            TaskDifficulty::Moderate
        );
        assert_eq!(
            policy.classify(
                "Architect a migration plan for the billing service, then do a security review \
                 of the token exchange and document the threat model."
            ),
            TaskDifficulty::Hard
        );
        assert_eq!(
            policy.classify("```\nfn main() {}\n```\nrefactor this module"),
            TaskDifficulty::Moderate
        );
    }

    #[test]
    fn difficulty_maps_to_tiers() {
        let policy = RouterPolicy::new();

        assert_eq!(
            policy.choose_tier(Role::Coder, TaskDifficulty::Trivial),
            ModelTier::Small
        );
        assert_eq!(
            policy.choose_tier(Role::Coder, TaskDifficulty::Easy),
            ModelTier::Small
        );
        assert_eq!(
            policy.choose_tier(Role::Coder, TaskDifficulty::Moderate),
            ModelTier::Strong
        );
        assert_eq!(
            policy.choose_tier(Role::Coder, TaskDifficulty::Hard),
            ModelTier::Strong
        );
        assert_eq!(policy.default_tier(Role::Intake), ModelTier::Small);
        assert_eq!(policy.default_tier(Role::Security), ModelTier::Strong);
        assert_eq!(
            policy.tier_for(Role::Security, "architect a migration plan"),
            ModelTier::Strong
        );
    }

    #[test]
    fn owner_override_wins_over_difficulty() {
        let mut policy = RouterPolicy::new();
        assert_eq!(
            policy.choose_tier(Role::Coder, TaskDifficulty::Hard),
            ModelTier::Strong
        );
        assert!(policy.owner_override(Role::Coder).is_none());

        policy.set_override(Role::Coder, ModelTier::Small);
        assert_eq!(policy.owner_override(Role::Coder), Some(ModelTier::Small));
        assert_eq!(
            policy.choose_tier(Role::Coder, TaskDifficulty::Hard),
            ModelTier::Small
        );

        assert_eq!(policy.clear_override(Role::Coder), Some(ModelTier::Small));
        assert_eq!(policy.clear_override(Role::Coder), None);
        assert_eq!(
            policy.choose_tier(Role::Coder, TaskDifficulty::Hard),
            ModelTier::Strong
        );
    }

    #[test]
    fn response_cache_counts_hits_and_misses() {
        let mut cache = ResponseCache::new();
        assert!(cache.is_empty());

        assert!(cache
            .get(Role::Coder, "mock-small", "write a test")
            .is_none());
        cache.insert(
            Role::Coder,
            "mock-small",
            "write a test",
            "done".to_string(),
        );

        assert_eq!(
            cache
                .get(Role::Coder, "mock-small", "write a test")
                .as_deref(),
            Some("done")
        );
        assert!(cache
            .get(Role::Coder, "mock-strong", "write a test")
            .is_none());
        assert!(cache
            .get(Role::Reviewer, "mock-small", "write a test")
            .is_none());

        assert_eq!(cache.hits(), 1);
        assert_eq!(cache.misses(), 3);
        assert_eq!(cache.len(), 1);
        assert_eq!(
            ResponseCache::key(Role::Coder, "mock-small", "write a test"),
            ResponseCache::key(Role::Coder, "mock-small", "write a test")
        );
    }

    #[test]
    fn cost_sink_accumulates_totals() {
        let mut sink = CostSink::new();
        sink.record(Role::Coder, ModelTier::Strong, 7);
        sink.record(Role::Coder, ModelTier::Small, 2);
        sink.record(Role::Intake, ModelTier::Small, 1);

        assert_eq!(sink.total_cents(), 10);
        assert_eq!(sink.total_for(Role::Coder), 9);
        assert_eq!(sink.total_for(Role::Intake), 1);
        assert_eq!(sink.total_for(Role::Security), 0);
        assert_eq!(sink.total_for_tier(ModelTier::Small), 3);
        assert_eq!(sink.total_for_tier(ModelTier::Strong), 7);
        assert_eq!(sink.entries().len(), 3);
        assert_eq!(sink.entries()[0].role, Role::Coder);
    }
}
