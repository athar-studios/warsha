//! One-click provider setup, a **network-free** "Test connection" and the one
//! reachability probe that sits behind it.
//!
//! [`OneClickProvider`] is the short list the setup wizard offers: the five
//! hosted OpenAI-compatible endpoints Warsha ships a default base URL and a
//! default model for, plus a custom endpoint the owner fills in by hand.
//!
//! [`ProviderSetupWizard::test_connection`] deliberately makes **no network
//! call**. It validates the three inputs the owner types — the URL parses, the
//! key is non-empty and the model is non-empty — and returns a
//! [`ConnectionTestResult`] with one `*_ok` flag and one human-readable reason
//! per input. That keeps the three error classes (URL, key, model) distinct
//! instead of collapsing every failure into "connection failed", and it keeps
//! tests offline: a real reachability probe belongs to the adapters, which
//! already have `health()`.
//!
//! [`probe_endpoint`] is that probe, and it is a separate function for exactly
//! that reason: `test_connection` answers "is this input well formed?", the probe
//! answers "does this endpoint answer, and does it accept this key?". The
//! daemon's `providers.test` runs the first and then, only if it passed, the
//! second — which is what makes a wrong key, an unreachable endpoint and a good
//! key three different answers instead of one.

use std::time::{Duration, Instant};

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::HealthCheck;

/// How long [`probe_endpoint`] waits for an answer.
///
/// Short on purpose: the owner is looking at a wizard with a spinner, and a
/// probe that hangs is worse than one that says the endpoint did not answer.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

/// The three checks a setup attempt reports on, with a reason for each failure.
///
/// A `*_ok` flag is `true` exactly when the matching `*_reason` is `None`, so a
/// caller can render three checkmarks and, next to each cross, the sentence
/// that explains it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    /// True when the base URL parses as an absolute `http(s)` URL with a host.
    pub url_ok: bool,
    /// True when the API key is non-empty.
    pub key_ok: bool,
    /// True when the model id is non-empty.
    pub model_ok: bool,
    /// Why the URL failed, `None` when it passed.
    pub url_reason: Option<String>,
    /// Why the key failed, `None` when it passed.
    pub key_reason: Option<String>,
    /// Why the model failed, `None` when it passed.
    pub model_reason: Option<String>,
}

impl ConnectionTestResult {
    /// Build a result from three already-evaluated checks.
    fn from_checks(
        url: Result<(), String>,
        key: Result<(), String>,
        model: Result<(), String>,
    ) -> Self {
        Self {
            url_ok: url.is_ok(),
            key_ok: key.is_ok(),
            model_ok: model.is_ok(),
            url_reason: url.err(),
            key_reason: key.err(),
            model_reason: model.err(),
        }
    }

    /// True when all three checks passed.
    pub fn all_ok(&self) -> bool {
        self.url_ok && self.key_ok && self.model_ok
    }

    /// The checks that failed, as `(field, reason)` pairs in a stable order.
    pub fn failures(&self) -> Vec<(&'static str, &str)> {
        let mut failures = Vec::new();
        if let Some(reason) = self.url_reason.as_deref() {
            failures.push(("url", reason));
        }
        if let Some(reason) = self.key_reason.as_deref() {
            failures.push(("key", reason));
        }
        if let Some(reason) = self.model_reason.as_deref() {
            failures.push(("model", reason));
        }
        failures
    }

    /// Every failed check's reason as one sentence, `None` when all three passed.
    ///
    /// A caller with room for one sentence — a JSON-RPC error, a log line — should
    /// send this rather than "connection failed": the sentence names what to fix.
    pub fn reason(&self) -> Option<String> {
        let reasons: Vec<&str> = self
            .failures()
            .into_iter()
            .map(|(_, reason)| reason)
            .collect();
        if reasons.is_empty() {
            None
        } else {
            Some(reasons.join(" "))
        }
    }
}

/// Validates provider setup input without touching the network.
///
/// The wizard is a unit struct: it holds no configuration and every check is a
/// pure function of the three strings the owner typed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ProviderSetupWizard;

