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
