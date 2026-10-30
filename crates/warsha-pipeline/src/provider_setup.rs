//! Provider setup — the one-click wizard and its network-free connection test.
//!
//! The implementation lives in `warsha-providers`, next to the adapters it
//! configures, so there is exactly one copy of the validation rules. This
//! module re-exports it for pipeline callers (the daemon's setup RPC and the
//! desktop wizard both reach it through here), which keeps the crate-level
//! surface in one place without duplicating the logic.

pub use warsha_providers::{ConnectionTestResult, OneClickProvider, ProviderSetupWizard};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipeline_reaches_the_provider_setup_wizard() {
        // The re-export must stay usable through the pipeline crate: this is
        // what the daemon and the desktop call.
        let result = ProviderSetupWizard::test_connection(
            "https://openrouter.ai/api/v1",
            "sk-or-test-key",
            "openai/gpt-4o-mini",
        );
        assert!(result.all_ok());
        assert_eq!(
            OneClickProvider::OpenRouter.default_base_url(),
            Some("https://openrouter.ai/api/v1")
        );

        let bad = ProviderSetupWizard::test_connection("nope", "sk-key", "gpt");
        assert!(!bad.url_ok);
        assert!(bad.url_reason.is_some());

        // The result is the same serialisable struct the daemon sends back.
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"model_ok\":true"));
        assert_eq!(
            serde_json::from_str::<ConnectionTestResult>(&json).unwrap(),
            result
        );
    }
}
