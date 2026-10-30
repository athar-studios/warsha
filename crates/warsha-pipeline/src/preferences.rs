//! Taste-learning preference store — what the owner approved, rejected, asked to
//! change and edited, folded into a weighted, decaying, explainable preference
//! per project and per owner (PLAN.md M20).
//!
//! The pipeline already records gate decisions (approve / reject /
//! changes-requested) and diffs, but nothing reads them back as *taste*. This
//! module is that reader. It owns four rules and no transport:
//!
//! - **A signal is one event.** [`PreferenceSignal`] is what the owner did —
//!   [`SignalKind::Approve`], [`SignalKind::Reject`],
//!   [`SignalKind::ChangeRequest`] or [`SignalKind::Edit`] — against one target
//!   (a file, a style key, a phrasing, a section title) inside one project, by
//!   one owner, at one time. Recording is append-only: a signal is never
//!   rewritten, so the history stays an audit trail.
//! - **Signals decay.** A preference is what the owner keeps choosing, not what
//!   they chose once. Every contribution is multiplied by
//!   `0.5 ^ (age / DECAY_HALF_LIFE_SECS)`, so a signal loses half its weight
//!   every 30 days and a stale taste cannot outvote a fresh one.
//! - **A preference is derived, never stored.** [`Preference`] is computed from
//!   the signal list at query time; `score` is the decayed, weighted sum and
//!   `evidence_count` is how many signals back it. There is no second copy of
//!   the truth to keep in sync.
//! - **Every score is explainable.** [`PreferenceStore::explain`] returns one
//!   human-readable line per target ("dark mode — Approved 3 times, Rejected
//!   once (score 2.00)"), so the UI can answer "what did Warsha learn, and
//!   why?" without inventing a narrative the numbers do not support.
//!
//! The store is a trait with an in-memory implementation: the implementation
//! here is the default for a run and the mock for tests, and the SQLite- or
//! event-store-backed version implements the same three methods later. Nothing
//! here reads the event store, the gates or the diffs yet — the callers that
//! would turn a gate decision into a signal do not exist, and this module does
//! not pretend otherwise.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

/// How long it takes a signal to lose half its weight, in seconds (30 days).
pub const DECAY_HALF_LIFE_SECS: u64 = 30 * 24 * 60 * 60;

/// The magnitude a signal carries when the caller does not set one.
pub const DEFAULT_SIGNAL_WEIGHT: f64 = 1.0;

/// Errors raised by the preference store.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PreferenceError {
    /// A signal with that id was already recorded.
    #[error("preference signal `{0}` already recorded")]
    DuplicateSignal(String),
    /// The signal cannot be recorded as given.
    #[error("invalid preference signal: {0}")]
    InvalidSignal(String),
}

/// What the owner did to a target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignalKind {
    /// The owner accepted the target as it stands.
    Approve,
    /// The owner rejected it.
    Reject,
    /// The owner asked for a change.
    ChangeRequest,
    /// The owner (or an agent on their behalf) edited it.
    Edit,
}

impl SignalKind {
    /// Every kind, in the order `explain` lists them.
    pub fn all() -> [SignalKind; 4] {
        [
            SignalKind::Approve,
            SignalKind::Reject,
            SignalKind::ChangeRequest,
            SignalKind::Edit,
        ]
    }

    /// Stable snake_case tag, also the serde form.
    pub fn as_str(self) -> &'static str {
        match self {
            SignalKind::Approve => "approve",
            SignalKind::Reject => "reject",
            SignalKind::ChangeRequest => "change_request",
            SignalKind::Edit => "edit",
        }
    }

    /// True when the signal adds to a preference score.
    pub fn is_positive(self) -> bool {
        matches!(self, SignalKind::Approve | SignalKind::Edit)
    }

    /// `+1.0` for a positive signal, `-1.0` for a negative one.
    pub fn direction(self) -> f64 {
        if self.is_positive() {
            1.0
        } else {
            -1.0
        }
    }

    /// Past-tense phrase used by [`PreferenceStore::explain`].
    pub fn phrase(self) -> &'static str {
        match self {
            SignalKind::Approve => "approved",
            SignalKind::Reject => "rejected",
            SignalKind::ChangeRequest => "changes requested",
            SignalKind::Edit => "edited",
        }
    }
}

