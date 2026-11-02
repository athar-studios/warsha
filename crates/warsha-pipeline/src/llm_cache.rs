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
//! **Retention (H-06)**: paid model output must not live forever. The store is
//! bounded two ways and both are enforced by [`InMemoryLlmCache`] itself, not by
//! a caller who may forget:
//!
//! - **Capacity**: at most [`InMemoryLlmCache::capacity`] entries. A `put` that
//!   overflows evicts the least-recently-used entry (a `get` or a re-`put` makes
//!   an entry the most-recently-used), so eviction is deterministic rather than
//!   whichever bucket `HashMap` iteration happened to reach.
//! - **Age**: every entry carries the [`LlmCacheEntry::created_at`] it was stored
//!   under and expires after [`InMemoryLlmCache::ttl_secs`] seconds of the
//!   store's clock. An expired entry is never returned — a lookup that finds one
//!   reaps it and counts a miss — and any `put` sweeps expired entries first, so
//!   the store cannot quietly hoard stale answers under the capacity bound.
//!
//! The clock starts at `0` and only moves forward through
//! [`InMemoryLlmCache::advance_to`]; a caller that wants wall-clock expiry drives
//! it from the system time (or, in a test, from a fabricated value — no sleeping
//! required). [`InMemoryLlmCache::invalidate`] and
//! [`InMemoryLlmCache::clear`] drop entries on demand. An entry is reachable two
//! ways (exact identity and a normalized pointer), so every removal — eviction,
//! expiry, invalidation — drops the entry *and* every normalized pointer that
//! aimed at it; a pointer may never outlive its entry.
//!
//! A changed prompt or a changed model still cannot collide with the old entry,
//! because the key carries both. Normalization deliberately ignores only
//! whitespace and case, the one difference that provably cannot change a model's
//! answer in a way the owner would notice.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};

use crate::build_cache::fnv1a_64_hex;

/// Default bound on stored responses before least-recently-used eviction.
///
/// Large enough to survive a busy run, small enough that the paid output held in
/// memory stays bounded. Override with `WARSHA_LLM_CACHE_MAX_ENTRIES` (see
/// [`InMemoryLlmCache::from_env`]).
pub const DEFAULT_LLM_CACHE_MAX_ENTRIES: usize = 512;

/// Default lifetime of a cached response, in seconds — 24 hours.
///
/// After this much store-clock time an entry is stale and is never served again.
/// Override with `WARSHA_LLM_CACHE_TTL_SECS` (see [`InMemoryLlmCache::from_env`]).
pub const DEFAULT_LLM_CACHE_TTL_SECS: u64 = 86_400;

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
    /// Entries dropped by the capacity bound (least-recently-used eviction).
    pub evictions: u64,
    /// Entries dropped because their TTL lapsed (on a lookup or a sweep).
    pub expirations: u64,
}

impl LlmCacheStats {
    /// Every lookup so far.
    pub fn lookups(&self) -> u64 {
        self.hits.saturating_add(self.misses)
    }

