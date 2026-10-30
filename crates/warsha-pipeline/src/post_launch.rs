//! Post-launch care — crash reports, store reviews, the daily owner summary and
//! plain-language change requests (PLAN.md M17, LingCode-inspired ideas only).
//!
//! This module is the bookkeeping layer that runs *after* v0.1.0 ships. It owns
//! four small pieces of state and the rules over them; it owns no transport,
//! no store client and no publisher:
//!
//! - [`CrashReport`] / [`CrashReportStore`] — what the app caught, and whether it
//!   already left the machine. Sending is the collector's job (a self-hosted
//!   GlitchTip endpoint), and it is opt-in with a kill switch; nothing here
//!   posts anywhere. The stored report carries the message, an optional stack
//!   trace and the run id — no PII and no source code by default.
//! - [`StoreReview`] / [`StoreReviewStore`] — the reviews we read back from the
//!   stores we ship to, tagged by store so the feedback loop can pick one store
//!   up at a time.
//! - [`DailySummary`] / [`DailySummaryBuilder`] — the once-a-day owner digest:
//!   runs completed, cost, errors, new feedback, plus the next steps that follow
//!   from those numbers. The shipped language is Arabic (Arabic-first project);
//!   [`SummaryLanguage::English`] exists for the English UI.
//! - [`PlainLanguageChangeRequest`] / [`ChangeRequestStore`] — "make the button
//!   green" in the owner's words, with the status flow that turns it into a run.
//!   A change request never publishes anything: it opens a run that ends at
//!   Gate C and a *draft* release.
//!
//! Every store is a trait with an in-memory implementation: the implementation
//! here is both the default for a run and the mock for tests, and a SQLite- or
//! git-backed store implements the same methods later.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The lowest rating a store review can carry on the stores we ship to.
pub const MIN_RATING: u8 = 1;

/// The highest rating a store review can carry on the stores we ship to.
pub const MAX_RATING: u8 = 5;

/// Errors raised by the post-launch layer.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum PostLaunchError {
    /// A crash report with that id is already stored.
    #[error("crash report `{0}` already exists")]
    DuplicateCrashReport(String),
    /// No crash report with that id is stored.
    #[error("crash report `{0}` not found")]
    CrashReportNotFound(String),
    /// The crash report cannot be stored as given.
    #[error("invalid crash report: {0}")]
    InvalidCrashReport(String),
    /// A store review with that id is already stored.
    #[error("store review `{0}` already exists")]
    DuplicateStoreReview(String),
    /// The store review cannot be stored as given.
    #[error("invalid store review: {0}")]
    InvalidStoreReview(String),
    /// A change request with that id is already stored.
    #[error("change request `{0}` already exists")]
    DuplicateChangeRequest(String),
    /// No change request with that id is stored.
    #[error("change request `{0}` not found")]
    ChangeRequestNotFound(String),
    /// The change request cannot be stored as given.
    #[error("invalid change request: {0}")]
    InvalidChangeRequest(String),
    /// The status flow does not allow that step.
    #[error("change request cannot go from `{from}` to `{to}`")]
    InvalidStatusTransition {
        /// The status the request was in.
        from: &'static str,
        /// The status that was asked for.
        to: &'static str,
    },
}

/// One crash the app or the daemon caught and stored.
///
/// The payload is deliberately small: a message, an optional stack trace, the
/// run it happened in and when. No secret, no user identifier and no source
/// code is part of this type — the privacy note in `docs/src/post-launch-care.md`
/// is the promise the collector keeps, and [`CrashReport`] is what it is allowed
/// to send.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CrashReport {
    /// Stable identifier, e.g. a ULID.
    pub id: String,
    /// The run that was active when the crash happened.
    pub run_id: String,
    /// The top-level error message, already masked by the guardrails layer.
    pub message: String,
    /// Optional stack trace, attached only when the owner turned that on.
    #[serde(default)]
    pub stack_trace: Option<String>,
    /// When the crash happened, in seconds since the Unix epoch.
    pub occurred_at: u64,
    /// Whether the report already left this machine.
    pub sent: bool,
}

impl CrashReport {
    /// A report that has not been sent yet.
    pub fn new(
        id: impl Into<String>,
        run_id: impl Into<String>,
        message: impl Into<String>,
        occurred_at: u64,
    ) -> Self {
        Self {
            id: id.into(),
            run_id: run_id.into(),
            message: message.into(),
            stack_trace: None,
            occurred_at,
            sent: false,
        }
    }

