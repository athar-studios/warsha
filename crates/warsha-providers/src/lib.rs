//! Warsha Providers — Provider layer: adapters, router, fallback, cost & quota meter

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, PoisonError};
use std::time::Duration;
use thiserror::Error;
use tokio::sync::Semaphore;
use warsha_core::*;

mod anthropic;
mod env_llm;
mod fake;
mod ollama;
mod openai;
mod provider_setup;
mod provider_update;
mod secrets;

pub use anthropic::AnthropicProvider;
pub use env_llm::{EnvLlmConfig, DEFAULT_LLM_BASE_URL, DEFAULT_LLM_MODEL};
pub use fake::{FakeProvider, FAKE_MODEL_ID, FAKE_PROVIDER_ID};
pub use ollama::OllamaProvider;
pub use openai::{delete_key, load_key, store_key, OpenAIProvider};
pub use provider_setup::{
    probe_endpoint, ConnectionTestResult, OneClickProvider, ProviderSetupWizard, PROBE_TIMEOUT,
};
pub use provider_update::{
    check_provider_model_updates, latest_versions, reconcile_model_catalog, DetectedProvider,
    MockChecker, MockDetector, ModelCatalogDiff, ProviderDetector, ProviderUpdateAction,
    ProviderUpdateChecker, ProviderUpdateError, ProviderUpdateMode, ProviderUpdatePlanner,
    ProviderUpdatePolicy, SkipReason,
};
pub use secrets::{
    InMemorySecretStore, KeychainSecretStore, SecretStore, PROVIDER_KEYCHAIN_SERVICE,
};

#[derive(Error, Debug, Clone)]
pub enum ProviderError {
    #[error("Provider not found: {0}")]
    NotFound(String),
    #[error("Model not found: {0}")]
    ModelNotFound(String),
    #[error("Authentication failed: {0}")]
    Auth(String),
    #[error("Rate limited: {0}")]
    RateLimited(String),
    #[error("Quota exhausted: {0}")]
    QuotaExhausted(String),
    #[error("Timeout: {0}")]
    Timeout(String),
    #[error("HTTP {0}: {1}")]
    Http(u16, String),
    #[error("Provider error: {0}")]
    Other(String),
    #[error("Budget exceeded")]
    BudgetExceeded,
}

impl ProviderError {
    /// True when re-issuing the *same* paid request could plausibly succeed: a
    /// rate limit, an exhausted-quota throttle that later refills, a timeout, or
    /// a server/transport error (5xx and the transport errors the adapters fold
    /// into [`ProviderError::Other`]).
    ///
    /// Everything else is a decision, not a hiccup, and re-spending on it would
    /// only pay twice for the same rejection: a missing provider or model, an
    /// authentication failure, a 4xx client rejection (400, 401, 403, 404, 422),
    /// or a budget we have already crossed.
    pub fn is_retryable(&self) -> bool {
        match self {
            ProviderError::RateLimited(_)
            | ProviderError::QuotaExhausted(_)
            | ProviderError::Timeout(_) => true,
            ProviderError::Http(status, _) => !matches!(status, 400 | 401 | 403 | 404 | 422),
            ProviderError::Other(_) => true,
            _ => false,
        }
    }
}

/// Scrub an API key from an error message or response body before recording or returning.
pub fn scrub_key(text: &str, api_key: &str) -> String {
    let key = api_key.trim();
    if key.is_empty() {
        text.to_string()
    } else {
        text.replace(key, "[REDACTED]")
    }
}

pub type Result<T> = std::result::Result<T, ProviderError>;

/// Chat message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    System,
    User,
    Assistant,
    Tool,
}

/// Chat completion request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub stream: bool,
}

/// Chat completion response (non-streaming)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub id: String,
    pub model: String,
    pub choices: Vec<ChatChoice>,
    pub usage: TokenUsage,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatChoice {
    pub index: u32,
    pub message: ChatMessage,
    pub finish_reason: Option<String>,
}

/// Streaming chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatStreamChunk {
    pub id: String,
    pub model: String,
    pub choices: Vec<StreamChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChoice {
    pub index: u32,
    pub delta: ChatMessageDelta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageDelta {
    pub role: Option<MessageRole>,
    pub content: Option<String>,
}

/// Model information
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub context_window: u32,
    pub max_output: u32,
    pub pricing: ModelPricing,
}

/// Health check result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheck {
    pub healthy: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

/// Provider trait — all adapters implement this
#[async_trait]
pub trait ChatProvider: Send + Sync {
    /// Provider identifier
    fn id(&self) -> &str;

    /// Provider kind
    fn kind(&self) -> ProviderKind;

    /// List available models
    async fn list_models(&self) -> Result<Vec<ModelInfo>>;

    /// Health check
    async fn health(&self) -> Result<HealthCheck>;

    /// Non-streaming chat completion
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse>;

    /// Streaming chat completion
    async fn chat_stream(
        &self,
        request: ChatRequest,
    ) -> Result<Box<dyn futures::Stream<Item = Result<ChatStreamChunk>> + Send + Unpin>>;

    /// Calculate cost for usage
    fn cost_of(&self, model: &str, usage: &TokenUsage) -> Result<u64>; // cents
}

/// Mock provider for testing
pub struct MockProvider {
    pub id: String,
    pub models: Vec<ModelInfo>,
    pub should_fail: bool,
    pub fail_with: Option<ProviderError>,
    pub call_count: std::sync::atomic::AtomicU32,
    /// Shared call counter a test can keep a handle to before boxing the
    /// provider, so it can read how many times the router actually called it.
    pub calls: Arc<AtomicU32>,
    /// Remaining failures that surface as [`ProviderError::RateLimited`] before
    /// the provider starts succeeding — what lets a test drive the retry loop.
    pub retryable_left: Arc<AtomicU32>,
}

impl MockProvider {
    pub fn new(id: &str) -> Self {
        Self {
            id: id.to_string(),
            models: vec![ModelInfo {
                id: "mock-model".to_string(),
                name: "Mock Model".to_string(),
                provider: id.to_string(),
                context_window: 4096,
                max_output: 2048,
                pricing: ModelPricing {
                    input_per_million_cents: 100,
                    output_per_million_cents: 200,
                },
            }],
            should_fail: false,
            fail_with: None,
            call_count: std::sync::atomic::AtomicU32::new(0),
            calls: Arc::new(AtomicU32::new(0)),
            retryable_left: Arc::new(AtomicU32::new(0)),
        }
    }

    pub fn with_failure(mut self, err: ProviderError) -> Self {
        self.should_fail = true;
        self.fail_with = Some(err);
        self
    }

    pub fn with_models(mut self, models: Vec<ModelInfo>) -> Self {
        self.models = models;
        self
    }

    /// Fail the first `n` `chat` calls with a retryable
    /// [`ProviderError::RateLimited`], then answer normally.
    pub fn with_retryable_failures(mut self, n: u32) -> Self {
        self.retryable_left = Arc::new(AtomicU32::new(n));
        self
    }

    /// A handle to the shared call counter, readable after the provider is boxed
    /// and handed to the router.
    pub fn call_counter(&self) -> Arc<AtomicU32> {
        Arc::clone(&self.calls)
    }
}