    /// Entries removed for being over capacity or out of date.
    pub fn removed(&self) -> u64 {
        self.evictions.saturating_add(self.expirations)
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
    /// `hit_count`. An expired entry is not returned: it is reaped and counted as
    /// a miss.
    fn get(&mut self, key: &LlmCacheKey) -> Option<LlmCacheEntry>;

    /// Store a response under its key, replacing any earlier response for the
    /// same prompt and model, sweeping expired entries and enforcing the
    /// capacity bound.
    fn put(&mut self, entry: LlmCacheEntry);

    /// Drop the entry for `key` — its exact identity and every normalized
    /// pointer that resolves to it — returning how many entries were removed.
    fn invalidate(&mut self, key: &LlmCacheKey) -> usize;

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
///
/// Storage is bounded (H-06): a `recency` deque orders entries least- to
/// most-recently-used, `capacity` caps how many survive, and `ttl_secs` is the
/// age after which an entry is stale on the store's `now` clock. Removal is
/// always whole: an entry leaves together with every normalized pointer that
/// aimed at it, so a pointer never outlives its entry.
#[derive(Debug, Clone)]
pub struct InMemoryLlmCache {
    entries: HashMap<String, LlmCacheEntry>,
    normalized_index: HashMap<String, String>,
    /// Identities front-to-back, least- to most-recently-used. Holds exactly the
    /// identities present in `entries`, once each.
    recency: VecDeque<String>,
    capacity: usize,
    ttl_secs: u64,
    /// The store's clock in seconds; only ever moves forward. Expiry is measured
    /// against it, so a test drives time with [`Self::advance_to`] instead of
    /// sleeping.
    now: u64,
    hits: u64,
    misses: u64,
    evictions: u64,
    expirations: u64,
}

impl Default for InMemoryLlmCache {
    fn default() -> Self {
        Self::with_capacity_and_ttl(DEFAULT_LLM_CACHE_MAX_ENTRIES, DEFAULT_LLM_CACHE_TTL_SECS)
    }
}

/// Read `key` from the environment as a number, ignoring a missing or unparseable
/// value so a stray setting never panics the cache into nothing.
fn env_number<T: std::str::FromStr>(key: &str) -> Option<T> {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<T>().ok())
}

impl InMemoryLlmCache {
    /// An empty cache at the default capacity and TTL, clock at `0`.
    pub fn new() -> Self {
        Self::default()
    }

    /// A cache holding at most `max_entries` (LRU-evicted), at the default TTL.
    pub fn with_capacity(max_entries: usize) -> Self {
        Self::with_capacity_and_ttl(max_entries, DEFAULT_LLM_CACHE_TTL_SECS)
    }

    /// A cache whose entries expire after `ttl_secs` store seconds, at the
    /// default capacity. `u64::MAX` disables age expiry.
    pub fn with_ttl(ttl_secs: u64) -> Self {
        Self::with_capacity_and_ttl(DEFAULT_LLM_CACHE_MAX_ENTRIES, ttl_secs)
    }