    /// Attach a stack trace.
    pub fn with_stack_trace(mut self, stack_trace: impl Into<String>) -> Self {
        self.stack_trace = Some(stack_trace.into());
        self
    }

    /// Whether the report carries a stack trace for the collector.
    pub fn has_stack_trace(&self) -> bool {
        self.stack_trace
            .as_deref()
            .map(|trace| !trace.trim().is_empty())
            .unwrap_or(false)
    }
}

/// Where crash reports live.
///
/// The in-memory implementation is the default and the test double; the
/// SQLite-backed store the daemon uses implements the same three methods.
pub trait CrashReportStore {
    /// Store a report, rejecting a duplicate id.
    fn record(&mut self, report: CrashReport) -> Result<(), PostLaunchError>;

    /// Every stored report, oldest first.
    fn list(&self) -> Vec<CrashReport>;

    /// Mark a report as sent and return it; marking twice is harmless.
    fn mark_sent(&mut self, id: &str) -> Result<CrashReport, PostLaunchError>;
}

/// A [`CrashReportStore`] that keeps reports in memory, in arrival order.
#[derive(Debug, Default)]
pub struct InMemoryCrashReportStore {
    reports: Vec<CrashReport>,
}

impl InMemoryCrashReportStore {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// How many reports are stored.
    pub fn len(&self) -> usize {
        self.reports.len()
    }

    /// Whether the store holds no reports.
    pub fn is_empty(&self) -> bool {
        self.reports.is_empty()
    }

    /// How many reports have not been sent yet.
    pub fn unsent_count(&self) -> usize {
        self.reports.iter().filter(|report| !report.sent).count()
    }
}

impl CrashReportStore for InMemoryCrashReportStore {
    fn record(&mut self, report: CrashReport) -> Result<(), PostLaunchError> {
        if report.id.trim().is_empty() {
            return Err(PostLaunchError::InvalidCrashReport(
                "report id must not be empty".to_string(),
            ));
        }
        if report.message.trim().is_empty() {
            return Err(PostLaunchError::InvalidCrashReport(
                "report message must not be empty".to_string(),
            ));
        }
        if self.reports.iter().any(|stored| stored.id == report.id) {
            return Err(PostLaunchError::DuplicateCrashReport(report.id));
        }
        self.reports.push(report);
        Ok(())
    }

    fn list(&self) -> Vec<CrashReport> {
        self.reports.clone()
    }

    fn mark_sent(&mut self, id: &str) -> Result<CrashReport, PostLaunchError> {
        let report = self
            .reports
            .iter_mut()
            .find(|stored| stored.id == id)
            .ok_or_else(|| PostLaunchError::CrashReportNotFound(id.to_string()))?;
        report.sent = true;
        Ok(report.clone())
    }
}

/// One review read back from a store we ship to.
///
/// `store` is a free-form tag (`microsoft_store`, `crates_io`, …) so one list
/// serves every store, and `rating` stays exactly what the store reported:
/// [`StoreReviewStore`] does not clamp it, because rewriting a rating would hide
/// a data problem the feedback loop needs to see. Use
/// [`StoreReview::rating_is_known`] to spot the values outside
/// [`MIN_RATING`]..=[`MAX_RATING`] before rendering stars.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoreReview {
    /// Stable identifier from the store, or one we minted for it.
    pub id: String,
    /// Which store the review came from, e.g. `microsoft_store`.
    pub store: String,
    /// The rating as the store reported it.
    pub rating: u8,
    /// The review body, verbatim.
    pub body: String,
    /// The display name the store reports, or `anonymous`.
    pub author: String,
    /// When the review was received, in seconds since the Unix epoch.
    pub received_at: u64,
}

impl StoreReview {
    /// A review with the six values the stores give us.
    pub fn new(
        id: impl Into<String>,
        store: impl Into<String>,
        rating: u8,
        body: impl Into<String>,
        author: impl Into<String>,
        received_at: u64,
    ) -> Self {
        Self {
            id: id.into(),
            store: store.into(),
            rating,
            body: body.into(),
            author: author.into(),
            received_at,
        }
    }

    /// Whether the rating is inside the range the stores we ship to use.
    pub fn rating_is_known(&self) -> bool {
        (MIN_RATING..=MAX_RATING).contains(&self.rating)
    }
}

/// Where store reviews live.
pub trait StoreReviewStore {
    /// Store a review, rejecting a duplicate id.
    fn record(&mut self, review: StoreReview) -> Result<(), PostLaunchError>;

