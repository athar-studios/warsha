//! From a configured provider to a call the router is allowed to make.
//!
//! The owner's half of a provider already lives in two places: its *configuration*
//! is a row in the settings store (`configured_providers`) and its *key* is an entry
//! in the OS keychain, addressed by the provider's name. The router's half is a
//! `Box<dyn ChatProvider>` registered under an id. C2's gap was that nobody crossed
//! that bridge: `start_daemon` registered the mock and nothing else, so a provider
//! the owner had configured — before a restart or after one — was invisible to the
//! pipeline and to `agent.turn`, and Agent mode could only ever answer that no model
//! is wired.
//!
//! This module is the bridge, in four pieces:
//!
//! - [`AdapterKind`] and [`adapter_kind`]: the pure decision "which protocol does
//!   this kind tag speak". It names no endpoint and reads no key, so it is testable
//!   without a network or a keychain.
//! - [`ProviderFactory`]: the seam that turns a row into a live adapter.
//!   [`KeychainProviderFactory`] is what the daemon installs — the only production
//!   path, and the only one that reads the OS keychain. A test installs
//!   [`MockProviderFactory`] and stays offline (AGENTS.md: no real model calls in
//!   tests).
//! - [`DeferredProvider`]: what the daemon registers for a configured row. It holds
//!   the row and the factory, and builds on the first call rather than at start-up:
//!   a daemon that phoned every configured provider on boot would be slow, and a
//!   laptop that starts offline would come up broken. What it costs is one extra
//!   round trip on the first paid call, which is what a daemon owes an owner who
//!   configured a provider and asked for an answer.
//! - [`RemovedProvider`]: the fail-closed half. When a provider is removed its key
//!   is gone from the keychain, but the router may still hold an adapter with that
//!   key already inside its request headers. Registering a refusal in its place is
//!   the difference between "the owner removed the provider" and "the owner removed
//!   the record that it existed".
//!
//! Nothing here logs or returns a key: the secret is read by the adapter, into its
//! own request headers, and never through this module.

use std::fmt;
use std::sync::Arc;

use futures::Stream;
use jsonrpsee::core::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use warsha_core::{CredentialsRef, ProviderKind, TokenUsage};
use warsha_providers::{
    AnthropicProvider, ChatProvider, ChatRequest, ChatResponse, ChatStreamChunk, HealthCheck,
    KeychainSecretStore, MockProvider, ModelInfo, OllamaProvider, OpenAIProvider, ProviderError,
};
use warsha_store::StoredProvider;

use crate::{provider_endpoint, DaemonError, Result};

/// What one `ChatProvider` method answers: the provider crate's own result.
type ProviderResult<T> = std::result::Result<T, ProviderError>;

/// The stream type [`ChatProvider::chat_stream`] hands back.
type ProviderStream =
    ProviderResult<Box<dyn Stream<Item = ProviderResult<ChatStreamChunk>> + Send + Unpin>>;

/// The protocol a configured provider is spoken to.
///
/// The wizard's kinds are all OpenAI-compatible endpoints, so the wizard's own preset
/// table
/// alone would be enough for it; `anthropic` and a local server are here because a
/// kind tag is free text on the wire and the workspace already has adapters for both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterKind {
    /// The OpenAI chat-completions protocol (OpenRouter, DeepSeek, Kimi, GLM, Qwen,
    /// and any `custom` base URL).
    OpenAiCompatible,
    /// Anthropic's messages API.
    Anthropic,
    /// A local Ollama or LM Studio server, which needs no key.
    Ollama,
}

impl AdapterKind {
    /// The `warsha-core` kind the built adapter reports.
    pub fn provider_kind(self) -> ProviderKind {
        match self {
            AdapterKind::OpenAiCompatible => ProviderKind::OpenAI,
            AdapterKind::Anthropic => ProviderKind::Anthropic,
            AdapterKind::Ollama => ProviderKind::Ollama,
        }
    }
}

