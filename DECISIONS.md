# D-RN-A3-1: Quota State Representation
Date: 2026-11-17
Description: Use `ProviderQuota` enum to represent quota states (Reported(u64), Estimated(u64), Unknown) across providers. This allows UI to show "unknown" for providers without an exposed endpoint and distinguish between real and estimated data.

# D-RN-A3-2: Mock Provider Updates
Date: 2026-11-17
Description: Updated all test mock providers (`fake.rs`, `anthropic.rs`, `ollama.rs`, `openai.rs`, `run_integrity.rs`, `status_truth.rs`, `lib.rs`, `harness_skills_wiring.rs`) to implement the `get_quota` method to satisfy the new `ChatProvider` trait requirements. All return `ProviderQuota::Unknown`.