impl ProviderSetupWizard {
    /// Validate `url`, `key` and `model`, reporting the three classes
    /// separately.
    pub fn test_connection(url: &str, key: &str, model: &str) -> ConnectionTestResult {
        ConnectionTestResult::from_checks(
            validate_url(url),
            validate_key(key),
            validate_model(model),
        )
    }
}

/// A URL must be absolute `http`/`https` with a non-empty host and no spaces.
///
/// Hand-rolled on purpose: the crate has no `url` dependency and a setup field
/// does not need full RFC 3986 parsing.
fn validate_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Enter the base URL of the provider.".to_string());
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err("The URL contains a space.".to_string());
    }

    let rest = if let Some(rest) = trimmed.strip_prefix("https://") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        rest
    } else {
        return Err("The URL must start with http:// or https://.".to_string());
    };

    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if host.is_empty() {
        return Err("The URL has no host.".to_string());
    }
    // A bare scheme separator ("http:///v1") leaves a host that is only a
    // userinfo or nothing at all.
    let host_without_userinfo = host.rsplit('@').next().unwrap_or_default();
    if host_without_userinfo.is_empty() || host_without_userinfo.starts_with(':') {
        return Err("The URL has no host.".to_string());
    }

    Ok(())
}

/// A key must be present and free of whitespace.
fn validate_key(key: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Enter the API key.".to_string());
    }
    if trimmed.chars().any(char::is_whitespace) {
        return Err("The API key contains a space.".to_string());
    }
    Ok(())
}

/// A model id must be present.
fn validate_model(model: &str) -> Result<(), String> {
    if model.trim().is_empty() {
        return Err("Enter the model id.".to_string());
    }
    Ok(())
}

/// The providers the setup wizard offers as one click.
///
/// Every variant except [`Custom`](OneClickProvider::Custom) carries a default
/// OpenAI-compatible base URL, so the owner only has to paste a key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OneClickProvider {
    /// <https://openrouter.ai>
    OpenRouter,
    /// <https://platform.deepseek.com>
    DeepSeek,
    /// Moonshot / Kimi.
    Kimi,
    /// Zhipu GLM.
    Glm,
    /// Alibaba Qwen (DashScope compatible mode).
    Qwen,
    /// Any other OpenAI-compatible endpoint; the owner supplies the URL.
    Custom,
}

impl OneClickProvider {
    /// Every variant, in the order the picker shows them.
    pub fn all() -> &'static [OneClickProvider] {
        &[
            OneClickProvider::OpenRouter,
            OneClickProvider::DeepSeek,
            OneClickProvider::Kimi,
            OneClickProvider::Glm,
            OneClickProvider::Qwen,
            OneClickProvider::Custom,
        ]
    }

    /// Stable snake_case tag for the config file, logs and UI keys.
    pub fn as_str(self) -> &'static str {
        match self {
            OneClickProvider::OpenRouter => "open_router",
            OneClickProvider::DeepSeek => "deep_seek",
            OneClickProvider::Kimi => "kimi",
            OneClickProvider::Glm => "glm",
            OneClickProvider::Qwen => "qwen",
            OneClickProvider::Custom => "custom",
        }
    }

    /// The OpenAI-compatible base URL to prefill, `None` for
    /// [`Custom`](OneClickProvider::Custom).
    pub fn default_base_url(self) -> Option<&'static str> {
        match self {
            OneClickProvider::OpenRouter => Some("https://openrouter.ai/api/v1"),
            OneClickProvider::DeepSeek => Some("https://api.deepseek.com/v1"),
            OneClickProvider::Kimi => Some("https://api.moonshot.cn/v1"),
            OneClickProvider::Glm => Some("https://open.bigmodel.cn/api/paas/v4"),
            OneClickProvider::Qwen => Some("https://dashscope.aliyuncs.com/compatible-mode/v1"),
            OneClickProvider::Custom => None,
        }
    }

    /// The variant `tag` names, or `None` when no variant does.
    ///
    /// The wizard sends the tag over the wire (`open_router`), and the daemon has
    /// to read it back to find the default URL and model for a provider whose
    /// owner supplied neither. The match is case-insensitive and ignores `-` and
    /// spaces so `open-router` and `OpenRouter` land on the same variant, but it
    /// never guesses a variant from a prefix: an unknown tag is `None`, and the
    /// caller refuses rather than testing a provider against a URL nobody chose.
    pub fn from_tag(tag: &str) -> Option<Self> {
        let normalized: String = tag
            .chars()
            .filter(|c| !matches!(c, '-' | '_' | ' '))
            .flat_map(char::to_lowercase)
            .collect();
        Self::all()
            .iter()
            .copied()
            .find(|provider| provider.as_str().replace('_', "") == normalized)
    }

    /// The model id this provider is reached with when the owner names none.
    ///
    /// The wizard's promise is "paste one API key", and a connection probe needs
    /// a model to check that field with. These are the vendors' own published ids
    /// for their flagship text model, so an answer is a real model and not a
    /// placeholder that would pass a field check while naming nothing.
    /// [`Custom`](OneClickProvider::Custom) has no default: an arbitrary endpoint
    /// is the owner's to name, and the setup check says so.
    pub fn default_model(self) -> Option<&'static str> {
        match self {
            OneClickProvider::OpenRouter => Some("openai/gpt-4o-mini"),
            OneClickProvider::DeepSeek => Some("deepseek-chat"),
            OneClickProvider::Kimi => Some("moonshot-v1-8k"),
            OneClickProvider::Glm => Some("glm-4"),
            OneClickProvider::Qwen => Some("qwen-plus"),
            OneClickProvider::Custom => None,
        }
    }
}