/// Which protocol `kind` names.
///
/// The two named protocols are matched on their own names and their product names,
/// normalised the way the wizard's own tag matching normalises it (case-insensitive,
/// `-`, `_` and spaces equivalent). The fall-through is deliberate: a tag that is
/// neither is treated as OpenAI-compatible, which is what `providers.add` told the
/// owner it meant when it accepted a `custom` kind with an `api_base`. Nothing here
/// guesses a protocol from a prefix that could also be a provider's own name.
pub fn adapter_kind(kind: &str) -> AdapterKind {
    let normalised: String = kind
        .trim()
        .chars()
        .flat_map(|c| c.to_lowercase())
        .map(|c| if c == '-' || c == ' ' { '_' } else { c })
        .collect();
    match normalised.as_str() {
        "anthropic" | "claude" | "anthropic_api" => AdapterKind::Anthropic,
        "ollama" | "lm_studio" | "lmstudio" => AdapterKind::Ollama,
        _ => AdapterKind::OpenAiCompatible,
    }
}

/// The keychain address of `name`'s API key.
///
/// It is the same address [`KeychainSecretStore`] writes, so the daemon's
/// `providers.add` and the adapter it later builds cannot disagree about where the
/// key is — which is the one way a configured provider could otherwise end up
/// permanently uncallable.
pub fn keychain_credentials(name: &str) -> CredentialsRef {
    CredentialsRef::Keychain {
        service: KeychainSecretStore::SERVICE.to_string(),
        account: name.to_string(),
    }
}

/// The seam between a stored provider and a live adapter.
///
/// `build` is async because both halves of the job are: reading the OS keychain and,
/// for the adapters that list their models, asking the endpoint. It is fallible by
/// design — a provider whose key is not in the keychain is not a provider, and no
/// adapter can be invented around that.
#[async_trait]
pub trait ProviderFactory: Send + Sync + fmt::Debug {
    /// The adapter for `provider`, or why there is none.
    async fn build(&self, provider: &StoredProvider) -> Result<Box<dyn ChatProvider>>;
}

/// The factory the daemon starts with: the OS keychain holds the key, and
/// `warsha-providers`' own adapters speak the protocol.
#[derive(Debug, Clone, Copy, Default)]
pub struct KeychainProviderFactory;

impl KeychainProviderFactory {
    /// The daemon's production factory.
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl ProviderFactory for KeychainProviderFactory {
    async fn build(&self, provider: &StoredProvider) -> Result<Box<dyn ChatProvider>> {
        // A provider with no endpoint is a row the owner half-filled. Its kind's own
        // default answers it when there is one; `providers.add` already refuses a
        // kind with neither, and a row that predates that check is refused here.
        let endpoint = provider_endpoint(provider).ok_or_else(|| {
            DaemonError::Config(format!(
                "provider {} (kind {}) names no endpoint to call",
                provider.name, provider.kind
            ))
        })?;
        let service = KeychainSecretStore::SERVICE;
        // The credentials name the keychain entry rather than carry a key: nothing in
        // this module holds or copies a secret.
        let credentials = keychain_credentials(&provider.name);
        let id = provider.name.clone();
        let adapter: Box<dyn ChatProvider> = match adapter_kind(&provider.kind) {
            AdapterKind::OpenAiCompatible => Box::new(
                OpenAIProvider::new(id, Some(endpoint), &credentials, service)
                    .await
                    .map_err(DaemonError::Provider)?,
            ),
            AdapterKind::Anthropic => Box::new(
                AnthropicProvider::new(id, Some(endpoint), &credentials, service)
                    .await
                    .map_err(DaemonError::Provider)?,
            ),
            // A local server needs no key; its own probe answers whether one is
            // there, and `providers.test` is where the owner is told.
            AdapterKind::Ollama => Box::new(
                OllamaProvider::new(id, Some(endpoint), &credentials, service)
                    .await
                    .map_err(DaemonError::Provider)?,
            ),
        };
        Ok(adapter)
    }
}

/// A factory that hands back the offline mock provider.
///
/// For tests and for an embedded host with no keychain: the daemon never installs it
/// on its own ([`crate::start_daemon`] uses [`KeychainProviderFactory`]). It exists
/// so an integration test can prove the whole configured-provider path — row,
/// routing, agent turn, restart — without a key, a network or a bill, which is what
/// AGENTS.md requires of a test in this repository.
#[derive(Debug, Clone, Copy, Default)]
pub struct MockProviderFactory;

impl MockProviderFactory {
    /// The offline factory.
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl ProviderFactory for MockProviderFactory {
    async fn build(&self, provider: &StoredProvider) -> Result<Box<dyn ChatProvider>> {
        // The row's own name is the adapter id, exactly as the keychain factory
        // registers it, so a routing that names the provider resolves the same way
        // offline as it does with a real key.
        Ok(Box::new(MockProvider::new(provider.name.as_str())))
    }
}

/// A configured provider the router holds *before* it has been used.
///
/// The daemon registers one of these for every provider row a routing names, so a
/// restart restores everything that can be restored with no network at all: the
/// router knows the provider exists and a turn can be routed to it, and the first
/// call pays for building the real adapter. The adapter is kept, so one provider is
/// constructed once per daemon.
pub struct DeferredProvider {
    provider: StoredProvider,
    factory: Arc<dyn ProviderFactory>,
    built: Mutex<Option<Arc<dyn ChatProvider>>>,
}

impl fmt::Debug for DeferredProvider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The row without its key (a row has none) and whether the real adapter has
        // been built yet — the only facts a log line needs about a provider. `Debug` is
        // synchronous, so the lock is tried rather than waited for: a provider that is
        // being built right now is itself the answer worth printing.
        let built = self
            .built
            .try_lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false);
        f.debug_struct("DeferredProvider")
            .field("name", &self.provider.name)
            .field("kind", &self.provider.kind)
            .field("built", &built)
            .finish_non_exhaustive()
    }
}

