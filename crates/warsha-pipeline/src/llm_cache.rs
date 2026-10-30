//! LLM cache — exact-match and normalized reuse of model responses (PLAN.md M20).
//!
//! The pipeline asks the same questions repeatedly: a stage re-runs, an eval
//! suite replays a prompt, the owner retries a task. When the prompt and the
//! model are unchanged, the answer is unchanged too, and the token budget pays
//! for it again. This module is the store that stops that.
//!
//! - [`LlmCacheKey`] is `(prompt, model)` plus a `normalized` flag. A key with
//!   `normalized: false` must match the stored prompt exactly; a key with
//!   `normalized: true` matches any stored prompt that differs only in
//!   whitespace or letter case, which is what a post-compaction prompt usually
//!   is.
//! - [`normalize_prompt`] is that rule: trim, collapse every run of whitespace
//!   to one space, lowercase.
//! - [`LlmCacheEntry`] is the response, the key it was stored under, when, and
//!   how often it has been reused.
//! - [`LlmCache`] is the trait (`get` / `put` / `stats`) and
//!   [`InMemoryLlmCache`] is the default implementation and the test double.
//!
//! **Relationship to [`crate::router_quality::ResponseCache`]** — that cache is
//! the router's per-run in-process memo keyed by `(role, model, prompt)` through
//! `DefaultHasher`, and it owns cost-avoidance inside one run. It is left exactly
//! as it is: this cache sits behind it, not in front of it. The router asks
//! `ResponseCache` first and only a miss reaches [`LlmCache`], so the existing
//! hit/miss meter keeps its meaning and this one records what survived a cold
//! start. The two do not share storage, and nothing here rewrites a
//! `ResponseCache` entry.
//!
//! **Invalidation**: a changed prompt, a changed model or a cleared store is the
//! whole rule. The key carries both, so an edited prompt cannot collide with the
//! old entry; normalization deliberately ignores only whitespace and case, which
//! is the one difference that provably cannot change a model's answer in a way
//! the owner would notice. Nothing expires by age: a stale answer is a wrong
//! answer, so eviction is [`InMemoryLlmCache::clear`] (or the caller's policy),
//! not a timer this module cannot observe.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::build_cache::fnv1a_64_hex;

/// The prompt form used for a tolerant lookup: trimmed, whitespace-collapsed,
/// lowercased.
///
/// An empty or all-whitespace prompt normalizes to `""`; it is still a legal
/// key, and two blank prompts are the same blank prompt.
pub fn normalize_prompt(prompt: &str) -> String {
    prompt
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// The identity of a cached response.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct LlmCacheKey {
    /// The prompt as the caller holds it. Never rewritten by this module.
    pub prompt: String,
    /// The model that answered it.
    pub model: String,
    /// When true, look the prompt up in normalized form.
    pub normalized: bool,
}

impl LlmCacheKey {
    /// An exact-match key.
    pub fn new(prompt: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            prompt: prompt.into(),
            model: model.into(),
            normalized: false,
        }
    }

    /// A key that also matches prompts differing only in whitespace or case.
    pub fn normalized(prompt: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            prompt: prompt.into(),
            model: model.into(),
            normalized: true,
        }
    }

    /// The prompt as this key compares it.
    pub fn canonical_prompt(&self) -> String {
        if self.normalized {
            normalize_prompt(&self.prompt)
        } else {
            self.prompt.clone()
        }
    }

    /// The cache address: FNV-1a 64 over the canonical prompt and the model.
    pub fn hash(&self) -> String {
        self.identity()
    }

    /// The same address with normalization always applied — the pointer a
    /// tolerant lookup follows to the entry that was stored under the raw prompt.
    fn normalized_identity(&self) -> String {
        fnv1a_64_hex(&[&normalize_prompt(&self.prompt), &self.model])
    }

    fn identity(&self) -> String {
        fnv1a_64_hex(&[&self.canonical_prompt(), &self.model])
    }
}

