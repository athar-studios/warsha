//! Router quality — difficulty classification, model-tier choice, a response
//! cache and a cost sink that feeds the existing cost accounting.
//!
//! Nothing here talks to a provider: the types are pure and the
//! [`ResponseCache`] is deliberately not wired into the engine yet.
//!
//! The router additions ([`TargetKind`], [`RouterTarget`], [`EcoMode`],
//! [`PerTaskDefaults`], [`LocalFallbackPolicy`]) are pure decisions too: they
//! describe *which* target a step should use, never perform the call.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, VecDeque};
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
///
/// Storage is bounded (H-06): at most [`ResponseCache::capacity`] entries, each
/// living [`ResponseCache::ttl_secs`] seconds of the store's clock. A `recency`
/// deque orders least- to most-recently-used so a full cache evicts
/// deterministically, and an expired entry is never returned — a lookup reaps it
/// and counts a miss — while `insert` sweeps stale entries before adding. Time is
/// a plain forward-only clock advanced with [`ResponseCache::advance_to`], so the
/// expiry tests fabricate time instead of sleeping. This is the router's per-run
/// in-process memo; the paid output it holds is bounded in both count and age.
#[derive(Debug, Clone)]
pub struct ResponseCache {
    entries: HashMap<u64, CachedResponse>,
    /// Keys front-to-back, least- to most-recently-used; exactly the keys present
    /// in `entries`, once each.
    recency: VecDeque<u64>,
    capacity: usize,
    ttl_secs: u64,
    now: u64,
    hits: u64,
    misses: u64,
    evictions: u64,
    expirations: u64,
}

/// One cached response with the store time it was written at.
#[derive(Debug, Clone)]
struct CachedResponse {
    response: String,
    created_at: u64,
}

/// Read `key` from the environment as a number, ignoring a missing or unparseable
/// value so a stray setting never turns the cache into nothing.
fn env_number<T: std::str::FromStr>(key: &str) -> Option<T> {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<T>().ok())
}

impl Default for ResponseCache {
    fn default() -> Self {
        Self::with_capacity_and_ttl(
            crate::llm_cache::DEFAULT_LLM_CACHE_MAX_ENTRIES,
            crate::llm_cache::DEFAULT_LLM_CACHE_TTL_SECS,
        )
    }
}

impl ResponseCache {
    /// Create an empty cache at the default capacity and TTL, clock at `0`.
    pub fn new() -> Self {
        Self::default()
    }

    /// A cache holding at most `max_entries` (LRU-evicted), at the default TTL.
    pub fn with_capacity(max_entries: usize) -> Self {
        Self::with_capacity_and_ttl(max_entries, crate::llm_cache::DEFAULT_LLM_CACHE_TTL_SECS)
    }

    /// A cache whose entries expire after `ttl_secs` store seconds, at the
    /// default capacity. `u64::MAX` disables age expiry.
    pub fn with_ttl(ttl_secs: u64) -> Self {
        Self::with_capacity_and_ttl(crate::llm_cache::DEFAULT_LLM_CACHE_MAX_ENTRIES, ttl_secs)
    }

    /// A cache with an explicit bound and lifetime, clock at `0`.
    pub fn with_capacity_and_ttl(max_entries: usize, ttl_secs: u64) -> Self {
        Self {
            entries: HashMap::new(),
            recency: VecDeque::new(),
            capacity: max_entries,
            ttl_secs,
            now: 0,
            hits: 0,
            misses: 0,
            evictions: 0,
            expirations: 0,
        }
    }

    /// Build the cache from `WARSHA_ROUTER_CACHE_MAX_ENTRIES` and
    /// `WARSHA_ROUTER_CACHE_TTL_SECS`, each falling back to the shared cache
    /// default when unset or unparseable.
    pub fn from_env() -> Self {
        let capacity = env_number::<usize>("WARSHA_ROUTER_CACHE_MAX_ENTRIES")
            .unwrap_or(crate::llm_cache::DEFAULT_LLM_CACHE_MAX_ENTRIES);
        let ttl = env_number::<u64>("WARSHA_ROUTER_CACHE_TTL_SECS")
            .unwrap_or(crate::llm_cache::DEFAULT_LLM_CACHE_TTL_SECS);
        Self::with_capacity_and_ttl(capacity, ttl)
    }

    /// The deterministic cache key for a (role, model, prompt) triple.
    pub fn key(role: Role, model: &str, prompt: &str) -> u64 {
        let mut hasher = DefaultHasher::new();
        role.hash(&mut hasher);
        model.hash(&mut hasher);
        prompt.hash(&mut hasher);
        hasher.finish()
    }

