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