/// One recorded taste signal.
///
/// `weight` is the magnitude the caller chose (default
/// [`DEFAULT_SIGNAL_WEIGHT`]); the sign comes from [`SignalKind::direction`], so
/// a weight is never negative — a rejection with a big weight is
/// `SignalKind::Reject` plus `weight: 2.0`, not `Approve` plus `-2.0`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreferenceSignal {
    /// Stable identifier, e.g. a ULID.
    pub id: String,
    /// The project the taste belongs to.
    pub project_id: String,
    /// The owner whose taste it is.
    pub owner_id: String,
    /// What they did.
    pub kind: SignalKind,
    /// What they did it to — a file, a style key, a phrasing.
    pub target: String,
    /// Magnitude of the signal; must be finite and non-negative.
    pub weight: f64,
    /// When it happened, in seconds since the Unix epoch.
    pub recorded_at: u64,
}

impl PreferenceSignal {
    /// A signal with the default weight.
    pub fn new(
        id: impl Into<String>,
        project_id: impl Into<String>,
        owner_id: impl Into<String>,
        kind: SignalKind,
        target: impl Into<String>,
        recorded_at: u64,
    ) -> Self {
        Self {
            id: id.into(),
            project_id: project_id.into(),
            owner_id: owner_id.into(),
            kind,
            target: target.into(),
            weight: DEFAULT_SIGNAL_WEIGHT,
            recorded_at,
        }
    }

    /// Set the magnitude of the signal.
    pub fn with_weight(mut self, weight: f64) -> Self {
        self.weight = weight;
        self
    }

    /// The signed, weighted contribution before decay.
    pub fn contribution(&self) -> f64 {
        self.kind.direction() * self.weight.max(0.0)
    }

    /// The contribution after decay at `now`.
    pub fn decayed_contribution(&self, now: u64) -> f64 {
        self.contribution() * decay_factor(self.recorded_at, now)
    }

    /// Refuse a signal that cannot mean anything.
    fn validate(&self) -> Result<(), PreferenceError> {
        if self.id.trim().is_empty() {
            return Err(PreferenceError::InvalidSignal("id is blank".to_string()));
        }
        if self.project_id.trim().is_empty() {
            return Err(PreferenceError::InvalidSignal(
                "project_id is blank".to_string(),
            ));
        }
        if self.owner_id.trim().is_empty() {
            return Err(PreferenceError::InvalidSignal(
                "owner_id is blank".to_string(),
            ));
        }
        if self.target.trim().is_empty() {
            return Err(PreferenceError::InvalidSignal(
                "target is blank".to_string(),
            ));
        }
        if !self.weight.is_finite() {
            return Err(PreferenceError::InvalidSignal(
                "weight is not a finite number".to_string(),
            ));
        }
        if self.weight < 0.0 {
            return Err(PreferenceError::InvalidSignal(
                "weight is negative (use SignalKind::Reject for a negative vote)".to_string(),
            ));
        }
        Ok(())
    }
}

/// A decayed, weighted preference derived from the recorded signals.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Preference {
    /// The target the signals were about.
    pub key: String,
    /// Decayed, weighted sum: positive means the owner keeps choosing it.
    pub score: f64,
    /// How many signals back the score.
    pub evidence_count: u32,
    /// When the newest signal for this target was recorded.
    pub last_updated: u64,
}

/// How much of a signal is left after `now - recorded_at` seconds.
///
/// `1.0` for a signal recorded at or after `now` (a clock that ran backwards
/// must not amplify anything), halving every [`DECAY_HALF_LIFE_SECS`].
pub fn decay_factor(recorded_at: u64, now: u64) -> f64 {
    if now <= recorded_at {
        return 1.0;
    }
    let age_secs = (now - recorded_at) as f64;
    0.5_f64.powf(age_secs / DECAY_HALF_LIFE_SECS as f64)
}