    /// The capacity bound in entries.
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// The lifetime in store seconds (`u64::MAX` when age expiry is disabled).
    pub fn ttl_secs(&self) -> u64 {
        self.ttl_secs
    }

    /// The store's current clock reading.
    pub fn now(&self) -> u64 {
        self.now
    }

    /// Move the clock forward to `now`; a value in the past is ignored. Lets a
    /// test age entries without sleeping.
    pub fn advance_to(&mut self, now: u64) {
        if now > self.now {
            self.now = now;
        }
    }

    /// True when `created_at` has aged past the TTL against the store clock.
    fn is_expired(&self, created_at: u64) -> bool {
        if self.ttl_secs == u64::MAX {
            return false;
        }
        created_at.saturating_add(self.ttl_secs) <= self.now
    }

    /// Remove `cache_key` from storage and the recency deque. Counters are the
    /// caller's business.
    fn reap(&mut self, cache_key: u64) {
        self.entries.remove(&cache_key);
        self.recency.retain(|held| *held != cache_key);
    }

    /// Mark `cache_key` most-recently-used.
    fn touch(&mut self, cache_key: u64) {
        self.recency.retain(|held| *held != cache_key);
        self.recency.push_back(cache_key);
    }

    /// Evict least-recently-used entries until the cache fits the bound.
    fn enforce_capacity(&mut self) {
        while self.entries.len() > self.capacity {
            match self.recency.front().copied() {
                Some(lru) => {
                    self.reap(lru);
                    self.evictions = self.evictions.saturating_add(1);
                }
                None => break,
            }
        }
    }

    /// Reap every expired entry, count them and return how many went. `insert`
    /// calls this so a run cannot hoard stale responses under the bound.
    pub fn purge_expired(&mut self) -> usize {
        if self.ttl_secs == u64::MAX {
            return 0;
        }
        let expired: Vec<u64> = self
            .entries
            .iter()
            .filter(|(_, cached)| self.is_expired(cached.created_at))
            .map(|(cache_key, _)| *cache_key)
            .collect();
        let removed = expired.len();
        for cache_key in expired {
            self.reap(cache_key);
        }
        self.expirations = self.expirations.saturating_add(removed as u64);
        removed
    }

    /// Store `response` under the key for (role, model, prompt), stamped with the
    /// current store clock. Sweeps expired entries and enforces the bound.
    pub fn insert(&mut self, role: Role, model: &str, prompt: &str, response: String) {
        self.purge_expired();
        let cache_key = Self::key(role, model, prompt);
        self.entries.insert(
            cache_key,
            CachedResponse {
                response,
                created_at: self.now,
            },
        );
        self.touch(cache_key);
        self.enforce_capacity();
    }

    /// Look up a cached response, counting the hit or the miss. A stale entry is
    /// never returned: it is reaped, counted as an expiration and reported as a
    /// miss.
    pub fn get(&mut self, role: Role, model: &str, prompt: &str) -> Option<String> {
        let cache_key = Self::key(role, model, prompt);
        // Snapshot (present, stale, response) first so the immutable map borrow
        // is released before any `reap`/`touch` mutates the store.
        let (present, stale, response) = match self.entries.get(&cache_key) {
            Some(cached) => (
                true,
                self.is_expired(cached.created_at),
                Some(cached.response.clone()),
            ),
            None => (false, false, None),
        };

        if !present {
            self.misses = self.misses.saturating_add(1);
            return None;
        }
        if stale {
            self.reap(cache_key);
            self.expirations = self.expirations.saturating_add(1);
            self.misses = self.misses.saturating_add(1);
            return None;
        }
        self.touch(cache_key);
        self.hits = self.hits.saturating_add(1);
        response
    }

    /// Drop the entry for (role, model, prompt), returning whether one was there.
    pub fn invalidate(&mut self, role: Role, model: &str, prompt: &str) -> bool {
        let cache_key = Self::key(role, model, prompt);
        let present = self.entries.contains_key(&cache_key);
        if present {
            self.reap(cache_key);
        }
        present
    }

