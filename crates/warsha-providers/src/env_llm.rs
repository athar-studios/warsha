//! Environment-derived LLM configuration (`WARSHA_LLM_*`).
//!
//! The pipeline's unrouted default path needs three things — an API base URL, an
//! optional key and a model id — and reads them from the environment so a developer
//! can point a full pipeline run at any OpenAI-compatible endpoint without touching
//! the keychain or a config file. [`EnvLlmConfig::from_lookup`] keeps the reading
//! injectable so the defaults are unit-testable without mutating process env.
//!
//! The API key is a secret: it is never logged and the [`Debug`] implementation
//! masks it, per the repository rule that secrets never reach a log line.

/// The OpenAI-compatible endpoint Warsha defaults to when `WARSHA_LLM_BASE_URL`
/// is unset or blank.
pub const DEFAULT_LLM_BASE_URL: &str = "https://router.sayl.site/v1";

/// The model Warsha defaults to when `WARSHA_LLM_MODEL` is unset or blank.
pub const DEFAULT_LLM_MODEL: &str = "bzl/deepseek-v4-flash-0731free";

/// The LLM configuration read from `WARSHA_LLM_BASE_URL`, `WARSHA_LLM_API_KEY`
/// and `WARSHA_LLM_MODEL`, each falling back to its default (or, for the key, to
/// `None`) when unset or blank.
#[derive(Clone, PartialEq, Eq)]
pub struct EnvLlmConfig {
    /// OpenAI-compatible API base URL, e.g. `https://router.sayl.site/v1`.
    pub base_url: String,
    /// The API key, if one is configured. A secret — never log this value.
    pub api_key: Option<String>,
    /// The model id to request.
    pub model: String,
}

impl EnvLlmConfig {
    /// Read the configuration from the process environment.
    pub fn from_env() -> Self {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Read the configuration through `lookup`, which returns the raw value of an
    /// environment variable name. Blank values count as unset: every field is
    /// trimmed, and a trimmed-empty value falls back to its default (`None` for
    /// the key).
    pub fn from_lookup<F: Fn(&str) -> Option<String>>(lookup: F) -> Self {
        let non_empty = |raw: Option<String>| {
            raw.map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        Self {
            base_url: non_empty(lookup("WARSHA_LLM_BASE_URL"))
                .unwrap_or_else(|| DEFAULT_LLM_BASE_URL.to_string()),
            api_key: non_empty(lookup("WARSHA_LLM_API_KEY")),
            model: non_empty(lookup("WARSHA_LLM_MODEL"))
                .unwrap_or_else(|| DEFAULT_LLM_MODEL.to_string()),
        }
    }
}

/// A hand-written `Debug` so the API key can never be printed by an accidental
/// `{:?}` in a log line or a test failure message.
impl std::fmt::Debug for EnvLlmConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EnvLlmConfig")
            .field("base_url", &self.base_url)
            .field("api_key", &self.api_key.as_ref().map(|_| "Some([masked])"))
            .field("model", &self.model)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup_from(map: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let owned: Vec<(String, String)> = map
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        move |key: &str| {
            owned
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.clone())
        }
    }

    #[test]
    fn unset_env_falls_back_to_the_documented_defaults() {
        let config = EnvLlmConfig::from_lookup(|_| None);
        assert_eq!(config.base_url, "https://router.sayl.site/v1");
        assert_eq!(config.base_url, DEFAULT_LLM_BASE_URL);
        assert_eq!(config.model, "bzl/deepseek-v4-flash-0731free");
        assert_eq!(config.model, DEFAULT_LLM_MODEL);
        assert!(config.api_key.is_none(), "no key means no key");
    }

    #[test]
    fn blank_values_count_as_unset() {
        let config = EnvLlmConfig::from_lookup(lookup_from(&[
            ("WARSHA_LLM_BASE_URL", "   "),
            ("WARSHA_LLM_API_KEY", ""),
            ("WARSHA_LLM_MODEL", "\t "),
        ]));
        assert_eq!(config.base_url, DEFAULT_LLM_BASE_URL);
        assert_eq!(config.model, DEFAULT_LLM_MODEL);
        assert!(config.api_key.is_none());
    }

    #[test]
    fn set_values_are_trimmed_and_kept() {
        let config = EnvLlmConfig::from_lookup(lookup_from(&[
            ("WARSHA_LLM_BASE_URL", " https://example.test/v1 "),
            ("WARSHA_LLM_API_KEY", "  sk-secret-value "),
            ("WARSHA_LLM_MODEL", " some/model-x "),
        ]));
        assert_eq!(config.base_url, "https://example.test/v1");
        assert_eq!(config.api_key.as_deref(), Some("sk-secret-value"));
        assert_eq!(config.model, "some/model-x");
    }

    #[test]
    fn the_key_is_never_printed_by_debug() {
        let config = EnvLlmConfig {
            base_url: DEFAULT_LLM_BASE_URL.to_string(),
            api_key: Some("sk-super-secret-token".to_string()),
            model: DEFAULT_LLM_MODEL.to_string(),
        };
        let printed = format!("{config:?}");
        assert!(!printed.contains("sk-super-secret-token"), "{printed}");
        assert!(printed.contains("[masked]"), "{printed}");
    }

    #[test]
    fn from_env_reads_the_process_environment_without_panicking() {
        // Whatever the ambient environment holds, the defaults guarantee a usable
        // config; this test only proves the call exists and cannot fail.
        let config = EnvLlmConfig::from_env();
        assert!(!config.base_url.is_empty());
        assert!(!config.model.is_empty());
    }
}