    /// Every stored review, oldest first.
    fn list(&self) -> Vec<StoreReview>;

    /// Every review of one store, oldest first.
    fn list_by_store(&self, store: &str) -> Vec<StoreReview>;
}

/// A [`StoreReviewStore`] that keeps reviews in memory, in arrival order.
#[derive(Debug, Default)]
pub struct InMemoryStoreReviewStore {
    reviews: Vec<StoreReview>,
}

impl InMemoryStoreReviewStore {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// How many reviews are stored.
    pub fn len(&self) -> usize {
        self.reviews.len()
    }

    /// Whether the store holds no reviews.
    pub fn is_empty(&self) -> bool {
        self.reviews.is_empty()
    }
}

impl StoreReviewStore for InMemoryStoreReviewStore {
    fn record(&mut self, review: StoreReview) -> Result<(), PostLaunchError> {
        if review.id.trim().is_empty() {
            return Err(PostLaunchError::InvalidStoreReview(
                "review id must not be empty".to_string(),
            ));
        }
        if review.store.trim().is_empty() {
            return Err(PostLaunchError::InvalidStoreReview(
                "review store must not be empty".to_string(),
            ));
        }
        if self.reviews.iter().any(|stored| stored.id == review.id) {
            return Err(PostLaunchError::DuplicateStoreReview(review.id));
        }
        self.reviews.push(review);
        Ok(())
    }

    fn list(&self) -> Vec<StoreReview> {
        self.reviews.clone()
    }

    fn list_by_store(&self, store: &str) -> Vec<StoreReview> {
        self.reviews
            .iter()
            .filter(|stored| stored.store == store)
            .cloned()
            .collect()
    }
}

/// The language the summary's suggested next steps are written in.
///
/// Arabic is the shipped default because the daily summary is an Arabic-first
/// surface (PLAN.md M17 and AGENTS.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SummaryLanguage {
    /// Arabic, the shipped default.
    #[default]
    Arabic,
    /// English, for the English UI.
    English,
}

impl SummaryLanguage {
    /// The stable name used in JSON and in the docs.
    pub fn as_str(&self) -> &'static str {
        match self {
            SummaryLanguage::Arabic => "arabic",
            SummaryLanguage::English => "english",
        }
    }
}

/// One day of post-launch numbers, in plain language, for the owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DailySummary {
    /// The day the summary covers, as `YYYY-MM-DD`.
    pub date: String,
    /// How many runs finished that day.
    pub runs_completed: u32,
    /// What the day cost, in cents.
    pub total_cost_cents: u64,
    /// How many errors were recorded that day.
    pub error_count: u32,
    /// How many new pieces of feedback arrived that day.
    pub new_feedback_count: u32,
    /// The next steps that follow from those numbers, most urgent first.
    pub suggested_next_steps: Vec<String>,
}

impl DailySummary {
    /// Whether the day was clean: at least one run, no errors, no cost overrun.
    ///
    /// `max_cost_cents` is the owner's daily ceiling, `None` when none is set.
    pub fn is_quiet(&self, max_cost_cents: Option<u64>) -> bool {
        self.error_count == 0
            && self.runs_completed > 0
            && max_cost_cents
                .map(|ceiling| self.total_cost_cents <= ceiling)
                .unwrap_or(true)
    }
}

/// Builds a [`DailySummary`] from one day's counters.
///
/// The counters are the caller's: it counts runs, cost and errors from the run
/// store and new feedback from the feedback loop, then asks this builder for the
/// suggested next steps. Nothing here reads the store, so the digest is a pure
/// function of the numbers and testable without a database or a clock.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DailySummaryBuilder {
    language: SummaryLanguage,
}

impl DailySummaryBuilder {
    /// A builder that writes its steps in `language`.
    pub fn new(language: SummaryLanguage) -> Self {
        Self { language }
    }

    /// A builder with the shipped language ([`SummaryLanguage::Arabic`]).
    pub fn build(
        date: &str,
        runs_completed: u32,
        total_cost_cents: u64,
        error_count: u32,
        new_feedback_count: u32,
    ) -> DailySummary {
        Self::default().summarize(
            date,
            runs_completed,
            total_cost_cents,
            error_count,
            new_feedback_count,
        )
    }

    /// The language this builder writes in.
    pub fn language(&self) -> SummaryLanguage {
        self.language
    }