#[async_trait]
impl ChatProvider for MockProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::CustomOpenAICompatible
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        Ok(self.models.clone())
    }

    async fn health(&self) -> Result<HealthCheck> {
        Ok(HealthCheck {
            healthy: !self.should_fail,
            latency_ms: Some(10),
            error: None,
        })
    }

    async fn chat(&self, _request: ChatRequest) -> Result<ChatResponse> {
        self.call_count
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.calls.fetch_add(1, Ordering::Relaxed);
        // A finite run of retryable failures first, then normal behaviour.
        loop {
            let left = self.retryable_left.load(Ordering::Relaxed);
            if left == 0 {
                break;
            }
            if self
                .retryable_left
                .compare_exchange(left, left - 1, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
                return Err(ProviderError::RateLimited(format!(
                    "mock rate limited ({left} retryable failures left)"
                )));
            }
        }
        if self.should_fail {
            return Err(self
                .fail_with
                .clone()
                .unwrap_or_else(|| ProviderError::Other("mock failure".to_string())));
        }
        Ok(ChatResponse {
            id: "mock-response".to_string(),
            model: "mock-model".to_string(),
            choices: vec![ChatChoice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: "Mock response".to_string(),
                },
                finish_reason: Some("stop".to_string()),
            }],
            usage: TokenUsage {
                input: 10,
                output: 20,
                total: 30,
            },
        })
    }

    async fn chat_stream(
        &self,
        request: ChatRequest,
    ) -> Result<Box<dyn futures::Stream<Item = Result<ChatStreamChunk>> + Send + Unpin>> {
        let response = self.chat(request).await?;
        let id = response.id;
        let model = response.model;
        let choices = response
            .choices
            .into_iter()
            .map(|c| StreamChoice {
                index: c.index,
                delta: ChatMessageDelta {
                    role: Some(c.message.role),
                    content: Some(c.message.content),
                },
                finish_reason: c.finish_reason,
            })
            .collect();
        let stream = futures::stream::iter(vec![Ok(ChatStreamChunk { id, model, choices })]);
        Ok(Box::new(stream))
    }

    fn cost_of(&self, _model: &str, usage: &TokenUsage) -> Result<u64> {
        // $0.001 per 1k tokens = 1 cent per 100k tokens
        Ok((usage.total as f64 * 0.01).ceil() as u64)
    }
}

/// Default ceiling on extra attempts against a single target, beyond the first.
pub const DEFAULT_MAX_RETRIES_PER_TARGET: u32 = 2;
/// Default hard ceiling on paid attempts across every target for one call.
pub const DEFAULT_MAX_TOTAL_ATTEMPTS: u32 = 6;
/// Default base for the exponential backoff, in milliseconds.
pub const DEFAULT_BASE_BACKOFF_MS: u64 = 250;
/// Default upper bound on a single backoff sleep, in milliseconds.
pub const DEFAULT_MAX_BACKOFF_MS: u64 = 8_000;
/// Default cap on paid provider calls a router keeps in flight at once.
pub const DEFAULT_MAX_CONCURRENT_PAID_CALLS: usize = 4;

/// Bounded retry/backoff policy for paid provider calls (H-07).
///
/// It never sleeps longer than [`RetryPolicy::max_backoff_ms`], never makes more
/// than `max_retries_per_target + 1` attempts against a single target, and never
/// exceeds `max_total_attempts` across the whole fallback walk — so a failing
/// provider cannot turn one request into unbounded paid traffic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "snake_case")]
pub struct RetryPolicy {
    /// Extra attempts against one target before falling back to the next.
    pub max_retries_per_target: u32,
    /// Hard ceiling on paid attempts across all targets for one call.
    pub max_total_attempts: u32,
    /// Exponential backoff base, in milliseconds.
    pub base_backoff_ms: u64,
    /// Upper bound on a single backoff sleep, in milliseconds.
    pub max_backoff_ms: u64,
    /// Whether to spread retries with full jitter.
    pub jitter: bool,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries_per_target: DEFAULT_MAX_RETRIES_PER_TARGET,
            max_total_attempts: DEFAULT_MAX_TOTAL_ATTEMPTS,
            base_backoff_ms: DEFAULT_BASE_BACKOFF_MS,
            max_backoff_ms: DEFAULT_MAX_BACKOFF_MS,
            jitter: true,
        }
    }
}

impl RetryPolicy {
    /// The documented defaults.
    pub fn standard() -> Self {
        Self::default()
    }

    /// A policy that keeps the attempt ceilings but never sleeps (zero backoff,
    /// no jitter) — what the fast tests drive the retry loop with.
    pub fn no_backoff() -> Self {
        Self {
            base_backoff_ms: 0,
            max_backoff_ms: 0,
            jitter: false,
            ..Self::default()
        }
    }

    /// Build the policy from the environment, each knob falling back to its
    /// default when unset or unparseable: `WARSHA_PROVIDER_MAX_RETRIES`,
    /// `WARSHA_PROVIDER_MAX_TOTAL_ATTEMPTS`, `WARSHA_PROVIDER_BASE_BACKOFF_MS`,
    /// `WARSHA_PROVIDER_MAX_BACKOFF_MS`, `WARSHA_PROVIDER_RETRY_JITTER` (`0` off).
    pub fn from_env() -> Self {
        let d = Self::default();
        Self {
            max_retries_per_target: env_number::<u32>("WARSHA_PROVIDER_MAX_RETRIES")
                .unwrap_or(d.max_retries_per_target),
            max_total_attempts: env_number::<u32>("WARSHA_PROVIDER_MAX_TOTAL_ATTEMPTS")
                .unwrap_or(d.max_total_attempts),
            base_backoff_ms: env_number::<u64>("WARSHA_PROVIDER_BASE_BACKOFF_MS")
                .unwrap_or(d.base_backoff_ms),
            max_backoff_ms: env_number::<u64>("WARSHA_PROVIDER_MAX_BACKOFF_MS")
                .unwrap_or(d.max_backoff_ms),
            jitter: match env_number::<u8>("WARSHA_PROVIDER_RETRY_JITTER") {
                Some(0) => false,
                Some(_) => true,
                None => d.jitter,
            },
        }
    }

    /// Attempts made against one target: the first plus the retries.
    pub fn attempts_per_target(&self) -> u32 {
        self.max_retries_per_target.saturating_add(1)
    }
}

/// Read `key` from the environment as a number, ignoring a missing or unparseable
/// value so a stray setting never changes provider behaviour.
fn env_number<T: std::str::FromStr>(key: &str) -> Option<T> {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<T>().ok())
}

/// SplitMix64 finalizer — a dependency-free, deterministic mixer used to derive
/// jitter from a seed, so backoff needs no random-number crate.
fn mix_entropy(mut x: u64) -> u64 {
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d0_49bb_1331_11eb);
    x ^= x >> 31;
    x
}

/// A best-effort entropy source for jitter: wall-clock nanoseconds if the clock
/// is usable, else the attempt index alone.
fn entropy_seed() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos() as u64)
        .unwrap_or(0)
}

/// The backoff sleep before the attempt following `attempt` failures, in
/// milliseconds: exponential `base * 2^attempt` capped at `max`, optionally
/// spread over `[1, capped]` by full jitter derived from `entropy`.
///
/// Pure and clock-free so the growth, the cap and the jitter bound can each be
/// tested directly without ever sleeping.
pub fn backoff_delay_ms(policy: &RetryPolicy, attempt: u32, entropy: u64) -> u64 {
    if policy.base_backoff_ms == 0 {
        return 0;
    }
    // Clamp the shift so 1 << shift cannot overflow a u64 on huge attempt counts.
    let shift = attempt.min(30);
    let growth = policy.base_backoff_ms.saturating_mul(1u64 << shift);
    let capped = growth.min(policy.max_backoff_ms);
    if !policy.jitter || capped <= 1 {
        return capped;
    }
    let mixed = mix_entropy(entropy ^ (attempt as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15));
    (mixed % capped) + 1
}

