#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

use super::*;

#[tokio::test]
async fn health_reports_probed_capabilities() {
    #[derive(Debug)]
    struct FailingSecretStore;

    #[async_trait]
    impl SecretStore for FailingSecretStore {
        async fn store(&self, _account: &str, _key: &str) -> warsha_providers::Result<()> {
            Err(warsha_providers::ProviderError::Auth(
                "Platform secure storage failure: unavailable".to_string(),
            ))
        }

        async fn load(&self, _account: &str) -> warsha_providers::Result<String> {
            Err(warsha_providers::ProviderError::Auth(
                "Platform secure storage failure: unavailable".to_string(),
            ))
        }

        async fn delete(&self, _account: &str) -> warsha_providers::Result<()> {
            Ok(())
        }
    }

    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = tests::owner_ext();

    // 1. Fresh state without configured providers or role routings:
    // daemon is alive, keychain (InMemorySecretStore) is operational, providers is false.
    let initial = rpc.health(&owner).await.expect("health succeeds");
    assert_eq!(initial.status, "healthy");
    assert!(initial.capabilities.daemon);
    assert!(initial.capabilities.keychain);
    assert!(!initial.capabilities.providers);
    assert!(initial.capabilities.run_controls);

    // 2. Configure an enabled provider -> providers capability becomes true.
    state
        .settings
        .save_provider(&StoredProvider {
            name: "test-provider".to_string(),
            kind: "open_router".to_string(),
            api_base: None,
            enabled: true,
            created_at: 0,
        })
        .await
        .expect("save provider");

    let with_provider = rpc.health(&owner).await.expect("health succeeds");
    assert!(with_provider.capabilities.providers);
    assert!(with_provider.capabilities.daemon);
    assert!(with_provider.capabilities.keychain);

    // 3. With an unavailable keychain store, keychain capability reports false.
    let degraded_state = DaemonState {
        config: state.config.clone(),
        store: state.store.clone(),
        providers: state.providers.clone(),
        pipeline: state.pipeline.clone(),
        backends: Vec::new(),
        github: None,
        devices: state.devices.clone(),
        backend_kits: state.backend_kits.clone(),
        crash_reports: state.crash_reports.clone(),
        store_reviews: state.store_reviews.clone(),
        agent_loop: state.agent_loop.clone(),
        mcp_permissions: state.mcp_permissions.clone(),
        mcp_approvals: state.mcp_approvals.clone(),
        run_worktrees: state.run_worktrees.clone(),
        agent_sessions: state.agent_sessions.clone(),
        processes: state.processes.clone(),
        mcp: state.mcp.clone(),
        previews: state.previews.clone(),
        settings: state.settings.clone(),
        run_modes: state.run_modes.clone(),
        preferences: state.preferences.clone(),
        stored_preferences: state.stored_preferences.clone(),
        pairings: state.pairings.clone(),
        secrets: Arc::new(FailingSecretStore),
        routines: state.routines.clone(),
        routine_scheduler: state.routine_scheduler.clone(),
        sessions: state.sessions.clone(),
        rates: state.rates.clone(),
        role_routings: state.role_routings.clone(),
        provider_factory: state.provider_factory.clone(),
        pairing_origin: std::sync::OnceLock::new(),
        events: state.events.clone(),
        start_time: state.start_time,
    };
    let degraded_rpc = WarshaRpc::new(Arc::new(degraded_state));
    let degraded_health = degraded_rpc
        .health(&owner)
        .await
        .expect("health probe succeeds even when keychain is unavailable");
    assert!(degraded_health.capabilities.daemon);
    assert!(degraded_health.capabilities.providers);
    assert!(!degraded_health.capabilities.keychain);
}

/// The migration a run-ending control depends on is applied, so health advertises the
/// controls — through the real probe, on the real store the daemon opened.
#[tokio::test]
async fn health_reports_run_controls_from_a_real_probe() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = tests::owner_ext();

    // The store `test_state` builds is the daemon's own: it migrated `003_run_version.sql`
    // on open, so `runs.version` is there for the CAS loop the controls race against — and the
    // probe reads that schema rather than asserting a constant, which the case below proves
    // from the other side.
    let miss = store
        .get_run_versioned(RunId::new())
        .await
        .expect_err("the freshly minted id is not stored");
    assert!(
        matches!(miss, warsha_store::StoreError::RunNotFound(_)),
        "the column resolved, so the read is a lookup miss and not a schema error: {miss}"
    );

    let health = rpc.health(&owner).await.expect("health succeeds");
    assert!(health.capabilities.daemon);
    assert!(
        health.capabilities.run_controls,
        "a daemon whose store has the run-version column advertises the run-ending controls"
    );
}

