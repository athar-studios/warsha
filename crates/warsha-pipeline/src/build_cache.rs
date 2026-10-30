//! Build cache — content-addressed reuse of stage outputs (PLAN.md M20).
//!
//! A pipeline stage is a pure function of its inputs, its prompt, the model that
//! answers it and the skill versions it loads. When all four are unchanged the
//! output the stage produced last time is still the answer, so re-running the
//! stage is money spent to recompute a known result. This module is the store
//! that lets the engine skip that work.
//!
//! - [`BuildCacheKey`] names the four inputs plus the skill versions, and
//!   [`BuildCacheKey::hash`] folds them into one stable hex string (FNV-1a 64,
//!   hand-rolled — this crate has no digest dependency and gains none here).
//! - [`BuildCacheEntry`] is what was produced: the key, the output path and when
//!   it was written, plus how many times it has been reused.
//! - [`BuildCache`] is the trait (`get` / `put` / `invalidate` / `stats`) and
//!   [`InMemoryBuildCache`] is the default implementation and the test double.
//!
//! **Invalidation rules** — the four ways an entry stops being valid, each one a
//! consequence of the key rather than a policy this store remembers:
//!
//! | Change | Why the old entry stops hitting |
//! | --- | --- |
//! | Prompt edited | `prompt_hash` changes, so [`BuildCacheKey::hash`] changes |
//! | Model swapped | `model` is part of the key |
//! | Skill pinned or bumped | `skill_versions` is part of the key, in order |
//! | Inputs edited | `inputs_hash` changes |
//! | Cold start | a fresh store holds nothing, so the first lookup misses |
//! | A stage rebuilt on purpose | [`BuildCache::invalidate`] drops every entry for that stage |
//!
//! Because the key carries all four, an invalidation is mostly *implicit*: a
//! changed prompt cannot collide with the old entry. `invalidate` exists for the
//! one case the key cannot express — "this stage's outputs are wrong, drop them
//! all" — and it reports how many entries it removed. Nothing here reads or
//! writes the filesystem: `output_path` is a string the caller resolves, and a
//! cached entry whose file is gone must be evicted by the caller with
//! `invalidate`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The field separator inside a hash: a unit separator, so `("ab", "c")` and
/// `("a", "bc")` cannot produce the same digest.
const FIELD_SEPARATOR: u8 = 0x1f;

/// FNV-1a 64 over `parts`, zero-padded hex.
///
/// Shared with [`crate::llm_cache`] so both caches name keys the same way. The
/// separator is fed between parts, which is what keeps field boundaries from
/// blurring together.
pub(crate) fn fnv1a_64_hex(parts: &[&str]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for (index, part) in parts.iter().enumerate() {
        if index > 0 {
            hash = fnv1a_step(hash, FIELD_SEPARATOR);
        }
        for byte in part.as_bytes() {
            hash = fnv1a_step(hash, *byte);
        }
    }
    format!("{hash:016x}")
}

fn fnv1a_step(hash: u64, byte: u8) -> u64 {
    let mixed = hash ^ u64::from(byte);
    mixed.wrapping_mul(0x0000_0100_0000_01b3)
}

/// Everything a stage's output depends on.
///
/// The three `*_hash`/`model` scalars are the four declared inputs; the skill
/// list is kept in the order the stage loaded the skills, because a changed
/// order can change the prompt.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct BuildCacheKey {
    /// The stage name, e.g. `code` or `review_qa_security`.
    pub stage: String,
    /// Hash of the stage's input artifacts.
    pub inputs_hash: String,
    /// Hash of the rendered prompt.
    pub prompt_hash: String,
    /// The model that answered it.
    pub model: String,
    /// Versions of the skills the stage loaded, in load order.
    #[serde(default)]
    pub skill_versions: Vec<String>,
}