/// The parts of a router a paid call only ever reads: the registered adapters, the
/// routing table, the retry policy and the bound on simultaneous calls.
///
/// It lives behind one `Arc` so a [`ProviderRouter`] can be cloned into a handle that
/// shares this state, which is what audit N-3 asked for: a caller takes the daemon's
/// router lock, clones the handle and releases the lock *before* its first await, so no
/// lock is held across a provider call, a retry or a backoff sleep.
///
/// The locks here are `std` locks, and a guard is never held across an `await`: what a
/// caller takes out of them is an owned value (an `Arc` adapter, a cloned target list, a
/// copied policy), and a guard that outlived a suspension point would make the future
/// non-`Send` and put the serialization back where it was.
struct RouterCore {
    /// Registered adapters by id. `Arc` rather than `Box`, so the call path can carry the
    /// adapter it is dialling instead of a borrow of this map.
    providers: std::sync::RwLock<HashMap<String, Arc<dyn ChatProvider>>>,
    role_routings: std::sync::RwLock<HashMap<Role, RoleRouting>>,
    retry: std::sync::RwLock<RetryPolicy>,
    /// Bounds simultaneous paid calls across everything that shares this core.
    permits: std::sync::RwLock<Arc<Semaphore>>,
    in_flight: Arc<AtomicUsize>,
    max_concurrent_calls: AtomicUsize,
}

/// The core printed as counts and a policy, because an adapter is a live client with the
/// owner's key inside its request headers and a derived `Debug` would name every provider
/// the daemon knows about in any line that printed one.
impl fmt::Debug for RouterCore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let providers = self
            .providers
            .read()
            .unwrap_or_else(PoisonError::into_inner);
        let routings = self
            .role_routings
            .read()
            .unwrap_or_else(PoisonError::into_inner);
        f.debug_struct("RouterCore")
            .field("providers", &providers.keys().count())
            .field("routings", &routings.len())
            .field(
                "max_concurrent_paid_calls",
                &self.max_concurrent_calls.load(Ordering::Acquire),
            )
            .field("in_flight", &self.in_flight.load(Ordering::Acquire))
            .finish()
    }
}

/// What the owner capped and what has been spent, per project.
///
/// Spend state is the only part of a router that a paid call *writes*, which is why it is
/// guarded apart from the call machinery: with its own lock, an in-flight call blocks
/// nothing else on the router and a second caller's spend is still counted (audit N-3).
/// A `std` mutex is enough — recording a cost is two integer adds and never crosses an
/// `await`.
#[derive(Debug, Default)]
pub struct SpendLedger {
    /// `project_id` -> budget in cents.
    budgets: HashMap<String, u64>,
    /// `project_id` -> cents spent.
    spent: HashMap<String, u64>,
}

impl SpendLedger {
    /// Cents recorded against `project_id`.
    fn spent(&self, project_id: &str) -> u64 {
        *self.spent.get(project_id).unwrap_or(&0)
    }

    /// Add `cost` to `project_id`'s spend, saturating rather than wrapping: a meter that
    /// rolls over would report a project that has spent its budget as one that has not.
    fn record(&mut self, project_id: &str, cost: u64) {
        let entry = self.spent.entry(project_id.to_string()).or_insert(0);
        *entry = entry.saturating_add(cost);
    }
}

/// Provider router with bounded fallback, retry and cost-aware concurrency.
///
/// Cheap to clone, and a clone is a handle to the same router rather than a copy of it:
/// the providers, the routing, the retry policy, the concurrency bound and the spend
/// ledger are all shared. That is the shape audit N-3 asked for — a paid call needs no
/// write lock, so the in-flight cap can actually be reached and one retrying request does
/// not sit in front of every other caller of the same daemon.
#[derive(Clone)]
pub struct ProviderRouter {
    core: Arc<RouterCore>,
    ledger: Arc<std::sync::Mutex<SpendLedger>>,
}

/// A router printed as what it is configured to do, never as what it holds.
///
/// An adapter is a live client with a provider key in its request headers, and a
/// derived `Debug` on the map would put the ids of everything the owner configured in any
/// log line that printed a router. Ids and numbers are what an operator needs from it.
impl fmt::Debug for ProviderRouter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ProviderRouter")
            .field("providers", &self.provider_ids())
            .field(
                "routings",
                &self
                    .core
                    .role_routings
                    .read()
                    .map(|g| g.keys().count())
                    .unwrap_or_default(),
            )
            .field(
                "max_concurrent_paid_calls",
                &self.max_concurrent_paid_calls(),
            )
            .field("paid_calls_in_flight", &self.paid_calls_in_flight())
            .field("budgeted_projects", &self.budgeted_projects())
            .finish()
    }
}

impl ProviderRouter {
    pub fn new() -> Self {
        Self::with_capacity_and_policy(DEFAULT_MAX_CONCURRENT_PAID_CALLS, RetryPolicy::standard())
    }

    /// Build the router from the environment: the retry policy plus
    /// `WARSHA_PROVIDER_MAX_CONCURRENT_CALLS` for the paid-call budget.
    pub fn from_env() -> Self {
        let max_concurrent = env_number::<usize>("WARSHA_PROVIDER_MAX_CONCURRENT_CALLS")
            .unwrap_or(DEFAULT_MAX_CONCURRENT_PAID_CALLS);
        Self::with_capacity_and_policy(max_concurrent, RetryPolicy::from_env())
    }

    fn with_capacity_and_policy(max_concurrent: usize, retry: RetryPolicy) -> Self {
        let max_concurrent = max_concurrent.max(1);
        // The deterministic fake provider is pre-registered on *every* router under
        // `"fake"`, so an end-to-end run is always executable with zero configured
        // providers, zero keys and zero network. It carries no role routing, so it
        // never hijacks a role the owner explicitly routed.
        let mut providers = HashMap::new();
        providers.insert(
            FAKE_PROVIDER_ID.to_string(),
            Arc::new(FakeProvider::new()) as Arc<dyn ChatProvider>,
        );
        Self {
            core: Arc::new(RouterCore {
                providers: std::sync::RwLock::new(providers),
                role_routings: std::sync::RwLock::new(HashMap::new()),
                retry: std::sync::RwLock::new(retry),
                permits: std::sync::RwLock::new(Arc::new(Semaphore::new(max_concurrent))),
                in_flight: Arc::new(AtomicUsize::new(0)),
                max_concurrent_calls: AtomicUsize::new(max_concurrent),
            }),
            ledger: Arc::new(std::sync::Mutex::new(SpendLedger::default())),
        }
    }

    /// Replace the retry policy before the router serves traffic.
    ///
    /// A router that has been cloned shares the policy with every handle of it, so this
    /// is a change to the router and not to one caller's copy of it — which is what makes
    /// a test that sets a policy on the daemon's router mean the same thing as one that
    /// sets it before the daemon started.
    pub fn set_retry_policy(&mut self, retry: RetryPolicy) {
        let mut guard = self
            .core
            .retry
            .write()
            .unwrap_or_else(PoisonError::into_inner);
        *guard = retry;
    }

    /// The current retry policy.
    pub fn retry_policy(&self) -> RetryPolicy {
        let guard = self
            .core
            .retry
            .read()
            .unwrap_or_else(PoisonError::into_inner);
        *guard
    }

    /// Replace the cap on simultaneous paid calls (at least one).
    ///
    /// The new bound governs the calls that start after it; a call already holding a permit
    /// keeps it, because taking a permit back from a request that is mid-flight would be
    /// the router losing track of its own spend.
    pub fn set_max_concurrent_paid_calls(&mut self, max_concurrent: usize) {
        let max_concurrent = max_concurrent.max(1);
        if let Ok(mut permits) = self.core.permits.write() {
            *permits = Arc::new(Semaphore::new(max_concurrent));
        }
        self.core
            .max_concurrent_calls
            .store(max_concurrent, Ordering::Release);
    }