/// A cached model response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmCacheEntry {
    /// The key it was stored under.
    pub key: LlmCacheKey,
    /// The response text.
    pub response: String,
    /// When it was stored, in seconds since the Unix epoch.
    pub created_at: u64,
    /// How many times it has been reused.
    pub hit_count: u32,
}

impl LlmCacheEntry {
    /// A fresh entry with no hits yet.
    pub fn new(key: LlmCacheKey, response: impl Into<String>, created_at: u64) -> Self {
        Self {
            key,
            response: response.into(),
            created_at,
            hit_count: 0,
        }
    }
}

/// Cache counters, as shown by the cost view.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlmCacheStats {
    /// Entries currently stored.
    pub entries: usize,
    /// Lookups that found a response.
    pub hits: u64,
    /// Lookups that found nothing.
    pub misses: u64,
}

impl LlmCacheStats {
    /// Every lookup so far.
    pub fn lookups(&self) -> u64 {
        self.hits.saturating_add(self.misses)
    }

    /// Hits over lookups, `0.0` before the first lookup.
    pub fn hit_rate(&self) -> f64 {
        match self.lookups() {
            0 => 0.0,
            lookups => self.hits as f64 / lookups as f64,
        }
    }
}

/// Reuses model responses.
pub trait LlmCache {
    /// Look the key up, counting the hit or the miss and bumping the entry's
    /// `hit_count`.
    fn get(&mut self, key: &LlmCacheKey) -> Option<LlmCacheEntry>;

    /// Store a response under its key, replacing any earlier response for the
    /// same prompt and model.
    fn put(&mut self, entry: LlmCacheEntry);

    /// Current counters.
    fn stats(&self) -> LlmCacheStats;
}

/// The in-memory [`LlmCache`]: entries by exact identity, plus a normalized
/// pointer per prompt so a tolerant lookup can find an entry stored raw.
///
/// Every `put` is reachable both ways: by its exact prompt and by its normalized
/// form. When two different raw prompts normalize to the same text, the first one
/// stored owns the normalized pointer (`or_insert`), so the tolerant lookup is
/// deterministic instead of whichever write landed last.
#[derive(Debug, Clone, Default)]
pub struct InMemoryLlmCache {
    entries: HashMap<String, LlmCacheEntry>,
    normalized_index: HashMap<String, String>,
    hits: u64,
    misses: u64,
}

impl InMemoryLlmCache {
    /// An empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// Number of stored responses.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when nothing is cached.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Every stored entry, in no particular order.
    pub fn entries(&self) -> Vec<&LlmCacheEntry> {
        self.entries.values().collect()
    }

    /// Drop the responses, the pointers and the counters.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.normalized_index.clear();
        self.hits = 0;
        self.misses = 0;
    }

    fn record_hit(&mut self, identity: &str) -> Option<LlmCacheEntry> {
        match self.entries.get_mut(identity) {
            Some(entry) => {
                entry.hit_count = entry.hit_count.saturating_add(1);
                self.hits = self.hits.saturating_add(1);
                Some(entry.clone())
            }
            None => None,
        }
    }
}

impl LlmCache for InMemoryLlmCache {
    fn get(&mut self, key: &LlmCacheKey) -> Option<LlmCacheEntry> {
        let identity = if key.normalized {
            self.normalized_index
                .get(&key.normalized_identity())
                .cloned()
        } else {
            Some(key.identity())
        };

        let found = identity.and_then(|identity| self.record_hit(&identity));
        if found.is_none() {
            self.misses = self.misses.saturating_add(1);
        }
        found
    }

    fn put(&mut self, entry: LlmCacheEntry) {
        let identity = entry.key.identity();
        self.normalized_index
            .entry(entry.key.normalized_identity())
            .or_insert_with(|| identity.clone());
        self.entries.insert(identity, entry);
    }