impl BuildCacheKey {
    /// A key with no skills pinned yet.
    pub fn new(
        stage: impl Into<String>,
        inputs_hash: impl Into<String>,
        prompt_hash: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        Self {
            stage: stage.into(),
            inputs_hash: inputs_hash.into(),
            prompt_hash: prompt_hash.into(),
            model: model.into(),
            skill_versions: Vec::new(),
        }
    }

    /// Pin the skill versions the stage loaded.
    pub fn with_skills(mut self, skill_versions: impl IntoIterator<Item = String>) -> Self {
        self.skill_versions = skill_versions.into_iter().collect();
        self
    }

    /// The content address: FNV-1a 64 over every field, as 16 hex digits.
    pub fn hash(&self) -> String {
        // The skill list is joined into one part; a version string containing the
        // join character would be ambiguous, so the order-preserving list is
        // folded with a newline, which no version string in `skills.lock` uses.
        let skills = self.skill_versions.join("\n");
        fnv1a_64_hex(&[
            &self.stage,
            &self.inputs_hash,
            &self.prompt_hash,
            &self.model,
            &skills,
        ])
    }

    /// True when every scalar field carries a value, which is what a lookup is
    /// worth doing for. A key with a blank `stage` or `model` would hit whichever
    /// blank-keyed entry happened to be there first.
    pub fn is_complete(&self) -> bool {
        !self.stage.trim().is_empty()
            && !self.inputs_hash.trim().is_empty()
            && !self.prompt_hash.trim().is_empty()
            && !self.model.trim().is_empty()
    }
}

/// A cached stage output.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BuildCacheEntry {
    /// The key it was produced under.
    pub key: BuildCacheKey,
    /// Where the output lives, relative to the project or absolute.
    pub output_path: String,
    /// When it was written, in seconds since the Unix epoch.
    pub created_at: u64,
    /// How many times it has been reused.
    pub hit_count: u32,
}

impl BuildCacheEntry {
    /// A fresh entry with no hits yet.
    pub fn new(key: BuildCacheKey, output_path: impl Into<String>, created_at: u64) -> Self {
        Self {
            key,
            output_path: output_path.into(),
            created_at,
            hit_count: 0,
        }
    }
}

/// Cache counters, as shown by the cost view.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BuildCacheStats {
    /// Entries currently stored.
    pub entries: usize,
    /// Lookups that found an entry.
    pub hits: u64,
    /// Lookups that found nothing.
    pub misses: u64,
}

impl BuildCacheStats {
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

/// Reuses stage outputs keyed by [`BuildCacheKey`].
pub trait BuildCache {
    /// Look the key up, counting the hit or the miss and bumping the entry's
    /// `hit_count`.
    fn get(&mut self, key: &BuildCacheKey) -> Option<BuildCacheEntry>;

    /// Store an entry under its key, replacing any earlier entry with that hash.
    fn put(&mut self, entry: BuildCacheEntry);

    /// Drop every entry for `stage`, returning how many were removed.
    fn invalidate(&mut self, stage: &str) -> usize;

    /// Current counters.
    fn stats(&self) -> BuildCacheStats;
}

/// The in-memory [`BuildCache`]: entries by content hash plus hit/miss counters.
#[derive(Debug, Clone, Default)]
pub struct InMemoryBuildCache {
    entries: HashMap<String, BuildCacheEntry>,
    hits: u64,
    misses: u64,
}

impl InMemoryBuildCache {
    /// An empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    /// Every stored entry, in no particular order.
    pub fn entries(&self) -> Vec<&BuildCacheEntry> {
        self.entries.values().collect()
    }

    /// Number of stored entries.
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// True when nothing is cached.
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Drop the entries and the counters.
    pub fn clear(&mut self) {
        self.entries.clear();
        self.hits = 0;
        self.misses = 0;
    }
}

impl BuildCache for InMemoryBuildCache {
    fn get(&mut self, key: &BuildCacheKey) -> Option<BuildCacheEntry> {
        match self.entries.get_mut(&key.hash()) {
            Some(entry) => {
                entry.hit_count = entry.hit_count.saturating_add(1);
                self.hits = self.hits.saturating_add(1);
                Some(entry.clone())
            }
            None => {
                self.misses = self.misses.saturating_add(1);
                None
            }
        }
    }

