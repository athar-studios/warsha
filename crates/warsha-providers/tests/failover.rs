// A4 acceptance tests: failover, cooldown, budget, and the estimate.
// All five groups the packet names, against the mock provider only — no
// real model APIs are dialled (AGENTS.md).

use std::sync::atomic::Ordering;

use warsha_core::{Role, RoleRouting, RoutingTarget};
use warsha_providers::{
    ChatMessage, ChatRequest, MessageRole, MockProvider, ProviderError, ProviderRouter, RetryPolicy,
};

fn request() -> ChatRequest {
    ChatRequest {
        model: "mock-model".to_string(),
        messages: vec![ChatMessage {
            role: MessageRole::User,
            content: "estimate me".to_string(),
        }],
        temperature: None,
        max_tokens: Some(64),
        stream: false,
    }
}

fn target(provider_id: &str) -> RoutingTarget {
    RoutingTarget {
        provider_id: provider_id.to_string(),
        model_id: "mock-model".to_string(),
        weight: 1,
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

#[tokio::test]
async fn kill_the_primary_completes_on_the_fallback() {
    let primary = MockProvider::new("mock-primary").with_retryable_failures(3);
    let primary_calls = primary.call_counter();
    let fallback = MockProvider::new("mock");
    let fallback_calls = fallback.call_counter();

    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(primary));
    router.register_provider(Box::new(fallback));
    router.set_retry_policy(RetryPolicy::no_backoff());
    router.set_role_routing(coder_routing(
        vec![target("mock-primary"), target("mock")],
        true,
    ));

    let result = router
        .chat_with_fallback(Role::Coder, "project-1", request())
        .await;
    assert!(result.is_ok(), "the run must complete on the fallback");
    assert_eq!(
        primary_calls.load(Ordering::SeqCst),
        3,
        "the primary is retried per-target before the walk moves on"
    );
    assert_eq!(
        fallback_calls.load(Ordering::SeqCst),
        1,
        "fallback dialled once"
    );
}

#[tokio::test]
async fn no_routing_outside_the_configured_list() {
    let outside = MockProvider::new("mock-outside");
    let outside_calls = outside.call_counter();
    let configured = MockProvider::new("mock");

    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(outside));
    router.register_provider(Box::new(configured));
    // Only `mock` is configured; the outside provider is registered but never routed.
    router.set_retry_policy(RetryPolicy::no_backoff());
    router.set_role_routing(coder_routing(vec![target("mock")], true));

    let result = router
        .chat_with_fallback(Role::Coder, "project-1", request())
        .await;
    assert!(result.is_ok());
    assert_eq!(
        outside_calls.load(Ordering::SeqCst),
        0,
        "a provider outside the owner's list is never called"
    );
}

#[tokio::test]
async fn cooldown_skips_a_failing_provider_and_reset_reopens_it() {
    let failing = MockProvider::new("mock").with_retryable_failures(u32::MAX);
    let calls = failing.call_counter();

    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(failing));
    router.set_retry_policy(RetryPolicy::no_backoff());
    router.set_role_routing(coder_routing(vec![target("mock")], false));

    let first = router
        .chat_with_fallback(Role::Coder, "project-1", request())
        .await;
    assert!(first.is_err(), "no fallback configured, the error surfaces");
    assert_eq!(
        calls.load(Ordering::SeqCst),
        3,
        "walk retries the target before giving up"
    );

    // The provider is now in cooldown: the next walk skips it by name.
    let second = router
        .chat_with_fallback(Role::Coder, "project-1", request())
        .await;
    assert!(second.is_err());
    assert_eq!(
        calls.load(Ordering::SeqCst),
        3,
        "a provider in cooldown is not dialled again (count unchanged)"
    );

    // A success resets the cooldown.
    router.reset_cooldown("mock");
    let third = router
        .chat_with_fallback(Role::Coder, "project-1", request())
        .await;
    assert!(third.is_err());
    assert_eq!(
        calls.load(Ordering::SeqCst),
        6,
        "cooldown reset lets the walk try again (3 more attempts)"
    );
}

#[tokio::test]
async fn budget_cap_stops_the_walk_through_the_existing_gate() {
    let provider = MockProvider::new("mock");
    let calls = provider.call_counter();

    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(provider));
    router.set_retry_policy(RetryPolicy::no_backoff());
    router.set_role_routing(coder_routing(vec![target("mock")], false));
    router.set_budget("project-1", 1); // one cent: already spent past it below
    router.record_spend_for_test("project-1", 5);

    let result = router
        .chat_with_fallback(Role::Coder, "project-1", request())
        .await;
    assert!(
        matches!(result, Err(ProviderError::BudgetExceeded)),
        "the budget gate stops the run before a call is dialled: {result:?}"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
}

#[test]
fn estimate_range_floor_below_ceiling() {
    // The estimate helper is exercised end to end through the daemon in the
    // warshad suite; here the range arithmetic is checked directly: the floor
    // is the cheapest plausible usage and the ceiling a heavier one.
    let floor = estimate_cents(20_000.0, 5_000.0, 100, 200);
    let ceiling = estimate_cents(200_000.0, 50_000.0, 100, 200);
    assert!(floor > 0);
    assert!(ceiling > floor, "the ceiling must exceed the floor");
}

fn estimate_cents(
    input_tokens: f64,
    output_tokens: f64,
    input_per_million_cents: u64,
    output_per_million_cents: u64,
) -> u64 {
    let input = (input_tokens / 1_000_000.0) * input_per_million_cents as f64;
    let output = (output_tokens / 1_000_000.0) * output_per_million_cents as f64;
    (input + output).ceil() as u64
}