    /// Drop every response, the recency order and all counters.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.recency.clear();
        self.hits = 0;
        self.misses = 0;
        self.evictions = 0;
        self.expirations = 0;
    }

    /// Number of cache hits so far.
    pub fn hits(&self) -> u64 {
        self.hits
    }

    /// Number of cache misses so far.
    pub fn misses(&self) -> u64 {
        self.misses
    }

    /// Entries dropped by the capacity bound.
    pub fn evictions(&self) -> u64 {
        self.evictions
    }

    /// Entries dropped because their TTL lapsed.
    pub fn expirations(&self) -> u64 {
        self.expirations
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

/// Whether a router target runs on this machine or on a provider's servers.
///
/// The distinction is what the local/cloud badge shows and what Eco mode
/// switches between.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetKind {
    /// Runs on this machine (Ollama, LM Studio, a local runtime).
    Local,
    /// Runs on a provider's servers (OpenRouter, DeepSeek, Anthropic, …).
    Cloud,
}

impl TargetKind {
    /// Stable snake_case tag for logs, events and UI.
    pub fn as_str(self) -> &'static str {
        match self {
            TargetKind::Local => "local",
            TargetKind::Cloud => "cloud",
        }
    }

    /// True for [`TargetKind::Local`].
    pub fn is_local(self) -> bool {
        matches!(self, TargetKind::Local)
    }
}

/// One router target: a provider name, whether it is local or cloud, and the
/// model to run on it.
///
/// `warsha_core::RoutingTarget` carries a provider id, a model id and a weight
/// for the existing fallback loop; this struct is the router-quality view that
/// adds the local/cloud [`kind`](RouterTarget::kind).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouterTarget {
    /// Provider name, e.g. `ollama` or `openrouter`.
    pub name: String,
    /// Local or cloud.
    pub kind: TargetKind,
    /// Model id to run on that provider.
    pub model: String,
}

impl RouterTarget {
    /// Build a target from its three parts.
    pub fn new(name: impl Into<String>, kind: TargetKind, model: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            kind,
            model: model.into(),
        }
    }

    /// True when this target runs on this machine.
    pub fn is_local(&self) -> bool {
        self.kind.is_local()
    }

    /// The badge label the UI shows for this target.
    pub fn badge(&self) -> &'static str {
        self.kind.as_str()
    }
}

/// Eco mode: prefer a local model on battery power or when offline.
///
/// The defaults are off, a 20 % battery threshold and "fall back to local when
/// possible", so a fresh install never silently changes routing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct EcoMode {
    /// Whether Eco mode is on at all.
    pub enabled: bool,
    /// Battery percentage at or below which Eco mode prefers local.
    pub battery_threshold_pct: u8,
    /// Whether Eco mode may route to a local target when it triggers.
    pub fallback_to_local: bool,
}

impl Default for EcoMode {
    fn default() -> Self {
        Self {
            enabled: false,
            battery_threshold_pct: 20,
            fallback_to_local: true,
        }
    }
}

impl EcoMode {
    /// An enabled Eco mode with the default threshold and local fallback.
    pub fn enabled() -> Self {
        Self {
            enabled: true,
            ..Self::default()
        }
    }

    /// Replace the battery threshold (clamped to 0..=100).
    pub fn with_battery_threshold(mut self, pct: u8) -> Self {
        self.battery_threshold_pct = pct.min(100);
        self
    }

    /// Turn the local fallback on or off.
    pub fn with_local_fallback(mut self, fallback_to_local: bool) -> Self {
        self.fallback_to_local = fallback_to_local;
        self
    }

    /// Decide whether this step should run on a local target.
    ///
    /// Offline wins over the battery check: without a network no cloud target
    /// can answer, whatever the charge level.
    pub fn decide(&self, is_battery: bool, battery_pct: u8, network_ok: bool) -> EcoModeDecision {
        if !self.enabled {
            return EcoModeDecision {
                use_local: false,
                reason: "eco mode is off".to_string(),
            };
        }

        if !network_ok {
            return EcoModeDecision {
                use_local: self.fallback_to_local,
                reason: if self.fallback_to_local {
                    "offline, so routing to a local target".to_string()
                } else {
                    "offline, and local fallback is disabled".to_string()
                },
            };
        }

        if is_battery && battery_pct <= self.battery_threshold_pct {
            return EcoModeDecision {
                use_local: self.fallback_to_local,
                reason: if self.fallback_to_local {
                    format!(
                        "on battery at {}% (threshold {}%), so routing to a local target",
                        battery_pct, self.battery_threshold_pct
                    )
                } else {
                    format!(
                        "on battery at {}% (threshold {}%), and local fallback is disabled",
                        battery_pct, self.battery_threshold_pct
                    )
                },
            };
        }

        EcoModeDecision {
            use_local: false,
            reason: if is_battery {
                format!(
                    "on battery at {}%, above the {}% threshold",
                    battery_pct, self.battery_threshold_pct
                )
            } else {
                "on mains power".to_string()
            },
        }
    }
}