    /// Build the summary in this builder's language.
    pub fn summarize(
        &self,
        date: &str,
        runs_completed: u32,
        total_cost_cents: u64,
        error_count: u32,
        new_feedback_count: u32,
    ) -> DailySummary {
        DailySummary {
            date: date.to_string(),
            runs_completed,
            total_cost_cents,
            error_count,
            new_feedback_count,
            suggested_next_steps: self.next_steps(
                runs_completed,
                total_cost_cents,
                error_count,
                new_feedback_count,
            ),
        }
    }

    /// The next steps that follow from the counters, most urgent first.
    ///
    /// The list is never empty: a summary that says nothing is worse than one
    /// with a single "check the gates" line, and the push notification that
    /// carries this digest always has somewhere to point.
    fn next_steps(
        &self,
        runs_completed: u32,
        total_cost_cents: u64,
        error_count: u32,
        new_feedback_count: u32,
    ) -> Vec<String> {
        let mut steps = Vec::new();

        if error_count > 0 {
            steps.push(match self.language {
                SummaryLanguage::Arabic => format!(
                    "راجع {error_count} خطأ مسجّلاً اليوم وأعد تشغيل الاختبارات قبل أي إصدار."
                ),
                SummaryLanguage::English => {
                    format!("Review the {error_count} error(s) logged today and re-run the tests before any release.")
                }
            });
        }

        if runs_completed == 0 {
            steps.push(match self.language {
                SummaryLanguage::Arabic => {
                    "لم يكتمل أي تشغيل اليوم — شغّل مساراً تجريبياً بالمزوّد الوهمي للتأكد من سلامة السلسلة.".to_string()
                }
                SummaryLanguage::English => {
                    "No run finished today — start a mock-provider run to prove the chain still works.".to_string()
                }
            });
        }

        if new_feedback_count > 0 {
            steps.push(match self.language {
                SummaryLanguage::Arabic => format!(
                    "راجع {new_feedback_count} ملاحظة جديدة وقرّر ما يدخل إلى قائمة العمل."
                ),
                SummaryLanguage::English => {
                    format!("Read the {new_feedback_count} new piece(s) of feedback and decide what enters the backlog.")
                }
            });
        }

        if runs_completed > 0 && total_cost_cents == 0 {
            steps.push(match self.language {
                SummaryLanguage::Arabic => {
                    "التكلفة صفر اليوم — تأكد أن التوجيه يستخدم النموذج المحلي عن قصد لا بسبب عطل.".to_string()
                }
                SummaryLanguage::English => {
                    "Today cost nothing — check that routing chose the local model on purpose, not because a provider failed.".to_string()
                }
            });
        }

        steps.push(match self.language {
            SummaryLanguage::Arabic => "افتح لوحة البوابات وتحقق مما ينتظر توقيعك.".to_string(),
            SummaryLanguage::English => {
                "Open the gates inbox and check what is waiting for your signature.".to_string()
            }
        });

        steps
    }
}

/// Where a plain-language change request stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeRequestStatus {
    /// The owner described it; nothing has started.
    Pending,
    /// A run is working on it.
    InProgress,
    /// The change is built and waiting at Gate C or as a draft release.
    Done,
    /// The owner or the team dropped it.
    Rejected,
}

impl ChangeRequestStatus {
    /// The stable name used in JSON, in the store and in the UI.
    pub fn as_str(&self) -> &'static str {
        match self {
            ChangeRequestStatus::Pending => "pending",
            ChangeRequestStatus::InProgress => "in_progress",
            ChangeRequestStatus::Done => "done",
            ChangeRequestStatus::Rejected => "rejected",
        }
    }

    /// Whether the request still needs work.
    pub fn is_open(&self) -> bool {
        matches!(
            self,
            ChangeRequestStatus::Pending | ChangeRequestStatus::InProgress
        )
    }

    /// Whether the status flow allows `self -> next`.
    ///
    /// `pending -> in_progress -> done` is the happy path; `rejected` is
    /// reachable from either open status, and a rejected request may be reopened
    /// as `pending`. `done` is terminal: shipping it is the draft release's job,
    /// and reopening a finished change means a new request.
    pub fn can_transition_to(&self, next: ChangeRequestStatus) -> bool {
        matches!(
            (*self, next),
            (
                ChangeRequestStatus::Pending,
                ChangeRequestStatus::InProgress | ChangeRequestStatus::Rejected
            ) | (
                ChangeRequestStatus::InProgress,
                ChangeRequestStatus::Done | ChangeRequestStatus::Rejected
            ) | (ChangeRequestStatus::Rejected, ChangeRequestStatus::Pending)
        )
    }
}

