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

/// The LLM configuration read from `WARSHA_LLM_BASE_URL`, `WARSHA_LLM_API_KEY`
/// and `WARSHA_LLM_MODEL`, each falling back to its default (or, for the key, to
/// `None`) when unset or blank.
#[derive(Clone, PartialEq, Eq)]
pub struct EnvLlmConfig {
    /// OpenAI-compatible API base URL.
    pub base_url: String,
    /// The API key, if one is configured. A secret — never log this value.
    pub api_key: Option<String>,
    /// The model id to request.
    pub model: String,
}

impl EnvLlmConfig {
    /// Read the configuration from the process environment.
    pub fn from_env() -> Result<Self, anyhow::Error> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Read the configuration through `lookup`, which returns the raw value of an
    /// environment variable name. Blank values count as unset: every field is
    /// trimmed, and a trimmed-empty value falls back to its default (`None` for
    /// the key).
    pub fn from_lookup<F: Fn(&str) -> Option<String>>(lookup: F) -> Result<Self, anyhow::Error> {
        let non_empty = |raw: Option<String>| {
            raw.map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };

        let base_url = non_empty(lookup("WARSHA_LLM_BASE_URL"));
        let api_key = non_empty(lookup("WARSHA_LLM_API_KEY"));
        let model = non_empty(lookup("WARSHA_LLM_MODEL"));

        if api_key.is_some() && base_url.is_none() {
            return Err(anyhow::anyhow!(
                "WARSHA_LLM_API_KEY set but WARSHA_LLM_BASE_URL missing"
            ));
        }

        Ok(Self {
            base_url: base_url.unwrap_or_default(),
            api_key,
            model: model.unwrap_or_default(),
        })
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
    fn unset_env_has_no_defaults() {
        let config = EnvLlmConfig::from_lookup(|_| None).unwrap();
        assert_eq!(config.base_url, "");
        assert_eq!(config.model, "");
        assert!(config.api_key.is_none(), "no key means no key");
    }

    #[test]
    fn blank_values_count_as_unset() {
        let config = EnvLlmConfig::from_lookup(lookup_from(&[
            ("WARSHA_LLM_BASE_URL", "   "),
            ("WARSHA_LLM_API_KEY", ""),
            ("WARSHA_LLM_MODEL", "\t "),
        ]))
        .unwrap();
        assert_eq!(config.base_url, "");
        assert_eq!(config.model, "");
        assert!(config.api_key.is_none());
    }

    #[test]
    fn set_values_are_trimmed_and_kept() {
        let config = EnvLlmConfig::from_lookup(lookup_from(&[
            ("WARSHA_LLM_BASE_URL", " https://example.test/v1 "),
            ("WARSHA_LLM_API_KEY", "  sk-secret-value "),
            ("WARSHA_LLM_MODEL", " some/model-x "),
        ]))
        .unwrap();
        assert_eq!(config.base_url, "https://example.test/v1");
        assert_eq!(config.api_key.as_deref(), Some("sk-secret-value"));
        assert_eq!(config.model, "some/model-x");
    }

    #[test]
    fn key_without_url_is_an_error() {
        let result =
            EnvLlmConfig::from_lookup(lookup_from(&[("WARSHA_LLM_API_KEY", "sk-secret-value")]));
        assert!(result.is_err());
    }

    #[test]
    fn the_key_is_never_printed_by_debug() {
        let config = EnvLlmConfig {
            base_url: "https://example.test".to_string(),
            api_key: Some("sk-super-secret-token".to_string()),
            model: "some/model".to_string(),
        };
        let printed = format!("{config:?}");
        assert!(!printed.contains("sk-super-secret-token"), "{printed}");
        assert!(printed.contains("[masked]"), "{printed}");
    }

    #[test]
    fn from_env_reads_the_process_environment_without_panicking() {
        // Whatever the ambient environment holds, this test only proves the call
        // exists and cannot fail (unless the environment violates the rule).
        let _ = EnvLlmConfig::from_env();
    }
}