    /// The cap on simultaneous paid calls.
    pub fn max_concurrent_paid_calls(&self) -> usize {
        self.core.max_concurrent_calls.load(Ordering::Acquire)
    }

    /// Paid calls currently in flight.
    pub fn paid_calls_in_flight(&self) -> usize {
        self.core.in_flight.load(Ordering::Acquire)
    }

    /// A shared handle to the in-flight counter, so a test provider can observe
    /// concurrency through the same counter the router drives.
    pub fn paid_call_in_flight_handle(&self) -> Arc<AtomicUsize> {
        Arc::clone(&self.core.in_flight)
    }

    /// Paid-call permits not currently taken.
    pub fn available_paid_permits(&self) -> usize {
        let permits = self
            .core
            .permits
            .read()
            .unwrap_or_else(PoisonError::into_inner);
        permits.available_permits()
    }

    /// The ids of every registered adapter, in name order. Not a secret — an adapter's
    /// *key* is, and it is inside the adapter, which is why this reports ids.
    fn provider_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = {
            let providers = self
                .core
                .providers
                .read()
                .unwrap_or_else(PoisonError::into_inner);
            providers.keys().cloned().collect()
        };
        ids.sort();
        ids
    }

    /// How many projects carry a budget, for a status report.
    fn budgeted_projects(&self) -> usize {
        self.lock_ledger().budgets.len()
    }

    /// The spend ledger, with a poisoned lock read as the panic it already was rather
    /// than failing twice on the way to a paid call.
    fn lock_ledger(&self) -> std::sync::MutexGuard<'_, SpendLedger> {
        self.ledger.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Register an adapter under its own id, replacing whatever was there.
    ///
    /// Takes a `Box` because that is what every adapter in the workspace is handed here
    /// as, and stores an `Arc` because a call path that is mid-flight must keep the
    /// adapter it dialled without borrowing the router it came from (audit N-3).
    pub fn register_provider(&mut self, provider: Box<dyn ChatProvider>) {
        let id = provider.id().to_string();
        let mut providers = self
            .core
            .providers
            .write()
            .unwrap_or_else(PoisonError::into_inner);
        providers.insert(id, Arc::from(provider));
    }

    /// Access a registered provider by its identifier.
    ///
    /// The answer is an owned handle rather than a borrow of the router's map, so a
    /// caller can hold it across an `await` without holding a lock.
    pub fn get_provider(&self, id: &str) -> Option<Arc<dyn ChatProvider>> {
        let providers = self
            .core
            .providers
            .read()
            .unwrap_or_else(PoisonError::into_inner);
        providers.get(id).cloned()
    }

    /// Check for model catalog updates from a registered provider.
    ///
    /// The adapter is taken out of the map and the map is released before the network
    /// call, which is the same rule the paid path follows: no lock across an `await`.
    pub async fn check_model_updates(
        &self,
        provider_id: &str,
        current_catalog: &[ModelInfo],
    ) -> Result<ModelCatalogDiff> {
        let provider = self
            .get_provider(provider_id)
            .ok_or_else(|| ProviderError::NotFound(provider_id.to_string()))?;
        check_provider_model_updates(provider.as_ref(), current_catalog).await
    }

    pub fn set_role_routing(&mut self, routing: RoleRouting) {
        let mut routings = self
            .core
            .role_routings
            .write()
            .unwrap_or_else(PoisonError::into_inner);
        routings.insert(routing.role, routing);
    }

    pub fn set_budget(&mut self, project_id: &str, budget_cents: u64) {
        self.lock_ledger()
            .budgets
            .insert(project_id.to_string(), budget_cents);
    }

    pub fn get_spent(&self, project_id: &str) -> u64 {
        self.lock_ledger().spent(project_id)
    }

    /// True when `project_id` has a budget and has already spent it (or more).
    fn budget_exhausted(&self, project_id: &str) -> bool {
        let ledger = self.lock_ledger();
        match ledger.budgets.get(project_id) {
            Some(&budget) => ledger.spent(project_id) >= budget,
            None => false,
        }
    }

    /// Cents still available under the project budget, or `None` when unbudgeted.
    pub fn remaining_budget(&self, project_id: &str) -> Option<u64> {
        let ledger = self.lock_ledger();
        ledger
            .budgets
            .get(project_id)
            .map(|budget| budget.saturating_sub(ledger.spent(project_id)))
    }

    /// Fail fast before a paid call if the project budget is already spent,
    /// warning (once per call, not gating) as it nears the cap.
    fn require_budget_available(&self, project_id: &str) -> Result<()> {
        let (budget, spent) = {
            let ledger = self.lock_ledger();
            match ledger.budgets.get(project_id) {
                Some(&budget) => (Some(budget), ledger.spent(project_id)),
                None => (None, 0),
            }
        };
        let Some(budget) = budget else {
            return Ok(());
        };
        if spent >= budget {
            return Err(ProviderError::BudgetExceeded);
        }
        if (spent as f64) >= (budget as f64) * 0.8 {
            tracing::warn!(
                project_id,
                spent,
                budget,
                "project budget is within 20% of its cap"
            );
        }
        Ok(())
    }

    /// Add `cost` to what a project has spent. The one write a paid call makes on the
    /// router, and it goes to the spend ledger rather than through a router lock.
    fn record_spend(&self, project_id: &str, cost: u64) {
        self.lock_ledger().record(project_id, cost);
    }

    /// Get the best provider/model for a role
    pub fn route(&self, role: Role) -> Option<(String, String)> {
        let routings = self
            .core
            .role_routings
            .read()
            .unwrap_or_else(PoisonError::into_inner);
        routings
            .get(&role)
            .and_then(|routing| routing.targets.first())
            .map(|target| (target.provider_id.clone(), target.model_id.clone()))
    }

    /// The targets routed for `role`, taken out of the table in one short read.
    ///
    /// A fallback walk holds its own list rather than a borrow of the routing table, so a
    /// `roles.set` that lands mid-walk is honoured by the *next* call rather than
    /// deadlocking the current one (audit N-3).
    fn routing_for(&self, role: Role) -> Result<(Vec<RoutingTarget>, bool)> {
        let routings = self
            .core
            .role_routings
            .read()
            .unwrap_or_else(PoisonError::into_inner);
        let routing = routings
            .get(&role)
            .ok_or_else(|| ProviderError::NotFound(format!("No routing for role {:?}", role)))?;
        Ok((routing.targets.clone(), routing.fallback_enabled))
    }

    /// Calculate cost for a model using the appropriate provider
    pub fn cost_of(&self, _model: &str, usage: &TokenUsage) -> Result<u64> {
        // Since we can't easily iterate async from sync context,
        // use a reasonable default pricing for cost estimation.
        // In practice, the provider's actual cost_of would be called after chat.
        let default_pricing = ModelPricing {
            input_per_million_cents: 100,
            output_per_million_cents: 200,
        };
        let input_cost =
            (usage.input as f64 / 1_000_000.0) * default_pricing.input_per_million_cents as f64;
        let output_cost =
            (usage.output as f64 / 1_000_000.0) * default_pricing.output_per_million_cents as f64;
        Ok((input_cost + output_cost).ceil() as u64)
    }

    /// One spend-aware paid call: it holds a permit for the duration of the
    /// provider call and mirrors that in the in-flight counter, so at most
    /// [`max_concurrent_paid_calls`](Self::max_concurrent_paid_calls) paid calls
    /// cross the wire at a time — extra callers wait for a slot rather than piling
    /// on spend.
    ///
    /// `&self`, and no lock is held while the provider is dialled: the adapter handle and
    /// the permit pool are both taken out of the router first. That is what lets the cap
    /// mean something — with a router write lock held across the walk (audit N-3) a second
    /// caller could never reach this function, so the semaphore could never see two calls
    /// in flight and the bound the tests assert was unreachable in the daemon.
    pub async fn paid_call(&self, provider_id: &str, request: ChatRequest) -> Result<ChatResponse> {
        let provider = self
            .get_provider(provider_id)
            .ok_or_else(|| ProviderError::NotFound(provider_id.to_string()))?;
        let pool = {
            let permits = self
                .core
                .permits
                .read()
                .unwrap_or_else(PoisonError::into_inner);
            Arc::clone(&permits)
        };
        let permit = pool
            .acquire_owned()
            .await
            .map_err(|e| ProviderError::Other(format!("paid-call permit closed: {e}")))?;
        self.core.in_flight.fetch_add(1, Ordering::AcqRel);
        let result = provider.chat(request).await;
        self.core.in_flight.fetch_sub(1, Ordering::AcqRel);
        drop(permit);
        result
    }

    /// Chat with bounded retry, backoff and automatic fallback.
    ///
    /// For each routing target it makes at most
    /// [`RetryPolicy::attempts_per_target`] attempts, sleeping a bounded, jittered
    /// backoff between them, and stops retrying a target the moment the error is
    /// not [`ProviderError::is_retryable`]. Total paid attempts across all
    /// targets are capped at [`RetryPolicy::max_total_attempts`]. Fallback to the
    /// next target only happens when the routing enables it and the last error
    /// was retryable — the original semantics — and never once the project budget
    /// is exhausted, so the walk cannot keep spending after it has hit the cap.
    ///
    /// `&self`, and nothing of the router is locked while it waits or sleeps. Budgets,
    /// routing, fallback and spend accounting are all still honoured — the ledger that
    /// records spend is its own lock, taken and released around two integer adds — so a
    /// second paid call shares the concurrency bound with this one and a `providers.*`
    /// or `roles.set` call is not queued behind a backoff sleep (audit N-3).
    pub async fn chat_with_fallback(
        &self,
        role: Role,
        project_id: &str,
        mut request: ChatRequest,
    ) -> Result<ChatResponse> {
        // Everything the walk reads about the router is snapshotted here, under locks that
        // are gone before the first `await`.
        let (targets, fallback_enabled) = self.routing_for(role)?;
        let retry = self.retry_policy();

        // Refuse to spend at all once the budget is gone.
        self.require_budget_available(project_id)?;

        let mut last_error: Option<ProviderError> = None;
        let mut total_attempts: u32 = 0;

        for target in &targets {
            // Never spend on a further target after the budget is exhausted.
            if self.budget_exhausted(project_id) {
                break;
            }
            if self.get_provider(&target.provider_id).is_none() {
                last_error = Some(ProviderError::NotFound(format!(
                    "Provider {}",
                    target.provider_id
                )));
                continue;
            }

            let mut target_retries: u32 = 0;
            loop {
                if total_attempts >= retry.max_total_attempts {
                    break;
                }
                // Re-check the budget before every (re)attempt: a retry must not
                // cross the project cap either.
                self.require_budget_available(project_id)?;

                total_attempts = total_attempts.saturating_add(1);
                request.model = target.model_id.clone();
                let outcome = self.paid_call(&target.provider_id, request.clone()).await;

                match outcome {
                    Ok(response) => {
                        let provider = self
                            .get_provider(&target.provider_id)
                            .ok_or_else(|| ProviderError::NotFound(target.provider_id.clone()))?;
                        let cost = provider.cost_of(&target.model_id, &response.usage)?;
                        self.record_spend(project_id, cost);
                        return Ok(response);
                    }
                    Err(err) => {
                        let retryable = err.is_retryable();
                        last_error = Some(err);
                        if !retryable {
                            // A decision, not a hiccup: do not spend again here.
                            break;
                        }
                        if target_retries >= retry.max_retries_per_target
                            || total_attempts >= retry.max_total_attempts
                            || self.budget_exhausted(project_id)
                        {
                            break;
                        }
                        let delay = backoff_delay_ms(&retry, target_retries, entropy_seed());
                        target_retries = target_retries.saturating_add(1);
                        if delay > 0 {
                            tokio::time::sleep(Duration::from_millis(delay)).await;
                        }
                    }
                }
            }

            // Fallback: only continue to another target when routing allows it and
            // the last failure was one a different target might clear.
            if !fallback_enabled {
                break;
            }
            let last_retryable = last_error
                .as_ref()
                .map(ProviderError::is_retryable)
                .unwrap_or(false);
            if !last_retryable {
                break;
            }
        }

        Err(last_error
            .unwrap_or_else(|| ProviderError::NotFound("No available provider".to_string())))
    }
}