    /// A cache with an explicit bound and lifetime, clock at `0`. A `max_entries`
    /// of `0` stores nothing; a `ttl_secs` of `u64::MAX` never expires by age.
    pub fn with_capacity_and_ttl(max_entries: usize, ttl_secs: u64) -> Self {
        Self {
            entries: HashMap::new(),
            normalized_index: HashMap::new(),
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

    /// Build the cache from the environment: `WARSHA_LLM_CACHE_MAX_ENTRIES` and
    /// `WARSHA_LLM_CACHE_TTL_SECS`, each falling back to its default when unset or
    /// unparseable.
    pub fn from_env() -> Self {
        let capacity = env_number::<usize>("WARSHA_LLM_CACHE_MAX_ENTRIES")
            .unwrap_or(DEFAULT_LLM_CACHE_MAX_ENTRIES);
        let ttl =
            env_number::<u64>("WARSHA_LLM_CACHE_TTL_SECS").unwrap_or(DEFAULT_LLM_CACHE_TTL_SECS);
        Self::with_capacity_and_ttl(capacity, ttl)
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

    /// Move the clock forward to `now`. A value in the past is ignored, so the
    /// clock only ever advances — this is what lets expiry tests fabricate time.
    pub fn advance_to(&mut self, now: u64) {
        if now > self.now {
            self.now = now;
        }
    }

    /// Number of stored responses.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when nothing is cached.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Every stored entry that has not yet aged out, in no particular order.
    pub fn entries(&self) -> Vec<&LlmCacheEntry> {
        self.entries
            .values()
            .filter(|entry| !self.is_expired(entry.created_at))
            .collect()
    }

    /// True when `created_at` has aged past the TTL against the store clock.
    fn is_expired(&self, created_at: u64) -> bool {
        if self.ttl_secs == u64::MAX {
            return false;
        }
        created_at.saturating_add(self.ttl_secs) <= self.now
    }

    /// Drop `identity` and every normalized pointer that aimed at it, keeping the
    /// recency deque in step. Does not touch the counters — callers say why.
    fn reap(&mut self, identity: &str) {
        self.entries.remove(identity);
        self.recency.retain(|held| held != identity);
        self.normalized_index.retain(|_, target| target != identity);
    }

    /// Mark `identity` most-recently-used.
    fn touch(&mut self, identity: &str) {
        self.recency.retain(|held| held != identity);
        self.recency.push_back(identity.to_string());
    }

    /// Evict least-recently-used entries until the store fits the bound.
    fn enforce_capacity(&mut self) {
        while self.entries.len() > self.capacity {
            match self.recency.front().cloned() {
                Some(lru) => {
                    self.reap(&lru);
                    self.evictions = self.evictions.saturating_add(1);
                }
                None => break,
            }
        }
    }

    /// Reap every expired entry, count them and return how many went. A `put`
    /// calls this so the store cannot hoard stale answers under the bound.
    pub fn purge_expired(&mut self) -> usize {
        if self.ttl_secs == u64::MAX {
            return 0;
        }
        let expired: Vec<String> = self
            .entries
            .iter()
            .filter(|(_, entry)| self.is_expired(entry.created_at))
            .map(|(identity, _)| identity.clone())
            .collect();
        let removed = expired.len();
        for identity in &expired {
            self.reap(identity);
        }
        self.expirations = self.expirations.saturating_add(removed as u64);
        removed
    }

    /// Return the live entry under `identity`, bumping its hit count and marking
    /// it most-recently-used, or `None` (reaping and counting an expiration) when
    /// it is absent or stale.
    fn lookup_live(&mut self, identity: &str) -> Option<LlmCacheEntry> {
        // Read the clock into copies first: the mutable `get_mut` borrow of
        // `entries` would otherwise conflict with the immutable borrow `&self`
        // methods take.
        let no_expiry = self.ttl_secs == u64::MAX;
        let ttl = self.ttl_secs;
        let now = self.now;
        let hit = match self.entries.get_mut(identity) {
            Some(entry) => {
                let stale = !no_expiry && entry.created_at.saturating_add(ttl) <= now;
                if stale {
                    None
                } else {
                    entry.hit_count = entry.hit_count.saturating_add(1);
                    Some(entry.clone())
                }
            }
            None => None,
        };
        if let Some(entry) = hit {
            self.touch(identity);
            return Some(entry);
        }
        // A stale entry that was present is reaped here; an absent one is not.
        if self.entries.contains_key(identity) {
            self.reap(identity);
            self.expirations = self.expirations.saturating_add(1);
        }
        None
    }

    /// Drop the responses, the pointers, the recency order and the counters.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.normalized_index.clear();
        self.recency.clear();
        self.hits = 0;
        self.misses = 0;
        self.evictions = 0;
        self.expirations = 0;
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

        let found = identity
            .as_deref()
            .and_then(|identity| self.lookup_live(identity));
        if found.is_some() {
            self.hits = self.hits.saturating_add(1);
        } else {
            self.misses = self.misses.saturating_add(1);
        }
        found
    }

    fn put(&mut self, entry: LlmCacheEntry) {
        self.purge_expired();
        let identity = entry.key.identity();
        self.normalized_index
            .entry(entry.key.normalized_identity())
            .or_insert_with(|| identity.clone());
        self.entries.insert(identity.clone(), entry);
        self.touch(&identity);
        self.enforce_capacity();
    }

    fn invalidate(&mut self, key: &LlmCacheKey) -> usize {
        let pointer_target = self
            .normalized_index
            .get(&key.normalized_identity())
            .cloned();
        let mut identities = vec![key.identity()];
        if let Some(target) = pointer_target {
            identities.push(target);
        }
        let mut removed = 0usize;
        for identity in &identities {
            if self.entries.contains_key(identity) {
                self.reap(identity);
                removed = removed.saturating_add(1);
            }
        }
        removed
    }

    fn stats(&self) -> LlmCacheStats {
        LlmCacheStats {
            entries: self.entries.len(),
            hits: self.hits,
            misses: self.misses,
            evictions: self.evictions,
            expirations: self.expirations,
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
                evictions: 0,
                expirations: 0,
            }
        );
    }

    #[test]
    fn capacity_evicts_the_least_recently_used_entry() {
        let mut cache = InMemoryLlmCache::with_capacity(2);
        assert_eq!(cache.capacity(), 2);

        // `first` is inserted, then touched by a lookup, so `second` becomes the
        // oldest when `third` arrives and forces an eviction.
        cache.put(LlmCacheEntry::new(
            LlmCacheKey::new("first", "model-a"),
            "one",
            1,
        ));
        cache.put(LlmCacheEntry::new(
            LlmCacheKey::new("second", "model-a"),
            "two",
            2,
        ));
        assert!(cache.get(&LlmCacheKey::new("first", "model-a")).is_some());
        cache.put(LlmCacheEntry::new(
            LlmCacheKey::new("third", "model-a"),
            "three",
            3,
        ));

        assert_eq!(cache.len(), 2);
        assert!(
            cache.get(&LlmCacheKey::new("second", "model-a")).is_none(),
            "the untouched `second` was the LRU and is gone"
        );
        assert!(cache.get(&LlmCacheKey::new("first", "model-a")).is_some());
        assert!(cache.get(&LlmCacheKey::new("third", "model-a")).is_some());
        assert_eq!(cache.stats().evictions, 1);
        assert_eq!(cache.stats().entries, 2);
    }

    #[test]
    fn a_zero_capacity_cache_stores_nothing() {
        let mut cache = InMemoryLlmCache::with_capacity(0);
        cache.put(LlmCacheEntry::new(key(), "the summary", 1));
        assert_eq!(cache.len(), 0);
        assert!(cache.is_empty());
        assert_eq!(cache.stats().evictions, 1);
    }

    #[test]
    fn an_expired_entry_is_not_returned_and_counts_as_a_miss() {
        let mut cache = InMemoryLlmCache::with_ttl(60);
        cache.put(LlmCacheEntry::new(key(), "the summary", 100));

        // Still fresh at the store clock of 100.
        assert!(cache.get(&key()).is_some());

        // Age it out purely by advancing the clock — no sleeping.
        cache.advance_to(160);
        assert_eq!(
            cache.get(&key()),
            None,
            "past 100 + 60 the entry is stale and never served"
        );

        let stats = cache.stats();
        assert_eq!(stats.misses, 1);
        assert_eq!(stats.expirations, 1);
        assert_eq!(stats.entries, 0, "the stale entry was reaped on lookup");
        // Advancing backward is ignored: the clock only moves forward.
        cache.advance_to(0);
        assert_eq!(cache.now(), 160);
    }

    #[test]
    fn a_normalized_lookup_never_returns_an_expired_entry() {
        let mut cache = InMemoryLlmCache::with_ttl(10);
        cache.put(LlmCacheEntry::new(
            LlmCacheKey::new("Summarize   the PRD", "model-a"),
            "the summary",
            1,
        ));
        assert!(cache
            .get(&LlmCacheKey::normalized("summarize the prd", "model-a"))
            .is_some());

        cache.advance_to(50);
        assert_eq!(
            cache.get(&LlmCacheKey::normalized("summarize the prd", "model-a")),
            None
        );
        // The pointer and its entry are both gone, so the exact lookup misses too.
        assert_eq!(
            cache.get(&LlmCacheKey::new("Summarize   the PRD", "model-a")),
            None
        );
        assert_eq!(cache.stats().entries, 0);
    }

    #[test]
    fn putting_sweeps_expired_entries_under_the_bound() {
        let mut cache = InMemoryLlmCache::with_capacity_and_ttl(100, 20);
        cache.put(LlmCacheEntry::new(
            LlmCacheKey::new("gone", "model-a"),
            "old",
            1,
        ));
        cache.advance_to(100);
        // One live entry pushed after expiry also sweeps the stale one first.
        cache.put(LlmCacheEntry::new(
            LlmCacheKey::new("fresh", "model-a"),
            "new",
            100,
        ));

        assert_eq!(cache.len(), 1);
        assert_eq!(cache.stats().expirations, 1);
        assert!(cache.get(&LlmCacheKey::new("gone", "model-a")).is_none());
        assert!(cache.get(&LlmCacheKey::new("fresh", "model-a")).is_some());
    }

    #[test]
    fn ttl_of_max_never_expires_by_age() {
        let mut cache = InMemoryLlmCache::with_ttl(u64::MAX);
        cache.put(LlmCacheEntry::new(key(), "the summary", 1));
        cache.advance_to(u64::MAX / 2);
        assert!(cache.get(&key()).is_some());
        assert_eq!(cache.purge_expired(), 0);
        assert_eq!(cache.stats().expirations, 0);
    }

    #[test]
    fn invalidate_drops_the_exact_entry_and_its_normalized_pointer() {
        let mut cache = InMemoryLlmCache::new();
        let raw = LlmCacheKey::new("Summarize   the PRD", "model-a");
        cache.put(LlmCacheEntry::new(raw.clone(), "the summary", 1));
        // Reachable through the tolerant pointer before invalidation.
        assert!(cache
            .get(&LlmCacheKey::normalized("summarize the prd", "model-a"))
            .is_some());

        let removed = cache.invalidate(&raw);
        assert_eq!(removed, 1);
        assert!(cache.is_empty());
        // Both indexes are gone: exact and normalized lookups miss.
        assert_eq!(cache.get(&raw), None);
        assert_eq!(
            cache.get(&LlmCacheKey::normalized("summarize the prd", "model-a")),
            None
        );
    }

    #[test]
    fn invalidate_through_a_normalized_key_drops_the_raw_entry() {
        let mut cache = InMemoryLlmCache::new();
        cache.put(LlmCacheEntry::new(
            LlmCacheKey::new("  Spaced  Prompt  ", "model-a"),
            "answer",
            1,
        ));
        // Invalidate using a differently-spaced tolerant key for the same text.
        let removed = cache.invalidate(&LlmCacheKey::normalized("spaced prompt", "model-a"));
        assert_eq!(removed, 1);
        assert_eq!(cache.len(), 0);
        assert_eq!(
            cache.get(&LlmCacheKey::new("  Spaced  Prompt  ", "model-a")),
            None
        );
    }

    #[test]
    fn eviction_drops_the_normalized_pointer_with_its_owner() {
        // Capacity-1. The tolerant pointer is owned by the FIRST raw prompt stored
        // ("Same   prompt"). Evicting that owner must drop the pointer too — a
        // pointer never outlives its entry — so the surviving raw prompt stays
        // reachable exactly but is not resurrected through the tolerant lookup.
        let mut cache = InMemoryLlmCache::with_capacity(1);
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
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.stats().evictions, 1);
        assert_eq!(
            cache
                .get(&LlmCacheKey::new("same prompt", "model-a"))
                .expect("the surviving raw prompt is still reachable exactly")
                .response,
            "second"
        );
        assert_eq!(
            cache.get(&LlmCacheKey::normalized("SAME PROMPT", "model-a")),
            None,
            "the pointer died with its owner, so nothing is served through it"
        );
    }

    #[test]
    fn from_env_falls_back_to_the_documented_defaults() {
        // Without the env vars set, `from_env` matches `new`'s defaults.
        let cache = InMemoryLlmCache::from_env();
        assert_eq!(cache.capacity(), DEFAULT_LLM_CACHE_MAX_ENTRIES);
        assert_eq!(cache.ttl_secs(), DEFAULT_LLM_CACHE_TTL_SECS);
    }
}