impl DeferredProvider {
    /// A deferred adapter for `provider`, built by `factory` on first use.
    pub fn new(provider: StoredProvider, factory: Arc<dyn ProviderFactory>) -> Self {
        Self {
            provider,
            factory,
            built: Mutex::new(None),
        }
    }

    /// The provider's name, which is its router id and its keychain account.
    pub fn name(&self) -> &str {
        &self.provider.name
    }

    /// The adapter, building it once.
    async fn adapter(&self) -> ProviderResult<Arc<dyn ChatProvider>> {
        let mut guard = self.built.lock().await;
        if let Some(adapter) = guard.as_ref() {
            return Ok(Arc::clone(adapter));
        }
        let built = self
            .factory
            .build(&self.provider)
            .await
            .map_err(|error| match error {
                // The provider's own error keeps its code (and its retryability);
                // anything else arrives as text, because a daemon error can name a
                // path and a provider error must not.
                DaemonError::Provider(provider) => provider,
                other => ProviderError::Other(other.to_string()),
            })?;
        let shared: Arc<dyn ChatProvider> = Arc::from(built);
        *guard = Some(Arc::clone(&shared));
        Ok(shared)
    }
}

#[async_trait]
impl ChatProvider for DeferredProvider {
    fn id(&self) -> &str {
        &self.provider.name
    }

    fn kind(&self) -> ProviderKind {
        adapter_kind(&self.provider.kind).provider_kind()
    }

    async fn list_models(&self) -> ProviderResult<Vec<ModelInfo>> {
        self.adapter().await?.list_models().await
    }

    async fn health(&self) -> ProviderResult<HealthCheck> {
        self.adapter().await?.health().await
    }

    async fn chat(&self, request: ChatRequest) -> ProviderResult<ChatResponse> {
        self.adapter().await?.chat(request).await
    }

    async fn chat_stream(&self, request: ChatRequest) -> ProviderStream {
        self.adapter().await?.chat_stream(request).await
    }

    /// Cost follows a call that happened, so by the time the router asks, the adapter
    /// is built. Before that this refuses rather than quoting a price for a provider
    /// it has not reached: an estimate nobody checked is how a budget stops meaning
    /// anything.
    fn cost_of(&self, model: &str, usage: &TokenUsage) -> ProviderResult<u64> {
        let guard = match self.built.try_lock() {
            Ok(guard) => guard,
            // Being built right now means no call has been answered yet.
            Err(_) => {
                return Err(ProviderError::Other(format!(
                    "provider {} is being reached for the first time; its cost is not known yet",
                    self.provider.name
                )))
            }
        };
        match guard.as_ref() {
            Some(adapter) => adapter.cost_of(model, usage),
            None => Err(ProviderError::Other(format!(
                "provider {} has not been reached, so its cost is not known",
                self.provider.name
            ))),
        }
    }
}