/// Without the K2 run-version column the daemon says so: `run_controls` is false and every
/// other probed capability is untouched.
///
/// The pre-K2 schema is built for real rather than injected: the store migrates on open, so
/// after `test_state` the column is there and this test drops it, then re-reads the same
/// daemon through the same (real) probe. A probe that answered a constant `true` passes the
/// case above and fails this one.
#[tokio::test]
async fn health_reports_no_run_controls_without_the_version_column() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = tests::test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = tests::owner_ext();

    // Control: the same daemon on the same store, with `runs.version` in place, advertises them.
    let supported = rpc.health(&owner).await.expect("health succeeds");
    assert!(supported.capabilities.run_controls);

    sqlx::query("ALTER TABLE runs DROP COLUMN version")
        .execute(store.pool())
        .await
        .expect("the run-version column is dropped");

    let unsupported = state.probe_capabilities().await;
    assert!(
        !unsupported.run_controls,
        "a store without the run-version column cannot serve the controls"
    );
    // Only the run-controls answer changes: the other probes are unaffected by the schema.
    assert!(unsupported.daemon);
    assert_eq!(unsupported.providers, supported.capabilities.providers);
    assert_eq!(unsupported.keychain, supported.capabilities.keychain);
}

/// A daemon that cannot read its store at all does not advertise the controls either.
///
/// This is the default path (`probe_capabilities`, the real probe, a real pool), so a constant
/// `true` in place of the probe fails here: `run_controls` short-circuits on `daemon`.
#[tokio::test]
async fn health_reports_no_run_controls_when_the_store_cannot_answer() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = tests::test_state(temp.path()).await;
    store.pool().close().await;

    let caps = state.probe_capabilities().await;
    assert!(!caps.daemon, "a closed pool is not a reachable store");
    assert!(
        !caps.run_controls,
        "a daemon that cannot read its store does not advertise run-ending controls"
    );
}

/// A payload written before the field existed decodes with `run_controls == false`, and the
/// answer serialises the field from then on — the wire stays additive (R-UI-2 D1).
#[test]
fn health_decodes_an_old_payload_with_run_controls_defaulting_to_false() {
    let old = r#"{"daemon":true,"providers":true,"keychain":true}"#;
    let caps: HealthCapabilities = serde_json::from_str(old).expect("an older payload decodes");
    assert!(!caps.run_controls);
    assert!(caps.daemon && caps.providers && caps.keychain);

    let encoded = serde_json::to_string(&caps).expect("capabilities serialise");
    assert!(
        encoded.contains("\"run_controls\":false"),
        "the current daemon states the field instead of omitting it: {encoded}"
    );
    let round_trip: HealthCapabilities =
        serde_json::from_str(&encoded).expect("its own payload decodes");
    assert_eq!(round_trip, caps);
}

#[tokio::test]
async fn http_health_reports_monotonic_uptime_growth() {
    use axum::extract::ConnectInfo;
    use tower::ServiceExt;

    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = tests::test_state(temp.path()).await;
    let app = http_app(state.clone());

    let make_req = || {
        let mut req = axum::http::Request::builder()
            .uri("/health")
            .body(axum::body::Body::empty())
            .expect("valid request");
        req.extensions_mut()
            .insert(ConnectInfo(std::net::SocketAddr::from((
                [127, 0, 0, 1],
                40_000,
            ))));
        req
    };

    let res1 = app.clone().oneshot(make_req()).await.expect("app responds");
    let bytes1 = axum::body::to_bytes(res1.into_body(), usize::MAX)
        .await
        .expect("collect body");
    let health1: HealthResponse =
        serde_json::from_slice(&bytes1).expect("deserialize health response");
    let t1 = health1.uptime_seconds;

    // Time passes: at least 1.1s
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

    let res2 = app.clone().oneshot(make_req()).await.expect("app responds");
    let bytes2 = axum::body::to_bytes(res2.into_body(), usize::MAX)
        .await
        .expect("collect body");
    let health2: HealthResponse =
        serde_json::from_slice(&bytes2).expect("deserialize health response");
    let t2 = health2.uptime_seconds;

    assert!(
        t2 > 0,
        "uptime must be > 0 after time passes (observed {t2})"
    );
    assert!(t2 > t1, "uptime must grow monotonically: t1={t1}, t2={t2}");
}