impl Default for ProviderRouter {
    fn default() -> Self {
        Self::new()
    }
}

/// Factory for creating provider instances from configuration
pub async fn create_provider(
    config: &warsha_core::ProviderConfig,
    keyring_service: &str,
) -> Result<Box<dyn ChatProvider>> {
    let provider = match config.kind {
        warsha_core::ProviderKind::OpenAI
        | warsha_core::ProviderKind::DeepSeek
        | warsha_core::ProviderKind::OpenRouter
        | warsha_core::ProviderKind::AzureOpenAI
        | warsha_core::ProviderKind::CustomOpenAICompatible => Box::new(
            OpenAIProvider::new(
                config.id.clone(),
                config.models.first().map(|m| m.id.clone()),
                &config.credentials,
                keyring_service,
            )
            .await?,
        ) as Box<dyn ChatProvider>,
        warsha_core::ProviderKind::Anthropic => Box::new(
            AnthropicProvider::new(
                config.id.clone(),
                config.models.first().map(|m| m.id.clone()),
                &config.credentials,
                keyring_service,
            )
            .await?,
        ) as Box<dyn ChatProvider>,
        warsha_core::ProviderKind::Ollama | warsha_core::ProviderKind::LMStudio => Box::new(
            OllamaProvider::new(
                config.id.clone(),
                config.models.first().map(|m| m.id.clone()),
                &config.credentials,
                keyring_service,
            )
            .await?,
        )
            as Box<dyn ChatProvider>,
        _ => {
            return Err(ProviderError::NotFound(format!(
                "Provider kind {:?} not implemented",
                config.kind
            )))
        }
    };
    Ok(provider)
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;

    fn request() -> ChatRequest {
        ChatRequest {
            model: "mock-model".to_string(),
            messages: vec![ChatMessage {
                role: MessageRole::User,
                content: "Hello".to_string(),
            }],
            temperature: None,
            max_tokens: None,
            stream: false,
        }
    }

    fn target(provider_id: &str) -> RoutingTarget {
        RoutingTarget {
            provider_id: provider_id.to_string(),
            model_id: "mock-model".to_string(),
            weight: 100,
        }
    }

    fn coder_routing(targets: Vec<RoutingTarget>, fallback_enabled: bool) -> RoleRouting {
        RoleRouting {
            role: Role::Coder,
            targets,
            fallback_enabled,
            budget_cents_per_run: None,
        }
    }

    /// A provider that samples the router's in-flight counter while it answers and
    /// holds the slot briefly, so a test can observe peak concurrency.
    struct TrackingProvider {
        id: String,
        in_flight: Arc<AtomicUsize>,
        peak: Arc<AtomicUsize>,
    }

    #[async_trait]
    impl ChatProvider for TrackingProvider {
        fn id(&self) -> &str {
            &self.id
        }
        fn kind(&self) -> ProviderKind {
            ProviderKind::CustomOpenAICompatible
        }
        async fn list_models(&self) -> Result<Vec<ModelInfo>> {
            Ok(Vec::new())
        }
        async fn health(&self) -> Result<HealthCheck> {
            Ok(HealthCheck {
                healthy: true,
                latency_ms: None,
                error: None,
            })
        }
        async fn chat(&self, _request: ChatRequest) -> Result<ChatResponse> {
            // Record how many paid calls are in flight at the same instant.
            let current = self.in_flight.load(Ordering::Acquire);
            self.peak.fetch_max(current, Ordering::AcqRel);
            // Hold the permit long enough for another task to reach the cap.
            tokio::time::sleep(Duration::from_millis(20)).await;
            Ok(ChatResponse {
                id: "x".to_string(),
                model: "m".to_string(),
                choices: vec![ChatChoice {
                    index: 0,
                    message: ChatMessage {
                        role: MessageRole::Assistant,
                        content: "ok".to_string(),
                    },
                    finish_reason: None,
                }],
                usage: TokenUsage {
                    input: 1,
                    output: 1,
                    total: 2,
                },
            })
        }
        async fn chat_stream(
            &self,
            _request: ChatRequest,
        ) -> Result<Box<dyn futures::Stream<Item = Result<ChatStreamChunk>> + Send + Unpin>>
        {
            Err(ProviderError::Other(
                "streaming not implemented".to_string(),
            ))
        }
        fn cost_of(&self, _model: &str, _usage: &TokenUsage) -> Result<u64> {
            Ok(0)
        }
    }

    #[tokio::test]
    async fn test_mock_provider() {
        let provider = MockProvider::new("test");
        let health = provider.health().await.unwrap();
        assert!(health.healthy);

        let models = provider.list_models().await.unwrap();
        assert_eq!(models.len(), 1);

        let response = provider.chat(request()).await.unwrap();
        assert_eq!(response.choices[0].message.content, "Mock response");
    }

    #[tokio::test]
    async fn test_mock_provider_failure() {
        let provider =
            MockProvider::new("test").with_failure(ProviderError::RateLimited("429".to_string()));

        let result = provider.chat(request()).await;
        assert!(matches!(result, Err(ProviderError::RateLimited(_))));
    }

    #[test]
    fn retryable_and_non_retryable_errors_are_distinguished() {
        assert!(ProviderError::RateLimited("429".into()).is_retryable());
        assert!(ProviderError::QuotaExhausted("402".into()).is_retryable());
        assert!(ProviderError::Timeout("408".into()).is_retryable());
        assert!(ProviderError::Other("500".into()).is_retryable());

        assert!(!ProviderError::Auth("401".into()).is_retryable());
        assert!(!ProviderError::NotFound("missing".into()).is_retryable());
        assert!(!ProviderError::ModelNotFound("404".into()).is_retryable());
        assert!(!ProviderError::BudgetExceeded.is_retryable());
    }

    #[test]
    fn backoff_grows_exponentially_and_is_capped() {
        let policy = RetryPolicy {
            base_backoff_ms: 100,
            max_backoff_ms: 1_000,
            jitter: false,
            ..RetryPolicy::no_backoff()
        };
        assert_eq!(backoff_delay_ms(&policy, 0, 0), 100);
        assert_eq!(backoff_delay_ms(&policy, 1, 0), 200);
        assert_eq!(backoff_delay_ms(&policy, 2, 0), 400);
        assert_eq!(backoff_delay_ms(&policy, 3, 0), 800);
        assert_eq!(backoff_delay_ms(&policy, 4, 0), 1_000, "capped at max");
        assert_eq!(backoff_delay_ms(&policy, 30, 0), 1_000, "still capped");
        // A zero base never sleeps.
        assert_eq!(backoff_delay_ms(&RetryPolicy::no_backoff(), 3, 0), 0);
    }

    #[test]
    fn jittered_backoff_stays_within_the_cap() {
        let policy = RetryPolicy {
            base_backoff_ms: 100,
            max_backoff_ms: 1_000,
            jitter: true,
            ..RetryPolicy::no_backoff()
        };
        for seed in 0..500u64 {
            let delay = backoff_delay_ms(&policy, 2, seed);
            assert!((1..=1_000).contains(&delay), "out of range: {delay}");
        }
        // Jitter varies the delay, so it is not the plain capped value.
        let varied = (0..50u64)
            .map(|seed| backoff_delay_ms(&policy, 2, seed))
            .collect::<Vec<_>>();
        assert!(
            varied.windows(2).any(|w| w[0] != w[1]),
            "jitter is deterministic"
        );
    }

    #[tokio::test]
    async fn test_router_fallback() {
        let mut router = ProviderRouter::new();
        router.set_retry_policy(RetryPolicy::no_backoff());

        let primary = MockProvider::new("primary").with_retryable_failures(u32::MAX);
        let primary_calls = primary.call_counter();
        router.register_provider(Box::new(primary));
        let fallback = MockProvider::new("fallback");
        let fallback_calls = fallback.call_counter();
        router.register_provider(Box::new(fallback));

        router.set_role_routing(coder_routing(
            vec![target("primary"), target("fallback")],
            true,
        ));

        let retry = router.retry_policy();
        let response = router
            .chat_with_fallback(Role::Coder, "project-1", request())
            .await
            .unwrap();

        assert_eq!(response.choices[0].message.content, "Mock response");
        // The rate-limited primary is retried to the per-target ceiling, then the
        // fallback answers on its first attempt.
        assert_eq!(
            primary_calls.load(Ordering::SeqCst),
            retry.attempts_per_target()
        );
        assert_eq!(fallback_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_non_retryable_error_is_not_retried_and_does_not_fall_back() {
        let mut router = ProviderRouter::new();
        router.set_retry_policy(RetryPolicy::no_backoff());

        let primary = MockProvider::new("primary").with_failure(ProviderError::Auth("401".into()));
        let primary_calls = primary.call_counter();
        router.register_provider(Box::new(primary));
        let fallback = MockProvider::new("fallback");
        let fallback_calls = fallback.call_counter();
        router.register_provider(Box::new(fallback));

        router.set_role_routing(coder_routing(
            vec![target("primary"), target("fallback")],
            true,
        ));

        let result = router
            .chat_with_fallback(Role::Coder, "project-1", request())
            .await;

        assert!(matches!(result, Err(ProviderError::Auth(_))));
        assert_eq!(
            primary_calls.load(Ordering::SeqCst),
            1,
            "an auth error is final"
        );
        assert_eq!(
            fallback_calls.load(Ordering::SeqCst),
            0,
            "a non-retryable error does not spend across targets"
        );
    }

    #[tokio::test]
    async fn total_attempts_are_capped_across_the_walk() {
        let mut router = ProviderRouter::new();
        router.set_retry_policy(RetryPolicy {
            max_retries_per_target: 10,
            max_total_attempts: 3,
            ..RetryPolicy::no_backoff()
        });

        let primary = MockProvider::new("primary").with_retryable_failures(u32::MAX);
        let primary_calls = primary.call_counter();
        router.register_provider(Box::new(primary));
        router.set_role_routing(coder_routing(vec![target("primary")], true));

        let result = router
            .chat_with_fallback(Role::Coder, "project-1", request())
            .await;

        assert!(matches!(result, Err(ProviderError::RateLimited(_))));
        assert_eq!(
            primary_calls.load(Ordering::SeqCst),
            3,
            "hard attempt ceiling"
        );
    }

    #[tokio::test]
    async fn test_budget_enforcement() {
        let mut router = ProviderRouter::new();
        router.set_retry_policy(RetryPolicy::no_backoff());
        let provider = MockProvider::new("test");
        let calls = provider.call_counter();
        router.register_provider(Box::new(provider));
        router.set_role_routing(coder_routing(vec![target("test")], true));
        // The mock spends 1 cent per call (30 tokens ceil to 1), so one call uses
        // the whole budget.
        router.set_budget("project-1", 1);

        router
            .chat_with_fallback(Role::Coder, "project-1", request())
            .await
            .unwrap();
        assert_eq!(router.get_spent("project-1"), 1);
        assert_eq!(router.remaining_budget("project-1"), Some(0));

        // The second call is refused before the provider is reached — no spend.
        let blocked = router
            .chat_with_fallback(Role::Coder, "project-1", request())
            .await;
        assert!(matches!(blocked, Err(ProviderError::BudgetExceeded)));
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "the cap blocked the second call"
        );
    }

    #[tokio::test]
    async fn budget_guard_blocks_before_any_spend() {
        let mut router = ProviderRouter::new();
        router.set_retry_policy(RetryPolicy::no_backoff());
        let provider = MockProvider::new("test");
        let calls = provider.call_counter();
        router.register_provider(Box::new(provider));
        router.set_role_routing(coder_routing(vec![target("test")], true));
        router.set_budget("project-1", 0);

        let blocked = router
            .chat_with_fallback(Role::Coder, "project-1", request())
            .await;
        assert!(matches!(blocked, Err(ProviderError::BudgetExceeded)));
        assert_eq!(
            calls.load(Ordering::SeqCst),
            0,
            "a zero budget issues no paid call"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn spend_aware_concurrency_caps_in_flight_calls() {
        let mut router = ProviderRouter::new();
        router.set_max_concurrent_paid_calls(2);
        let in_flight = router.paid_call_in_flight_handle();
        let peak = Arc::new(AtomicUsize::new(0));
        router.register_provider(Box::new(TrackingProvider {
            id: "tracking".to_string(),
            in_flight,
            peak: Arc::clone(&peak),
        }));
        let router = Arc::new(router);

        let mut handles = Vec::new();
        for _ in 0..6 {
            let router = Arc::clone(&router);
            handles.push(tokio::spawn(async move {
                router.paid_call("tracking", request()).await
            }));
        }
        for handle in handles {
            handle.await.unwrap().unwrap();
        }

        assert_eq!(
            peak.load(Ordering::SeqCst),
            2,
            "exactly the configured cap of paid calls ran at once"
        );
        assert!(peak.load(Ordering::SeqCst) <= 2, "never above the cap");
        assert_eq!(
            router.paid_calls_in_flight(),
            0,
            "every permit was released"
        );
        assert_eq!(
            router.available_paid_permits(),
            2,
            "permits returned to the pool"
        );
    }

    #[test]
    fn retry_policy_defaults_are_bounded() {
        let policy = RetryPolicy::default();
        assert_eq!(
            policy.max_retries_per_target,
            DEFAULT_MAX_RETRIES_PER_TARGET
        );
        assert_eq!(policy.max_total_attempts, DEFAULT_MAX_TOTAL_ATTEMPTS);
        assert_eq!(policy.base_backoff_ms, DEFAULT_BASE_BACKOFF_MS);
        assert_eq!(policy.max_backoff_ms, DEFAULT_MAX_BACKOFF_MS);
        assert!(policy.jitter);
        // The round-trip through serde keeps config persistence intact.
        let json = serde_json::to_value(policy).unwrap();
        let back: RetryPolicy = serde_json::from_value(json).unwrap();
        assert_eq!(back, policy);
    }

    // ---- Audit N-3: the router's lock is not the request path's bottleneck.
    //
    // The finding was that `chat_with_fallback` needed `&mut self`, so both integrated
    // callers held the daemon's `RwLock<ProviderRouter>` *write* guard across every await
    // — which made the paid-call cap unreachable on those paths (a second caller could
    // not enter the function to be counted) and put every other `providers.*` request
    // behind one run's backoff sleeps. These three tests are driven through the shape the
    // daemon actually uses, `Arc<RwLock<ProviderRouter>>`, because a test of the router API
    // alone is what let the bug through the last suite.

    /// How long a test waits for something that is expected to overlap.
    const OVERLAP_WAIT: Duration = Duration::from_secs(5);

    /// A provider that does not answer until every concurrent caller is inside it.
    ///
    /// The barrier is the assertion: two `chat_with_fallback` calls reach `chat` at the
    /// same moment only if neither is waiting on a router lock, and a barrier that times
    /// out is recorded as such rather than hanging the suite.
    struct OverlapProvider {
        id: String,
        barrier: Arc<tokio::sync::Barrier>,
        in_flight: Arc<AtomicUsize>,
        peak: Arc<AtomicUsize>,
        overlapped: Arc<std::sync::atomic::AtomicBool>,
    }

    #[async_trait]
    impl ChatProvider for OverlapProvider {
        fn id(&self) -> &str {
            &self.id
        }
        fn kind(&self) -> ProviderKind {
            ProviderKind::CustomOpenAICompatible
        }
        async fn list_models(&self) -> Result<Vec<ModelInfo>> {
            Ok(Vec::new())
        }
        async fn health(&self) -> Result<HealthCheck> {
            Ok(HealthCheck {
                healthy: true,
                latency_ms: None,
                error: None,
            })
        }
        async fn chat(&self, _request: ChatRequest) -> Result<ChatResponse> {
            // Read the router's own counter: `paid_call` has already moved it, so what is
            // sampled here is the number of paid calls the router believes are in flight.
            let now = self.in_flight.load(Ordering::Acquire);
            self.peak.fetch_max(now, Ordering::AcqRel);
            // Wait for the other caller to arrive, while still holding the paid-call
            // permit: this is the instant the router's cap is measured at.
            if tokio::time::timeout(OVERLAP_WAIT, self.barrier.wait())
                .await
                .is_ok()
            {
                self.overlapped.store(true, Ordering::Release);
            }
            Ok(ChatResponse {
                id: "overlap".to_string(),
                model: "mock-model".to_string(),
                choices: vec![ChatChoice {
                    index: 0,
                    message: ChatMessage {
                        role: MessageRole::Assistant,
                        content: "both callers were in flight".to_string(),
                    },
                    finish_reason: None,
                }],
                usage: TokenUsage {
                    input: 1,
                    output: 1,
                    total: 2,
                },
            })
        }
        async fn chat_stream(
            &self,
            _request: ChatRequest,
        ) -> Result<Box<dyn futures::Stream<Item = Result<ChatStreamChunk>> + Send + Unpin>>
        {
            Err(ProviderError::Other("not streamed".to_string()))
        }
        fn cost_of(&self, _model: &str, _usage: &TokenUsage) -> Result<u64> {
            Ok(1)
        }
    }

    /// Two paid calls on the integrated shape are in flight at the same moment, and the
    /// router's cap is the thing that bounds them — not a lock.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn two_integrated_paid_calls_reach_the_provider_at_the_same_time() {
        let peak = Arc::new(AtomicUsize::new(0));
        let overlapped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let mut router = ProviderRouter::new();
        router.set_retry_policy(RetryPolicy::no_backoff());
        // The provider samples the router's own in-flight counter, so "two paid calls at
        // once" is measured by the number `paid_call` moves rather than by a parallel one.
        let in_flight = router.paid_call_in_flight_handle();
        router.register_provider(Box::new(OverlapProvider {
            id: "overlap".to_string(),
            barrier: Arc::clone(&barrier),
            in_flight,
            peak: Arc::clone(&peak),
            overlapped: Arc::clone(&overlapped),
        }));
        router.set_role_routing(coder_routing(vec![target("overlap")], false));
        let router = Arc::new(tokio::sync::RwLock::new(router));

        let mut handles = Vec::new();
        for _ in 0..2 {
            let router = Arc::clone(&router);
            handles.push(tokio::spawn(async move {
                // Exactly what `execute_stage` and `ProviderRouterAdapter::complete` do:
                // take a handle under the lock, release the lock, then make the call.
                let providers = {
                    let guard = router.read().await;
                    (*guard).clone()
                };
                providers
                    .chat_with_fallback(Role::Coder, "project-1", request())
                    .await
            }));
        }
        for handle in handles {
            handle
                .await
                .expect("the task ran")
                .expect("both calls are served");
        }

        assert!(
            overlapped.load(Ordering::Acquire),
            "the two callers never met inside the provider: a lock is still held across the call"
        );
        assert_eq!(peak.load(Ordering::Acquire), 2, "both calls in flight");
        assert_eq!(
            router.read().await.paid_calls_in_flight(),
            0,
            "a permit leaked"
        );
        // Each call spent 1 cent, on the one ledger the router and its handles share.
        let spent = {
            let guard = router.read().await;
            guard.get_spent("project-1")
        };
        assert_eq!(spent, 2, "concurrent spend was not accounted");
    }

    /// The other half of N-3: during a backoff sleep nothing is locked, so a `providers.*`
    /// RPC — and a second paid call — is answered while the first request waits.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn a_backoff_sleep_holds_no_router_lock() {
        /// A provider that always answers with a retryable failure, counting the attempts.
        struct AlwaysThrottled {
            id: String,
            calls: Arc<AtomicU32>,
        }

        #[async_trait]
        impl ChatProvider for AlwaysThrottled {
            fn id(&self) -> &str {
                &self.id
            }
            fn kind(&self) -> ProviderKind {
                ProviderKind::CustomOpenAICompatible
            }
            async fn list_models(&self) -> Result<Vec<ModelInfo>> {
                Ok(Vec::new())
            }
            async fn health(&self) -> Result<HealthCheck> {
                Ok(HealthCheck {
                    healthy: true,
                    latency_ms: None,
                    error: None,
                })
            }
            async fn chat(&self, _request: ChatRequest) -> Result<ChatResponse> {
                self.calls.fetch_add(1, Ordering::AcqRel);
                Err(ProviderError::RateLimited("429".to_string()))
            }
            async fn chat_stream(
                &self,
                _request: ChatRequest,
            ) -> Result<Box<dyn futures::Stream<Item = Result<ChatStreamChunk>> + Send + Unpin>>
            {
                Err(ProviderError::Other("not streamed".to_string()))
            }
            fn cost_of(&self, _model: &str, _usage: &TokenUsage) -> Result<u64> {
                Ok(0)
            }
        }

        let calls = Arc::new(AtomicU32::new(0));
        let mut router = ProviderRouter::new();
        // One retry against one target, and a sleep long enough for the test to prove the
        // lock is free while it runs: 400 ms of backoff between two attempts.
        router.set_retry_policy(RetryPolicy {
            max_retries_per_target: 1,
            max_total_attempts: 2,
            base_backoff_ms: 400,
            max_backoff_ms: 400,
            jitter: false,
        });
        router.register_provider(Box::new(AlwaysThrottled {
            id: "throttled".to_string(),
            calls: Arc::clone(&calls),
        }));
        router.set_role_routing(RoleRouting {
            role: Role::Coder,
            targets: vec![target("throttled")],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
        let router = Arc::new(tokio::sync::RwLock::new(router));

        let walking = {
            let router = Arc::clone(&router);
            tokio::spawn(async move {
                let providers = {
                    let guard = router.read().await;
                    (*guard).clone()
                };
                providers
                    .chat_with_fallback(Role::Coder, "project-1", request())
                    .await
            })
        };

        // Wait until the first attempt has actually been made: the walk is now sleeping,
        // which is the window the finding says was locked.
        let slept = tokio::time::timeout(Duration::from_secs(5), async {
            while calls.load(Ordering::Acquire) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await;
        assert!(slept.is_ok(), "the retry walk never reached the provider");

        // A *write* lock is available — this is what `providers.add`, `providers.remove`
        // and `roles.set` take. Held across the sleep, it would not be.
        let written = tokio::time::timeout(Duration::from_millis(100), router.write()).await;
        assert!(
            written.is_ok(),
            "the router's write lock was held across the backoff sleep"
        );
        drop(written.expect("the write lock is free"));

        // And a second paid call is served concurrently rather than queued: same cap,
        // same ledger, no queue behind the first walk.
        let second = {
            let router = Arc::clone(&router);
            let providers = {
                let guard = router.read().await;
                (*guard).clone()
            };
            providers
                .chat_with_fallback(Role::Coder, "project-2", request())
                .await
        };
        assert!(
            matches!(second, Err(ProviderError::RateLimited(_))),
            "the second caller was not served by the router: {second:?}"
        );

        let outcome = walking.await.expect("the walk finished");
        assert!(
            matches!(outcome, Err(ProviderError::RateLimited(_))),
            "the walk did not end on its own decision: {outcome:?}"
        );
        // Walk semantics survive the lock split. Four attempts in total, and two of them
        // belong to each call: the cap is per request, so letting a second caller in
        // during the first one's sleep does not double anyone's budget.
        assert_eq!(calls.load(Ordering::Acquire), 4, "the attempt cap changed");
        assert_eq!(router.read().await.paid_calls_in_flight(), 0);
    }

    /// A handle is the router, not a copy of it: spend, budgets and registrations are all
    /// shared, which is what lets the call path be `&self` without losing the accounting
    /// audit H-07 asked for.
    #[tokio::test]
    async fn a_router_handle_shares_its_ledger_and_its_adapters() {
        let mut router = ProviderRouter::new();
        router.set_retry_policy(RetryPolicy::no_backoff());
        let provider = MockProvider::new("primary");
        let calls = provider.call_counter();
        router.register_provider(Box::new(provider));
        router.set_role_routing(coder_routing(vec![target("primary")], true));
        router.set_budget("project-1", 1);

        // One call through a handle spends the budget…
        let handle = router.clone();
        handle
            .chat_with_fallback(Role::Coder, "project-1", request())
            .await
            .expect("the call is served");
        assert_eq!(router.get_spent("project-1"), 1, "spend went to the clone");
        assert_eq!(router.remaining_budget("project-1"), Some(0));

        // …and the *original* refuses the next one, through the same ledger, without
        // having spent a second call.
        let blocked = router
            .chat_with_fallback(Role::Coder, "project-1", request())
            .await;
        assert!(matches!(blocked, Err(ProviderError::BudgetExceeded)));
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        // A handle registered after the clone is visible to the clone: the adapters are
        // shared, so `providers.add` on the daemon's router reaches the in-flight paths.
        let mut router = router;
        router.register_provider(Box::new(MockProvider::new("added-later")));
        assert!(
            handle.get_provider("added-later").is_some(),
            "a clone kept a stale provider map"
        );
        // A handle prints its configuration, never its adapters' keys.
        let printed = format!("{handle:?}");
        assert!(printed.contains("ProviderRouter"));
        assert!(!printed.contains("sk-"), "a router Debug printed a key");
    }
}
