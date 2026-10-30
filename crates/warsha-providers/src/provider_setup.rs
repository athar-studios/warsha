//! One-click provider setup and a **network-free** "Test connection".
//!
//! [`OneClickProvider`] is the short list the setup wizard offers: the five
//! hosted OpenAI-compatible endpoints Warsha ships a default base URL for, plus
//! a custom endpoint the owner fills in by hand.
//!
//! [`ProviderSetupWizard::test_connection`] deliberately makes **no network
//! call**. It validates the three inputs the owner types — the URL parses, the
//! key is non-empty and the model is non-empty — and returns a
//! [`ConnectionTestResult`] with one `*_ok` flag and one human-readable reason
//! per input. That keeps the three error classes (URL, key, model) distinct
//! instead of collapsing every failure into "connection failed", and it keeps
//! tests offline: a real reachability probe belongs to the adapters, which
//! already have `health()`.

use serde::{Deserialize, Serialize};

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
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