/// Ask `base_url` whether it answers and whether it accepts `api_key`.
///
/// The one network call in provider setup, and the only place a bare key leaves
/// the process: a `GET <base_url>/models` with the key as a bearer token, which is
/// the cheapest authenticated request every OpenAI-compatible endpoint answers.
/// The three outcomes the caller cares about are kept apart —
///
/// - a `2xx` is [`HealthCheck::healthy`] with the measured latency;
/// - a `401`/`403` names the key as the refused half, so "your key is wrong" is
///   not reported as "the endpoint is down";
/// - anything else — a refused connection, an unknown host, a timeout, a `5xx` —
///   is unhealthy with the reason, and never with the URL or the key in it.
///
/// The key is never logged, and the error text this returns never quotes the
/// request: a base URL can carry a token in its query string, and an error
/// message is the one string that reliably ends up in a log.
pub async fn probe_endpoint(base_url: &str, api_key: &str) -> HealthCheck {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let client = match Client::builder().timeout(PROBE_TIMEOUT).build() {
        Ok(client) => client,
        Err(error) => return unhealthy(format!("the HTTP client could not be built: {error}")),
    };

    let started = Instant::now();
    let response = match client.get(&url).bearer_auth(api_key).send().await {
        Ok(response) => response,
        Err(error) => return unhealthy(describe_transport(&error)),
    };
    let latency_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let status = response.status();

    if status.is_success() {
        HealthCheck {
            healthy: true,
            latency_ms: Some(latency_ms),
            error: None,
        }
    } else if status == reqwest::StatusCode::UNAUTHORIZED
        || status == reqwest::StatusCode::FORBIDDEN
    {
        unhealthy(format!(
            "the endpoint refused the API key (HTTP {})",
            status.as_u16()
        ))
    } else {
        unhealthy(format!(
            "the endpoint answered HTTP {} instead of a model list",
            status.as_u16()
        ))
    }
}

/// An unhealthy result carrying `reason`.
fn unhealthy(reason: String) -> HealthCheck {
    HealthCheck {
        healthy: false,
        latency_ms: None,
        error: Some(reason),
    }
}