/// "Make the button green" — a change the owner described in their own words.
///
/// The request is the entry point of a *new run*: it becomes a run that goes
/// through the normal stages, ends at Gate C and produces a **draft** release.
/// Nothing in this type publishes anything, and no agent may move a request to
/// [`ChangeRequestStatus::Done`] on its own — that is the owner's signature.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlainLanguageChangeRequest {
    /// Stable identifier, e.g. a ULID.
    pub id: String,
    /// What the owner asked for, in their words — never a rewritten spec.
    pub description: String,
    /// When the owner described it, in seconds since the Unix epoch.
    pub created_at: u64,
    /// Where the request stands.
    pub status: ChangeRequestStatus,
}

impl PlainLanguageChangeRequest {
    /// A new request, always starting at [`ChangeRequestStatus::Pending`].
    pub fn new(id: impl Into<String>, description: impl Into<String>, created_at: u64) -> Self {
        Self {
            id: id.into(),
            description: description.into(),
            created_at,
            status: ChangeRequestStatus::Pending,
        }
    }

    /// Move the request forward, refusing a step the status flow forbids.
    pub fn transition(&self, next: ChangeRequestStatus) -> Result<Self, PostLaunchError> {
        if !self.status.can_transition_to(next) {
            return Err(PostLaunchError::InvalidStatusTransition {
                from: self.status.as_str(),
                to: next.as_str(),
            });
        }
        Ok(Self {
            status: next,
            ..self.clone()
        })
    }
}

/// Where plain-language change requests live.
pub trait ChangeRequestStore {
    /// Store a request, rejecting a duplicate id.
    fn record(&mut self, request: PlainLanguageChangeRequest) -> Result<(), PostLaunchError>;

    /// Every stored request, oldest first.
    fn list(&self) -> Vec<PlainLanguageChangeRequest>;

    /// Move a stored request to `status`, refusing an illegal step.
    fn set_status(
        &mut self,
        id: &str,
        status: ChangeRequestStatus,
    ) -> Result<PlainLanguageChangeRequest, PostLaunchError>;
}

/// A [`ChangeRequestStore`] that keeps requests in memory, in arrival order.
#[derive(Debug, Default)]
pub struct InMemoryChangeRequestStore {
    requests: Vec<PlainLanguageChangeRequest>,
}

impl InMemoryChangeRequestStore {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// How many requests are stored.
    pub fn len(&self) -> usize {
        self.requests.len()
    }

    /// Whether the store holds no requests.
    pub fn is_empty(&self) -> bool {
        self.requests.is_empty()
    }

    /// Every request that still needs work, oldest first.
    pub fn open(&self) -> Vec<PlainLanguageChangeRequest> {
        self.requests
            .iter()
            .filter(|stored| stored.status.is_open())
            .cloned()
            .collect()
    }
}

impl ChangeRequestStore for InMemoryChangeRequestStore {
    fn record(&mut self, request: PlainLanguageChangeRequest) -> Result<(), PostLaunchError> {
        if request.id.trim().is_empty() {
            return Err(PostLaunchError::InvalidChangeRequest(
                "request id must not be empty".to_string(),
            ));
        }
        if request.description.trim().is_empty() {
            return Err(PostLaunchError::InvalidChangeRequest(
                "request description must not be empty".to_string(),
            ));
        }
        if self.requests.iter().any(|stored| stored.id == request.id) {
            return Err(PostLaunchError::DuplicateChangeRequest(request.id));
        }
        self.requests.push(request);
        Ok(())
    }

    fn list(&self) -> Vec<PlainLanguageChangeRequest> {
        self.requests.clone()
    }