    fn put(&mut self, entry: BuildCacheEntry) {
        self.entries.insert(entry.key.hash(), entry);
    }

    fn invalidate(&mut self, stage: &str) -> usize {
        let before = self.entries.len();
        self.entries.retain(|_, entry| entry.key.stage != stage);
        before - self.entries.len()
    }

    fn stats(&self) -> BuildCacheStats {
        BuildCacheStats {
            entries: self.entries.len(),
            hits: self.hits,
            misses: self.misses,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> BuildCacheKey {
        BuildCacheKey::new("code", "inputs-a", "prompt-a", "model-a")
    }

    fn entry(created_at: u64) -> BuildCacheEntry {
        BuildCacheEntry::new(key(), "factory/code.md", created_at)
    }

    #[test]
    fn the_hash_is_stable_and_covers_every_field() {
        let base = key();
        assert_eq!(base.hash(), base.clone().hash());
        assert_eq!(base.hash().len(), 16);
        assert!(base.hash().chars().all(|c| c.is_ascii_hexdigit()));

        let variants = [
            BuildCacheKey::new("review", "inputs-a", "prompt-a", "model-a"),
            BuildCacheKey::new("code", "inputs-b", "prompt-a", "model-a"),
            BuildCacheKey::new("code", "inputs-a", "prompt-b", "model-a"),
            BuildCacheKey::new("code", "inputs-a", "prompt-a", "model-b"),
            base.clone().with_skills(vec!["skill@1".to_string()]),
        ];
        for variant in &variants {
            assert_ne!(base.hash(), variant.hash(), "{variant:?} collided");
        }
        // The skill list is order-sensitive: reordering is a different prompt.
        let forward = base
            .clone()
            .with_skills(vec!["a@1".to_string(), "b@1".to_string()]);
        let reversed = base
            .clone()
            .with_skills(vec!["b@1".to_string(), "a@1".to_string()]);
        assert_ne!(forward.hash(), reversed.hash());
    }

    #[test]
    fn field_boundaries_do_not_blur() {
        let split = BuildCacheKey::new("ab", "c", "prompt", "model");
        let joined = BuildCacheKey::new("a", "bc", "prompt", "model");
        assert_ne!(split.hash(), joined.hash());
    }

    #[test]
    fn put_then_get_counts_one_hit() {
        let mut cache = InMemoryBuildCache::new();
        assert!(cache.is_empty());
        cache.put(entry(1_000));

        let found = cache.get(&key()).expect("entry is cached");
        assert_eq!(found.output_path, "factory/code.md");
        assert_eq!(found.created_at, 1_000);
        assert_eq!(found.hit_count, 1);
        assert_eq!(cache.len(), 1);

        let stats = cache.stats();
        assert_eq!(stats.entries, 1);
        assert_eq!(stats.hits, 1);
        assert_eq!(stats.misses, 0);
    }

    #[test]
    fn a_cold_store_misses_and_counts_it() {
        let mut cache = InMemoryBuildCache::new();
        assert_eq!(cache.get(&key()), None);
        assert_eq!(cache.get(&key()), None);

        let stats = cache.stats();
        assert_eq!(stats.misses, 2);
        assert_eq!(stats.hits, 0);
        assert_eq!(stats.entries, 0);
        assert_eq!(stats.lookups(), 2);
        assert_eq!(stats.hit_rate(), 0.0);
    }

    #[test]
    fn repeated_hits_accumulate_on_the_entry_and_the_stats() {
        let mut cache = InMemoryBuildCache::new();
        cache.put(entry(10));

        for _ in 0..3 {
            assert!(cache.get(&key()).is_some());
        }
        assert_eq!(cache.get(&key()).expect("cached").hit_count, 4);

        let stats = cache.stats();
        assert_eq!(stats.hits, 4);
        assert_eq!(stats.lookups(), 4);
        assert_eq!(stats.hit_rate(), 1.0);
    }

    #[test]
    fn invalidate_drops_only_the_named_stage() {
        let mut cache = InMemoryBuildCache::new();
        cache.put(entry(1));
        cache.put(BuildCacheEntry::new(
            BuildCacheKey::new("code", "inputs-b", "prompt-a", "model-a"),
            "factory/code-2.md",
            2,
        ));
        cache.put(BuildCacheEntry::new(
            BuildCacheKey::new("review", "inputs-a", "prompt-a", "model-a"),
            "factory/review.md",
            3,
        ));

        assert_eq!(cache.invalidate("code"), 2);
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.invalidate("code"), 0);
        assert!(cache.entries().iter().all(|e| e.key.stage == "review"));
        // The surviving entry still hits, and the dropped one now misses.
        assert!(cache
            .get(&BuildCacheKey::new(
                "review", "inputs-a", "prompt-a", "model-a"
            ))
            .is_some());
        assert_eq!(cache.get(&key()), None);
    }

    #[test]
    fn a_rebuild_replaces_the_entry_and_resets_its_hits() {
        let mut cache = InMemoryBuildCache::new();
        cache.put(entry(1));
        assert_eq!(cache.get(&key()).expect("cached").hit_count, 1);

        cache.put(BuildCacheEntry::new(key(), "factory/code-v2.md", 2));
        assert_eq!(cache.len(), 1);
        let replaced = cache.get(&key()).expect("cached");
        assert_eq!(replaced.output_path, "factory/code-v2.md");
        assert_eq!(replaced.created_at, 2);
        assert_eq!(replaced.hit_count, 1);
    }

    #[test]
    fn a_key_is_complete_only_with_every_scalar() {
        assert!(key().is_complete());
        assert!(key()
            .clone()
            .with_skills(vec!["skill@1".to_string()])
            .is_complete());
        for partial in [
            BuildCacheKey::new("", "inputs-a", "prompt-a", "model-a"),
            BuildCacheKey::new("code", " ", "prompt-a", "model-a"),
            BuildCacheKey::new("code", "inputs-a", "", "model-a"),
            BuildCacheKey::new("code", "inputs-a", "prompt-a", "  "),
        ] {
            assert!(!partial.is_complete());
        }
    }

    #[test]
    fn key_and_entry_serde_round_trip() {
        let entry = entry(42);
        let json = serde_json::to_value(&entry).expect("entry serialises");
        assert_eq!(json["output_path"], "factory/code.md");
        assert_eq!(json["hit_count"], 0);
        assert_eq!(json["key"]["stage"], "code");
        assert_eq!(json["key"]["skill_versions"], serde_json::json!([]));
        let back: BuildCacheEntry = serde_json::from_value(json).expect("entry deserialises");
        assert_eq!(back, entry);

        // A key written by an older caller without `skill_versions` still loads.
        let partial: BuildCacheKey = serde_json::from_value(serde_json::json!({
            "stage": "code",
            "inputs_hash": "inputs-a",
            "prompt_hash": "prompt-a",
            "model": "model-a",
        }))
        .expect("a key without skills deserialises");
        assert!(partial.skill_versions.is_empty());
        assert_eq!(partial.hash(), key().hash());
    }

    #[test]
    fn clearing_drops_entries_and_counters() {
        let mut cache = InMemoryBuildCache::new();
        cache.put(entry(1));
        assert!(cache.get(&key()).is_some());
        assert_eq!(cache.stats().hits, 1);

        cache.clear();
        assert!(cache.is_empty());
        assert_eq!(
            cache.stats(),
            BuildCacheStats {
                entries: 0,
                hits: 0,
                misses: 0,
            }
        );
    }
}