/// What a failed probe should say, without repeating the request.
///
/// `reqwest`'s own `Display` embeds the URL, which is why this does not use it:
/// the message is going to a log and to the owner's screen.
fn describe_transport(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        format!(
            "the endpoint did not answer within {} seconds",
            PROBE_TIMEOUT.as_secs()
        )
    } else if error.is_connect() {
        "the endpoint could not be reached (the connection was refused or the host was not found)"
            .to_string()
    } else {
        "the endpoint could not be reached".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::thread;

    #[test]
    fn connection_test_passes_when_all_three_inputs_are_valid() {
        let result = ProviderSetupWizard::test_connection(
            "https://openrouter.ai/api/v1",
            "sk-or-test-key",
            "openai/gpt-4o-mini",
        );

        assert!(result.all_ok());
        assert!(result.url_ok && result.key_ok && result.model_ok);
        assert_eq!(result.url_reason, None);
        assert_eq!(result.key_reason, None);
        assert_eq!(result.model_reason, None);
        assert!(result.failures().is_empty());
    }

    #[test]
    fn connection_test_rejects_a_bad_url() {
        let no_scheme =
            ProviderSetupWizard::test_connection("openrouter.ai/api/v1", "sk-key", "gpt-4o-mini");
        assert!(!no_scheme.url_ok);
        assert!(no_scheme.key_ok && no_scheme.model_ok);
        assert!(no_scheme
            .url_reason
            .as_deref()
            .unwrap_or_default()
            .contains("http"));

        let empty = ProviderSetupWizard::test_connection("   ", "sk-key", "gpt-4o-mini");
        assert!(!empty.url_ok);
        assert!(empty.url_reason.is_some());

        let no_host = ProviderSetupWizard::test_connection("https:///v1", "sk-key", "gpt-4o-mini");
        assert!(!no_host.url_ok);
        assert!(no_host
            .url_reason
            .as_deref()
            .unwrap_or_default()
            .contains("host"));

        let with_space =
            ProviderSetupWizard::test_connection("https://api.example.com /v1", "sk-key", "m");
        assert!(!with_space.url_ok);
        assert!(with_space
            .url_reason
            .as_deref()
            .unwrap_or_default()
            .contains("space"));

        // `http://` and a port are fine.
        let plain = ProviderSetupWizard::test_connection("http://localhost:11434/v1", "k", "m");
        assert!(plain.all_ok());
    }

    #[test]
    fn connection_test_rejects_a_bad_key() {
        let empty = ProviderSetupWizard::test_connection("https://api.example.com/v1", "", "gpt");
        assert!(!empty.key_ok);
        assert!(empty.url_ok && empty.model_ok);
        assert!(empty
            .key_reason
            .as_deref()
            .unwrap_or_default()
            .contains("API key"));

        let blank =
            ProviderSetupWizard::test_connection("https://api.example.com/v1", "  \t ", "gpt");
        assert!(!blank.key_ok);

        let spaced =
            ProviderSetupWizard::test_connection("https://api.example.com/v1", "sk key", "gpt");
        assert!(!spaced.key_ok);
        assert!(spaced
            .key_reason
            .as_deref()
            .unwrap_or_default()
            .contains("space"));
    }

    #[test]
    fn connection_test_rejects_a_bad_model() {
        let result =
            ProviderSetupWizard::test_connection("https://api.example.com/v1", "sk-key", "");
        assert!(!result.model_ok);
        assert!(result.url_ok && result.key_ok);
        assert!(result
            .model_reason
            .as_deref()
            .unwrap_or_default()
            .contains("model"));
    }

    #[test]
    fn connection_test_reports_all_three_failures_at_once() {
        let result = ProviderSetupWizard::test_connection("", "", "");
        assert!(!result.all_ok());
        assert_eq!(result.failures().len(), 3);
        assert_eq!(result.failures()[0].0, "url");
        assert_eq!(result.failures()[1].0, "key");
        assert_eq!(result.failures()[2].0, "model");

        // Every flag and its reason agree.
        assert_eq!(result.url_ok, result.url_reason.is_none());
        assert_eq!(result.key_ok, result.key_reason.is_none());
        assert_eq!(result.model_ok, result.model_reason.is_none());
    }

    #[test]
    fn one_click_providers_carry_default_urls() {
        assert_eq!(OneClickProvider::all().len(), 6);

        assert_eq!(
            OneClickProvider::OpenRouter.default_base_url(),
            Some("https://openrouter.ai/api/v1")
        );
        assert_eq!(
            OneClickProvider::DeepSeek.default_base_url(),
            Some("https://api.deepseek.com/v1")
        );
        assert_eq!(
            OneClickProvider::Kimi.default_base_url(),
            Some("https://api.moonshot.cn/v1")
        );
        assert_eq!(
            OneClickProvider::Glm.default_base_url(),
            Some("https://open.bigmodel.cn/api/paas/v4")
        );
        assert_eq!(
            OneClickProvider::Qwen.default_base_url(),
            Some("https://dashscope.aliyuncs.com/compatible-mode/v1")
        );
        assert_eq!(OneClickProvider::Custom.default_base_url(), None);

        // Every default URL passes the wizard's own URL check.
        for provider in OneClickProvider::all() {
            if let Some(url) = provider.default_base_url() {
                let result = ProviderSetupWizard::test_connection(url, "sk-key", "some-model");
                assert!(result.all_ok(), "{} default URL must validate", url);
            }
        }
    }

    #[test]
    fn one_click_provider_tags_round_trip_through_serde() {
        assert_eq!(OneClickProvider::OpenRouter.as_str(), "open_router");
        assert_eq!(OneClickProvider::Custom.as_str(), "custom");
        assert_eq!(
            serde_json::to_string(&OneClickProvider::Qwen).unwrap(),
            "\"qwen\""
        );
        assert_eq!(
            serde_json::from_str::<OneClickProvider>("\"kimi\"").unwrap(),
            OneClickProvider::Kimi
        );

        let result = ProviderSetupWizard::test_connection("https://api.example.com/v1", "k", "m");
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"url_ok\":true"));
        assert_eq!(
            serde_json::from_str::<ConnectionTestResult>(&json).unwrap(),
            result
        );
    }

    #[test]
    fn a_reason_is_one_sentence_and_none_when_everything_passed() {
        let ok = ProviderSetupWizard::test_connection("https://api.example.com/v1", "k", "m");
        assert_eq!(ok.reason(), None);

        let bad_key = ProviderSetupWizard::test_connection("https://api.example.com/v1", "", "m");
        assert_eq!(bad_key.reason().as_deref(), Some("Enter the API key."));

        // All three at once: one sentence, in url/key/model order.
        let all = ProviderSetupWizard::test_connection("", "", "");
        let reason = all.reason().unwrap_or_default();
        assert!(reason.starts_with("Enter the base URL"));
        assert!(reason.contains("Enter the API key."));
        assert!(reason.contains("Enter the model id."));
    }

    #[test]
    fn tags_identify_variants_and_carry_a_default_model() {
        assert_eq!(
            OneClickProvider::from_tag("open_router"),
            Some(OneClickProvider::OpenRouter)
        );
        // The case and separator spellings a hand-written config could carry.
        assert_eq!(
            OneClickProvider::from_tag("Open-Router"),
            Some(OneClickProvider::OpenRouter)
        );
        assert_eq!(
            OneClickProvider::from_tag("deep_seek"),
            Some(OneClickProvider::DeepSeek)
        );
        assert_eq!(
            OneClickProvider::from_tag("glm"),
            Some(OneClickProvider::Glm)
        );
        assert_eq!(
            OneClickProvider::from_tag("custom"),
            Some(OneClickProvider::Custom)
        );
        // No prefix guessing: a tag nothing declares is not a variant.
        assert_eq!(OneClickProvider::from_tag("open"), None);
        assert_eq!(OneClickProvider::from_tag(""), None);

        // Every variant but Custom's default model passes the model check, and
        // Custom's absence is what makes the check say so.
        for provider in OneClickProvider::all() {
            match provider.default_model() {
                Some(model) => {
                    let result = ProviderSetupWizard::test_connection(
                        "https://api.example.com/v1",
                        "k",
                        model,
                    );
                    assert!(
                        result.model_ok,
                        "{} must carry a usable model",
                        provider.as_str()
                    );
                }
                None => assert_eq!(*provider, OneClickProvider::Custom),
            }
        }
    }

    /// A one-request HTTP stub on loopback: the status it answers with, the URL to
    /// point a provider at, and the `Authorization` header it received.
    ///
    /// No test may reach a real model API, and a probe test cannot prove anything
    /// without an endpoint that answers, so the endpoint is here, on `127.0.0.1`,
    /// and it records what the probe sent it.
    fn stub_endpoint(status: u16) -> (String, Arc<Mutex<Vec<String>>>) {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let port = listener.local_addr().expect("the bound address").port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let captured = seen.clone();

        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().expect("a cloned stream"));
                let mut request_line = String::new();
                let mut authorization = String::new();
                while reader.read_line(&mut request_line).is_ok() && request_line != "\r\n" {
                    if request_line.to_lowercase().starts_with("authorization:") {
                        authorization = request_line.trim().to_string();
                    }
                    request_line.clear();
                }
                captured
                    .lock()
                    .expect("the capture lock")
                    .push(authorization);

                let body = if status == 200 {
                    r#"{"data":[]}"#
                } else {
                    "{}"
                };
                let response = format!(
                    "HTTP/1.1 {status} stub\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });

        (format!("http://127.0.0.1:{port}/v1"), seen)
    }

    /// A port nothing listens on: bound to get a free number, then released.
    fn closed_endpoint() -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let port = listener.local_addr().expect("the bound address").port();
        drop(listener);
        format!("http://127.0.0.1:{port}/v1")
    }

    #[tokio::test]
    async fn a_probe_that_gets_a_model_list_is_healthy_and_carries_the_key() {
        let (url, seen) = stub_endpoint(200);

        let health = probe_endpoint(&url, "sk-canary-key").await;

        assert!(health.healthy, "a 200 must read as healthy: {health:?}");
        assert!(health.latency_ms.is_some(), "a healthy probe times itself");
        assert_eq!(health.error, None);
        // The key really travelled: this is the assertion that makes the probe a
        // test of the endpoint and not of the URL's shape.
        let headers = seen.lock().expect("the capture lock").clone();
        assert_eq!(headers.len(), 1);
        assert_eq!(headers[0], "authorization: Bearer sk-canary-key");
    }

    #[tokio::test]
    async fn a_probe_refused_by_the_key_says_the_key_was_refused() {
        let (url, seen) = stub_endpoint(401);

        let health = probe_endpoint(&url, "sk-wrong-key").await;

        assert!(!health.healthy);
        assert_eq!(health.latency_ms, None);
        let error = health.error.clone().unwrap_or_default();
        assert!(error.contains("refused the API key"), "{error}");
        assert!(error.contains("401"), "{error}");
        // The message must not quote the key it was refused for.
        assert!(!error.contains("sk-wrong-key"), "{error}");
        assert_eq!(seen.lock().expect("the capture lock").len(), 1);
    }

    #[tokio::test]
    async fn a_probe_of_an_unreachable_endpoint_reports_that_it_could_not_be_reached() {
        let url = closed_endpoint();

        let health = probe_endpoint(&url, "sk-canary-key").await;

        assert!(!health.healthy);
        let error = health.error.clone().unwrap_or_default();
        assert!(error.contains("could not be reached"), "{error}");
        // The URL can carry a token in its query string, so it is never echoed.
        assert!(!error.contains(&url), "{error}");
        assert!(!error.contains("sk-canary-key"), "{error}");
    }

    #[tokio::test]
    async fn a_wrong_key_and_an_unreachable_endpoint_are_different_answers() {
        let (refusing, _) = stub_endpoint(403);
        let wrong_key = probe_endpoint(&refusing, "sk-canary-key").await;
        let unreachable = probe_endpoint(&closed_endpoint(), "sk-canary-key").await;

        assert_eq!(wrong_key.healthy, unreachable.healthy);
        assert_ne!(
            wrong_key.error, unreachable.error,
            "an owner who mistyped a key must not be told the endpoint is down"
        );
    }
}