/// Reads and records taste signals.
pub trait PreferenceStore {
    /// Record one signal. Re-recording an id is refused.
    fn record_signal(&mut self, signal: PreferenceSignal) -> Result<(), PreferenceError>;

    /// The project's preferences, highest score first.
    fn list_preferences(&self, project_id: &str) -> Vec<Preference>;

    /// One human-readable line per preference, saying what it is built from.
    fn explain(&self, project_id: &str) -> Vec<String>;
}

/// An in-memory [`PreferenceStore`]: append-only signals plus a settable clock.
///
/// The clock is the store's `now` and starts at `0`, which means "no decay"
/// (every signal has age 0). Call [`InMemoryPreferenceStore::advance_to`] with
/// the current time — or with a fabricated one in a test — to age the signals;
/// it only moves forward, so a caller cannot rewind the decay.
#[derive(Debug, Clone, Default)]
pub struct InMemoryPreferenceStore {
    signals: Vec<PreferenceSignal>,
    seen: HashSet<String>,
    now: u64,
}

impl InMemoryPreferenceStore {
    /// An empty store whose clock reads `0` (no decay).
    pub fn new() -> Self {
        Self::default()
    }

    /// The clock the decay is computed against.
    pub fn now(&self) -> u64 {
        self.now
    }

    /// Move the clock forward to `now`. A value in the past is ignored.
    pub fn advance_to(&mut self, now: u64) {
        if now > self.now {
            self.now = now;
        }
    }

    /// Every recorded signal, in arrival order.
    pub fn signals(&self) -> &[PreferenceSignal] {
        &self.signals
    }

    /// Preferences for one owner inside one project.
    pub fn owner_preferences(&self, project_id: &str, owner_id: &str) -> Vec<Preference> {
        self.scored(project_id, Some(owner_id))
    }

    /// [`PreferenceStore::explain`] scoped to a single owner.
    pub fn explain_for_owner(&self, project_id: &str, owner_id: &str) -> Vec<String> {
        self.explain_for(project_id, Some(owner_id))
    }

    /// Number of recorded signals.
    pub fn len(&self) -> usize {
        self.signals.len()
    }

    /// True when nothing has been recorded.
    pub fn is_empty(&self) -> bool {
        self.signals.is_empty()
    }

    /// Drop every signal and reset the clock.
    pub fn clear(&mut self) {
        self.signals.clear();
        self.seen.clear();
        self.now = 0;
    }

    fn scored(&self, project_id: &str, owner_id: Option<&str>) -> Vec<Preference> {
        let mut totals: HashMap<&str, (f64, u32, u64)> = HashMap::new();
        for signal in &self.signals {
            if !Self::belongs(signal, project_id, owner_id) {
                continue;
            }
            let entry = totals.entry(signal.target.as_str()).or_insert((0.0, 0, 0));
            entry.0 += signal.decayed_contribution(self.now);
            entry.1 = entry.1.saturating_add(1);
            entry.2 = entry.2.max(signal.recorded_at);
        }

        let mut preferences: Vec<Preference> = totals
            .into_iter()
            .map(|(key, (score, evidence_count, last_updated))| Preference {
                key: key.to_string(),
                score,
                evidence_count,
                last_updated,
            })
            .collect();
        // Highest score first; equal scores fall back to the key so the output
        // does not depend on hash order. `total_cmp` keeps a NaN from a
        // hand-built store from panicking a sort.
        preferences.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.key.cmp(&b.key)));
        preferences
    }

    fn explain_for(&self, project_id: &str, owner_id: Option<&str>) -> Vec<String> {
        let mut lines = Vec::new();
        for preference in self.scored(project_id, owner_id) {
            let mut counts: HashMap<SignalKind, u32> = HashMap::new();
            let mut decayed = false;
            for signal in &self.signals {
                if signal.target != preference.key || !Self::belongs(signal, project_id, owner_id) {
                    continue;
                }
                let count = counts.entry(signal.kind).or_insert(0);
                *count = count.saturating_add(1);
                if decay_factor(signal.recorded_at, self.now) < 1.0 {
                    decayed = true;
                }
            }

            let parts: Vec<String> = SignalKind::all()
                .iter()
                .filter_map(|kind| {
                    counts.get(kind).map(|count| {
                        capitalize_first(&format!("{} {}", kind.phrase(), count_phrase(*count)))
                    })
                })
                .collect();
            let reason = parts.join(", ");

            let note = if decayed {
                format!(" (score {:.2}, decayed)", preference.score)
            } else {
                format!(" (score {:.2})", preference.score)
            };
            lines.push(format!("{} — {}{}", preference.key, reason, note));
        }
        lines
    }

    fn belongs(signal: &PreferenceSignal, project_id: &str, owner_id: Option<&str>) -> bool {
        signal.project_id == project_id && owner_id.is_none_or(|owner| signal.owner_id == owner)
    }
}