/// What a removed provider's registration is replaced with.
///
/// `providers.remove` deletes the keychain entry and the row; a router that had
/// already built an adapter for it still holds that key in its request headers. This
/// adapter keeps the id so the refusal is legible to whatever routing still names it,
/// and answers nothing.
pub struct RemovedProvider {
    id: String,
}

impl RemovedProvider {
    /// A refusal that keeps `id`'s place in the router.
    pub fn new(id: &str) -> Self {
        Self { id: id.to_string() }
    }

    /// The one reason every call fails, in the words the owner is shown.
    fn refusal(&self) -> ProviderError {
        ProviderError::Auth(format!(
            "provider {} was removed; its key is gone, so nothing is called in its name",
            self.id
        ))
    }
}

impl fmt::Debug for RemovedProvider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RemovedProvider")
            .field("id", &self.id)
            .finish()
    }
}

#[async_trait]
impl ChatProvider for RemovedProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::CustomOpenAICompatible
    }

    async fn list_models(&self) -> ProviderResult<Vec<ModelInfo>> {
        Err(self.refusal())
    }

    async fn health(&self) -> ProviderResult<HealthCheck> {
        Err(self.refusal())
    }

    async fn chat(&self, _request: ChatRequest) -> ProviderResult<ChatResponse> {
        Err(self.refusal())
    }

    async fn chat_stream(&self, _request: ChatRequest) -> ProviderStream {
        Err(self.refusal())
    }

    fn cost_of(&self, _model: &str, _usage: &TokenUsage) -> ProviderResult<u64> {
        Err(self.refusal())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(name: &str, kind: &str, api_base: Option<&str>) -> StoredProvider {
        StoredProvider {
            name: name.to_string(),
            kind: kind.to_string(),
            api_base: api_base.map(str::to_string),
            enabled: true,
            created_at: 1_700_000_000,
        }
    }

    /// Usage for a call that was never made: `warsha-core` gives `TokenUsage` no
    /// `Default`, and inventing one here would be a price for nothing.
    fn no_usage() -> TokenUsage {
        TokenUsage {
            input: 0,
            output: 0,
            total: 0,
        }
    }

    #[test]
    fn the_two_named_protocols_are_matched_and_everything_else_is_openai_compatible() {
        assert_eq!(adapter_kind("anthropic"), AdapterKind::Anthropic);
        assert_eq!(adapter_kind("Anthropic"), AdapterKind::Anthropic);
        assert_eq!(adapter_kind("claude"), AdapterKind::Anthropic);
        assert_eq!(adapter_kind("ollama"), AdapterKind::Ollama);
        assert_eq!(adapter_kind("LM-Studio"), AdapterKind::Ollama);
        // The wizard's own kinds, and a gateway named by the owner, are all
        // OpenAI-compatible — the same reading `providers.add` gives a `custom` kind.
        for kind in [
            "open_router",
            "deep_seek",
            "kimi",
            "glm",
            "qwen",
            "custom",
            "my-gateway",
        ] {
            assert_eq!(adapter_kind(kind), AdapterKind::OpenAiCompatible, "{kind}");
        }
    }

    #[test]
    fn a_tag_is_normalised_the_way_the_wizard_normalises_it() {
        assert_eq!(adapter_kind("  ANTHROPIC "), AdapterKind::Anthropic);
        assert_eq!(adapter_kind("lm studio"), AdapterKind::Ollama);
        assert_eq!(adapter_kind("anthropic-api"), AdapterKind::Anthropic);
        // A name that merely *starts* with a protocol word is not that protocol.
        assert_eq!(
            adapter_kind("anthropic-proxy"),
            AdapterKind::OpenAiCompatible
        );
    }

    #[test]
    fn the_keychain_address_is_the_one_the_daemon_stores_the_key_under() {
        // `providers.add` files the key through `KeychainSecretStore`, whose account
        // is the provider's name; an adapter built from the same name has to read the
        // same entry or the configured provider is permanently uncallable.
        //
        // `CredentialsRef` is a `warsha-core` enum with no `PartialEq`, so the two fields
        // are asserted rather than the value: what matters is the pair, not the type.
        match keychain_credentials("my-qwen") {
            CredentialsRef::Keychain { service, account } => {
                assert_eq!(service, KeychainSecretStore::SERVICE);
                assert_eq!(account, "my-qwen");
            }
            other => panic!("a provider key is addressed as a keychain entry, not {other:?}"),
        }
    }

    #[test]
    fn the_reported_kind_follows_the_adapter_choice() {
        assert_eq!(
            AdapterKind::Anthropic.provider_kind(),
            ProviderKind::Anthropic
        );
        assert_eq!(AdapterKind::Ollama.provider_kind(), ProviderKind::Ollama);
        assert_eq!(
            AdapterKind::OpenAiCompatible.provider_kind(),
            ProviderKind::OpenAI
        );
    }

    #[tokio::test]
    async fn a_row_with_no_endpoint_is_refused_before_anything_is_called() {
        // `custom` has no default URL, so a row with no `api_base` names nothing to
        // call. The refusal is the daemon's own error, not a provider's guess.
        let factory = KeychainProviderFactory::new();
        // `Box<dyn ChatProvider>` is not `Debug`, so the refusal is matched rather than
        // unwrapped: what is being proved is the error, and there is no adapter to print.
        let error = match factory.build(&row("gateway", "custom", None)).await {
            Ok(_) => panic!("a provider with no endpoint cannot be built"),
            Err(error) => error,
        };
        assert!(
            error.to_string().contains("names no endpoint"),
            "the refusal says why: {error}"
        );
    }

    #[tokio::test]
    async fn the_mock_factory_answers_under_the_providers_own_name() {
        let built = MockProviderFactory::new()
            .build(&row("my-qwen", "qwen", None))
            .await
            .expect("the mock is built without a key or a network");
        assert_eq!(built.id(), "my-qwen");
    }

    #[tokio::test]
    async fn a_removed_provider_refuses_every_call_under_its_id() {
        let removed = RemovedProvider::new("my-qwen");
        assert_eq!(removed.id(), "my-qwen");
        let error = removed
            .health()
            .await
            .expect_err("a removed provider is not healthy, it is gone");
        assert!(error.to_string().contains("was removed"), "{error}");
        assert!(
            !error.is_retryable(),
            "a removal is a decision, not a hiccup: a retry must not spend"
        );
        assert!(removed
            .cost_of("m", &no_usage())
            .expect_err("no cost is quoted for a provider that cannot be called")
            .to_string()
            .contains("was removed"));
    }

    #[tokio::test]
    async fn a_deferred_provider_builds_once_and_keeps_the_adapter() {
        let provider = row("my-qwen", "qwen", None);
        let deferred =
            DeferredProvider::new(provider.clone(), Arc::new(MockProviderFactory::new()));
        assert_eq!(deferred.id(), "my-qwen");
        assert_eq!(deferred.kind(), ProviderKind::OpenAI);
        // Nothing has been reached, so no cost is quoted.
        assert!(deferred
            .cost_of("m", &no_usage())
            .expect_err("the adapter is not built yet")
            .to_string()
            .contains("has not been reached"));

        let answer = deferred
            .chat(ChatRequest {
                model: String::new(),
                messages: vec![],
                temperature: None,
                max_tokens: None,
                stream: false,
            })
            .await
            .expect("the mock answers");
        assert_eq!(answer.choices.len(), 1);
        // The call built the adapter, so the cost of the usage it reported is known.
        assert!(
            deferred
                .cost_of("m", &answer.usage)
                .expect("the built adapter prices the usage")
                >= 1
        );
    }

    #[tokio::test]
    async fn a_deferred_provider_that_cannot_be_built_says_why_and_builds_nothing_else() {
        // A row with no endpoint: the factory refuses, and the refusal reaches the
        // caller as the provider's own error rather than a silent empty answer.
        let deferred = DeferredProvider::new(
            row("gateway", "custom", None),
            Arc::new(KeychainProviderFactory::new()),
        );
        let error = deferred
            .health()
            .await
            .expect_err("a provider that names no endpoint cannot answer a health check");
        assert!(
            error.to_string().contains("names no endpoint"),
            "the caller hears the reason: {error}"
        );
        // Still unbuilt: a failed build is not cached as an adapter.
        assert!(deferred
            .cost_of("m", &no_usage())
            .expect_err("nothing was built")
            .to_string()
            .contains("has not been reached"));
    }
}