    fn stats(&self) -> LlmCacheStats {
        LlmCacheStats {
            entries: self.entries.len(),
            hits: self.hits,
            misses: self.misses,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> LlmCacheKey {
        LlmCacheKey::new("Summarize the PRD", "model-a")
    }

    #[test]
    fn normalize_trims_collapses_and_lowercases() {
        assert_eq!(
            normalize_prompt("  Summarize   the\n\tPRD  "),
            "summarize the prd"
        );
        assert_eq!(normalize_prompt("one"), "one");
        assert_eq!(normalize_prompt("   "), "");
        assert_eq!(normalize_prompt(""), "");
        // Already-normalized input is a fixed point.
        let once = normalize_prompt("  A  b  ");
        assert_eq!(normalize_prompt(&once), once);
    }

    #[test]
    fn exact_round_trip_hits_and_bumps_the_count() {
        let mut cache = InMemoryLlmCache::new();
        assert!(cache.is_empty());
        cache.put(LlmCacheEntry::new(key(), "the summary", 500));

        let found = cache.get(&key()).expect("response is cached");
        assert_eq!(found.response, "the summary");
        assert_eq!(found.created_at, 500);
        assert_eq!(found.hit_count, 1);
        assert_eq!(found.key, key());

        let stats = cache.stats();
        assert_eq!(stats.entries, 1);
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 0);
    }

    #[test]
    fn a_miss_is_counted() {
        let mut cache = InMemoryLlmCache::new();
        assert_eq!(cache.get(&key()), None);
        assert_eq!(
            cache.get(&LlmCacheKey::new("other prompt", "model-a")),
            None
        );

        let stats = cache.stats();
        assert_eq!(stats.misses, 2);
        assert_eq!(stats.hits, 0);
        assert_eq!(stats.lookups(), 2);
        assert_eq!(stats.hit_rate(), 0.0);
    }

    #[test]
    fn a_normalized_lookup_matches_a_differently_spaced_prompt() {
        let mut cache = InMemoryLlmCache::new();
        cache.put(LlmCacheEntry::new(
            LlmCacheKey::new("Summarize   the PRD", "model-a"),
            "the summary",
            1,
        ));

        let found = cache
            .get(&LlmCacheKey::normalized("  summarize the prd ", "model-a"))
            .expect("the normalized key finds the raw entry");
        assert_eq!(found.response, "the summary");
        assert_eq!(cache.stats().hits, 1);
    }

    #[test]
    fn an_exact_lookup_is_whitespace_sensitive() {
        let mut cache = InMemoryLlmCache::new();
        cache.put(LlmCacheEntry::new(
            LlmCacheKey::new("Summarize   the PRD", "model-a"),
            "the summary",
            1,
        ));

        assert_eq!(
            cache.get(&LlmCacheKey::new("Summarize the PRD", "model-a")),
            None
        );
        assert!(cache
            .get(&LlmCacheKey::normalized("Summarize the PRD", "model-a"))
            .is_some());
        assert_eq!(cache.stats().misses, 1);
    }

    #[test]
    fn the_model_is_part_of_the_key() {
        let mut cache = InMemoryLlmCache::new();
        cache.put(LlmCacheEntry::new(key(), "model-a answer", 1));

        assert_eq!(
            cache.get(&LlmCacheKey::new("Summarize the PRD", "model-b")),
            None
        );
        assert_eq!(
            cache.get(&LlmCacheKey::normalized("Summarize the PRD", "model-b")),
            None
        );
        assert_eq!(
            cache.get(&key()).expect("cached").response,
            "model-a answer"
        );
    }

    #[test]
    fn hits_accumulate_and_the_rate_follows_the_counters() {
        let mut cache = InMemoryLlmCache::new();
        cache.put(LlmCacheEntry::new(key(), "the summary", 1));

        for _ in 0..3 {
            assert!(cache.get(&key()).is_some());
        }
        assert_eq!(cache.get(&key()).expect("cached").hit_count, 4);
        assert_eq!(cache.stats().hit_rate(), 1.0);

        assert_eq!(cache.get(&LlmCacheKey::new("unknown", "model-a")), None);
        let stats = cache.stats();
        assert_eq!(stats.hits, 4);
        assert_eq!(stats.misses, 1);
        assert_eq!(stats.lookups(), 5);
        assert!((stats.hit_rate() - 0.8).abs() < 1e-9);
    }

    #[test]
    fn re_putting_the_same_prompt_replaces_the_response() {
        let mut cache = InMemoryLlmCache::new();
        cache.put(LlmCacheEntry::new(key(), "first", 1));
        assert_eq!(cache.get(&key()).expect("cached").hit_count, 1);

        cache.put(LlmCacheEntry::new(key(), "second", 2));
        assert_eq!(cache.len(), 1);
        let replaced = cache.get(&key()).expect("cached");
        assert_eq!(replaced.response, "second");
        assert_eq!(replaced.created_at, 2);
        assert_eq!(replaced.hit_count, 1);
        // The normalized pointer still lands on the live entry.
        assert_eq!(
            cache
                .get(&LlmCacheKey::normalized("summarize the prd", "model-a"))
                .expect("cached")
                .response,
            "second"
        );
    }

    #[test]
    fn the_first_raw_prompt_owns_the_normalized_pointer() {
        let mut cache = InMemoryLlmCache::new();
        cache.put(LlmCacheEntry::new(
            LlmCacheKey::new("Same   prompt", "model-a"),
            "first",
            1,
        ));
        cache.put(LlmCacheEntry::new(
            LlmCacheKey::new("same prompt", "model-a"),
            "second",
            2,
        ));

        assert_eq!(cache.len(), 2);
        // Both raw prompts are still reachable exactly.
        assert_eq!(
            cache
                .get(&LlmCacheKey::new("Same   prompt", "model-a"))
                .expect("cached")
                .response,
            "first"
        );
        assert_eq!(
            cache
                .get(&LlmCacheKey::new("same prompt", "model-a"))
                .expect("cached")
                .response,
            "second"
        );
        // The tolerant lookup is deterministic: the first writer wins.
        assert_eq!(
            cache
                .get(&LlmCacheKey::normalized("SAME PROMPT", "model-a"))
                .expect("cached")
                .response,
            "first"
        );
    }

    #[test]
    fn key_and_entry_serde_round_trip() {
        let entry = LlmCacheEntry::new(LlmCacheKey::normalized("  Hello  ", "model-a"), "hi", 7);
        let json = serde_json::to_value(&entry).expect("entry serialises");
        assert_eq!(json["response"], "hi");
        assert_eq!(json["hit_count"], 0);
        assert_eq!(json["key"]["normalized"], true);
        assert_eq!(json["key"]["prompt"], "  Hello  ");

        let back: LlmCacheEntry = serde_json::from_value(json).expect("entry deserialises");
        assert_eq!(back, entry);
        // The stored prompt is kept verbatim, so a round trip cannot change it.
        assert_eq!(back.key.prompt, "  Hello  ");
    }

    #[test]
    fn canonical_prompt_follows_the_flag() {
        let exact = LlmCacheKey::new("  Mixed  Case ", "model-a");
        assert_eq!(exact.canonical_prompt(), "  Mixed  Case ");
        let tolerant = LlmCacheKey::normalized("  Mixed  Case ", "model-a");
        assert_eq!(tolerant.canonical_prompt(), "mixed case");
        assert_eq!(tolerant.hash().len(), 16);
    }

    #[test]
    fn clearing_drops_entries_pointers_and_counters() {
        let mut cache = InMemoryLlmCache::new();
        cache.put(LlmCacheEntry::new(key(), "the summary", 1));
        assert!(cache.get(&key()).is_some());

        cache.clear();
        assert!(cache.is_empty());
        assert!(cache.get(&key()).is_none());
        assert_eq!(
            cache.stats(),
            LlmCacheStats {
                entries: 0,
                hits: 0,
                misses: 1,
            }
        );
    }
}