#[tokio::test]
async fn rpc_health_reports_truthful_uptime_from_state_start_time() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = tests::test_state(temp.path()).await;
    let owner = tests::owner_ext();

    let rpc1 = WarshaRpc::new(state.clone());
    let h1 = rpc1.health(&owner).await.expect("health succeeds");

    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

    // Creating a fresh WarshaRpc must NOT reset the daemon uptime
    let rpc2 = WarshaRpc::new(state.clone());
    let h2 = rpc2.health(&owner).await.expect("health succeeds");

    assert!(
        h2.uptime_seconds > 0,
        "RPC uptime must be > 0 after 1s (got {})",
        h2.uptime_seconds
    );
    assert!(
        h2.uptime_seconds > h1.uptime_seconds,
        "RPC uptime must grow monotonically: h1={}, h2={}",
        h1.uptime_seconds,
        h2.uptime_seconds
    );
}

#[derive(Debug)]
struct HungSecretStore;

#[async_trait]
impl SecretStore for HungSecretStore {
    async fn store(&self, _account: &str, _key: &str) -> warsha_providers::Result<()> {
        futures::future::pending().await
    }

    async fn load(&self, _account: &str) -> warsha_providers::Result<String> {
        futures::future::pending().await
    }

    async fn delete(&self, _account: &str) -> warsha_providers::Result<()> {
        futures::future::pending().await
    }
}

fn state_with_secret_store(state: &Arc<DaemonState>, secrets: Arc<dyn SecretStore>) -> DaemonState {
    DaemonState {
        config: state.config.clone(),
        store: state.store.clone(),
        providers: state.providers.clone(),
        pipeline: state.pipeline.clone(),
        backends: Vec::new(),
        github: None,
        devices: state.devices.clone(),
        backend_kits: state.backend_kits.clone(),
        crash_reports: state.crash_reports.clone(),
        store_reviews: state.store_reviews.clone(),
        agent_loop: state.agent_loop.clone(),
        mcp_permissions: state.mcp_permissions.clone(),
        mcp_approvals: state.mcp_approvals.clone(),
        run_worktrees: state.run_worktrees.clone(),
        agent_sessions: state.agent_sessions.clone(),
        processes: state.processes.clone(),
        mcp: state.mcp.clone(),
        previews: state.previews.clone(),
        settings: state.settings.clone(),
        run_modes: state.run_modes.clone(),
        preferences: state.preferences.clone(),
        stored_preferences: state.stored_preferences.clone(),
        pairings: state.pairings.clone(),
        secrets,
        routines: state.routines.clone(),
        routine_scheduler: state.routine_scheduler.clone(),
        sessions: state.sessions.clone(),
        rates: state.rates.clone(),
        role_routings: state.role_routings.clone(),
        provider_factory: state.provider_factory.clone(),
        pairing_origin: std::sync::OnceLock::new(),
        events: state.events.clone(),
        start_time: state.start_time,
    }
}

#[tokio::test]
async fn probe_capabilities_reports_keychain_false_promptly_against_hung_store() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = tests::test_state(temp.path()).await;
    let hung_state = state_with_secret_store(&state, Arc::new(HungSecretStore));
    let owner = tests::owner_ext();
    let rpc = WarshaRpc::new(Arc::new(hung_state));

    let start = std::time::Instant::now();
    let health = rpc
        .health(&owner)
        .await
        .expect("health probe succeeds even when keychain hangs");
    let elapsed = start.elapsed();

    assert!(health.capabilities.daemon);
    assert!(
        !health.capabilities.keychain,
        "hung keychain must report keychain: false"
    );
    assert!(
        elapsed < std::time::Duration::from_secs(5),
        "health probe must return promptly within timeout, elapsed {elapsed:?}"
    );
}