    fn set_status(
        &mut self,
        id: &str,
        status: ChangeRequestStatus,
    ) -> Result<PlainLanguageChangeRequest, PostLaunchError> {
        let request = self
            .requests
            .iter_mut()
            .find(|stored| stored.id == id)
            .ok_or_else(|| PostLaunchError::ChangeRequestNotFound(id.to_string()))?;
        let moved = request.transition(status)?;
        *request = moved.clone();
        Ok(moved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crash_reports_are_listed_in_arrival_order() {
        let mut store = InMemoryCrashReportStore::new();
        store
            .record(CrashReport::new(
                "crash-1",
                "run-1",
                "index out of bounds",
                1,
            ))
            .expect("record crash-1");
        store
            .record(CrashReport::new("crash-2", "run-2", "connection reset", 2))
            .expect("record crash-2");

        let ids: Vec<String> = store.list().into_iter().map(|report| report.id).collect();
        assert_eq!(ids, vec!["crash-1", "crash-2"]);
        assert_eq!(store.len(), 2);
        assert!(!store.is_empty());
    }

    #[test]
    fn crash_report_store_rejects_duplicates_and_blank_fields() {
        let mut store = InMemoryCrashReportStore::new();
        store
            .record(CrashReport::new("crash-1", "run-1", "boom", 1))
            .expect("record crash-1");

        assert_eq!(
            store.record(CrashReport::new("crash-1", "run-1", "boom again", 2)),
            Err(PostLaunchError::DuplicateCrashReport("crash-1".to_string()))
        );
        assert!(matches!(
            store.record(CrashReport::new("  ", "run-1", "boom", 3)),
            Err(PostLaunchError::InvalidCrashReport(_))
        ));
        assert!(matches!(
            store.record(CrashReport::new("crash-3", "run-1", "   ", 4)),
            Err(PostLaunchError::InvalidCrashReport(_))
        ));
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn crash_report_mark_sent_flips_the_flag_once() {
        let mut store = InMemoryCrashReportStore::new();
        store
            .record(
                CrashReport::new("crash-1", "run-1", "boom", 1)
                    .with_stack_trace("at pipeline::advance\nat main"),
            )
            .expect("record crash-1");

        assert_eq!(store.unsent_count(), 1);

        let first = store.mark_sent("crash-1").expect("mark sent");
        assert!(first.sent);
        assert!(first.has_stack_trace());
        assert_eq!(store.unsent_count(), 0);

        // Marking twice keeps the report sent instead of failing.
        let second = store.mark_sent("crash-1").expect("mark sent twice");
        assert!(second.sent);
        assert_eq!(
            store.mark_sent("crash-404"),
            Err(PostLaunchError::CrashReportNotFound(
                "crash-404".to_string()
            ))
        );
    }

    #[test]
    fn crash_report_serde_roundtrips_without_a_stack_trace() {
        let report = CrashReport::new("crash-1", "run-1", "boom", 1_700_000_000);
        let encoded = serde_json::to_string(&report).expect("serialize report");
        assert!(encoded.contains("\"sent\":false"));
        let decoded: CrashReport = serde_json::from_str(&encoded).expect("deserialize report");
        assert_eq!(decoded, report);
        assert!(!decoded.has_stack_trace());

        // A stored report from before the field existed still parses.
        let legacy: CrashReport = serde_json::from_str(
            r#"{"id":"crash-2","run_id":"run-1","message":"boom","occurred_at":1,"sent":true}"#,
        )
        .expect("deserialize legacy report");
        assert_eq!(legacy.stack_trace, None);
        assert!(legacy.sent);
    }

    #[test]
    fn store_reviews_can_be_filtered_by_store() {
        let mut store = InMemoryStoreReviewStore::new();
        store
            .record(StoreReview::new(
                "review-1",
                "microsoft_store",
                5,
                "Works offline.",
                "owner-a",
                1,
            ))
            .expect("record review-1");
        store
            .record(StoreReview::new(
                "review-2",
                "crates_io",
                2,
                "Docs are thin.",
                "owner-b",
                2,
            ))
            .expect("record review-2");
        store
            .record(StoreReview::new(
                "review-3",
                "microsoft_store",
                1,
                "Could not install.",
                "owner-c",
                3,
            ))
            .expect("record review-3");

        let all: Vec<String> = store.list().into_iter().map(|review| review.id).collect();
        assert_eq!(all, vec!["review-1", "review-2", "review-3"]);

        let microsoft: Vec<String> = store
            .list_by_store("microsoft_store")
            .into_iter()
            .map(|review| review.id)
            .collect();
        assert_eq!(microsoft, vec!["review-1", "review-3"]);
        assert_eq!(store.list_by_store("winget").len(), 0);
        assert_eq!(store.len(), 3);
    }

    #[test]
    fn store_review_store_rejects_duplicates_and_blank_ids() {
        let mut store = InMemoryStoreReviewStore::new();
        store
            .record(StoreReview::new(
                "review-1",
                "crates_io",
                4,
                "Good.",
                "a",
                1,
            ))
            .expect("record review-1");

        assert_eq!(
            store.record(StoreReview::new(
                "review-1",
                "crates_io",
                5,
                "Again.",
                "b",
                2
            )),
            Err(PostLaunchError::DuplicateStoreReview(
                "review-1".to_string()
            ))
        );
        assert!(matches!(
            store.record(StoreReview::new("review-2", "  ", 5, "No store.", "b", 3)),
            Err(PostLaunchError::InvalidStoreReview(_))
        ));
        assert!(matches!(
            store.record(StoreReview::new("", "crates_io", 5, "No id.", "b", 4)),
            Err(PostLaunchError::InvalidStoreReview(_))
        ));
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn store_review_keeps_an_out_of_range_rating_but_flags_it() {
        let known = StoreReview::new("review-1", "scoop", 5, "Fine.", "a", 1);
        assert!(known.rating_is_known());

        let lowest = StoreReview::new("review-2", "scoop", MIN_RATING, "Bad.", "b", 2);
        assert!(lowest.rating_is_known());

        let unknown = StoreReview::new("review-3", "scoop", 9, "Broken feed.", "c", 3);
        assert!(!unknown.rating_is_known());
        assert_eq!(unknown.rating, 9);
        assert_eq!(MAX_RATING, 5);
    }

    #[test]
    fn daily_summary_carries_todays_numbers_and_arabic_steps() {
        let summary = DailySummaryBuilder::build("2026-10-29", 3, 480, 2, 5);

        assert_eq!(summary.date, "2026-10-29");
        assert_eq!(summary.runs_completed, 3);
        assert_eq!(summary.total_cost_cents, 480);
        assert_eq!(summary.error_count, 2);
        assert_eq!(summary.new_feedback_count, 5);

        // Errors first, then feedback, then the gate reminder.
        assert_eq!(summary.suggested_next_steps.len(), 3);
        let first = summary.suggested_next_steps.first().expect("a first step");
        assert!(
            first.contains("2"),
            "the error count is in the step: {first}"
        );
        assert!(first.contains("خطأ"), "the step is Arabic: {first}");
        let last = summary.suggested_next_steps.last().expect("a last step");
        assert!(last.contains("البوابات"));
        assert!(!summary.is_quiet(None));
    }

    #[test]
    fn daily_summary_never_has_zero_steps_and_marks_a_quiet_day() {
        let quiet = DailySummaryBuilder::build("2026-10-30", 2, 120, 0, 0);
        assert_eq!(quiet.suggested_next_steps.len(), 1);
        assert!(quiet.is_quiet(None));

        // A ceiling below today's spend makes the day not quiet.
        assert!(!quiet.is_quiet(Some(100)));

        // An empty day still has somewhere to point.
        let empty = DailySummaryBuilder::build("2026-10-31", 0, 0, 0, 0);
        assert_eq!(empty.suggested_next_steps.len(), 2);
        assert!(empty
            .suggested_next_steps
            .first()
            .map(|step| step.contains("لم يكتمل"))
            .unwrap_or(false));
        assert!(!empty.is_quiet(None));
    }

    #[test]
    fn daily_summary_builder_honours_the_language() {
        let arabic =
            DailySummaryBuilder::new(SummaryLanguage::Arabic).summarize("2026-10-29", 1, 0, 1, 0);
        let english =
            DailySummaryBuilder::new(SummaryLanguage::English).summarize("2026-10-29", 1, 0, 1, 0);

        assert_eq!(
            arabic.suggested_next_steps.len(),
            english.suggested_next_steps.len()
        );
        assert_ne!(arabic.suggested_next_steps, english.suggested_next_steps);
        assert!(english.suggested_next_steps[0].contains("error(s)"));
        assert_eq!(
            DailySummaryBuilder::default().language(),
            SummaryLanguage::Arabic
        );
        assert_eq!(SummaryLanguage::English.as_str(), "english");
        assert_eq!(SummaryLanguage::Arabic.as_str(), "arabic");

        // Every other number matches: the language changes words, not data.
        assert_eq!(arabic.runs_completed, english.runs_completed);
        assert_eq!(arabic.total_cost_cents, english.total_cost_cents);
        assert_eq!(arabic.error_count, english.error_count);
    }

    #[test]
    fn change_requests_start_pending_and_follow_the_status_flow() {
        let mut store = InMemoryChangeRequestStore::new();
        let request = PlainLanguageChangeRequest::new("cr-1", "Make the run button green", 1);
        assert_eq!(request.status, ChangeRequestStatus::Pending);
        assert!(request.status.is_open());
        store.record(request.clone()).expect("record cr-1");

        let started = store
            .set_status("cr-1", ChangeRequestStatus::InProgress)
            .expect("start cr-1");
        assert_eq!(started.status, ChangeRequestStatus::InProgress);
        assert_eq!(started.description, "Make the run button green");
        assert_eq!(started.created_at, 1);
        assert_eq!(store.open().len(), 1);

        let done = store
            .set_status("cr-1", ChangeRequestStatus::Done)
            .expect("finish cr-1");
        assert_eq!(done.status, ChangeRequestStatus::Done);
        assert!(!done.status.is_open());
        assert!(store.open().is_empty());
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn change_request_status_flow_refuses_illegal_steps() {
        assert!(!ChangeRequestStatus::Pending.can_transition_to(ChangeRequestStatus::Done));
        assert!(!ChangeRequestStatus::Done.can_transition_to(ChangeRequestStatus::InProgress));
        assert!(ChangeRequestStatus::Rejected.can_transition_to(ChangeRequestStatus::Pending));

        let mut store = InMemoryChangeRequestStore::new();
        store
            .record(PlainLanguageChangeRequest::new("cr-1", "Dark mode", 1))
            .expect("record cr-1");

        assert_eq!(
            store.set_status("cr-1", ChangeRequestStatus::Done),
            Err(PostLaunchError::InvalidStatusTransition {
                from: "pending",
                to: "done",
            })
        );
        // A refused step leaves the stored request untouched.
        assert_eq!(
            store.list().first().map(|request| request.status),
            Some(ChangeRequestStatus::Pending)
        );

        store
            .set_status("cr-1", ChangeRequestStatus::Rejected)
            .expect("reject cr-1");
        let reopened = store
            .set_status("cr-1", ChangeRequestStatus::Pending)
            .expect("reopen cr-1");
        assert_eq!(reopened.status, ChangeRequestStatus::Pending);
        assert_eq!(
            store.set_status("cr-404", ChangeRequestStatus::InProgress),
            Err(PostLaunchError::ChangeRequestNotFound("cr-404".to_string()))
        );
    }

    #[test]
    fn change_request_store_rejects_duplicates_and_blank_fields() {
        let mut store = InMemoryChangeRequestStore::new();
        store
            .record(PlainLanguageChangeRequest::new("cr-1", "Dark mode", 1))
            .expect("record cr-1");

        assert_eq!(
            store.record(PlainLanguageChangeRequest::new(
                "cr-1",
                "Dark mode again",
                2
            )),
            Err(PostLaunchError::DuplicateChangeRequest("cr-1".to_string()))
        );
        assert!(matches!(
            store.record(PlainLanguageChangeRequest::new("  ", "Dark mode", 3)),
            Err(PostLaunchError::InvalidChangeRequest(_))
        ));
        assert!(matches!(
            store.record(PlainLanguageChangeRequest::new("cr-2", "  ", 4)),
            Err(PostLaunchError::InvalidChangeRequest(_))
        ));
        assert_eq!(store.len(), 1);
        assert!(!store.is_empty());
    }

    #[test]
    fn statuses_serialize_as_snake_case_names() {
        assert_eq!(
            serde_json::to_string(&ChangeRequestStatus::InProgress).expect("serialize status"),
            "\"in_progress\""
        );
        assert_eq!(
            serde_json::from_str::<ChangeRequestStatus>("\"rejected\"")
                .expect("deserialize status"),
            ChangeRequestStatus::Rejected
        );
        assert_eq!(
            serde_json::to_string(&SummaryLanguage::Arabic).expect("serialize language"),
            "\"arabic\""
        );

        let request = PlainLanguageChangeRequest::new("cr-1", "Dark mode", 1)
            .transition(ChangeRequestStatus::InProgress)
            .expect("start cr-1");
        let encoded = serde_json::to_string(&request).expect("serialize request");
        assert!(encoded.contains("\"status\":\"in_progress\""));
        let decoded: PlainLanguageChangeRequest =
            serde_json::from_str(&encoded).expect("deserialize request");
        assert_eq!(decoded, request);
    }

    #[test]
    fn a_refused_transition_reports_both_sides() {
        let request = PlainLanguageChangeRequest::new("cr-1", "Dark mode", 1)
            .transition(ChangeRequestStatus::Done)
            .expect_err("pending to done is not allowed");
        assert_eq!(
            request.to_string(),
            "change request cannot go from `pending` to `done`"
        );
    }
}