impl PreferenceStore for InMemoryPreferenceStore {
    fn record_signal(&mut self, signal: PreferenceSignal) -> Result<(), PreferenceError> {
        signal.validate()?;
        if self.seen.contains(&signal.id) {
            return Err(PreferenceError::DuplicateSignal(signal.id));
        }
        self.seen.insert(signal.id.clone());
        self.signals.push(signal);
        Ok(())
    }

    fn list_preferences(&self, project_id: &str) -> Vec<Preference> {
        self.scored(project_id, None)
    }

    fn explain(&self, project_id: &str) -> Vec<String> {
        self.explain_for(project_id, None)
    }
}

/// "once", "twice", "N times".
fn count_phrase(count: u32) -> String {
    match count {
        0 => "never".to_string(),
        1 => "once".to_string(),
        2 => "twice".to_string(),
        other => format!("{other} times"),
    }
}

/// Uppercase the first character and leave the rest alone.
fn capitalize_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 24 * 60 * 60;
    const PROJECT: &str = "project-1";
    const OWNER: &str = "owner-1";

    fn signal(id: &str, kind: SignalKind, target: &str, recorded_at: u64) -> PreferenceSignal {
        PreferenceSignal::new(id, PROJECT, OWNER, kind, target, recorded_at)
    }

    fn approx(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn signal_kinds_have_one_direction_and_one_phrase_each() {
        let expected = [
            (SignalKind::Approve, "approve", 1.0, "approved"),
            (SignalKind::Reject, "reject", -1.0, "rejected"),
            (
                SignalKind::ChangeRequest,
                "change_request",
                -1.0,
                "changes requested",
            ),
            (SignalKind::Edit, "edit", 1.0, "edited"),
        ];
        assert_eq!(SignalKind::all().len(), expected.len());
        for (index, (kind, tag, direction, phrase)) in expected.iter().enumerate() {
            assert_eq!(SignalKind::all()[index], *kind);
            assert_eq!(kind.as_str(), *tag);
            assert_eq!(kind.direction(), *direction);
            assert_eq!(kind.phrase(), *phrase);
            assert_eq!(kind.is_positive(), *direction > 0.0);
        }
    }

    #[test]
    fn signal_serde_is_snake_case_and_round_trips() {
        let signal = signal("s1", SignalKind::ChangeRequest, "dark mode", 1_000);
        let json = serde_json::to_value(&signal).expect("signal serialises");
        assert_eq!(json["kind"], "change_request");
        assert_eq!(json["project_id"], PROJECT);
        assert_eq!(json["weight"], DEFAULT_SIGNAL_WEIGHT);

        let back: PreferenceSignal = serde_json::from_value(json).expect("signal deserialises");
        assert_eq!(back, signal);
    }

    #[test]
    fn one_approval_makes_one_preference() {
        let mut store = InMemoryPreferenceStore::new();
        store
            .record_signal(signal("s1", SignalKind::Approve, "dark mode", 500))
            .expect("signal records");

        let preferences = store.list_preferences(PROJECT);
        assert_eq!(preferences.len(), 1);
        assert_eq!(preferences[0].key, "dark mode");
        approx(preferences[0].score, 1.0);
        assert_eq!(preferences[0].evidence_count, 1);
        assert_eq!(preferences[0].last_updated, 500);
        assert_eq!(store.len(), 1);
        assert!(!store.is_empty());
    }

    #[test]
    fn approvals_and_rejections_net_out() {
        let mut store = InMemoryPreferenceStore::new();
        store
            .record_signal(signal("s1", SignalKind::Approve, "dark mode", 100))
            .expect("records");
        store
            .record_signal(signal("s2", SignalKind::Approve, "dark mode", 200))
            .expect("records");
        store
            .record_signal(signal("s3", SignalKind::Reject, "dark mode", 300))
            .expect("records");

        let preferences = store.list_preferences(PROJECT);
        approx(preferences[0].score, 1.0);
        assert_eq!(preferences[0].evidence_count, 3);
        assert_eq!(preferences[0].last_updated, 300);
    }

    #[test]
    fn weight_scales_the_contribution() {
        let mut store = InMemoryPreferenceStore::new();
        store
            .record_signal(signal("s1", SignalKind::Edit, "tone", 10).with_weight(0.5))
            .expect("records");
        store
            .record_signal(signal("s2", SignalKind::ChangeRequest, "tone", 10).with_weight(2.0))
            .expect("records");

        approx(store.list_preferences(PROJECT)[0].score, -1.5);
    }

    #[test]
    fn decay_halves_a_signal_after_thirty_days() {
        assert_eq!(DECAY_HALF_LIFE_SECS, 30 * DAY);
        let mut store = InMemoryPreferenceStore::new();
        store
            .record_signal(signal("s1", SignalKind::Approve, "dark mode", 0))
            .expect("records");

        store.advance_to(30 * DAY);
        approx(store.list_preferences(PROJECT)[0].score, 0.5);

        store.advance_to(60 * DAY);
        approx(store.list_preferences(PROJECT)[0].score, 0.25);

        // Evidence is a count, so ageing never erases it.
        assert_eq!(store.list_preferences(PROJECT)[0].evidence_count, 1);
    }

    #[test]
    fn decay_never_amplifies_and_never_rewinds() {
        // Age 0 and a clock that ran backwards both leave the signal at full weight.
        approx(decay_factor(500, 500), 1.0);
        approx(decay_factor(500, 100), 1.0);

        let mut store = InMemoryPreferenceStore::new();
        store
            .record_signal(signal("s1", SignalKind::Approve, "dark mode", 1_000))
            .expect("records");
        // A signal recorded after the clock is not amplified.
        store.advance_to(500);
        assert_eq!(store.now(), 500);
        approx(store.list_preferences(PROJECT)[0].score, 1.0);
        // The clock never moves backwards either.
        store.advance_to(100);
        assert_eq!(store.now(), 500);
    }

    #[test]
    fn explain_says_what_the_score_is_built_from() {
        let mut store = InMemoryPreferenceStore::new();
        for (index, kind) in [
            SignalKind::Approve,
            SignalKind::Approve,
            SignalKind::Approve,
            SignalKind::Reject,
        ]
        .iter()
        .enumerate()
        {
            store
                .record_signal(signal(
                    &format!("s{index}"),
                    *kind,
                    "dark mode",
                    100 * index as u64,
                ))
                .expect("records");
        }

        assert_eq!(
            store.explain(PROJECT),
            vec!["dark mode — Approved 3 times, Rejected once (score 2.00)".to_string()]
        );
    }

    #[test]
    fn explain_counts_twice_and_marks_decay() {
        let mut store = InMemoryPreferenceStore::new();
        store
            .record_signal(signal("s1", SignalKind::Edit, "tone", 0))
            .expect("records");
        store
            .record_signal(signal("s2", SignalKind::Edit, "tone", 0))
            .expect("records");
        store.advance_to(30 * DAY);

        assert_eq!(
            store.explain(PROJECT),
            vec!["tone — Edited twice (score 1.00, decayed)".to_string()]
        );
    }

    #[test]
    fn a_signal_needs_a_meaning_and_a_unique_id() {
        let mut store = InMemoryPreferenceStore::new();
        store
            .record_signal(signal("s1", SignalKind::Approve, "dark mode", 0))
            .expect("records");

        assert_eq!(
            store.record_signal(signal("s1", SignalKind::Reject, "tone", 0)),
            Err(PreferenceError::DuplicateSignal("s1".to_string()))
        );
        for (bad, label) in [
            (
                PreferenceSignal::new("", PROJECT, OWNER, SignalKind::Approve, "x", 0),
                "id is blank",
            ),
            (
                PreferenceSignal::new("s2", "  ", OWNER, SignalKind::Approve, "x", 0),
                "project_id is blank",
            ),
            (
                PreferenceSignal::new("s3", PROJECT, "", SignalKind::Approve, "x", 0),
                "owner_id is blank",
            ),
            (
                PreferenceSignal::new("s4", PROJECT, OWNER, SignalKind::Approve, " ", 0),
                "target is blank",
            ),
            (
                signal("s5", SignalKind::Approve, "x", 0).with_weight(-1.0),
                "weight is negative (use SignalKind::Reject for a negative vote)",
            ),
            (
                signal("s6", SignalKind::Approve, "x", 0).with_weight(f64::NAN),
                "weight is not a finite number",
            ),
        ] {
            assert_eq!(
                store.record_signal(bad),
                Err(PreferenceError::InvalidSignal(label.to_string()))
            );
        }
        // Nothing invalid was stored, and the duplicate did not double-count.
        assert_eq!(store.len(), 1);
        assert_eq!(store.list_preferences(PROJECT)[0].evidence_count, 1);
    }

    #[test]
    fn projects_and_owners_do_not_see_each_other() {
        let mut store = InMemoryPreferenceStore::new();
        store
            .record_signal(signal("s1", SignalKind::Approve, "dark mode", 0))
            .expect("records");
        store
            .record_signal(PreferenceSignal::new(
                "s2",
                "project-2",
                OWNER,
                SignalKind::Reject,
                "dark mode",
                0,
            ))
            .expect("records");
        store
            .record_signal(PreferenceSignal::new(
                "s3",
                PROJECT,
                "owner-2",
                SignalKind::Reject,
                "dark mode",
                0,
            ))
            .expect("records");

        assert_eq!(store.list_preferences(PROJECT).len(), 1);
        approx(store.list_preferences(PROJECT)[0].score, 0.0);
        approx(store.owner_preferences(PROJECT, OWNER)[0].score, 1.0);
        approx(store.owner_preferences(PROJECT, "owner-2")[0].score, -1.0);
        assert_eq!(store.list_preferences("project-2").len(), 1);
        assert!(store.list_preferences("project-3").is_empty());
        assert_eq!(
            store.explain_for_owner(PROJECT, "owner-2"),
            vec!["dark mode — Rejected once (score -1.00)".to_string()]
        );
    }

    #[test]
    fn preferences_are_sorted_by_score_then_key() {
        let mut store = InMemoryPreferenceStore::new();
        store
            .record_signal(signal("s1", SignalKind::Approve, "b", 0))
            .expect("records");
        store
            .record_signal(signal("s2", SignalKind::Approve, "a", 0))
            .expect("records");
        store
            .record_signal(signal("s3", SignalKind::Approve, "c", 0))
            .expect("records");
        store
            .record_signal(signal("s4", SignalKind::Approve, "c", 0))
            .expect("records");
        store
            .record_signal(signal("s5", SignalKind::Reject, "z", 0))
            .expect("records");

        let keys: Vec<String> = store
            .list_preferences(PROJECT)
            .into_iter()
            .map(|preference| preference.key)
            .collect();
        assert_eq!(keys, vec!["c", "a", "b", "z"]);
    }

    #[test]
    fn clearing_drops_the_signals_and_the_clock() {
        let mut store = InMemoryPreferenceStore::new();
        store
            .record_signal(signal("s1", SignalKind::Approve, "dark mode", 10))
            .expect("records");
        store.advance_to(DAY);
        assert_eq!(store.now(), DAY);

        store.clear();
        assert!(store.is_empty());
        assert_eq!(store.now(), 0);
        assert!(store.list_preferences(PROJECT).is_empty());
        // The id is free again after a clear.
        store
            .record_signal(signal("s1", SignalKind::Approve, "dark mode", 10))
            .expect("records");
        assert_eq!(store.len(), 1);
    }
}