#[tokio::test]
async fn provider_add_keychain_failure_returns_fast_without_wedging() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = tests::test_state(temp.path()).await;
    let hung_state = state_with_secret_store(&state, Arc::new(HungSecretStore));
    let owner = tests::owner_ext();
    let rpc = WarshaRpc::new(Arc::new(hung_state));

    let start = std::time::Instant::now();
    let result = rpc
        .add_provider(
            &owner,
            "hung-test-provider".to_string(),
            "custom".to_string(),
            "sk-test-canary-key".to_string(),
            Some("https://router.sayl.site/v1".to_string()),
        )
        .await;
    let elapsed = start.elapsed();

    // 1. Must fail fast around KEYCHAIN_TIMEOUT (2s)
    assert!(
        elapsed < std::time::Duration::from_secs(5),
        "add_provider must return promptly on hung keychain, elapsed {elapsed:?}"
    );

    // 2. Must return a provider_refusal naming the keychain timeout
    let err = result.expect_err("add_provider must fail when keychain hangs");
    let err_msg = err.to_string();
    assert!(
        err_msg.contains("OS keychain")
            && (err_msg.contains("timed out") || err_msg.contains("timeout")),
        "error must name keychain timeout: {err_msg}"
    );

    // 3. No row written to settings store
    let providers = rpc
        .state
        .settings
        .load_providers()
        .await
        .unwrap_or_default();
    assert!(
        !providers.iter().any(|p| p.name == "hung-test-provider"),
        "no row written when keychain times out"
    );

    // 4. Daemon remains responsive: health and list_providers still answer promptly
    let health = rpc.health(&owner).await;
    assert!(
        health.is_ok(),
        "daemon health must remain responsive after keychain failure"
    );

    let list = rpc.list_providers(&owner).await;
    assert!(
        list.is_ok(),
        "providers.list must remain responsive after keychain failure"
    );
}

#[tokio::test]
async fn provider_add_and_read_fallback_on_locked_keychain() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = tests::test_state(temp.path()).await;

    let fallback_store = Arc::new(
        warsha_providers::EncryptedFileSecretStore::new(temp.path())
            .expect("create fallback store"),
    );
    let fallback_secrets = Arc::new(
        warsha_providers::FallbackSecretStore::new(
            Arc::new(HungSecretStore),
            fallback_store.clone(),
        )
        .with_primary_timeout(std::time::Duration::from_millis(50)),
    );
    warsha_providers::set_fallback_store(fallback_store.clone());

    let state_with_fallback = state_with_secret_store(&state, fallback_secrets);
    let owner = tests::owner_ext();
    let rpc = WarshaRpc::new(Arc::new(state_with_fallback));

    let secret_key = "sk-fallback-test-canary-key-999";
    let start = std::time::Instant::now();
    let result = rpc
        .add_provider(
            &owner,
            "fallback-canary-provider".to_string(),
            "custom".to_string(),
            secret_key.to_string(),
            Some("https://router.sayl.site/v1".to_string()),
        )
        .await;
    let elapsed = start.elapsed();

    // 1. Must complete promptly without wedging
    assert!(
        elapsed < std::time::Duration::from_secs(3),
        "add_provider must complete promptly when falling back, elapsed {elapsed:?}"
    );
    assert!(result.is_ok(), "add_provider must succeed via fallback");

    // 2. Settings row and DeferredProvider registration completed
    let providers = rpc
        .state
        .settings
        .load_providers()
        .await
        .unwrap_or_default();
    assert!(
        providers
            .iter()
            .any(|p| p.name == "fallback-canary-provider"),
        "provider row must be written to settings store"
    );

    // 3. Encrypted file exists and plaintext key is NOT in file
    let enc_file = temp.path().join("provider-secrets.enc.json");
    assert!(enc_file.exists(), "encrypted secrets file must exist");
    let file_content = std::fs::read_to_string(&enc_file).expect("read secrets file");
    assert!(
        !file_content.contains(secret_key),
        "plaintext key must NOT appear in encrypted file"
    );

    // 4. read-from-fallback: load succeeds from fallback despite hung primary keychain
    let loaded = rpc
        .state
        .secrets
        .load("fallback-canary-provider")
        .await
        .expect("load must succeed from fallback");
    assert_eq!(loaded, secret_key);

    // 5. providers.test path reads key without "could not be read from OS keychain" error
    let test_res = rpc
        .test_provider(&owner, "fallback-canary-provider".to_string(), None)
        .await;
    // test_provider may fail at probe_endpoint (no mock server running), but must NOT fail at key read
    if let Err(err) = test_res {
        let msg = err.to_string();
        assert!(
            !msg.contains("could not be read from the OS keychain"),
            "test_provider must not fail at key read: {msg}"
        );
    }

    // 6. delete semantics: delete removes from fallback, second delete is idempotent
    let del_res = rpc
        .remove_provider(&owner, "fallback-canary-provider".to_string())
        .await;
    assert!(del_res.is_ok(), "remove_provider succeeds");

    let del_loaded = rpc.state.secrets.load("fallback-canary-provider").await;
    assert!(del_loaded.is_err(), "key must be gone after delete");

    warsha_providers::clear_fallback_store();
}