/// The outcome of [`EcoMode::decide`], with a human-readable reason.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EcoModeDecision {
    /// True when the step should run on a local target.
    pub use_local: bool,
    /// Why, in plain words, for the UI and the event log.
    pub reason: String,
}

/// One task pinned to one model, overriding the role default for that task.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PerTaskDefault {
    /// The task name, e.g. `unit-tests` or `release-notes`.
    pub task: String,
    /// The model id that task should use.
    pub model: String,
}

impl PerTaskDefault {
    /// Build a task → model pin.
    pub fn new(task: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            task: task.into(),
            model: model.into(),
        }
    }
}

/// Task → model pins that override the per-role preset for a single task
/// without touching the role preset itself.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PerTaskDefaults {
    entries: HashMap<String, String>,
}

impl PerTaskDefaults {
    /// No pins.
    pub fn new() -> Self {
        Self::default()
    }

    /// Build the map from a list of pins; a later pin wins on a duplicate task.
    pub fn from_defaults(defaults: impl IntoIterator<Item = PerTaskDefault>) -> Self {
        let mut map = Self::new();
        for default in defaults {
            map.set(&default.task, &default.model);
        }
        map
    }

    /// Pin `task` to `model`, returning the model it replaced.
    pub fn set(&mut self, task: &str, model: &str) -> Option<String> {
        self.entries.insert(task.to_string(), model.to_string())
    }

    /// Pin a [`PerTaskDefault`], returning the model it replaced.
    pub fn set_default(&mut self, default: PerTaskDefault) -> Option<String> {
        self.set(&default.task, &default.model)
    }

    /// The model pinned for `task`, if any.
    pub fn get(&self, task: &str) -> Option<&str> {
        self.entries.get(task).map(String::as_str)
    }

    /// Drop the pin for `task`, returning the model it held.
    pub fn remove(&mut self, task: &str) -> Option<String> {
        self.entries.remove(task)
    }

    /// The model `task` should use: the pin when there is one, otherwise the
    /// role default.
    pub fn model_for<'a>(&'a self, task: &str, role_default: &'a str) -> &'a str {
        self.get(task).unwrap_or(role_default)
    }

    /// Number of pins.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when nothing is pinned.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Every pin, sorted by task name so the output is stable.
    pub fn defaults(&self) -> Vec<PerTaskDefault> {
        let mut defaults: Vec<PerTaskDefault> = self
            .entries
            .iter()
            .map(|(task, model)| PerTaskDefault::new(task.clone(), model.clone()))
            .collect();
        defaults.sort_by(|a, b| a.task.cmp(&b.task));
        defaults
    }
}

/// What to do when a cloud target fails: try the next one, then a local model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct LocalFallbackPolicy {
    /// Whether local fallback is allowed at all.
    pub enabled: bool,
    /// How many local attempts to make after the cloud targets are exhausted.
    pub max_retries: u8,
}

impl Default for LocalFallbackPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            max_retries: 1,
        }
    }
}

impl LocalFallbackPolicy {
    /// A policy with local fallback on or off and `max_retries` local attempts.
    pub fn new(enabled: bool, max_retries: u8) -> Self {
        Self {
            enabled,
            max_retries,
        }
    }

    /// True when `error` looks like a network failure a local target can
    /// absorb: it mentions "network", "timeout" or "connection".
    ///
    /// A disabled policy never falls back, whatever the error says.
    pub fn should_fallback(&self, error: &str) -> bool {
        if !self.enabled {
            return false;
        }
        let lower = error.to_lowercase();
        lower.contains("network") || lower.contains("timeout") || lower.contains("connection")
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
    fn response_cache_capacity_evicts_the_least_recently_used() {
        let mut cache = ResponseCache::with_capacity(2);
        assert_eq!(cache.capacity(), 2);

        cache.insert(Role::Coder, "m", "a", "A".to_string());
        cache.insert(Role::Coder, "m", "b", "B".to_string());
        // Touch "a" so "b" becomes the oldest surviving entry.
        assert_eq!(cache.get(Role::Coder, "m", "a").as_deref(), Some("A"));
        cache.insert(Role::Coder, "m", "c", "C".to_string());

        assert_eq!(cache.len(), 2);
        assert_eq!(cache.get(Role::Coder, "m", "b"), None, "`b` was the LRU");
        assert_eq!(cache.get(Role::Coder, "m", "a").as_deref(), Some("A"));
        assert_eq!(cache.get(Role::Coder, "m", "c").as_deref(), Some("C"));
        assert_eq!(cache.evictions(), 1);
        assert_eq!(cache.expirations(), 0);
    }

    #[test]
    fn response_cache_never_returns_an_expired_entry() {
        let mut cache = ResponseCache::with_ttl(30);
        cache.insert(Role::Coder, "m", "write a test", "done".to_string());
        assert_eq!(
            cache.get(Role::Coder, "m", "write a test").as_deref(),
            Some("done")
        );

        // Age it out by advancing the store clock, then it is a miss and gone.
        cache.advance_to(40);
        assert_eq!(cache.get(Role::Coder, "m", "write a test"), None);
        assert_eq!(cache.expirations(), 1);
        assert_eq!(cache.evictions(), 0);
        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn response_cache_insert_sweeps_expired_under_the_bound() {
        let mut cache = ResponseCache::with_capacity_and_ttl(50, 10);
        cache.insert(Role::Coder, "m", "old", "stale".to_string());
        cache.advance_to(100);
        // Inserting now purges the entry created at 0 (0 + 10 <= 100).
        cache.insert(Role::Coder, "m", "new", "fresh".to_string());

        assert_eq!(cache.len(), 1);
        assert_eq!(cache.expirations(), 1);
        assert_eq!(cache.get(Role::Coder, "m", "old"), None);
        assert_eq!(cache.get(Role::Coder, "m", "new").as_deref(), Some("fresh"));
    }

    #[test]
    fn response_cache_invalidate_and_clear_drop_entries() {
        let mut cache = ResponseCache::new();
        cache.insert(Role::Coder, "m", "write a test", "done".to_string());
        assert!(cache.invalidate(Role::Coder, "m", "write a test"));
        assert!(!cache.invalidate(Role::Coder, "m", "write a test"));
        assert!(cache.is_empty());
        assert_eq!(cache.get(Role::Coder, "m", "write a test"), None);

        cache.insert(Role::Coder, "m", "x", "y".to_string());
        cache.clear();
        assert!(cache.is_empty());
        assert_eq!(cache.hits(), 0);
        assert_eq!(cache.misses(), 0);
    }

    #[test]
    fn response_cache_from_env_uses_the_shared_defaults() {
        // Env unset in the test harness, so `from_env` matches the defaults.
        let cache = ResponseCache::from_env();
        assert_eq!(
            cache.capacity(),
            crate::llm_cache::DEFAULT_LLM_CACHE_MAX_ENTRIES
        );
        assert_eq!(
            cache.ttl_secs(),
            crate::llm_cache::DEFAULT_LLM_CACHE_TTL_SECS
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

    #[test]
    fn target_kind_serialises_and_badges() {
        assert_eq!(TargetKind::Local.as_str(), "local");
        assert_eq!(TargetKind::Cloud.as_str(), "cloud");
        assert!(TargetKind::Local.is_local());
        assert!(!TargetKind::Cloud.is_local());

        assert_eq!(
            serde_json::to_string(&TargetKind::Local).unwrap(),
            "\"local\""
        );
        assert_eq!(
            serde_json::from_str::<TargetKind>("\"cloud\"").unwrap(),
            TargetKind::Cloud
        );

        let local = RouterTarget::new("ollama", TargetKind::Local, "qwen2.5:3b");
        let cloud = RouterTarget::new("openrouter", TargetKind::Cloud, "gpt-4o-mini");
        assert!(local.is_local());
        assert!(!cloud.is_local());
        assert_eq!(local.badge(), "local");
        assert_eq!(cloud.badge(), "cloud");
    }

    #[test]
    fn eco_mode_defaults_are_off() {
        let eco = EcoMode::default();
        assert!(!eco.enabled);
        assert_eq!(eco.battery_threshold_pct, 20);
        assert!(eco.fallback_to_local);

        // A missing field falls back to the default, not to `false`.
        let partial: EcoMode = serde_json::from_str("{\"enabled\": true}").unwrap();
        assert!(partial.enabled);
        assert_eq!(partial.battery_threshold_pct, 20);
        assert!(partial.fallback_to_local);
    }

    #[test]
    fn eco_mode_decides_local_vs_cloud() {
        let eco = EcoMode::enabled().with_battery_threshold(20);

        // Mains power and network: cloud.
        let mains = eco.decide(false, 15, true);
        assert!(!mains.use_local);
        assert!(mains.reason.contains("mains power"));

        // Battery at or below the threshold: local.
        let low = eco.decide(true, 20, true);
        assert!(low.use_local);
        assert!(low.reason.contains("threshold"));

        let lower = eco.decide(true, 5, true);
        assert!(lower.use_local);

        // Battery above the threshold: cloud.
        let high = eco.decide(true, 21, true);
        assert!(!high.use_local);
        assert!(high.reason.contains("above"));

        // Offline beats the battery check.
        let offline = eco.decide(false, 90, false);
        assert!(offline.use_local);
        assert!(offline.reason.contains("offline"));
    }

    #[test]
    fn eco_mode_respects_disabled_local_fallback_and_off_switch() {
        let off = EcoMode::default();
        let decision = off.decide(true, 1, false);
        assert!(!decision.use_local);
        assert_eq!(decision.reason, "eco mode is off");

        let no_fallback = EcoMode::enabled()
            .with_battery_threshold(50)
            .with_local_fallback(false);
        let on_battery = no_fallback.decide(true, 10, true);
        assert!(!on_battery.use_local);
        assert!(on_battery.reason.contains("disabled"));

        let offline = no_fallback.decide(false, 90, false);
        assert!(!offline.use_local);
        assert!(offline.reason.contains("disabled"));

        // The threshold is clamped to a sane percentage.
        assert_eq!(
            EcoMode::enabled()
                .with_battery_threshold(250)
                .battery_threshold_pct,
            100
        );
    }

    #[test]
    fn per_task_defaults_override_the_role_default() {
        let mut defaults = PerTaskDefaults::new();
        assert!(defaults.is_empty());
        assert_eq!(defaults.get("unit-tests"), None);
        assert_eq!(defaults.model_for("unit-tests", "role-model"), "role-model");

        assert_eq!(defaults.set("unit-tests", "mock-small"), None);
        assert_eq!(
            defaults.set("release-notes", "mock-cheap"),
            None,
            "a new pin replaces nothing"
        );
        assert_eq!(defaults.len(), 2);
        assert_eq!(defaults.get("unit-tests"), Some("mock-small"));
        assert_eq!(defaults.model_for("unit-tests", "role-model"), "mock-small");
        assert_eq!(
            defaults.model_for("architecture", "role-model"),
            "role-model"
        );

        // Re-pinning returns the model it replaced.
        assert_eq!(
            defaults.set("unit-tests", "mock-strong"),
            Some("mock-small".to_string())
        );
        assert_eq!(
            defaults.model_for("unit-tests", "role-model"),
            "mock-strong"
        );

        // The listing is sorted by task name.
        let listed = defaults.defaults();
        assert_eq!(listed.len(), 2);
        assert_eq!(
            listed[0],
            PerTaskDefault::new("release-notes", "mock-cheap")
        );
        assert_eq!(listed[1], PerTaskDefault::new("unit-tests", "mock-strong"));

        assert_eq!(
            defaults.remove("unit-tests"),
            Some("mock-strong".to_string())
        );
        assert_eq!(defaults.remove("unit-tests"), None);
        assert_eq!(defaults.len(), 1);

        let built = PerTaskDefaults::from_defaults(vec![PerTaskDefault::new("qa", "mock-small")]);
        assert_eq!(built.get("qa"), Some("mock-small"));
        assert_eq!(
            serde_json::to_string(&built).unwrap(),
            "{\"qa\":\"mock-small\"}"
        );
    }

    #[test]
    fn local_fallback_policy_matches_network_errors() {
        let policy = LocalFallbackPolicy::default();
        assert!(policy.enabled);
        assert_eq!(policy.max_retries, 1);

        assert!(policy.should_fallback("network unreachable"));
        assert!(policy.should_fallback("request timeout after 30s"));
        assert!(policy.should_fallback("Connection reset by peer"));
        assert!(policy.should_fallback("TIMEOUT"));

        assert!(!policy.should_fallback("401 unauthorized"));
        assert!(!policy.should_fallback("model not found"));
        assert!(!policy.should_fallback(""));

        let disabled = LocalFallbackPolicy::new(false, 3);
        assert_eq!(disabled.max_retries, 3);
        assert!(!disabled.should_fallback("network unreachable"));
        assert!(!disabled.should_fallback("connection refused"));
    }
}
