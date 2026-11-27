use super::*;
use warsha_providers::{InMemorySecretStore, OneClickProvider};

#[cfg(unix)]
mod clean1_swarm;
mod project_source;

#[test]
fn the_default_backend_kit_comes_from_the_run_project() {
    let kit = default_backend_kit("Shop");

    assert_eq!(kit.config.kind, BackendKind::PocketBase);
    assert_eq!(kit.config.url, LOCAL_POCKETBASE_URL);
    // The project name, not the run id, names the export and its archive.
    assert_eq!(kit.config.project_name, "Shop");
    assert!(kit.config.enabled_features.is_empty());
    assert!(kit.is_empty());
    assert!(kit.export().sql_dump.contains("-- project: Shop"));
}

#[tokio::test]
async fn test_config_generation() {
    let temp_dir = crate::test_util::fresh_tempdir();
    let config_path = temp_dir.path().join("config.toml");

    let config = DaemonConfig {
        data_dir: temp_dir.path().to_path_buf(),
        auth_token: "test-token".to_string(),
        ..Default::default()
    };

    let content = toml::to_string_pretty(&config).unwrap();
    std::fs::write(&config_path, content).unwrap();

    let loaded: DaemonConfig =
        toml::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
    assert_eq!(loaded.auth_token, "test-token");
}

/// A daemon state over a temporary store, plus the store so a test can write
/// the project and run the RPC reads.
pub(super) async fn test_state(data_dir: &Path) -> (Arc<DaemonState>, Arc<Store>) {
    test_state_with(data_dir, |_| {}).await
}

/// The same state with a configuration the test names.
///
/// `configure` runs before the sessions and the ceilings are built from the
/// configuration, so a test that wants a command allowed by the process policy or
/// a bucket small enough to overflow in one loop gets exactly that.
async fn test_state_with(
    data_dir: &Path,
    configure: impl FnOnce(&mut DaemonConfig),
) -> (Arc<DaemonState>, Arc<Store>) {
    test_state_custom(data_dir, configure, None).await
}

async fn test_state_with_custom_settings(
    data_dir: &Path,
    settings: Arc<SettingsStore>,
) -> (Arc<DaemonState>, Arc<Store>) {
    test_state_custom(data_dir, |_| {}, Some(settings)).await
}

async fn test_state_custom(
    data_dir: &Path,
    configure: impl FnOnce(&mut DaemonConfig),
    custom_settings: Option<Arc<SettingsStore>>,
) -> (Arc<DaemonState>, Arc<Store>) {
    test_state_with_seams(data_dir, configure, custom_settings, None, None).await
}

/// The same state with the two seams a repair test has to observe replaced.
///
/// `secrets` is what lets a test count keychain reads — R-KEEL row 5 says the
/// refusal of a foreign account must happen *before* that account is read, which
/// no observable state proves on its own — and `mcp` is what lets a test count
/// transport calls, which is how row 6 proves a refused RPC never reached one.
/// Both default to the real test doubles.
pub(super) async fn test_state_with_seams(
    data_dir: &Path,
    configure: impl FnOnce(&mut DaemonConfig),
    custom_settings: Option<Arc<SettingsStore>>,
    secrets: Option<Arc<dyn SecretStore>>,
    mcp: Option<Arc<dyn McpManager>>,
) -> (Arc<DaemonState>, Arc<Store>) {
    test_state_with_all_seams(data_dir, configure, custom_settings, secrets, mcp, None).await
}

pub(super) async fn test_state_with_router(
    data_dir: &Path,
    router: ProviderRouter,
) -> (Arc<DaemonState>, Arc<Store>) {
    test_state_with_all_seams(
        data_dir,
        |_| {},
        None,
        None,
        None,
        Some(Arc::new(RwLock::new(router))),
    )
    .await
}

pub(super) async fn test_state_with_all_seams(
    data_dir: &Path,
    configure: impl FnOnce(&mut DaemonConfig),
    custom_settings: Option<Arc<SettingsStore>>,
    secrets: Option<Arc<dyn SecretStore>>,
    mcp: Option<Arc<dyn McpManager>>,
    custom_providers: Option<Arc<RwLock<ProviderRouter>>>,
) -> (Arc<DaemonState>, Arc<Store>) {
    std::fs::create_dir_all(data_dir).expect("the data directory is made");
    let mut config = DaemonConfig {
        data_dir: data_dir.to_path_buf(),
        auth_token: "test-token".to_string(),
        ..Default::default()
    };
    configure(&mut config);
    let store = Arc::new(
        Store::open_at(data_dir.join("warsha.db"))
            .await
            .expect("the store opens"),
    );
    store
        .recover_interrupted_runs()
        .await
        .expect("interrupted runs recover");
    let providers =
        custom_providers.unwrap_or_else(|| Arc::new(RwLock::new(agent_router_with_mock())));
    let settings = match custom_settings {
        Some(s) => s,
        None => {
            let s = Arc::new(
                SettingsStore::open(&data_dir.join("warsha.db"))
                    .await
                    .expect("the settings open"),
            );
            // The same seeding a real start performs, so a test's daemon answers
            // `harness.list` with the presets it ships and a catalog write has the row
            // under it that production would have.
            wave2::seed_bundled_records(&s)
                .await
                .expect("the bundled catalogs seed");
            s
        }
    };
    let mut pipeline =
        warsha_pipeline::PipelineEngine::new(store.clone(), providers.clone(), settings.clone());

    // The wiring side owns the environment selection: the pipeline never reads
    // `WARSHA_CODING_BACKEND` or names a backend, it only accepts an injected one.
    if let Some(backend) = BackendFactory::from_env() {
        pipeline = pipeline.with_coding_backend(Arc::from(backend));
    }
    let pipeline = Arc::new(pipeline);
    // The same reload a real start performs: the local identity is minted for
    // this process, and every phone already paired into this data dir comes back
    // with it. A test that rebuilds state over the same directory is a restart.
    let devices = Arc::new(
        crate::startup::load_device_registry(&store)
            .await
            .expect("paired devices reload"),
    );
    let identity = devices.local_identity().clone();

    let routines = Arc::new(RwLock::new(RoutineRegistry::new()));
    #[derive(Debug, Default)]
    struct TestRoutineRunner;
    impl RoutineRunner for TestRoutineRunner {
        fn run(
            &self,
            _routine: &Routine,
        ) -> std::result::Result<(), warsha_pipeline::RoutineError> {
            Ok(())
        }
    }
    let routine_runner: Arc<dyn RoutineRunner + Send + Sync> = Arc::new(TestRoutineRunner);
    let routine_scheduler = Arc::new(RoutineScheduler::new(routines.clone(), routine_runner));

    // A hand-built state carries the same session and ceiling wiring a real one
    // does: the daemon's own token is the owner session and speaks as the daemon's
    // device, which is exactly the desktop's situation.
    let sessions = Arc::new(Sessions::new(config.auth_token.clone(), identity.device_id));
    let rates = Arc::new(RateGovernor::new(&config.rate_limits));

    // One spawner for the daemon: the MCP stdio transport starts its server
    // through it and the live preview runs its dev server on it, so `process.list`
    // is the one place that names every child. It carries the configured
    // allow-list, so a restart re-checks the program the RPC edges admitted.
    let processes: Arc<dyn ProcessManager> = InMemoryProcessManager::shared_with_policy(
        CommandPolicy::from_config(&config.allowed_commands),
    );
    let mcp: Arc<dyn McpManager> = match mcp {
        Some(mcp) => mcp,
        None => Arc::new(InMemoryMcpManager::new(processes.clone())),
    };
    let previews = Arc::new(
        LivePreviewManager::new(processes.clone()).with_run_liveness(Arc::new(StoreRunLiveness {
            store: store.clone(),
        })),
    );

    // The agent loop's two seams, wired to the real thing: its file tools run
    // inside `<data_dir>/workspace`, and its model calls go out through the same
    // router the pipeline stages use — a router that now holds the configured
    // providers and the owner's routing, so an Agent-mode turn reaches a model
    // rather than reporting that nothing is wired.
    let default_kit = Arc::new(RwLock::new(default_backend_kit("default")));
    let mcp_permissions = Arc::new(StaticPermissions::new());
    // The same registry a real start builds, over the same daemon summarizer, so
    // a test drives the redaction and the audit trail production runs.
    let mcp_approvals = Arc::new(McpApprovals::new(Some(Box::new(
        mcp_approvals::DaemonSummarizer::new(config.auth_token.clone()),
    ))));
    let agent_loop = build_agent_loop(
        &config.data_dir,
        &config.allowed_commands,
        providers.clone(),
        mcp.clone(),
        mcp_permissions.clone(),
        mcp_approvals.clone(),
        default_kit,
    );

    let state = Arc::new(DaemonState {
        config,
        store: store.clone(),
        providers,
        pipeline,
        backends: BackendFactory::all_available(),
        github: None,
        devices,
        backend_kits: Arc::new(RwLock::new(HashMap::new())),
        crash_reports: Arc::new(RwLock::new(InMemoryCrashReportStore::new())),
        store_reviews: Arc::new(RwLock::new(InMemoryStoreReviewStore::new())),
        agent_loop,
        mcp_permissions,
        mcp_approvals,
        run_worktrees: Arc::new(RwLock::new(HashMap::new())),
        agent_sessions: Arc::new(RunAgentSessions::new()),
        processes,
        mcp,
        previews,
        settings,
        // The seeded maps are what `start_daemon` builds; a state built by hand
        // starts from the defaults and no rows, which is the same shape.
        run_modes: Arc::new(RwLock::new(
            RunMode::all()
                .into_iter()
                .map(|mode| (mode, RunModeConfig::for_mode(mode)))
                .collect(),
        )),
        preferences: Arc::new(RwLock::new(InMemoryPreferenceStore::new())),
        stored_preferences: Arc::new(RwLock::new(HashMap::new())),
        pairings: Arc::new(RwLock::new(InMemoryPairingStore::new())),
        // A state built by hand is a state under test: no OS keychain is
        // reached, and a test that adds a provider can read its key back.
        secrets: secrets.unwrap_or_else(|| Arc::new(InMemorySecretStore::new())),
        routines,
        routine_scheduler,
        sessions,
        rates,
        // The offline factory and no routing: a hand-built state is a state under
        // test, and a test that wants a routing sets one through `roles.set`.
        role_routings: Arc::new(RwLock::new(HashMap::new())),
        provider_factory: Arc::new(MockProviderFactory::new()),
        // No listener has bound: a hand-built state is a daemon that is not serving,
        // and `devices.pair-start` refuses rather than advertising a made-up origin.
        pairing_origin: std::sync::OnceLock::new(),
        // A hand-built state has no background pump, so this sequencer stays empty
        // unless a test publishes onto it directly; the live stream is exercised by
        // the real-daemon tests.
        events: Arc::new(EventSequencer::new()),
        start_time: std::time::Instant::now(),
        intake_tasks: Arc::new(std::sync::Mutex::new(Vec::new())),
    });
    (state, store)
}

/// The request extensions a verified **owner** session arrives with.
///
/// This is what the daemon's transport puts on a request after it checked the
/// bearer credential, so a test that calls an RPC with these extensions is in the
/// same position as the desktop app holding the daemon's own token.
pub(super) fn owner_ext() -> RpcExtensions {
    owner_ext_as(DeviceId::new())
}

/// The owner session speaking as a particular device, so a test can name the
/// approver it expects to be recorded.
fn owner_ext_as(device_id: DeviceId) -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(Actor::owner(device_id));
    ext
}

/// The extensions a **paired device** session arrives with.
fn paired_ext(device_id: &str) -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(Actor::paired(&PhonePairing::new(
        device_id,
        "a-pairing-secret",
        1_700_000_000,
    )));
    ext
}

/// Put a pairing in the daemon's store so a paired session is live, not stale.
///
/// `authorize` re-reads the store on every request (PAIR research finding 2), so a
/// test that expects a paired method to succeed has to represent a real pairing.
async fn seed_pairing(state: &DaemonState, device_id: &str) {
    state
        .pairings
        .write()
        .await
        .create_with_expiry(device_id, "a-pairing-secret", 1_700_000_000, None)
        .expect("the test pairing is recorded once");
}

/// The extensions of a request that never authenticated: an empty map, because
/// nothing but the transport can put an actor in one.
fn anonymous_ext() -> RpcExtensions {
    RpcExtensions::new()
}

/// The `code` of a JSON-RPC error, for asserting *which* refusal a caller got.
fn rpc_error_code(error: &jsonrpsee::types::ErrorObjectOwned) -> i32 {
    error.code()
}

/// A run whose own loop the owner approved over the wire, for the per-run turn tests.
///
/// `agent.turn` — the daemon-wide conversation — is retired (OD-E2), so a turn is
/// a run's own loop. `runs.start` builds that loop in Plan mode, and OD-E2b is the
/// wire path out of it: `agent.approve_mode` with the run's id moves the loop the
/// run's next turn executes on. The workspace is the one the run got: it names no
/// repository, so it is the daemon's agent workspace.
async fn approved_agent_run(state: &Arc<DaemonState>, store: &Arc<Store>) -> RunId {
    let project = Project {
        id: ProjectId::new(),
        name: "Agent Turn Project".to_string(),
        description: "Test".to_string(),
        language: "en".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        ..Default::default()
    };
    store.create_project(&project).await.expect("the project");
    let rpc = WarshaRpc::new(state.clone());
    let run = rpc
        .start_run(
            &owner_ext(),
            project.id,
            "An agent turn".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("the run starts");
    rpc.approve_agent_mode(&owner_ext(), Some(run.id))
        .await
        .expect("the owner approves the run's loop");
    run.id
}

/// The loop `runs.start` gives a run with no repository: the daemon's agent
/// workspace, the configured command policy, and the daemon's router and MCP seams.
fn agent_loop_for_run(state: &DaemonState) -> AgentLoop {
    build_agent_loop_in(
        &state.config.data_dir.join(AGENT_WORKSPACE_DIR),
        &state.config.allowed_commands,
        state.providers.clone(),
        state.mcp.clone(),
        state.mcp_permissions.clone(),
        state.mcp_approvals.clone(),
        None,
        Arc::new(RwLock::new(default_backend_kit("run"))),
        None,
    )
}

/// A program the process floor can actually start.
///
/// A child now starts with a cleared environment and the fixed minimal PATH,
/// so a test that wants a program to *start* cannot rely on `cargo` being
/// found. A program inside the daemon's data directory needs no lookup — it
/// is the daemon's own scope — and runs on every OS: a shell script on Unix
/// and, on Windows, a copy of this test binary run with `--list` so it lists
/// and exits instead of running the suite again.
fn fixture_program(data_dir: &Path) -> String {
    #[cfg(windows)]
    {
        let target = data_dir.join("fixture-probe.exe");
        std::fs::copy(
            std::env::current_exe().expect("the test binary names itself"),
            &target,
        )
        .expect("the fixture copies");
        target.to_string_lossy().into_owned()
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let target = data_dir.join("fixture-probe.sh");
        std::fs::write(&target, "#!/bin/sh\necho fixture-ok\n").expect("the fixture writes");
        let mut permissions = std::fs::metadata(&target)
            .expect("the fixture exists")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&target, permissions).expect("the fixture is executable");
        target.to_string_lossy().into_owned()
    }
}

// ---- Security audit S1a: identity, authorization and the policy floor.

/// Every method the server registers has a policy, and every policy names a
/// method the server registers.
///
/// This is the check that the authorization table is the whole surface rather than
/// a list of the methods someone remembered: an RPC added later without an entry
/// fails here instead of shipping unauthenticated-by-omission.
#[tokio::test]
async fn every_registered_method_has_a_policy_and_no_policy_names_a_missing_one() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let module = WarshaRpc::new(state).into_rpc();

    let registered: std::collections::BTreeSet<&str> = module.method_names().collect();
    let table: std::collections::BTreeSet<&str> = auth::METHOD_POLICIES
        .iter()
        .map(|entry| entry.method)
        .collect();

    let unpoliced: Vec<&str> = registered.difference(&table).copied().collect();
    assert!(
        unpoliced.is_empty(),
        "methods the daemon serves with no entry in the policy table: {unpoliced:?}"
    );
    let unknown: Vec<&str> = table.difference(&registered).copied().collect();
    assert!(
        unknown.is_empty(),
        "the policy table names methods the daemon does not serve: {unknown:?}"
    );

    // The structural half of re-audit LOAD-1 finding 1. A method that is not handed
    // its caller cannot reach `authorize()`, and a `Tier` nobody spends is a ceiling
    // on paper — that is exactly how 24 read methods ended up bounded only by the
    // transport. Scanning the declarations is the check that keeps a new method from
    // joining that set by accident, which is what the behaviour tests below cannot see
    // until someone remembers to write one. The path is one directory up since A10 moved
    // this module to `tests/mod.rs`; the scanned file and the assertion are unchanged.
    let source = include_str!("../api.rs");
    let trait_body = source
        .split("pub trait WarshaApi {")
        .nth(1)
        .expect("the RPC trait is declared")
        .split("\n}")
        .next()
        .expect("the RPC trait has an end");
    let declared: Vec<&str> = trait_body
        .lines()
        .filter(|line| line.trim_start().starts_with("#[method(name ="))
        .collect();
    let without_session: Vec<&&str> = declared
        .iter()
        .filter(|line| !line.contains("with_extensions"))
        .collect();
    assert!(
        without_session.is_empty(),
        "methods declared without `with_extensions`, so their handlers cannot see the \
         caller and cannot spend their tier: {without_session:?}"
    );
    assert_eq!(
        declared.len(),
        auth::METHOD_POLICIES.len(),
        "the trait declares {} methods and the policy table names {}",
        declared.len(),
        auth::METHOD_POLICIES.len()
    );
}

#[tokio::test]
async fn an_authorized_method_refuses_no_session_and_a_paired_device_differently() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let project = ProjectId::new();

    // No verified session: the caller is nobody.
    let no_session = rpc
        .set_budget(&anonymous_ext(), project, 500)
        .await
        .expect_err("a caller with no session set a budget");
    assert_eq!(
        rpc_error_code(&no_session),
        auth::rpc_codes::UNAUTHENTICATED,
        "an unauthenticated caller got the wrong refusal"
    );

    // A verified session that is not the owner: somebody, but not that.
    let phone = uuid::Uuid::new_v4().to_string();
    let paired = rpc
        .set_budget(&paired_ext(&phone), project, 500)
        .await
        .expect_err("a paired device set a budget");
    assert_eq!(
        rpc_error_code(&paired),
        auth::rpc_codes::FORBIDDEN,
        "a paired device was allowed an owner's mutation"
    );

    // The same refusal shape on the other privileged surfaces.
    for (method, result) in [
        (
            "roles.set",
            rpc.set_role(&paired_ext(&phone), role_config())
                .await
                .map(|_| ()),
        ),
        (
            "backend.set",
            rpc.set_backend(
                &paired_ext(&phone),
                "run".to_string(),
                default_backend_kit("Shop"),
            )
            .await
            .map(|_| ()),
        ),
    ] {
        let error = result.expect_err(&format!("{method} accepted a paired device"));
        assert_eq!(
            rpc_error_code(&error),
            auth::rpc_codes::FORBIDDEN,
            "{method} refused a paired device for the wrong reason"
        );
    }
}

// ---- Audit H1/H2: the pairing credential's lifecycle.

/// A pairing a phone could present, with the offer's 10-minute expiry.
fn fresh_pairing_data() -> warsha_remote::PairingData {
    let device =
        warsha_remote::DeviceIdentity::generate("phone".to_string()).expect("a device identity");
    warsha_remote::PairingData::new(&device, None).expect("a pairing")
}

/// The same record with a deadline the caller names.
fn pairing_data_expiring_at(expires_at: chrono::DateTime<Utc>) -> warsha_remote::PairingData {
    warsha_remote::PairingData {
        expires_at,
        ..fresh_pairing_data()
    }
}

/// Audit H2 / test 3: enrolment is the owner's act. A paired actor gets the same
/// `-32002` any paired device gets for an owner method, and the CLI's path — the
/// owner token from `config.toml` — still pairs a phone.
#[tokio::test]
async fn devices_pair_refuses_a_paired_actor_and_the_owner_still_pairs() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());

    let data = fresh_pairing_data();
    let secret = data.secret_token();
    let device_id = data.device_id;
    let phone = uuid::Uuid::new_v4().to_string();

    let refused = rpc
        .pair_device(&paired_ext(&phone), data.clone())
        .await
        .expect_err("a paired device enrolled another device");
    assert_eq!(
        rpc_error_code(&refused),
        auth::rpc_codes::FORBIDDEN,
        "a paired device was refused enrolment for a reason other than the owner gate"
    );
    assert!(
        state.pairings.read().await.is_empty(),
        "the refused enrolment still wrote a pairing"
    );
    assert!(
        !state
            .devices
            .list_devices()
            .await
            .iter()
            .any(|device| device.device_id == device_id),
        "the refused enrolment still wrote a device row"
    );

    rpc.pair_device(&owner_ext(), data)
        .await
        .expect("the owner's `warsha pair` path was refused");
    let rows = state.pairings.read().await.list();
    let actor = state
        .sessions
        .resolve_at(&secret, &rows, now_epoch_secs())
        .expect("the owner's pairing does not authenticate");
    assert_eq!(actor.role(), auth::ActorRole::Paired);
}

/// Audit H1 / test 4: an expired offer is refused before anything is written, so a
/// stale QR leaves no device and no credential behind.
#[tokio::test]
async fn devices_pair_refuses_expired_pairing_data_without_writing_anything() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());

    let expired = pairing_data_expiring_at(Utc::now() - chrono::Duration::minutes(1));
    let device_id = expired.device_id;
    let error = rpc
        .pair_device(&owner_ext(), expired)
        .await
        .expect_err("an expired pairing was redeemed");
    assert_eq!(rpc_error_code(&error), -32000);
    assert!(
        error.message().contains("expired"),
        "the refusal does not say the pairing expired: {error}"
    );
    assert!(state.pairings.read().await.is_empty());
    assert!(
        !state
            .devices
            .list_devices()
            .await
            .iter()
            .any(|device| device.device_id == device_id),
        "the refused pairing wrote a device row"
    );
    assert!(
        state
            .settings
            .load_pairings()
            .await
            .expect("the stored pairings are readable")
            .is_empty(),
        "the refused pairing was persisted"
    );
}

/// Audit H1 / test 5: `devices.pair-start` writes the offer's deadline beside the
/// secret, and the persisted record stops resolving at that instant.
#[tokio::test]
async fn start_pairing_persists_the_offer_expiry_and_the_secret_dies_with_it() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());
    state
        .pairing_origin
        .set("http://127.0.0.1:9000".to_string())
        .expect("the pairing origin is set once");

    let offer = rpc
        .start_pairing(&owner_ext())
        .await
        .expect("the daemon minted a pairing");
    let expiry = u64::try_from(offer.expires_at().timestamp()).expect("the expiry is positive");
    let secret = offer.pairing.secret_token();
    let device_id = offer.pairing.device_id.to_string();

    let persisted = state
        .settings
        .load_pairings()
        .await
        .expect("the stored pairings are readable");
    let row = persisted
        .get(&device_id)
        .expect("the minted pairing was not persisted");
    assert_eq!(
        row.expires_at,
        Some(expiry),
        "the stored deadline is not the offer's"
    );
    assert!(row.is_active_at(expiry - 1));
    assert!(!row.is_active_at(expiry));

    let rows = persisted.list();
    assert!(
        state.sessions.resolve_at(&secret, &rows, expiry).is_none(),
        "the stored secret still resolved at its deadline"
    );
    assert!(
        state
            .sessions
            .resolve_at(&secret, &rows, expiry - 1)
            .is_some(),
        "the stored secret did not resolve inside its window"
    );
}

/// Audit H1 / test 7: revocation still takes effect on the next request; the
/// expiry check must not have replaced it.
#[tokio::test]
async fn revoke_device_still_removes_access_on_the_next_request() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());

    let data = fresh_pairing_data();
    let secret = data.secret_token();
    let device_id = data.device_id;
    rpc.pair_device(&owner_ext(), data)
        .await
        .expect("the owner paired a phone");
    assert_eq!(
        state
            .sessions
            .resolve_at(&secret, &state.active_pairings().await, now_epoch_secs())
            .map(|actor| actor.role()),
        Some(auth::ActorRole::Paired),
        "the paired secret did not authenticate before revocation"
    );

    rpc.revoke_device(&owner_ext(), device_id)
        .await
        .expect("the device is revoked");
    assert!(
        state
            .sessions
            .resolve_at(&secret, &state.active_pairings().await, now_epoch_secs())
            .is_none(),
        "a revoked pairing still authenticated on the next request"
    );
}

/// Owner UI finding #6: a paired device is a row, not a memory entry. Dropping
/// the daemon and rebuilding its state from the same data dir is a restart, and
/// `devices.list` still names the phone — plus the local server device this
/// process minted, which is not itself a row.
#[tokio::test]
async fn paired_device_survives_rebuilding_daemon_state_from_the_same_data_dir() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);

    let data = fresh_pairing_data();
    let device_id = data.device_id;
    let public_key = data.static_public;
    rpc.pair_device(&owner_ext(), data)
        .await
        .expect("the owner paired a phone");
    drop(rpc);

    let (restarted, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(restarted);
    let listed = rpc
        .list_devices(&owner_ext())
        .await
        .expect("devices.list answers after a restart");

    let paired = listed
        .iter()
        .find(|device| device.device_id == device_id)
        .expect("the paired device is missing after a restart");
    assert_eq!(paired.name, "Paired Device");
    assert_eq!(paired.static_public, public_key);
    assert!(!paired.revoked);
    assert!(
        listed.iter().any(|device| device.name == "Warsha Daemon"),
        "the internal server device is no longer listed"
    );
    assert!(listed.len() >= 2, "devices.list returned only {listed:?}");
}

#[tokio::test]
async fn local_daemon_identity_is_stable_across_restarts() {
    let temp = crate::test_util::fresh_tempdir();
    let (state1, _store) = test_state(temp.path()).await;
    let initial_device_id = state1.devices.local_identity().device_id;
    let initial_pubkey = state1.devices.local_identity().static_public;
    drop(state1);

    // Restart daemon from the exact same data directory
    let (state2, _store) = test_state(temp.path()).await;
    let restarted_device_id = state2.devices.local_identity().device_id;
    let restarted_pubkey = state2.devices.local_identity().static_public;

    assert_eq!(
        initial_device_id, restarted_device_id,
        "local daemon identity device_id must be stable across restarts"
    );
    assert_eq!(
        initial_pubkey, restarted_pubkey,
        "local daemon identity public key must be stable across restarts"
    );
}

#[tokio::test]
async fn daemon_startup_survives_undecodable_device_row() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;
    drop(state);

    // Insert corrupt row into devices table (16-byte public_key instead of 32-byte)
    sqlx::query(
        "INSERT INTO devices (id, name, public_key, paired_at, revoked, revoked_at) \
         VALUES (?, ?, ?, ?, 0, NULL)",
    )
    .bind(uuid::Uuid::new_v4().as_bytes().as_slice())
    .bind("Corrupt Phone")
    .bind(&[9u8; 16][..])
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(store.pool())
    .await
    .unwrap();
    drop(store);

    // Daemon restarts without error and lists devices
    let (restarted, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(restarted);
    let listed = rpc
        .list_devices(&owner_ext())
        .await
        .expect("daemon startup and devices.list must succeed despite undecodable row");
    assert!(
        listed.iter().any(|d| d.name == "Warsha Daemon"),
        "daemon identity must still be listed"
    );
}

#[tokio::test]
async fn a_gate_decision_refuses_a_device_id_that_is_not_the_session() {
    // Audit H-03, at the seam: the legacy param is accepted, and a value that is
    // not the authenticated device is refused without touching the run.
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;
    let run = stored_run_with_gate(&store, "Shop").await;
    let rpc = WarshaRpc::new(state.clone());

    let session_device = DeviceId::new();
    let ext = owner_ext_as(session_device);
    let claimed = DeviceId::new();

    let error = rpc
        .approve_gate(&ext, run.id, Stage::GateA, Some(claimed))
        .await
        .expect_err("a spoofed approver was recorded");
    assert_eq!(
        rpc_error_code(&error),
        auth::rpc_codes::IDENTITY_MISMATCH,
        "a claimed device id was not refused as a mismatch"
    );

    let untouched = store.get_run(run.id).await.expect("the run is readable");
    assert!(
        matches!(untouched.gate_states[&Stage::GateA], GateState::Pending),
        "the refused decision still moved the gate"
    );

    // The session's own id, sent the old way, is accepted — and what is recorded is
    // the session's device either way.
    let approved = rpc
        .approve_gate(&ext, run.id, Stage::GateA, Some(session_device))
        .await
        .expect("the session's own device id is accepted");
    assert!(
        matches!(
            approved.gate_states[&Stage::GateA],
            GateState::Approved { by, .. } if by == session_device
        ),
        "the approver recorded is not the session's device"
    );

    let mut at_gate_b = store.get_run(run.id).await.expect("the run is readable");
    at_gate_b.current_stage = Stage::GateB;
    store
        .update_run(&at_gate_b)
        .await
        .expect("run reached GateB");

    let omitted = rpc
        .reject_gate(&ext, run.id, Stage::GateB, "not yet".to_string(), None)
        .await
        .expect("a decision with no legacy param is served");
    assert!(
        matches!(
            omitted.gate_states[&Stage::GateB],
            GateState::Rejected { by, .. } if by == session_device
        ),
        "a decision without the legacy field lost its decider"
    );
}

#[tokio::test]
async fn a_session_with_no_device_id_cannot_be_recorded_as_an_approver() {
    // A pairing whose id is not a device id is a real session for reads, and has no
    // approver to record: the daemon says so rather than storing an invented uuid.
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;
    let run = stored_run_with_gate(&store, "Shop").await;
    seed_pairing(&state, "a-phone-that-named-itself").await;
    let rpc = WarshaRpc::new(state);

    let error = rpc
        .approve_gate(
            &paired_ext("a-phone-that-named-itself"),
            run.id,
            Stage::GateA,
            None,
        )
        .await
        .expect_err("a session with no device id approved a gate");
    assert_eq!(
        rpc_error_code(&error),
        auth::rpc_codes::IDENTITY_MISMATCH,
        "an unrecordable approver was accepted"
    );
}

#[tokio::test]
async fn the_pipeline_refuses_a_gate_decision_for_no_device() {
    // The floor under the daemon (audit H-03): even a caller that reached the
    // pipeline directly cannot record the nil device as an approver.
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;
    let run = stored_run_with_gate(&store, "Shop").await;

    let nobody = DeviceId(uuid::Uuid::nil());
    let error = state
        .pipeline
        .approve_gate(run.id, Stage::GateA, nobody)
        .await
        .expect_err("a nil device approved a gate");
    assert!(
        error.to_string().contains("verified acting device"),
        "unexpected error: {error}"
    );
}

// ---- gates.list (issue #25): the queue read served from `Run.gate_states`.

#[tokio::test]
async fn gates_list_answers_every_gate_stage_in_pipeline_order() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;
    let run = stored_run_with_gate(&store, "Shop").await;
    let rpc = WarshaRpc::new(state);

    let gates = rpc
        .list_gates(&owner_ext(), run.id, None)
        .await
        .expect("the queue is served");
    let stages: Vec<Stage> = gates.iter().map(|gate| gate.stage).collect();
    assert_eq!(
        stages,
        vec![Stage::GateA, Stage::GateB, Stage::GateC, Stage::GateD],
        "the queue is not the four gate stages in `Stage::all()` order"
    );
    // The helper seeded `gate_a` and `gate_b` as explicit Pending entries and left
    // `gate_c`/`gate_d` out of the map: a missing key answers Pending, it is neither
    // a dropped row nor a refusal, and nothing is filtered out client-side here.
    for gate in &gates {
        assert_eq!(
            gate.state,
            GateSummaryState::Pending,
            "{:?} answered decided before anyone decided it",
            gate.stage
        );
    }

    // The ledger reads the same `Run.gate_states` the decisions mutate: approving
    // gate_a moves its answer on the next read, through the store.
    rpc.approve_gate(&owner_ext(), run.id, Stage::GateA, None)
        .await
        .expect("gate_a is approved");
    let after = rpc
        .list_gates(&owner_ext(), run.id, None)
        .await
        .expect("the queue is re-read");
    assert!(
        matches!(after[0].state, GateSummaryState::Approved { .. }),
        "a decision did not move the queue read: {after:?}"
    );
}

#[tokio::test]
async fn gates_list_answers_the_flat_state_shape_the_client_declares() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;
    let run = stored_run(&store, "Shop", None).await;
    let mut run = store.get_run(run.id).await.expect("the run is readable");
    let device = DeviceId(
        uuid::Uuid::parse_str("00000000-0000-0000-0000-00000000000a").expect("a fixed device id"),
    );
    let at = chrono::DateTime::parse_from_rfc3339("2026-11-03T09:30:00Z")
        .expect("a fixed instant")
        .with_timezone(&Utc);
    run.gate_states
        .insert(Stage::GateA, GateState::Approved { by: device, at });
    run.gate_states.insert(
        Stage::GateB,
        GateState::Rejected {
            reason: "not this".to_string(),
            by: device,
            at,
        },
    );
    run.gate_states.insert(
        Stage::GateC,
        GateState::ChangesRequested {
            notes: "tighten the brief".to_string(),
            by: device,
            at,
        },
    );
    // `gate_d` is deliberately absent: it must answer `{"state": "pending"}`.
    store.update_run(&run).await.expect("the states are stored");
    let rpc = WarshaRpc::new(state);

    let gates = rpc
        .list_gates(&owner_ext(), run.id, None)
        .await
        .expect("the queue is served");
    let wire = serde_json::to_value(&gates).expect("the queue serializes");
    // Literally the shape `@warsha/client` declares (`GateSummary`/`GateState` in
    // `packages/client/src/index.ts`): `by`, `at`, `reason` and `notes` sit beside
    // `state`, never under a `detail` object — `detail` is the adjacent-tagged
    // `runs.get` shape (`security_identity.rs` reads `approved["detail"]["by"]`),
    // and the queue must not fork it.
    assert_eq!(
        wire,
        serde_json::json!([
            {
                "stage": "gate_a",
                "state": {
                    "state": "approved",
                    "by": "00000000-0000-0000-0000-00000000000a",
                    "at": "2026-11-03T09:30:00Z"
                }
            },
            {
                "stage": "gate_b",
                "state": {
                    "state": "rejected",
                    "reason": "not this",
                    "by": "00000000-0000-0000-0000-00000000000a",
                    "at": "2026-11-03T09:30:00Z"
                }
            },
            {
                "stage": "gate_c",
                "state": {
                    "state": "changes_requested",
                    "notes": "tighten the brief",
                    "by": "00000000-0000-0000-0000-00000000000a",
                    "at": "2026-11-03T09:30:00Z"
                }
            },
            {
                "stage": "gate_d",
                "state": { "state": "pending" }
            }
        ])
    );
}

#[tokio::test]
async fn gates_list_refuses_a_run_the_store_does_not_have() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);

    let error = rpc
        .list_gates(&owner_ext(), RunId::new(), None)
        .await
        .expect_err("a run the store does not have answered a queue");
    assert_eq!(
        rpc_error_code(&error),
        -32000,
        "an unknown run was refused for a reason other than the store's error"
    );
    assert!(
        error.message().contains("run not found"),
        "unexpected refusal: {error}"
    );
}

#[tokio::test]
async fn the_gates_queue_reads_on_any_verified_session_and_refuses_without_one() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;
    let run = stored_run_with_gate(&store, "Shop").await;
    let rpc = WarshaRpc::new(state);

    // Unauthenticated reads nothing: `-32001` from `authorize`, before any tier.
    let anonymous = rpc
        .list_gates(&anonymous_ext(), run.id, None)
        .await
        .expect_err("an unauthenticated caller read the queue");
    assert_eq!(
        rpc_error_code(&anonymous),
        auth::rpc_codes::UNAUTHENTICATED,
        "a caller with no session read the gates queue"
    );

    // A paired phone reads the very queue it is asked to decide (#25's auth
    // decision: `Session`/`Standard`, the `runs.list` class, not `Auth`).
    let phone = uuid::Uuid::new_v4().to_string();
    seed_pairing(&rpc.state, &phone).await;
    let paired = rpc
        .list_gates(&paired_ext(&phone), run.id, None)
        .await
        .expect("a paired device was refused the queue it decides");
    assert_eq!(paired.len(), 4, "the queue is not all four gate stages");

    // The owner reads it too, and the legacy `device_id` slot is accepted and
    // believed for nothing: naming some other device changes no answer.
    let claimed = DeviceId::new();
    let owner = rpc
        .list_gates(&owner_ext(), run.id, Some(claimed))
        .await
        .expect("the owner was refused its own queue");
    assert_eq!(
        owner, paired,
        "a claimed device id changed what the queue read answered"
    );
}

#[tokio::test]
async fn gates_list_is_registered_and_policied_as_one_method() {
    // Registry==policy for the new name, in both views. The whole-set invariant is
    // `every_registered_method_has_a_policy_and_no_policy_names_a_missing_one`;
    // this pins `gates.list` by name so a one-sided addition fails at the name
    // rather than only at the count.
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let module = WarshaRpc::new(state).into_rpc();
    assert!(
        module.method_names().any(|name| name == "gates.list"),
        "the server does not register gates.list"
    );

    let policy = auth::policy_of("gates.list").expect("gates.list has a policy row");
    assert_eq!(policy.policy, Policy::Session);
    assert_eq!(policy.tier, Tier::Standard);
}

#[tokio::test]
async fn process_and_mcp_control_refuse_an_unlisted_program_and_a_remote_transport() {
    let temp = crate::test_util::fresh_tempdir();
    // Only the fixture program is admitted, by configuration rather than by a
    // caller.
    let fixture = fixture_program(temp.path());
    let allowed = fixture.clone();
    let (state, _store) = test_state_with(temp.path(), move |config| {
        config.allowed_commands = vec![allowed];
    })
    .await;
    let rpc = WarshaRpc::new(state);
    let ext = owner_ext();

    for (command, args) in [
        ("rm", vec!["-rf".to_string()]),
        ("sh", vec![]),
        ("npm", vec![]),
        ("", vec![]),
    ] {
        let error = rpc
            .spawn_process(&ext, command.to_string(), args, HashMap::new())
            .await
            .expect_err(&format!("`{command}` was started"));
        assert_eq!(
            rpc_error_code(&error),
            auth::rpc_codes::POLICY_REFUSED,
            "`{command}` was refused for a reason other than the policy"
        );
    }

    // An environment variable that changes execution is refused on its own.
    for key in ["PATH", "LD_PRELOAD", "NODE_OPTIONS"] {
        let mut env = HashMap::new();
        env.insert(key.to_string(), "/tmp".to_string());
        let error = rpc
            .spawn_process(&ext, "cargo".to_string(), vec![], env)
            .await
            .expect_err(&format!("{key} was handed to a child"));
        assert_eq!(
            rpc_error_code(&error),
            auth::rpc_codes::POLICY_REFUSED,
            "{key} reached a child process"
        );
    }

    // An allowed program is still startable: the policy restricts, it does not
    // disable the daemon's own workflow.
    let started = rpc
        .spawn_process(&ext, fixture, vec!["--list".to_string()], HashMap::new())
        .await
        .expect("an allowed program starts");
    rpc.stop_process(&ext, started).await.ok();

    // MCP transports: a stdio program is bounded like a spawn, and a remote one is
    // bounded to a secure or loopback endpoint.
    let unlisted =
        warsha_pipeline::mcp_transport::McpServerConfig::new_stdio("bad", "sh", Vec::new());
    let error = rpc
        .connect_mcp(&ext, unlisted)
        .await
        .expect_err("an unlisted stdio MCP server connected");
    assert_eq!(rpc_error_code(&error), auth::rpc_codes::POLICY_REFUSED);

    for url in [
        "http://evil.example/mcp",
        "file:///etc/passwd",
        "http://169.254.169.254/latest",
    ] {
        let error = rpc
            .connect_mcp(
                &ext,
                warsha_pipeline::mcp_transport::McpServerConfig::new_http("remote", url),
            )
            .await
            .expect_err(&format!("{url} was recorded"));
        assert_eq!(
            rpc_error_code(&error),
            auth::rpc_codes::POLICY_REFUSED,
            "{url} passed the transport policy"
        );
    }
    rpc.connect_mcp(
        &ext,
        warsha_pipeline::mcp_transport::McpServerConfig::new_http(
            "secure",
            "https://mcp.example/mcp",
        ),
    )
    .await
    .expect("an https MCP endpoint is allowed");
    rpc.connect_mcp(
        &ext,
        warsha_pipeline::mcp_transport::McpServerConfig::new_http(
            "local",
            "http://127.0.0.1:9100/mcp",
        ),
    )
    .await
    .expect("a loopback MCP endpoint is allowed");

    // None of it is reachable without the owner's role.
    let phone = uuid::Uuid::new_v4().to_string();
    let error = rpc
        .spawn_process(
            &paired_ext(&phone),
            "cargo".to_string(),
            vec![],
            HashMap::new(),
        )
        .await
        .expect_err("a paired device reached the process table");
    assert_eq!(rpc_error_code(&error), auth::rpc_codes::FORBIDDEN);
}

/// A role-routing config with no targets, for a test that only needs it to parse.
fn role_config() -> RoleRoutingConfig {
    RoleRoutingConfig {
        role: "coder".to_string(),
        targets: Vec::new(),
        fallback_enabled: false,
        budget_cents_per_run: None,
        daily_spend_cap_cents: None,
    }
}

/// A stored run sitting at pending GateA (with GateB also seeded Pending).
async fn stored_run_with_gate(store: &Arc<Store>, name: &str) -> Run {
    let run = stored_run(store, name, None).await;
    let mut run = store.get_run(run.id).await.expect("the run is readable");
    run.current_stage = Stage::GateA;
    run.gate_states.insert(Stage::GateA, GateState::Pending);
    run.gate_states.insert(Stage::GateB, GateState::Pending);
    store.update_run(&run).await.expect("the gates are pending");
    run
}

#[test]
fn a_providers_endpoint_falls_back_to_its_kinds_default() {
    let stored = StoredProvider {
        name: "mine".to_string(),
        kind: "qwen".to_string(),
        api_base: Some("http://127.0.0.1:8000/v1".to_string()),
        enabled: true,
        created_at: 1_700_000_000,
        last_test_ok: None,
        last_test_at: None,
        last_test_error: None,
    };
    // What the owner named wins.
    assert_eq!(
        provider_endpoint(&stored).as_deref(),
        Some("http://127.0.0.1:8000/v1")
    );

    // The kind's published default when the owner named none, which is what
    // makes "paste one API key" the whole first-run input.
    let defaulted = StoredProvider {
        api_base: None,
        ..stored.clone()
    };
    assert_eq!(
        provider_endpoint(&defaulted).as_deref(),
        Some(
            OneClickProvider::Qwen
                .default_base_url()
                .expect("qwen has a default")
        )
    );

    // Standard vendor kinds default to their canonical endpoints when none is named.
    let openai = StoredProvider {
        name: "openai".to_string(),
        kind: "openai".to_string(),
        api_base: None,
        enabled: true,
        created_at: 1_700_000_000,
        last_test_ok: None,
        last_test_at: None,
        last_test_error: None,
    };
    assert_eq!(
        provider_endpoint(&openai).as_deref(),
        Some("https://api.openai.com/v1")
    );

    let anthropic = StoredProvider {
        name: "anthropic".to_string(),
        kind: "anthropic".to_string(),
        api_base: None,
        enabled: true,
        created_at: 1_700_000_000,
        last_test_ok: None,
        last_test_at: None,
        last_test_error: None,
    };
    assert_eq!(
        provider_endpoint(&anthropic).as_deref(),
        Some("https://api.anthropic.com")
    );

    let ollama = StoredProvider {
        name: "ollama".to_string(),
        kind: "ollama".to_string(),
        api_base: None,
        enabled: true,
        created_at: 1_700_000_000,
        last_test_ok: None,
        last_test_at: None,
        last_test_error: None,
    };
    assert_eq!(
        provider_endpoint(&ollama).as_deref(),
        Some("http://127.0.0.1:11434")
    );

    // A custom endpoint is the owner's to name: no default URL, no default
    // model, and the setup check is what says so.
    let custom = StoredProvider {
        kind: "custom".to_string(),
        api_base: None,
        ..stored
    };
    assert_eq!(provider_endpoint(&custom), None);
    assert_eq!(provider_model(&custom), "");
}

#[test]
fn a_providers_model_comes_from_its_kind_and_blank_input_is_no_input() {
    let kimi = StoredProvider {
        name: "kimi".to_string(),
        kind: "kimi".to_string(),
        api_base: None,
        enabled: true,
        created_at: 1_700_000_000,
        last_test_ok: None,
        last_test_at: None,
        last_test_error: None,
    };
    assert_eq!(
        provider_model(&kimi),
        OneClickProvider::Kimi
            .default_model()
            .expect("kimi has a default")
    );
    assert!(!provider_model(&kimi).is_empty());

    // A blank string is no string, and a padded one is trimmed.
    assert_eq!(non_empty(None), None);
    assert_eq!(non_empty(Some("   ".to_string())), None);
    assert_eq!(
        non_empty(Some(" http://127.0.0.1:9/v1 ".to_string())).as_deref(),
        Some("http://127.0.0.1:9/v1")
    );
}

/// A provider router with the one mock provider routed for the agent role.
/// `warsha_providers::MockProvider` is the only provider a test may use
/// (AGENTS.md): no key, no network, no spend. Routing it for [`AGENT_ROLE`] is
/// what makes an Agent-mode turn's model path a real router call inside a test.
fn agent_router_with_mock() -> ProviderRouter {
    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(warsha_providers::MockProvider::new("mock")));
    router.set_role_routing(RoleRouting {
        role: AGENT_ROLE,
        targets: vec![RoutingTarget {
            provider_id: "mock".to_string(),
            model_id: "mock-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });
    router
}

/// Store a project and a run in it, returning the run.
async fn stored_run(store: &Store, name: &str, repo_path: Option<&Path>) -> Run {
    let project = Project {
        id: ProjectId::new(),
        name: name.to_string(),
        description: format!("{name} description"),
        language: "en".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        repo_path: repo_path.map(|path| path.to_string_lossy().into_owned()),
        ..Default::default()
    };
    store
        .create_project(&project)
        .await
        .expect("the project is stored");

    let run = Run {
        id: RunId::new(),
        project_id: project.id,
        current_stage: Stage::Idea,
        gate_states: HashMap::new(),
        run_mode: warsha_core::RunMode::Agent,
        artifacts: HashMap::new(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        status: RunStatus::Running,
        budget_cents: None,
        spent_cents: 0,
        worktree_path: None,
        worktree_branch: None,
        confinement: None,
    };
    store.create_run(&run).await.expect("the run is stored");
    run
}

#[tokio::test]
async fn apply_handoff_writes_the_files_and_reports_the_conflict_and_backup() {
    use warsha_pipeline::ApplyResult;

    let temp = crate::test_util::fresh_tempdir();
    let working_tree = temp.path().join("repo");
    std::fs::create_dir_all(working_tree.join("src")).expect("the working tree is made");
    std::fs::write(working_tree.join("src/lib.rs"), "local edit\n")
        .expect("the local file is written");

    let (state, store) = test_state(&temp.path().join("data")).await;
    let run = stored_run(&store, "Shop", Some(&working_tree)).await;

    // The bundle the remote run sends back, written where handoff.create puts
    // it: the same directory shape, one JSON file per run.
    let bundle = HandoffManager::new().create_bundle(
        &run.id.0.to_string(),
        &[("src/lib.rs", "remote\n"), ("src/new.rs", "new\n")],
    );
    let handoff_dir = temp.path().join("handoff");
    let path = HandoffManager::new()
        .write_bundle(&bundle, &handoff_dir.to_string_lossy())
        .expect("the bundle is written");

    let rpc = WarshaRpc::new(state);
    let summary = rpc
        .apply_handoff(&owner_ext(), path, false)
        .await
        .expect("a bundle with a project repo is applied");
    let result: ApplyResult = serde_json::from_str(&summary).expect("the summary is a result");

    // Remote wins: the conflict is overwritten and still on record.
    assert_eq!(result.applied, vec!["src/lib.rs", "src/new.rs"]);
    assert_eq!(result.conflicts.len(), 1);
    assert_eq!(result.conflicts[0].path, "src/lib.rs");
    assert!(result.requires_gate());
    // The file the two sides agreed nothing about is a plain write.
    assert_eq!(
        std::fs::read_to_string(working_tree.join("src/new.rs")).expect("the new file"),
        "new\n"
    );
    assert_eq!(
        std::fs::read_to_string(working_tree.join("src/lib.rs")).expect("the overwritten file"),
        "remote\n"
    );

    // The summary names the backup directory, and the local edit is in it.
    let backup_dir = result
        .backup_dir
        .as_deref()
        .expect("the summary names the backup directory");
    assert!(Path::new(backup_dir).starts_with(working_tree.join(".warsha-backup")));
    assert_eq!(
        std::fs::read_to_string(Path::new(backup_dir).join("src/lib.rs"))
            .expect("the backup is readable"),
        "local edit\n"
    );
}

#[tokio::test]
async fn apply_handoff_refuses_a_run_with_no_project_repo() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;
    let run = stored_run(&store, "Shop", None).await;

    let bundle = HandoffManager::new().create_bundle(&run.id.0.to_string(), &[("a.rs", "a\n")]);
    let handoff_dir = temp.path().join("handoff");
    let path = HandoffManager::new()
        .write_bundle(&bundle, &handoff_dir.to_string_lossy())
        .expect("the bundle is written");

    let error = WarshaRpc::new(state)
        .apply_handoff(&owner_ext(), path, true)
        .await
        .expect_err("an apply needs a working tree to write into");
    let message = format!("{error:?}");
    assert!(
        message.contains("has no project repo"),
        "unexpected error: {message}"
    );
    // Nothing was written next to the daemon's own bundle file.
    assert!(!handoff_dir.join("a.rs").exists());
}

#[tokio::test]
async fn export_backend_names_the_dump_after_the_run_project() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(&temp.path().join("data")).await;
    let run = stored_run(&store, "Shop", None).await;

    let output_dir = temp.path().join("export");
    let path = WarshaRpc::new(state)
        .export_backend(
            &owner_ext(),
            run.id.0.to_string(),
            output_dir.to_string_lossy().into_owned(),
        )
        .await
        .expect("the export is written");

    assert_eq!(Path::new(&path), output_dir.join("schema.sql").as_path());
    let dump = std::fs::read_to_string(&path).expect("schema.sql is readable");
    // The project, not the run id, names the dump.
    assert!(dump.contains("-- project: Shop"), "unexpected dump: {dump}");
    assert!(dump.contains("-- backend: PocketBase"));
}

#[tokio::test]
async fn skills_list_reports_the_slash_command_catalog() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;

    let skills = WarshaRpc::new(state.clone())
        .list_skills(&owner_ext())
        .await
        .expect("the catalog is served");

    let ids: Vec<&str> = skills.iter().map(|skill| skill.id.as_str()).collect();
    assert!(skills.len() >= 12);
    assert!(ids.contains(&"brainstorming"));
    assert!(ids.contains(&"writing-plans"));
    assert!(ids.contains(&"test-driven-development"));
    assert!(skills
        .iter()
        .all(|skill| !skill.description.trim().is_empty()));
    // The in-process slash command catalog resolves as a registry:
    let catalog = WarshaRpc::new(state)
        .active_skill_catalog()
        .await
        .expect("the catalog is served");
    let registry = SlashCommandRegistry::from_skills(&catalog);
    assert_eq!(
        registry.lookup("/FIX").map(|command| command.name.as_str()),
        Some("/fix")
    );
}

/// Whether one catalog serves a command by name.
fn serves(catalog: &[SlashCommand], name: &str) -> bool {
    catalog.iter().any(|command| command.name == name)
}

/// ENGINE P-E6: the catalog is the installed registry, not a constant list.
///
/// The shipped packs come from the settings rows through
/// `warsha_pipeline::SkillRegistry`, so a row the owner switches off leaves the
/// catalog: a hardcoded list would keep serving it either way.
#[tokio::test]
async fn the_skills_catalog_is_served_from_the_installed_registry() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());

    let catalog = rpc
        .active_skill_catalog()
        .await
        .expect("the catalog is served");
    // The composer's own commands survive beside the registry's entries.
    assert!(
        serves(&catalog, "/review"),
        "the built-ins stay: {catalog:?}"
    );
    // The rest is the install: packs no constant in this file names.
    assert!(
        serves(&catalog, "/brainstorming"),
        "a shipped pack is served from the registry: {catalog:?}"
    );
    assert!(serves(&catalog, "/test-driven-development"), "{catalog:?}");

    // The rows are the source: a skill the owner switches off leaves the catalog,
    // while the lock still pins it (the flag is not part of the pin).
    state
        .settings
        .toggle_skill("brainstorming")
        .await
        .expect("the flag flips");
    let catalog = rpc
        .active_skill_catalog()
        .await
        .expect("the catalog is served");
    assert!(
        !serves(&catalog, "/brainstorming"),
        "a disabled row is not served: {catalog:?}"
    );
    assert!(serves(&catalog, "/review"), "{catalog:?}");
}

/// ENGINE P-E6: a lockfile that disagrees with the install refuses the catalog.
///
/// This mirrors `SkillsLockfile::verify` at the daemon edge: every direction the
/// library fails closed on — a moved version or commit, a locked pack that is not
/// loaded, a lock that cannot be read — is a refusal, never a smaller catalog.
#[tokio::test]
async fn a_drifted_skills_lock_refuses_the_catalog() {
    let temp = crate::test_util::fresh_tempdir();
    let data_dir = temp.path().join("data");
    let (state, _store) = test_state(&data_dir).await;
    let rpc = WarshaRpc::new(state.clone());

    // The first read pins the install it found.
    rpc.active_skill_catalog()
        .await
        .expect("the catalog is served and pinned");
    let lock_path = data_dir.join(SKILLS_LOCK_FILE);
    let pinned = std::fs::read_to_string(&lock_path).expect("the lock is written");

    // A pinned version that moved.
    let mut lock: serde_json::Value = serde_json::from_str(&pinned).expect("the lock is JSON");
    lock["entries"]["brainstorming"]["version"] = serde_json::json!("0.0.1");
    std::fs::write(&lock_path, lock.to_string()).expect("the drifted lock is written");
    let error = rpc
        .active_skill_catalog()
        .await
        .expect_err("a moved version must refuse the catalog");
    assert_eq!(rpc_error_code(&error), auth::rpc_codes::POLICY_REFUSED);
    assert!(
        error.message().contains("brainstorming") && error.message().contains("0.0.1"),
        "the refusal names the drift: {}",
        error.message()
    );

    // A locked pack that is not installed.
    let mut lock: serde_json::Value = serde_json::from_str(&pinned).expect("the lock is JSON");
    let mut ghost = lock["entries"]["brainstorming"].clone();
    ghost["skill_id"] = serde_json::json!("ghost");
    lock["entries"]["ghost"] = ghost;
    std::fs::write(&lock_path, lock.to_string()).expect("the drifted lock is written");
    let error = rpc
        .active_skill_catalog()
        .await
        .expect_err("a locked but uninstalled pack must refuse the catalog");
    assert_eq!(rpc_error_code(&error), auth::rpc_codes::POLICY_REFUSED);
    assert!(
        error.message().contains("ghost"),
        "the refusal names the locked pack: {}",
        error.message()
    );

    // A lock the daemon cannot read is not a catalog it serves un-pinned.
    std::fs::write(&lock_path, "{ not a lock").expect("the corrupt lock is written");
    let error = rpc
        .active_skill_catalog()
        .await
        .expect_err("an unreadable lock must refuse the catalog");
    assert_eq!(rpc_error_code(&error), auth::rpc_codes::POLICY_REFUSED);
    assert!(
        error.message().contains("could not be read"),
        "the refusal says the lock is unreadable: {}",
        error.message()
    );
}

/// ENGINE P-E6: a pack the registry refuses to bundle refuses the catalog.
///
/// The rule is the registry's own — `SkillRegistry::register` refuses a copyleft
/// pack — and this proves the daemon edge reaches it: the catalog refuses instead
/// of listing a pack the license rules keep out.
#[tokio::test]
async fn a_copyleft_skills_pack_refuses_the_catalog() {
    let temp = crate::test_util::fresh_tempdir();
    let data_dir = temp.path().join("data");
    let (state, _store) = test_state(&data_dir).await;
    let rpc = WarshaRpc::new(state.clone());
    rpc.active_skill_catalog()
        .await
        .expect("the catalog is served and pinned");

    let mut gpl = state
        .settings
        .get_skill("brainstorming")
        .await
        .expect("the row reads")
        .expect("the row exists");
    gpl.id = "gpl-pack".to_string();
    gpl.name = "GPL Pack".to_string();
    gpl.license = "GPL-3.0".to_string();
    gpl.content = "# GPL Pack".to_string();
    state
        .settings
        .save_skill(&gpl)
        .await
        .expect("the row saves");

    let error = rpc
        .active_skill_catalog()
        .await
        .expect_err("a copyleft pack must refuse the catalog");
    assert_eq!(rpc_error_code(&error), auth::rpc_codes::POLICY_REFUSED);
    assert!(
        error.message().contains("gpl-pack"),
        "the refusal names the pack: {}",
        error.message()
    );
}

/// ENGINE P-E6: an install that changes after the lock was written is a drift too.
///
/// The pin covers the pack's own bytes, so editing a row and installing a new one
/// are both refused until the lock is re-pinned.
#[tokio::test]
async fn an_install_that_changed_after_the_skills_lock_refuses_the_catalog() {
    let temp = crate::test_util::fresh_tempdir();
    let data_dir = temp.path().join("data");
    let (state, _store) = test_state(&data_dir).await;
    let rpc = WarshaRpc::new(state.clone());

    rpc.active_skill_catalog()
        .await
        .expect("the catalog is served and pinned");
    let lock_path = data_dir.join(SKILLS_LOCK_FILE);
    let pinned = std::fs::read_to_string(&lock_path).expect("the lock is written");

    // The pack's body changed under the lock.
    let original = state
        .settings
        .get_skill("test-driven-development")
        .await
        .expect("the row reads")
        .expect("the row exists");
    let mut edited = original.clone();
    edited.content.push_str("\n\nAn edit no lock approved.\n");
    state
        .settings
        .save_skill(&edited)
        .await
        .expect("the row saves");
    let error = rpc
        .active_skill_catalog()
        .await
        .expect_err("an edited pack must refuse the catalog");
    assert_eq!(rpc_error_code(&error), auth::rpc_codes::POLICY_REFUSED);
    assert!(
        error.message().contains("test-driven-development"),
        "the refusal names the edited pack: {}",
        error.message()
    );
    assert!(
        error.message().contains(SKILLS_LOCK_FILE),
        "the refusal names the lock: {}",
        error.message()
    );

    // An install the lock never named: the edited pack is back to its pinned bytes
    // and a new row arrives, which is a set the lock does not cover.
    state
        .settings
        .save_skill(&original)
        .await
        .expect("the row restores");
    let mut extra = original.clone();
    extra.id = "imported-after-the-lock".to_string();
    extra.name = "Imported After The Lock".to_string();
    state
        .settings
        .save_skill(&extra)
        .await
        .expect("the row saves");
    let error = rpc
        .active_skill_catalog()
        .await
        .expect_err("an unlocked install must refuse the catalog");
    assert_eq!(rpc_error_code(&error), auth::rpc_codes::POLICY_REFUSED);
    assert!(
        error.message().contains("imported-after-the-lock"),
        "the refusal names the unlocked pack: {}",
        error.message()
    );
    // The lock itself is untouched by a read: the gate re-reads, it never re-pins.
    assert_eq!(
        std::fs::read_to_string(&lock_path).expect("the lock is still there"),
        pinned
    );
}

/// ENGINE P-E6: a role's catalog is its pack, and a pack that lost a skill fails
/// closed instead of shrinking.
#[tokio::test]
async fn a_roles_catalog_is_its_skills_pack_and_a_gap_fails_closed() {
    let temp = crate::test_util::fresh_tempdir();
    let data_dir = temp.path().join("data");
    let (state, _store) = test_state(&data_dir).await;
    let rows = state.settings.list_skills().await.expect("the rows read");
    let registry = installed_skill_registry(&rows, &data_dir).expect("the install registers");

    // Every role's pack resolves against a fresh install, and every shipped skill
    // belongs to one: a pack table naming a skill nothing ships would fail the role
    // it belongs to on the first start.
    let mut named: Vec<&str> = Vec::new();
    for role in Role::all() {
        let pack = registry
            .skills_for_role(*role)
            .unwrap_or_else(|error| panic!("the {role:?} pack resolves: {error}"));
        assert!(!pack.is_empty(), "the {role:?} pack is not empty");
        named.extend(pack.iter().map(|skill| skill.manifest.id.as_str()));
    }
    for row in &rows {
        assert!(
            named.contains(&row.id.as_str()),
            "`{}` is shipped but no role's pack names it",
            row.id
        );
    }

    // Coder is its own pack plus the built-ins — not every installed skill.
    let catalog =
        catalog_from_registry(&registry, &rows, Some(Role::Coder)).expect("the pack resolves");
    assert!(
        serves(&catalog, "/review"),
        "the built-ins stay: {catalog:?}"
    );
    assert!(serves(&catalog, "/test-driven-development"), "{catalog:?}");
    assert!(
        !serves(&catalog, "/frontend-design"),
        "a skill outside the pack is not the role's: {catalog:?}"
    );

    // A pack that names a skill the install no longer has is an error, not a
    // shorter pack.
    let without: Vec<StoredSkill> = rows
        .iter()
        .filter(|row| row.id != "systematic-debugging")
        .cloned()
        .collect();
    let registry =
        installed_skill_registry(&without, &data_dir).expect("the remaining install registers");
    let error = catalog_from_registry(&registry, &without, Some(Role::Coder))
        .expect_err("a pack that lost a skill must fail closed");
    assert!(
        error.contains("systematic-debugging"),
        "the refusal names the missing skill: {error}"
    );
}

/// The retired `agent.turn` was the only turn this proved, so it is proved on the
/// run's own loop instead: plan first, and only the owner's approval reaches Agent.
#[tokio::test]
async fn a_run_turn_plans_first_and_executes_after_the_owner_approves() {
    use warsha_pipeline::AgentMode;

    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    // The catalog `agent.turn_run` hands the loop, from the same daemon.
    let skills = WarshaRpc::new(state.clone())
        .active_skill_catalog()
        .await
        .expect("the catalog is served");
    // The loop a run works in: the daemon's router behind the model call and the
    // filesystem tools under the run's workspace.
    let mut agent = agent_loop_for_run(&state);

    let planned = agent
        .run_turn("/review the diff of @file src/main.rs", &skills)
        .await;
    assert_eq!(planned.mode, AgentMode::Plan);
    assert_eq!(
        planned
            .command
            .as_ref()
            .map(|command| command.name.as_str()),
        Some("/review")
    );
    assert_eq!(planned.mentions.len(), 1);
    assert_eq!(planned.todos.len(), 1);
    assert!(planned.tools.is_empty());
    assert!(!agent.mode_manager.can_edit());

    // Agent mode is only reachable through the owner's approval.
    agent
        .approve_agent_mode("owner")
        .expect("the approval is accepted");

    let executed = agent.run_turn("now apply it", &skills).await;
    assert_eq!(executed.mode, AgentMode::Agent);
    assert_eq!(executed.command, None);
    assert_eq!(executed.todos.len(), 2);
    assert_eq!(executed.todos[1].id, "turn-2");
    // The turn is not a tool request, so it went to the router — which is the
    // daemon's real `ProviderRouter`, holding the mock provider in this test.
    assert!(executed.response.starts_with("Summary (model completion):"));
    assert!(executed.response.contains("- model: Mock response"));
    assert!(executed.tools.is_empty());
}

/// The tool turn, on the run's own loop: the run's workspace is where the tools
/// write, and a path out of it is refused.
#[tokio::test]
async fn a_run_turn_runs_a_tool_inside_the_runs_workspace() {
    use warsha_pipeline::AgentMode;

    let temp = crate::test_util::fresh_tempdir();
    let data_dir = temp.path().join("data");
    let (state, store) = test_state(&data_dir).await;
    let rpc = WarshaRpc::new(state.clone());
    let run_id = approved_agent_run(&state, &store).await;

    let executed = rpc
        .agent_turn_run(
            &owner_ext(),
            run_id,
            "write file notes/hello.md: written by the agent".to_string(),
        )
        .await
        .expect("a tool turn answers");

    assert_eq!(executed.mode, AgentMode::Agent);
    assert_eq!(executed.tools.len(), 1);
    assert!(
        executed.tools[0].success,
        "unexpected tool: {:?}",
        executed.tools[0]
    );
    // The real file layer wrote it, inside `<data_dir>/workspace`.
    let written = data_dir.join("workspace").join("notes").join("hello.md");
    assert!(written.is_file(), "{} was not written", written.display());
    assert_eq!(
        std::fs::read_to_string(&written).expect("the file is readable"),
        "written by the agent"
    );

    // A path that leaves the workspace is refused, not written.
    let refused = rpc
        .agent_turn_run(
            &owner_ext(),
            run_id,
            "write file ../escape.md: no".to_string(),
        )
        .await
        .expect("a refused tool turn still answers");
    assert_eq!(refused.tools.len(), 1);
    assert!(!refused.tools[0].success);
    assert!(
        !data_dir.join("escape.md").exists(),
        "the screen let a path out"
    );
}

/// The tool name [`mcp_probe_server`] answers `tools/list` with.
const PROBE_TOOL: &str = "read_file";

/// The address [`preview_probe`] prints, as a dev server prints one.
const PROBE_URL: &str = "http://127.0.0.1:5199/";

/// A stdio MCP server, run as a child of this test binary.
///
/// `mcp.connect` now speaks the protocol, so a test server has to answer it.
/// The daemon starts a server with the program and arguments it was given and
/// no environment, so the child identifies itself by `--exact` and answers from
/// the constant above. `--nocapture` is what lets this `println!` reach the pipe
/// the manager reads instead of libtest's in-memory buffer, and the guard makes
/// the probe harmless if a full ignored run ever reaches it.
#[test]
#[ignore = "a child process, not a test"]
fn mcp_probe_server() {
    use std::io::BufRead;

    if !std::env::args().any(|arg| arg == "--exact") {
        return;
    }
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let Ok(request) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(id) = request.get("id").cloned() else {
            continue;
        };
        match request.get("method").and_then(serde_json::Value::as_str) {
            Some("initialize") => println!(
                "{}",
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": { "protocolVersion": "2024-11-05", "capabilities": {} },
                })
            ),
            Some("tools/list") => println!(
                "{}",
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": { "tools": [{ "name": PROBE_TOOL }] },
                })
            ),
            Some("tools/call") => {
                let tool_name = request
                    .get("params")
                    .and_then(|p| p.get("name"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("");
                println!(
                    "{}",
                    serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "result": {
                            "content": [{ "type": "text", "text": format!("mcp called {tool_name}") }],
                            "isError": false,
                        }
                    })
                );
            }
            _ => println!(
                "{}",
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": "unknown method" },
                })
            ),
        }
    }
}

/// A dev server, run as a child of this test binary: it prints its address and
/// stays up, which is what `preview.start` waits to read.
#[test]
#[ignore = "a child process, not a test"]
fn preview_probe() {
    if !std::env::args().any(|arg| arg == "--exact") {
        return;
    }
    println!("  ➜  Local:   {PROBE_URL}");
    loop {
        std::thread::park();
    }
}

/// The command line that starts one probe of this test binary.
///
/// A preview is given one command line and splits it itself, so a binary path
/// with a space in it would not survive. It does not here, and the pipeline's
/// own preview tests rest on the same assumption.
fn probe_line(test: &str) -> String {
    let exe = std::env::current_exe().expect("the test binary names itself");
    format!(
        "{} --exact tests::{test} --ignored --nocapture",
        exe.display()
    )
}

/// The same probe as a program plus args, which is what `mcp.connect` takes.
fn probe_command(test: &str) -> (String, Vec<String>) {
    let exe = std::env::current_exe().expect("the test binary names itself");
    (
        exe.to_string_lossy().into_owned(),
        vec![
            "--exact".to_string(),
            format!("tests::{test}"),
            "--ignored".to_string(),
            "--nocapture".to_string(),
        ],
    )
}

/// A program plus args that keeps running until the test stops it.
#[cfg(windows)]
fn long_running() -> (String, Vec<String>) {
    (
        "cmd".to_string(),
        vec!["/C".to_string(), "more".to_string()],
    )
}

/// A program plus args that keeps running until the test stops it (Unix).
#[cfg(not(windows))]
fn long_running() -> (String, Vec<String>) {
    ("sh".to_string(), vec!["-c".to_string(), "cat".to_string()])
}

#[tokio::test]
async fn process_rpcs_spawn_list_report_and_stop_a_real_process() {
    let temp = crate::test_util::fresh_tempdir();
    // The owner's own configuration is what admits a program: this test's
    // long-running stand-in is `cmd`/`sh`, which the default list deliberately
    // does not carry.
    let (state, _store) = test_state_with(temp.path(), |config| {
        config.allowed_commands = vec!["cmd".to_string(), "sh".to_string()];
    })
    .await;
    let rpc = WarshaRpc::new(state);
    let (command, args) = long_running();

    let id = rpc
        .spawn_process(&owner_ext(), command.clone(), args.clone(), HashMap::new())
        .await
        .expect("the process starts");
    assert_eq!(
        rpc.process_status(&owner_ext(), id.clone()).await.unwrap(),
        ProcessStatus::Running
    );
    let listed = rpc
        .list_processes(&owner_ext())
        .await
        .expect("the list is served");
    let process = listed.first().expect("the process is listed");
    assert_eq!(process.id, id);
    assert_eq!(process.command, command);
    assert_eq!(process.args, args);
    assert!(process.started_at.is_some());

    rpc.stop_process(&owner_ext(), id.clone())
        .await
        .expect("the process stops");
    assert_eq!(
        rpc.process_status(&owner_ext(), id.clone()).await.unwrap(),
        ProcessStatus::Stopped
    );

    // A second stop has nothing left to signal, and an unknown id is refused.
    assert!(rpc.stop_process(&owner_ext(), id).await.is_err());
    assert!(rpc
        .process_status(&owner_ext(), "proc-404".to_string())
        .await
        .is_err());
}

#[tokio::test]
async fn mcp_connect_requires_pinned_stdio_launch() {
    let temp = crate::test_util::fresh_tempdir();
    let (command, args) = probe_command("mcp_probe_server");
    // The policy must allow 'npx' and the probe command.
    let allowed_probe = command.clone();
    let (state, _store) = test_state_with(temp.path(), move |config| {
        config.allowed_commands = vec!["npx".to_string(), allowed_probe];
    })
    .await;
    let rpc = WarshaRpc::new(state);

    // (a) Unpinned npx launch: refused by wave2::require_pinned_launch BEFORE spawn.
    let unpinned_res = rpc
        .connect_mcp(
            &owner_ext(),
            warsha_pipeline::mcp_transport::McpServerConfig::new_stdio(
                "unpinned",
                "npx".to_string(),
                vec!["pkg".to_string()],
            ),
        )
        .await;
    let err = unpinned_res.expect_err("an unpinned npx launch must be refused");
    assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
    assert!(
        err.message().contains("unpinned package `pkg`"),
        "expected unpinned package message, got: {}",
        err.message()
    );

    // (b) Pinned / safe launch: connects successfully using probe server.
    rpc.connect_mcp(
        &owner_ext(),
        warsha_pipeline::mcp_transport::McpServerConfig::new_stdio("pinned", command, args),
    )
    .await
    .expect("a valid probe command should connect");

    rpc.disconnect_mcp(&owner_ext(), "pinned".to_string())
        .await
        .expect("the server disconnects");
}

#[tokio::test]
async fn mcp_rpcs_connect_send_and_disconnect_a_stdio_server() {
    let temp = crate::test_util::fresh_tempdir();
    let (command, args) = probe_command("mcp_probe_server");
    // The stdio transport starts this test's own binary as the MCP server, and the
    // daemon's configuration is what admits that exact program.
    let allowed = command.clone();
    let (state, _store) = test_state_with(temp.path(), move |config| {
        config.allowed_commands = vec![allowed];
    })
    .await;
    let rpc = WarshaRpc::new(state);

    rpc.connect_mcp(
        &owner_ext(),
        warsha_pipeline::mcp_transport::McpServerConfig::new_stdio("files", command, args),
    )
    .await
    .expect("the server connects");
    let listed = rpc
        .list_mcp(&owner_ext())
        .await
        .expect("the list is served");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Connected);
    assert!(listed[0].process_id.is_some());
    // The handshake ran, so `mcp.list` reports what the server said it can do.
    assert_eq!(listed[0].tools, vec![PROBE_TOOL.to_string()]);

    let frame = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
    assert_eq!(
        rpc.send_mcp(&owner_ext(), "files".to_string(), frame.to_string())
            .await
            .expect("the frame is written"),
        frame
    );

    // `mcp.call` consults the permission table like every other path to the
    // transport (K6, R-KEEL row 6), and an empty table is `Ask`, so this owner
    // grants the tool the way the desktop would before the call below.
    rpc.set_mcp_permission(
        &owner_ext(),
        "files".to_string(),
        PROBE_TOOL.to_string(),
        warsha_pipeline::MCP_AGENT_ROLE.to_string(),
        "allow".to_string(),
    )
    .await
    .expect("the owner grants the probe tool");

    let call_res = rpc
        .call_mcp(
            &owner_ext(),
            "files".to_string(),
            PROBE_TOOL.to_string(),
            serde_json::json!({}),
        )
        .await
        .expect("call_mcp succeeds");
    assert!(!call_res.is_error);
    assert_eq!(call_res.content.len(), 1);
    match &call_res.content[0] {
        warsha_pipeline::mcp::McpContent::Text { text } => {
            assert_eq!(text, &format!("mcp called {PROBE_TOOL}"));
        }
        _ => panic!("expected text content"),
    }

    rpc.disconnect_mcp(&owner_ext(), "files".to_string())
        .await
        .expect("the server disconnects");
    let listed = rpc
        .list_mcp(&owner_ext())
        .await
        .expect("the list is served");
    assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Disconnected);
    assert_eq!(listed[0].process_id, None);
    // Nothing is dialled for a *wired* name after the disconnect.
    assert!(rpc
        .send_mcp(&owner_ext(), "files".to_string(), "{}".to_string())
        .await
        .is_err());
}

/// The pipeline's own default, reached through the RPCs: a manager with **no** HTTP
/// client injected records an `http` config and dials nothing. Since R-EXT-4 the
/// daemon's startup injects one, so this pins the default rather than the daemon —
/// what a pipeline-only host (and every other test in this file) gets.
#[tokio::test]
async fn mcp_connect_records_an_http_transport_without_dialling_it() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);

    rpc.connect_mcp(
        &owner_ext(),
        warsha_pipeline::mcp_transport::McpServerConfig::new_http(
            "remote",
            "https://mcp.example/mcp",
        ),
    )
    .await
    .expect("the config is recorded");

    let listed = rpc
        .list_mcp(&owner_ext())
        .await
        .expect("the list is served");
    assert_eq!(listed[0].status, warsha_pipeline::McpStatus::Disconnected);
    assert_eq!(listed[0].process_id, None);
    assert!(rpc
        .list_processes(&owner_ext())
        .await
        .expect("the list is served")
        .is_empty());
    // The transport is recorded, not wired, and the error says so.
    let error = rpc
        .send_mcp(&owner_ext(), "remote".to_string(), "{}".to_string())
        .await
        .expect_err("nothing dials an http transport yet");
    assert!(format!("{error:?}").contains("not wired"));
}

#[tokio::test]
async fn preview_rpcs_start_report_and_stop_one_dev_server_per_project() {
    let temp = crate::test_util::fresh_tempdir();
    let command = probe_line("preview_probe");
    // A preview's command line names this test binary as its program, so the
    // owner's configuration is what admits that exact path.
    let program = command
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_string();
    let (state, _store) = test_state_with(temp.path(), move |config| {
        config.allowed_commands = vec![program];
    })
    .await;
    let rpc = WarshaRpc::new(state.clone());

    let started = rpc
        .start_preview(&owner_ext(), "project-1".to_string(), command.clone())
        .await
        .expect("the preview starts");
    assert_eq!(started.project_id, "project-1");
    // The dev server prints its address, and `preview.start` reports it (D4).
    assert_eq!(started.url.as_deref(), Some(PROBE_URL));
    let status = rpc
        .preview_status(&owner_ext(), "project-1".to_string())
        .await
        .expect("the preview is tracked");
    assert_eq!(status.process_id, started.process_id);
    assert_eq!(status.status, ProcessStatus::Running);
    assert_eq!(status.url.as_deref(), Some(PROBE_URL));
    // The dev server is a real child, so `process.list` sees it too.
    assert_eq!(
        rpc.list_processes(&owner_ext())
            .await
            .expect("the list is served")
            .len(),
        1
    );

    // One preview per project, and an unknown project is refused.
    assert!(rpc
        .start_preview(&owner_ext(), "project-1".to_string(), command)
        .await
        .is_err());
    assert!(rpc
        .preview_status(&owner_ext(), "nobody".to_string())
        .await
        .is_err());

    rpc.stop_preview(&owner_ext(), "project-1".to_string())
        .await
        .expect("the preview stops");
    assert_eq!(
        rpc.preview_status(&owner_ext(), "project-1".to_string())
            .await
            .expect("the preview is still tracked")
            .status,
        ProcessStatus::Stopped
    );
    // The process stays in the list as a stopped record.
    let listed = rpc
        .list_processes(&owner_ext())
        .await
        .expect("the list is served");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].status, ProcessStatus::Stopped);
}

// ---- R-BRIDGE-B5: a run owns its preview, and a preview dies with its run.

/// A project in the store, which is what a run needs before it can start.
async fn stored_project(store: &Store) -> Project {
    let project = Project {
        id: ProjectId::new(),
        name: "Preview Project".to_string(),
        description: "R-BRIDGE-B5".to_string(),
        language: "en".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        repo_path: None,
        repo_url: None,
        ..Default::default()
    };
    store
        .create_project(&project)
        .await
        .expect("the project is stored");
    project
}

/// The daemon, its store and the probe command line, with the probe admitted.
///
/// A preview's command line names this test binary as its program, so the
/// owner's configuration is what admits that exact path — the same wiring the
/// preview RPC test above uses.
async fn preview_state(data_dir: &std::path::Path) -> (Arc<DaemonState>, Arc<Store>, String) {
    let command = probe_line("preview_probe");
    let program = command
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_string();
    let (state, store) = test_state_with(data_dir, move |config| {
        config.allowed_commands = vec![program];
    })
    .await;
    (state, store, command)
}

/// T1 (R-BRIDGE-B5 D3): a second live run on the project never inherits the
/// server the first one owns.
#[tokio::test]
async fn second_run_never_inherits_a_live_server() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store, command) = preview_state(temp.path()).await;
    let project = stored_project(&store).await;
    let rpc = WarshaRpc::new(state.clone());

    let first = rpc
        .start_run(
            &owner_ext(),
            project.id,
            "the first run".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("run A starts");
    let started = rpc
        .start_preview(&owner_ext(), project.id.to_string(), command.clone())
        .await
        .expect("run A starts the project's preview");

    let second = rpc
        .start_run(
            &owner_ext(),
            project.id,
            "the second run".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("run B starts");
    // Run B is the project's newest live run, so it is the run context a
    // `preview.start` call arrives in (the wire carries no run id, D4).
    let runs = store.list_runs(project.id).await.expect("the runs list");
    assert_eq!(
        runs.first().map(|run| run.id),
        Some(second.id),
        "run B is the newest run of the project"
    );

    let error = rpc
        .start_preview(&owner_ext(), project.id.to_string(), command)
        .await
        .expect_err("run B cannot take the server run A owns");
    let message = format!("{error:?}");
    assert!(message.contains("owned by run"), "{message}");
    assert!(message.contains(&first.id.0.to_string()), "{message}");
    assert!(message.contains(&second.id.0.to_string()), "{message}");

    // The refusal took nothing: run A's server is still A's own. The RPC would
    // answer in run B's context now, which is exactly why this reads A's.
    assert_eq!(
        state
            .previews
            .status(&project.id.to_string(), Some(&first.id.0.to_string()))
            .await
            .expect("run A's server still answers for run A")
            .process_id,
        started.process_id
    );

    // And run A's close is what takes it down, not run B.
    rpc.cancel_run(&owner_ext(), first.id, None)
        .await
        .expect("run A closes");
    assert_eq!(
        state
            .processes
            .status(&started.process_id)
            .await
            .expect("the server is tracked"),
        ProcessStatus::Stopped
    );
    assert!(state.previews.list().await.is_empty());
}

/// T2 (R-BRIDGE-B5 D2): the terminal `runs.advance` arm stops the server the
/// run owned and drops its entry.
#[tokio::test]
async fn terminal_advance_stops_the_owned_server() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store, command) = preview_state(temp.path()).await;
    let project = stored_project(&store).await;
    let rpc = WarshaRpc::new(state.clone());

    let run = rpc
        .start_run(
            &owner_ext(),
            project.id,
            "a run".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("the run starts");
    let started = rpc
        .start_preview(&owner_ext(), project.id.to_string(), command)
        .await
        .expect("the run starts the project's preview");

    // `Feedback` is the last stage, so advancing a run there completes it — the
    // terminal arm the hook sits on. The stage is moved directly, as the Gate C
    // tests move it, so no model call is involved.
    let mut stored = store.get_run(run.id).await.expect("the run is stored");
    stored.current_stage = Stage::Feedback;
    store.update_run(&stored).await.expect("the stage moves");

    let finished = rpc
        .advance_run(&owner_ext(), run.id)
        .await
        .expect("the run advances");
    assert_eq!(finished.status, RunStatus::Completed);

    assert_eq!(
        state
            .processes
            .status(&started.process_id)
            .await
            .expect("the server is tracked"),
        ProcessStatus::Stopped,
        "the run's server outlived the run"
    );
    assert!(
        state.previews.list().await.is_empty(),
        "a completed run left a preview entry behind"
    );
    assert!(
        rpc.preview_status(&owner_ext(), project.id.to_string())
            .await
            .is_err(),
        "preview.status still answered for a finished run"
    );
}

/// T3 (R-BRIDGE-B5 D2): `runs.cancel` stops the server the run owned.
#[tokio::test]
async fn cancel_stops_the_owned_server() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store, command) = preview_state(temp.path()).await;
    let project = stored_project(&store).await;
    let rpc = WarshaRpc::new(state.clone());

    let run = rpc
        .start_run(
            &owner_ext(),
            project.id,
            "a run".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("the run starts");
    let started = rpc
        .start_preview(&owner_ext(), project.id.to_string(), command)
        .await
        .expect("the run starts the project's preview");

    let cancelled = rpc
        .cancel_run(&owner_ext(), run.id, None)
        .await
        .expect("the run cancels");
    assert_eq!(cancelled.status, RunStatus::Cancelled);

    assert_eq!(
        state
            .processes
            .status(&started.process_id)
            .await
            .expect("the server is tracked"),
        ProcessStatus::Stopped,
        "a cancelled run left its server running"
    );
    assert!(
        state.previews.list().await.is_empty(),
        "a cancelled run left a preview entry behind"
    );
}

/// T4 (R-BRIDGE-B5 D3): a run that died without its close leaves an entry that
/// the next start/status for the project sweeps — never a refusal.
#[tokio::test]
async fn dead_run_entry_swept_lazily() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store, command) = preview_state(temp.path()).await;
    let project = stored_project(&store).await;
    let rpc = WarshaRpc::new(state.clone());

    let dead = rpc
        .start_run(
            &owner_ext(),
            project.id,
            "the run that dies".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("the run starts");
    let abandoned = rpc
        .start_preview(&owner_ext(), project.id.to_string(), command.clone())
        .await
        .expect("the run starts the project's preview");

    // The run record is killed directly: no hook, no `stop_run`, exactly the
    // crash a daemon restart hands over.
    let mut stored = store.get_run(dead.id).await.expect("the run is stored");
    stored.status = RunStatus::Cancelled;
    store.update_run(&stored).await.expect("the record moves");

    // The next status for the project is what sweeps the abandoned entry ...
    assert!(
        rpc.preview_status(&owner_ext(), project.id.to_string())
            .await
            .is_err(),
        "a dead run's preview still answered"
    );
    assert_eq!(
        state
            .processes
            .status(&abandoned.process_id)
            .await
            .expect("the swept server is tracked"),
        ProcessStatus::Stopped,
        "the swept server was left running"
    );

    // ... and the next run starts clean instead of being refused.
    let next = rpc
        .start_run(
            &owner_ext(),
            project.id,
            "the next run".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("the next run starts");
    let fresh = rpc
        .start_preview(&owner_ext(), project.id.to_string(), command)
        .await
        .expect("the next run starts a server of its own");
    assert_ne!(fresh.process_id, abandoned.process_id);

    rpc.cancel_run(&owner_ext(), next.id, None)
        .await
        .expect("the next run closes");
    assert!(state.previews.list().await.is_empty());
}

/// T5 (R-BRIDGE-B5 D2), the close half: a run closes cleanly even when the
/// server it owns cannot be stopped any more.
///
/// The poisoned stop path itself is the pipeline's
/// `stop_failure_never_fails_run_close`; this is the daemon's side of the same
/// claim — `runs.cancel` answers with the run, not with an error, when the
/// preview's stop finds nothing to kill.
#[tokio::test]
async fn a_run_closes_even_when_its_server_is_already_down() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store, command) = preview_state(temp.path()).await;
    let project = stored_project(&store).await;
    let rpc = WarshaRpc::new(state.clone());

    let run = rpc
        .start_run(
            &owner_ext(),
            project.id,
            "a run".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect("the run starts");
    let started = rpc
        .start_preview(&owner_ext(), project.id.to_string(), command)
        .await
        .expect("the run starts the project's preview");
    // The server dies on its own: the entry is still the run's, the child is not.
    rpc.stop_preview(&owner_ext(), project.id.to_string())
        .await
        .expect("the server stops");

    let cancelled = rpc
        .cancel_run(&owner_ext(), run.id, None)
        .await
        .expect("the run still closes");
    assert_eq!(cancelled.status, RunStatus::Cancelled);
    assert_eq!(
        state
            .processes
            .status(&started.process_id)
            .await
            .expect("the server is tracked"),
        ProcessStatus::Stopped
    );
    assert!(
        state.previews.list().await.is_empty(),
        "the run's entry outlived the close"
    );
}

#[tokio::test]
async fn routines_rpcs_list_get_run_now_pause_and_resume() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());

    // Empty at start
    let list = rpc
        .list_routines(&owner_ext())
        .await
        .expect("list routines");
    assert!(list.is_empty());

    // Register routines
    {
        let mut reg = state.routines.write().await;
        reg.register(Routine::new(
            "task-manual",
            "Manual Routine",
            warsha_pipeline::RoutineSchedule::Manual,
        ))
        .expect("register manual");
        reg.register(Routine::new(
            "task-interval",
            "Interval Routine",
            warsha_pipeline::RoutineSchedule::IntervalSeconds(60),
        ))
        .expect("register interval");
    }

    // List
    let list = rpc
        .list_routines(&owner_ext())
        .await
        .expect("list routines");
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, "task-interval");
    assert_eq!(list[1].id, "task-manual");

    // Get
    let item = rpc
        .get_routine(&owner_ext(), "task-manual".to_string())
        .await
        .expect("get routine");
    assert!(item.is_some());
    assert_eq!(item.unwrap().name, "Manual Routine");

    let ghost = rpc
        .get_routine(&owner_ext(), "ghost".to_string())
        .await
        .expect("get ghost routine");
    assert!(ghost.is_none());

    // Run now
    let updated = rpc
        .run_routine_now(&owner_ext(), "task-manual".to_string())
        .await
        .expect("run routine now");
    assert_eq!(updated.id, "task-manual");
    assert_eq!(updated.state, warsha_pipeline::RoutineState::Idle);
    assert!(updated.last_run_unix.is_some());

    // Pause
    let paused = rpc
        .pause_routine(&owner_ext(), "task-interval".to_string())
        .await
        .expect("pause routine");
    assert_eq!(paused.state, warsha_pipeline::RoutineState::Paused);

    // Resume
    let resumed = rpc
        .resume_routine(&owner_ext(), "task-interval".to_string())
        .await
        .expect("resume routine");
    assert_eq!(resumed.state, warsha_pipeline::RoutineState::Idle);

    // Not found error
    assert!(rpc
        .run_routine_now(&owner_ext(), "ghost".to_string())
        .await
        .is_err());
    assert!(rpc
        .pause_routine(&owner_ext(), "ghost".to_string())
        .await
        .is_err());
    assert!(rpc
        .resume_routine(&owner_ext(), "ghost".to_string())
        .await
        .is_err());
}

#[tokio::test]
async fn providers_check_models_rpc() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());

    {
        let mut router = state.providers.write().await;
        router.register_provider(Box::new(
            warsha_providers::MockProvider::new("ollama_test").with_models(vec![
                warsha_providers::ModelInfo {
                    id: "qwen2.5-coder:7b".to_string(),
                    name: "Qwen 2.5 Coder 7B".to_string(),
                    provider: "ollama_test".to_string(),
                    context_window: 32_000,
                    max_output: 8_192,
                    pricing: warsha_core::ModelPricing {
                        input_per_million_cents: 0,
                        output_per_million_cents: 0,
                    },
                },
            ]),
        ));
    }

    let diff = rpc
        .check_provider_models(&owner_ext(), "ollama_test".to_string(), None, None, None)
        .await
        .expect("check_provider_models succeeds");
    assert_eq!(diff.provider, "ollama_test");
    assert_eq!(diff.new_models.len(), 1);
    assert_eq!(diff.new_models[0].id, "qwen2.5-coder:7b");

    assert!(rpc
        .check_provider_models(&owner_ext(), "non_existent".to_string(), None, None, None,)
        .await
        .is_err());
}

#[tokio::test]
async fn providers_check_models_diffs_against_local_catalog() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());

    state
        .settings
        .save_custom_model(&warsha_store::StoredCustomModel {
            provider: "ollama_test".to_string(),
            model_id: "qwen2.5-coder:7b".to_string(),
            display_name: Some("Local Qwen".to_string()),
            context_window: Some(32_000),
            enabled: true,
        })
        .await
        .expect("save custom model succeeds");

    {
        let mut router = state.providers.write().await;
        router.register_provider(Box::new(
            warsha_providers::MockProvider::new("ollama_test").with_models(vec![
                warsha_providers::ModelInfo {
                    id: "qwen2.5-coder:7b".to_string(),
                    name: "Qwen 2.5 Coder 7B".to_string(),
                    provider: "ollama_test".to_string(),
                    context_window: 32_000,
                    max_output: 8_192,
                    pricing: warsha_core::ModelPricing {
                        input_per_million_cents: 0,
                        output_per_million_cents: 0,
                    },
                },
                warsha_providers::ModelInfo {
                    id: "llama3.2:3b".to_string(),
                    name: "Llama 3.2 3B".to_string(),
                    provider: "ollama_test".to_string(),
                    context_window: 8_192,
                    max_output: 2_048,
                    pricing: warsha_core::ModelPricing {
                        input_per_million_cents: 0,
                        output_per_million_cents: 0,
                    },
                },
            ]),
        ));
    }

    let diff = rpc
        .check_provider_models(&owner_ext(), "ollama_test".to_string(), None, None, None)
        .await
        .expect("check_provider_models succeeds");
    assert_eq!(diff.provider, "ollama_test");
    assert_eq!(diff.retained_count, 1);
    assert_eq!(diff.new_models.len(), 1);
    assert_eq!(diff.new_models[0].id, "llama3.2:3b");
    assert_eq!(diff.updated_catalog.len(), 2);
}

#[tokio::test]
async fn providers_check_models_surfaces_error_without_leaking_key() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());

    let secret = "sk-live-super-secret-key-12345";
    state
        .secrets
        .store("failing_provider", secret)
        .await
        .expect("store secret succeeds");

    {
        let mut router = state.providers.write().await;
        router.register_provider(Box::new(
            warsha_providers::MockProvider::new("failing_provider").with_failure(
                warsha_providers::ProviderError::Auth(format!("rejected key {secret}")),
            ),
        ));
    }

    let err = rpc
        .check_provider_models(
            &owner_ext(),
            "failing_provider".to_string(),
            None,
            None,
            None,
        )
        .await
        .expect_err("failing provider must surface an error");

    let err_msg = err.to_string();
    assert!(
        !err_msg.contains(secret),
        "error must not leak secret: {err_msg}"
    );
    assert!(err_msg.contains("rejected key") || err_msg.contains("[REDACTED]"));
}

#[tokio::test]
async fn check_models_uses_kind_default_without_url() {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
    let port = listener.local_addr().expect("the bound address").port();
    let mock_url = format!("http://127.0.0.1:{port}/v1");

    // Spawn mock HTTP server returning an OpenAI-compatible models list
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let mut reader = BufReader::new(stream.try_clone().expect("a cloned stream"));
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok() && line != "\r\n" {
                line.clear();
            }
            let body = r#"{"data":[{"id":"gpt-4o","object":"model"}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });

    std::env::set_var("WARSHA_TEST_DEFAULT_BASE_URL", &mock_url);
    struct EnvGuard;
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            std::env::remove_var("WARSHA_TEST_DEFAULT_BASE_URL");
        }
    }
    let _guard = EnvGuard;

    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());

    // Call check_provider_models with kind "openai", key, and NO api_base (None)
    let diff = rpc
        .check_provider_models(
            &owner_ext(),
            "new_openai_provider".to_string(),
            None,
            Some("sk-test-key".to_string()),
            Some("openai".to_string()),
        )
        .await
        .expect("check_provider_models with preset kind should succeed via mock server, not fail with not-found");

    assert_eq!(diff.provider, "new_openai_provider");
    assert_eq!(diff.new_models.len(), 1);
    assert_eq!(diff.new_models[0].id, "gpt-4o");
}

// ---- Re-audit LOAD-1 finding 1: the tier table has to bind the read surface too.
//
// 24 of the 56 methods were declared without `with_extensions`, so their handlers had
// no `RpcExtensions` to read and never reached `authorize()` — the only place a tier
// token is spent. Their `Tier::Standard` rows in `METHOD_POLICIES` were dead on the
// RPC surface and the spike run proved it: 1.34M requests, zero `-32004`, and the
// admitted total landed exactly on the far looser transport ceiling. These tests are
// the two claims the fix has to hold: a method-level ceiling now fires on a read, and
// no read answers a caller that never authenticated.

/// Every read method, refused for want of a session.
///
/// Driven in-process, which is the floor under the transport: a paired device, an
/// unpaired caller or an embedded host that forgets to build the extensions must not
/// get data out of a handler that no longer has an identity to check. The wire
/// half — a request with no credential never reaches a handler at all — is
/// `security_identity.rs` and `security_rate_limits.rs`.
#[tokio::test]
async fn every_read_method_refuses_a_caller_with_no_session() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let anonymous = anonymous_session();
    let project = ProjectId::new();
    let run = RunId::new();

    let outcomes = [
        ("health", rpc.health(&anonymous).await.map(|_| ())),
        (
            "projects.list",
            rpc.list_projects(&anonymous).await.map(|_| ()),
        ),
        (
            "projects.get",
            rpc.get_project(&anonymous, project).await.map(|_| ()),
        ),
        ("runs.get", rpc.get_run(&anonymous, run).await.map(|_| ())),
        (
            "runs.list",
            rpc.list_runs(&anonymous, project).await.map(|_| ()),
        ),
        (
            "runs.events",
            rpc.get_events(&anonymous, run).await.map(|_| ()),
        ),
        (
            "providers.list",
            rpc.list_providers(&anonymous).await.map(|_| ()),
        ),
        ("roles.list", rpc.list_roles(&anonymous).await.map(|_| ())),
        (
            "budget.show",
            rpc.show_budget(&anonymous, project).await.map(|_| ()),
        ),
        (
            "devices.list",
            rpc.list_devices(&anonymous).await.map(|_| ()),
        ),
        (
            "pairing.list",
            rpc.list_pairings(&anonymous).await.map(|_| ()),
        ),
        (
            "backend.get",
            rpc.get_backend(&anonymous, "run".to_string())
                .await
                .map(|_| ()),
        ),
        (
            "runmode.list",
            rpc.list_run_modes(&anonymous).await.map(|_| ()),
        ),
        (
            "preferences.list",
            rpc.list_preferences(&anonymous, "project".to_string())
                .await
                .map(|_| ()),
        ),
        (
            "preferences.record",
            rpc.record_preference(
                &anonymous,
                PreferenceSignal::new(
                    "signal-1",
                    "project",
                    "owner",
                    warsha_pipeline::SignalKind::Approve,
                    "button",
                    1_700_000_000,
                ),
            )
            .await
            .map(|_| ()),
        ),
        (
            "postlaunch.crashes",
            rpc.list_crash_reports(&anonymous, "run".to_string())
                .await
                .map(|_| ()),
        ),
        (
            "postlaunch.reviews",
            rpc.list_store_reviews(&anonymous, "apple".to_string())
                .await
                .map(|_| ()),
        ),
        ("skills.list", rpc.list_skills(&anonymous).await.map(|_| ())),
        (
            "process.status",
            rpc.process_status(&anonymous, "proc-1".to_string())
                .await
                .map(|_| ()),
        ),
        (
            "process.list",
            rpc.list_processes(&anonymous).await.map(|_| ()),
        ),
        ("mcp.list", rpc.list_mcp(&anonymous).await.map(|_| ())),
        (
            "preview.status",
            rpc.preview_status(&anonymous, "project".to_string())
                .await
                .map(|_| ()),
        ),
        (
            "routines.list",
            rpc.list_routines(&anonymous).await.map(|_| ()),
        ),
        (
            "routines.get",
            rpc.get_routine(&anonymous, "task".to_string())
                .await
                .map(|_| ()),
        ),
    ];

    assert_eq!(
        outcomes.len(),
        24,
        "the read surface the re-audit counted is what this asserts over"
    );
    for (method, outcome) in outcomes {
        let error = outcome.expect_err(&format!("{method} served a caller with no session"));
        assert_eq!(
            rpc_error_code(&error),
            auth::rpc_codes::UNAUTHENTICATED,
            "{method} refused an unauthenticated caller for the wrong reason"
        );
    }
}

/// The `standard` tier is spent by a read now, which is the finding's actual claim:
/// `projects.list` can be refused with the method-tier code while the transport
/// ceiling in front of it is still serving traffic normally.
#[tokio::test]
async fn a_read_is_measured_by_its_own_tier_and_not_only_by_the_transport() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state_with(temp.path(), |config| {
        // The transport stays wide — the refusal below has to come from the method
        // tier, not from the whole-request bucket in front of it.
        config.rate_limits = RateLimitConfig {
            transport: QuotaConfig {
                burst: 600,
                sustained: 600,
                window_secs: 60,
            },
            standard: QuotaConfig {
                burst: 3,
                sustained: 3,
                window_secs: 60,
            },
            ..RateLimitConfig::default()
        };
    })
    .await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = owner_ext();

    for _ in 0..3 {
        rpc.list_projects(&owner)
            .await
            .expect("the standard burst is served");
    }

    let refused = rpc
        .list_projects(&owner)
        .await
        .map(|_| ())
        .expect_err("a read past the standard ceiling was served");
    assert_eq!(
        rpc_error_code(&refused),
        auth::rpc_codes::RATE_LIMITED,
        "the method tier did not bind the method tier's own caller"
    );

    // A second identity is not refused for the first one's flood.
    let phone = uuid::Uuid::new_v4().to_string();
    seed_pairing(&rpc.state, &phone).await;
    rpc.list_projects(&paired_ext(&phone))
        .await
        .expect("one caller's ceiling is not another's");

    // The refusal is the tier's, not the method's: `health` sits in `standard` with
    // the other reads, so the same caller that drained the bucket is refused there too
    // — which is what the table claiming one ceiling per tier has to mean.
    let health_refused = rpc
        .health(&owner)
        .await
        .map(|_| ())
        .expect_err("the standard tier refueled between two calls in one test");
    assert_eq!(
        rpc_error_code(&health_refused),
        auth::rpc_codes::RATE_LIMITED,
        "the tier is not per identity and ceiling"
    );
}

/// Re-audit N-8 on the one write that sat on the read surface: `preferences.record`
/// now needs a session, spends its tier and records its actor — and a paired device is
/// still allowed to record taste, which is what the table has always said.
#[tokio::test]
async fn recording_a_preference_is_a_write_with_a_ceiling_and_an_actor() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state_with(temp.path(), |config| {
        config.rate_limits = RateLimitConfig {
            standard: QuotaConfig {
                burst: 1,
                sustained: 1,
                window_secs: 60,
            },
            ..RateLimitConfig::default()
        };
    })
    .await;
    let rpc = WarshaRpc::new(state);
    let phone = uuid::Uuid::new_v4().to_string();
    seed_pairing(&rpc.state, &phone).await;
    let paired = paired_ext(&phone);
    let signal = || {
        PreferenceSignal::new(
            uuid::Uuid::new_v4().to_string(),
            "project-1",
            "owner-1",
            warsha_pipeline::SignalKind::Approve,
            "button",
            1_700_000_000,
        )
    };

    // Served once, and its own ceiling binds the next one rather than the caller
    // writing the settings file forever.
    rpc.record_preference(&paired, signal())
        .await
        .expect("a paired device records taste");
    let refused = rpc
        .record_preference(&paired, signal())
        .await
        .map(|_| ())
        .expect_err("an unbounded write on the read surface");
    assert_eq!(
        rpc_error_code(&refused),
        auth::rpc_codes::RATE_LIMITED,
        "the standard tier did not bind the write it names"
    );

    // A caller with no session writes nothing at all.
    let anonymous = rpc
        .record_preference(&anonymous_session(), signal())
        .await
        .map(|_| ())
        .expect_err("no session recorded a preference");
    assert_eq!(
        rpc_error_code(&anonymous),
        auth::rpc_codes::UNAUTHENTICATED,
        "an unauthenticated caller persisted a preference"
    );
}

/// The log lines a daemon wrote, kept by a test subscriber.
///
/// Two of this batch's findings are about the *shape* of the log rather than the value
/// of any field: a startup line written twice, and a refusal line written 1.3 million
/// times. Neither is assertable from a handler's return value, so the daemon's own
/// output is captured and counted.
#[derive(Clone, Default)]
struct LogCapture(Arc<std::sync::Mutex<Vec<String>>>);

impl LogCapture {
    /// Every line written so far.
    fn lines(&self) -> Vec<String> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    /// How many lines carry `needle`.
    fn count_matching(&self, needle: &str) -> usize {
        self.lines()
            .iter()
            .filter(|line| line.contains(needle))
            .count()
    }
}

/// The one field of an event a log-shape test needs: its message.
#[derive(Default)]
struct MessageVisitor {
    message: String,
}

impl tracing::field::Visit for MessageVisitor {
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        } else {
            // Every other field too: a value logged as `args = ...` is exactly
            // what a no-secrets-in-logs assertion has to be able to see.
            self.message.push_str(&format!(" {}={value}", field.name()));
        }
    }

    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{value:?}");
        } else {
            self.message
                .push_str(&format!(" {}={value:?}", field.name()));
        }
    }
}

/// A subscriber layer that appends each event's level and message to a [`LogCapture`].
struct CaptureLayer(LogCapture);

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for CaptureLayer {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let mut visitor = MessageVisitor::default();
        event.record(&mut visitor);
        self.0
             .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(format!("{} {}", event.metadata().level(), visitor.message));
    }
}

/// The capture, with a filter mounted beside it.
///
/// The filter is not decoration. tracing caches, per callsite, whether it is *ever*
/// enabled, and a callsite first reached by another test running in parallel — with no
/// subscriber of its own — is cached as "never", which blinds a thread-local capture to
/// exactly the line it is looking for. A subscriber that answers `Interest::sometimes()`
/// bypasses that cache, so the capture sees the events whatever the rest of the suite
/// has already done to the callsite: without the filter these two tests pass under
/// `--test-threads=1` and fail in a parallel run.
fn capture_subscriber(capture: &LogCapture) -> impl tracing::Subscriber + Send + Sync + 'static {
    use tracing_subscriber::layer::SubscriberExt;

    tracing_subscriber::Registry::default()
        .with(CaptureLayer(capture.clone()))
        .with(tracing_subscriber::filter::Targets::new().with_default(tracing::Level::TRACE))
}

/// Re-audit LOAD-1 finding 3: the listener lines are written once per daemon start.
///
/// The measured startup log carried each of them twice — once from `start_daemon`,
/// which is the code that knows the ports, and once from `run_daemon`, which only
/// repeats them. Asserted two ways on purpose: the runtime capture proves one start
/// writes one of each, and the source scan proves nothing has grown a second format
/// string for the same line, which is how the duplicate came back the first time.
#[test]
fn the_startup_listener_lines_are_written_once() {
    let capture = LogCapture::default();
    let subscriber = capture_subscriber(&capture);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a current-thread runtime");
    let temp = crate::test_util::fresh_tempdir();
    let data_dir = temp.path().to_path_buf();

    tracing::subscriber::with_default(subscriber, || {
        runtime.block_on(async move {
            let config = DaemonConfig {
                data_dir,
                auth_token: "one-line-token".to_string(),
                http_port: 0,
                ws_port: 0,
                ..Default::default()
            };
            let handle = start_daemon_with_secrets(config, Arc::new(InMemorySecretStore::new()))
                .await
                .expect("the daemon starts");
            assert!(handle.http_port() > 0 && handle.rpc_port() > 0);
            handle.shutdown().await;
        });
    });

    assert_eq!(
        capture.count_matching("HTTP server listening"),
        1,
        "the HTTP listener line was written more than once: {:?}",
        capture.lines()
    );
    assert_eq!(
        capture.count_matching("JSON-RPC server listening"),
        1,
        "the RPC listener line was written more than once: {:?}",
        capture.lines()
    );

    // The source-level guard: exactly one format string each, in the production part of
    // the crate. The duplicate this batch removed was a second call site in
    // `run_daemon`, and a second call site is exactly what this catches — the runtime
    // count above only sees the one start this test performed. P-H1 moved the listener
    // owner to `startup.rs`, so the guard scans both production parts (path seam only;
    // the one-owner assertion is unchanged). A10 moved this module to `tests/mod.rs`,
    // so the two paths are one directory up — the scan set and the assertion are the same.
    let production = [include_str!("../lib.rs"), include_str!("../startup.rs")]
        .into_iter()
        .map(|source| {
            source
                .split("#[cfg(test)]")
                .next()
                .expect("the crate has a test module to exclude")
        })
        .collect::<String>();
    for shape in ["HTTP server listening on", "JSON-RPC server listening on"] {
        let sites = production
            .lines()
            .filter(|line| line.contains(shape))
            .count();
        assert_eq!(
            sites, 1,
            "`{shape}` is written from {sites} places; a listener line has one owner"
        );
    }
}

/// Re-audit LOAD-1 finding 2 at the daemon: a flood of refusals is a count, and one
/// line — not a line per refusal.
///
/// Asserted on the meter the handler actually drives (refusals counted, lines handed
/// out, tallies kept) rather than on a log the test process intercepts. A subscriber
/// installed inside one test of a parallel suite only sees the events whose callsites
/// route to it, and the callsite here is shared with the other refusal tests in this
/// binary, so a capture assertion is flaky by construction; a counter is not. What the
/// line *says* — counts, a ceiling, a one-way digest, never an identity or a token —
/// is asserted next to the function that builds it, in `warsha-remote`.
#[test]
fn a_flood_of_refusals_is_counted_and_earns_one_line() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a current-thread runtime");
    let temp = crate::test_util::fresh_tempdir();

    runtime.block_on(async {
        let (state, _store) = test_state_with(temp.path(), |config| {
            config.rate_limits = RateLimitConfig {
                standard: QuotaConfig {
                    burst: 1,
                    sustained: 1,
                    window_secs: 60,
                },
                ..RateLimitConfig::default()
            };
        })
        .await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        // The first call is served; every one after it is a refusal.
        rpc.list_projects(&owner).await.expect("the burst");
        for _ in 0..500 {
            let refused = rpc
                .list_projects(&owner)
                .await
                .map(|_| ())
                .expect_err("a caller past its ceiling was served");
            assert_eq!(rpc_error_code(&refused), auth::rpc_codes::RATE_LIMITED);
        }

        let meter = state.rates.refusals();
        assert_eq!(meter.refusals_total(), 500, "every refusal is counted");
        assert_eq!(
            meter.lines_written(),
            1,
            "500 refusals earned one line, not 500 of them"
        );
        assert_eq!(meter.tracked(), 1, "one caller earned one tally");
        assert_eq!(meter.untracked(), 0, "the meter overflowed its bound");

        // And nothing about the caller survives in the state that prints: the limiter
        // keys, the identity labels and the daemon's own credential are all absent, so
        // a `debug!` of the governor cannot leak what the refusal line already refuses
        // to print.
        let printed = format!("{:?}", state.rates);
        assert!(
            !printed.contains("test-token"),
            "the ceilings printed the owner credential: {printed}"
        );
        assert!(
            !printed.contains("identity:") && !printed.contains("peer:"),
            "the ceilings printed a limiter key: {printed}"
        );
    });
}

#[tokio::test]
async fn revoking_an_unknown_device_returns_an_rpc_error() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();
    let unknown = DeviceId::new();
    let err = rpc
        .revoke_device(&owner, unknown)
        .await
        .expect_err("revoking an unknown device must fail with an RPC error");
    assert_eq!(rpc_error_code(&err), -32000);
}

#[tokio::test]
async fn toggle_plugin_returns_an_rpc_error_when_mcp_connect_fails() {
    let temp = crate::test_util::fresh_tempdir();
    let exe = std::env::current_exe()
        .expect("the test binary names itself")
        .to_string_lossy()
        .into_owned();
    let allowed = exe.clone();
    let (state, _store) = test_state_with(temp.path(), move |config| {
        config.allowed_commands = vec![allowed];
    })
    .await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();
    // A program the policy allows that is not an MCP server: it lists and exits,
    // so the handshake cannot complete and the failure has to surface.
    let manifest = serde_json::json!({
        "name": "Bad MCP Plugin",
        "transport": "stdio",
        "command": exe,
        "args": ["--list"],
        "enabled": false,
    })
    .to_string();
    let installed = rpc
        .install_plugin(&owner, manifest)
        .await
        .expect("plugin installs cleanly in disabled state");
    assert!(!installed.enabled);

    let err = rpc
        .toggle_plugin(&owner, installed.id, true)
        .await
        .expect_err("enabling a plugin whose server dies must fail with an RPC error");
    assert_eq!(rpc_error_code(&err), -32000);
}

/// R-KEEL checkpoint row 16: the row was written *before* the spawn, so a connect that
/// failed left it claiming `enabled` with no process behind it until the next toggle.
/// It is still the caller's error (the RPC contract above), but the row goes back.
#[tokio::test]
async fn a_failed_toggle_connect_leaves_the_row_disabled() {
    let temp = crate::test_util::fresh_tempdir();
    let exe = std::env::current_exe()
        .expect("the test binary names itself")
        .to_string_lossy()
        .into_owned();
    let allowed = exe.clone();
    let (state, _store) = test_state_with(temp.path(), move |config| {
        config.allowed_commands = vec![allowed];
    })
    .await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = owner_ext();
    let manifest = serde_json::json!({
        "name": "Bad MCP Plugin",
        "transport": "stdio",
        "command": exe,
        "args": ["--list"],
        "enabled": false,
    })
    .to_string();
    let installed = rpc
        .install_plugin(&owner, manifest)
        .await
        .expect("plugin installs cleanly in disabled state");

    let err = rpc
        .toggle_plugin(&owner, installed.id.clone(), true)
        .await
        .expect_err("enabling a plugin whose server dies must fail with an RPC error");
    assert_eq!(rpc_error_code(&err), -32000);

    let stored = state
        .settings
        .get_plugin(&installed.id)
        .await
        .expect("the catalog answers")
        .expect("the row is still there");
    assert!(
        !stored.enabled,
        "a failed connect must put the row back to disabled, not leave it enabled with no process"
    );
    assert!(
        state
            .mcp
            .list()
            .await
            .iter()
            .all(|connection| !connection.status.is_connected()),
        "a failed connect must not leave a connected server behind"
    );
}

/// The `configure` half of row 16: the new environment was persisted before the child
/// started, so a failed connect left the row naming an environment whose process never
/// existed. The caller keeps the connect's error; the row keeps its old environment.
#[tokio::test]
async fn a_failed_configure_connect_leaves_the_previous_environment() {
    let temp = crate::test_util::fresh_tempdir();
    let exe = std::env::current_exe()
        .expect("the test binary names itself")
        .to_string_lossy()
        .into_owned();
    let allowed = exe.clone();
    let (state, _store) = test_state_with(temp.path(), move |config| {
        config.allowed_commands = vec![allowed];
    })
    .await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = owner_ext();
    // Enabled but not connected: `install` files the row without spawning it, which is
    // the state `configure` re-launches from.
    let manifest = serde_json::json!({
        "name": "Configured Bad MCP Plugin",
        "transport": "stdio",
        "command": exe,
        "args": ["--list"],
        "enabled": true,
    })
    .to_string();
    let installed = rpc
        .install_plugin(&owner, manifest)
        .await
        .expect("plugin installs cleanly in enabled state");
    let before = state
        .settings
        .get_plugin(&installed.id)
        .await
        .expect("the catalog answers")
        .expect("the row exists")
        .env_json;

    let mut env = HashMap::new();
    env.insert(
        "GITHUB_TOKEN".to_string(),
        "material-never-launched".to_string(),
    );
    let err = rpc
        .configure_plugin(&owner, installed.id.clone(), env)
        .await
        .expect_err("configuring a pack whose server dies must fail with an RPC error");
    assert_eq!(rpc_error_code(&err), -32000);

    let after = state
        .settings
        .get_plugin(&installed.id)
        .await
        .expect("the catalog answers")
        .expect("the row is still there")
        .env_json;
    assert_eq!(
        after, before,
        "a failed connect must restore the previous environment instead of leaving the new one filed"
    );
    assert!(
        !after.contains("GITHUB_TOKEN"),
        "the environment whose child never started must not remain in the row: {after}"
    );
}

#[tokio::test]
async fn preview_policy_allows_allow_listed_quoted_path_with_spaces() {
    let temp = crate::test_util::fresh_tempdir();
    let custom_bin = "C:/Program Files/My Tools/dev-server.exe".to_string();
    let (state, _store) = test_state_with(temp.path(), |config| {
        config.allowed_commands = vec![custom_bin.clone()];
    })
    .await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();
    let cmd = format!("\"{custom_bin}\" --port 3000");
    let result = rpc.start_preview(&owner, "proj-1".to_string(), cmd).await;
    if let Err(err) = result {
        assert_ne!(
            rpc_error_code(&err),
            auth::rpc_codes::POLICY_REFUSED,
            "allow-listed quoted command was rejected by policy"
        );
    }
}

#[tokio::test]
async fn preview_policy_refuses_quoted_path_with_spaces_not_allowed() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();
    let cmd = "\"C:/Program Files/Disallowed Tool/evil.exe\" --port 3000".to_string();
    let err = rpc
        .start_preview(&owner, "proj-1".to_string(), cmd)
        .await
        .expect_err("disallowed quoted command must be rejected by policy");
    assert_eq!(
        rpc_error_code(&err),
        auth::rpc_codes::POLICY_REFUSED,
        "disallowed command must return POLICY_REFUSED (-32001)"
    );
}

#[test]
fn bootstrap_admin_token_is_never_sent_to_tracing_subscriber() {
    let capture = LogCapture::default();
    let subscriber = capture_subscriber(&capture);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("a current-thread runtime");
    let temp = crate::test_util::fresh_tempdir();
    let config_file = temp.path().join("config.toml");

    std::env::set_var("WARSHA_PRINT_BOOTSTRAP_TOKEN", "1");
    struct EnvGuard;
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            std::env::remove_var("WARSHA_PRINT_BOOTSTRAP_TOKEN");
        }
    }
    let _guard = EnvGuard;

    let token = tracing::subscriber::with_default(subscriber, || {
        runtime.block_on(async {
            let config = load_or_create_config(Some(&config_file))
                .await
                .expect("config created");
            config.auth_token
        })
    });

    assert!(!token.is_empty(), "token should be generated");
    assert_eq!(
        capture.count_matching("BOOTSTRAP_ADMIN_TOKEN"),
        0,
        "tracing subscriber saw BOOTSTRAP_ADMIN_TOKEN: {:?}",
        capture.lines()
    );
    assert_eq!(
        capture.count_matching(&token),
        0,
        "tracing subscriber saw the auth token: {:?}",
        capture.lines()
    );
}

/// The owner-only write is the only thing that keeps the daemon token's file out of
/// other accounts' reach on Unix, and nothing asserted it (R-KEEL checkpoint row 18).
/// `write_private_file` sets the mode on the temporary file **before** any content and
/// renames it into place, so this reads the finished file: mode `0600`, the new
/// content, no temporary left behind. The target starts out `0666` on purpose, so the
/// mode asserted is the write's rather than a fresh file's default or a directory's.
#[cfg(unix)]
#[test]
fn write_private_file_leaves_a_file_its_owner_alone_can_read_and_write() {
    use std::os::unix::fs::PermissionsExt;

    let temp = crate::test_util::fresh_tempdir();
    let path = temp.path().join("config.toml");
    std::fs::write(&path, "auth_token = \"stale\"\n").expect("a permissive file to replace");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o666))
        .expect("the permissive mode is set");

    write_private_file(&path, "auth_token = \"probe\"\n").expect("the private file writes");

    let mode = std::fs::metadata(&path)
        .expect("the finished file")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(
        mode, 0o600,
        "the private file must be readable and writable by its owner alone: mode was {mode:o}"
    );
    assert_eq!(
        std::fs::read_to_string(&path).expect("the finished file reads"),
        "auth_token = \"probe\"\n",
        "the rename must carry the new content, not the file it replaced"
    );
    let temporary = temp
        .path()
        .join(format!(".config.toml.tmp-{}", std::process::id()));
    assert!(
        !temporary.exists(),
        "the temporary file {temporary:?} must not survive the rename"
    );
}

#[tokio::test]
async fn create_pairing_returns_an_rpc_error_when_device_already_paired() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();
    let device_id = "test-device-duplicate".to_string();

    let first = rpc
        .create_pairing(&owner, device_id.clone(), "secret-1".to_string())
        .await
        .expect("first pairing creation succeeds");
    assert_eq!(first.device_id, device_id);

    let err = rpc
        .create_pairing(&owner, device_id.clone(), "secret-2".to_string())
        .await
        .expect_err("creating duplicate pairing must fail with an RPC error");
    assert_eq!(rpc_error_code(&err), -32000);
    assert!(
        err.message().contains("already paired"),
        "expected duplicate pairing error, got: {}",
        err.message()
    );
}

#[tokio::test]
async fn toggle_plugin_returns_an_rpc_error_when_mcp_disconnect_fails() {
    let temp = crate::test_util::fresh_tempdir();
    let exe = std::env::current_exe()
        .expect("the test binary names itself")
        .to_string_lossy()
        .into_owned();
    let allowed = exe.clone();
    let (state, _store) = test_state_with(temp.path(), move |config| {
        config.allowed_commands = vec![allowed];
    })
    .await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();
    let manifest = serde_json::json!({
        "name": "Enabled Plugin For Disconnect",
        "transport": "stdio",
        "command": exe,
        "args": ["--list"],
        "enabled": true,
    })
    .to_string();
    let installed = rpc
        .install_plugin(&owner, manifest)
        .await
        .expect("plugin installs cleanly in enabled state");
    assert!(installed.enabled);

    let err = rpc
        .toggle_plugin(&owner, installed.id, false)
        .await
        .expect_err("disabling an unconnected plugin must fail with an RPC error");
    assert_eq!(rpc_error_code(&err), -32000);
}

#[tokio::test]
async fn get_active_harness_db_error_returns_an_rpc_error() {
    let temp = crate::test_util::fresh_tempdir();
    let corrupt_db = temp.path().join("corrupt_warsha.db");
    std::fs::write(&corrupt_db, b"not-a-sqlite-database-header")
        .expect("corrupt database file written");
    let settings = Arc::new(SettingsStore::open_unvalidated(&corrupt_db));
    let (state, _store) = test_state_with_custom_settings(temp.path(), settings).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();
    let err = rpc
        .list_harnesses(&owner)
        .await
        .expect_err("corrupt settings db in list_harnesses must fail with an RPC error");
    assert_eq!(rpc_error_code(&err), -32000);
}

mod runs_resume {
    use super::*;

    #[tokio::test]
    async fn runs_resume_requires_authorization_and_allows_session() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Resume Auth Project".to_string(),
                "Test auth on runs.resume".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");
        let run = rpc
            .start_run(
                &owner,
                project.id,
                "Idea for resume auth".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("run started");

        // Anonymous caller must be refused with unauthorized.
        let unauth_err = rpc
            .resume_run(&anonymous_ext(), run.id)
            .await
            .expect_err("unauthenticated runs.resume must be refused");
        assert_eq!(
            rpc_error_code(&unauth_err),
            auth::rpc_codes::UNAUTHENTICATED
        );

        // Pause the run via interruption recovery and verify a paired session can resume it.
        store.recover_interrupted_runs().await.unwrap();
        let device = DeviceId::new().to_string();
        seed_pairing(&rpc.state, &device).await;
        let paired = paired_ext(&device);
        let resumed = rpc
            .resume_run(&paired, run.id)
            .await
            .expect("paired session can resume a paused run");
        assert_eq!(resumed.status, RunStatus::Running);
    }

    #[tokio::test]
    async fn runs_resume_resumes_paused_run_after_change_request() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Change Request Loop Project".to_string(),
                "Test change-request resume".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");
        let run = rpc
            .start_run(
                &owner,
                project.id,
                "Clinic booking app".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("run started");

        // Advance Idea -> GateA.
        let at_gate = rpc
            .advance_run(&owner, run.id)
            .await
            .expect("advance to GateA");
        assert_eq!(at_gate.current_stage, Stage::GateA);

        // Request changes -> run pauses at GateA with ChangesRequested.
        let paused = rpc
            .request_changes(
                &owner,
                run.id,
                Stage::GateA,
                "Add bilingual receipts".to_string(),
                None,
            )
            .await
            .expect("request_changes succeeds");
        assert_eq!(paused.status, RunStatus::Paused);

        // Resume via runs.resume -> re-opens GateA to Pending and re-runs producing stage.
        let resumed = rpc
            .resume_run(&owner, run.id)
            .await
            .expect("runs.resume succeeds");
        assert_eq!(resumed.status, RunStatus::Running);
        assert_eq!(resumed.current_stage, Stage::GateA);
        assert_eq!(resumed.gate_states[&Stage::GateA], GateState::Pending);

        // Approving GateA now succeeds.
        let approved = rpc
            .approve_gate(&owner, run.id, Stage::GateA, None)
            .await
            .expect("approve after resume succeeds");
        assert!(matches!(
            approved.gate_states[&Stage::GateA],
            GateState::Approved { .. }
        ));
    }

    #[tokio::test]
    async fn runs_resume_gate_c_changes_requested_reruns_coder_then_reviewer() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;

        for &role in Role::all() {
            state.providers.write().await.set_role_routing(RoleRouting {
                role,
                targets: vec![RoutingTarget {
                    provider_id: "mock".to_string(),
                    model_id: "mock-model".to_string(),
                    weight: 100,
                }],
                fallback_enabled: false,
                budget_cents_per_run: None,
            });
        }

        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Gate C Resume Project".to_string(),
                "Test Gate C change-request resume".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");
        let run = rpc
            .start_run(
                &owner,
                project.id,
                "Web application".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("run started");

        // Advance to GateA -> Approve GateA
        let at_gate_a = rpc
            .advance_run(&owner, run.id)
            .await
            .expect("advance to GateA");
        assert_eq!(at_gate_a.current_stage, Stage::GateA);
        rpc.approve_gate(&owner, run.id, Stage::GateA, None)
            .await
            .expect("approve GateA");

        // Advance to GateB -> Approve GateB
        let at_gate_b = rpc
            .advance_run(&owner, run.id)
            .await
            .expect("advance to GateB");
        assert_eq!(at_gate_b.current_stage, Stage::GateB);
        rpc.approve_gate(&owner, run.id, Stage::GateB, None)
            .await
            .expect("approve GateB");

        // Advance through Design -> Plan -> Code -> Review -> GateC
        let at_gate_c = rpc
            .advance_run(&owner, run.id)
            .await
            .expect("advance to GateC");
        assert_eq!(at_gate_c.current_stage, Stage::GateC);
        assert_eq!(at_gate_c.gate_states[&Stage::GateC], GateState::Pending);

        // Count sessions for Coder and Reviewer before resume
        let sessions_before = store
            .list_sessions_by_run(run.id)
            .await
            .expect("list sessions");
        let coder_sessions_before = sessions_before
            .iter()
            .filter(|s| s.role == Role::Coder)
            .count();
        let reviewer_sessions_before = sessions_before
            .iter()
            .filter(|s| s.role == Role::Reviewer)
            .count();
        assert_eq!(coder_sessions_before, 1, "coder ran once before Gate-C");
        assert_eq!(
            reviewer_sessions_before, 1,
            "reviewer ran once before Gate-C"
        );

        // Request changes at GateC
        let paused = rpc
            .request_changes(
                &owner,
                run.id,
                Stage::GateC,
                "Missing core implementation".to_string(),
                None,
            )
            .await
            .expect("request_changes succeeds");
        assert_eq!(paused.status, RunStatus::Paused);

        // Resume via runs.resume -> re-runs Coder, then re-runs Reviewer, then stops at GateC
        let resumed = rpc
            .resume_run(&owner, run.id)
            .await
            .expect("runs.resume succeeds");
        assert_eq!(resumed.status, RunStatus::Running);
        assert_eq!(resumed.current_stage, Stage::GateC);
        assert_eq!(resumed.gate_states[&Stage::GateC], GateState::Pending);

        // Verify Coder and Reviewer both re-executed
        let sessions_after = store
            .list_sessions_by_run(run.id)
            .await
            .expect("list sessions");
        let coder_sessions_after = sessions_after
            .iter()
            .filter(|s| s.role == Role::Coder)
            .count();
        let reviewer_sessions_after = sessions_after
            .iter()
            .filter(|s| s.role == Role::Reviewer)
            .count();
        assert_eq!(
            coder_sessions_after, 2,
            "coder must re-run on Gate-C resume"
        );
        assert_eq!(
            reviewer_sessions_after, 2,
            "reviewer must re-run on Gate-C resume"
        );

        // Approving GateC now succeeds
        let approved = rpc
            .approve_gate(&owner, run.id, Stage::GateC, None)
            .await
            .expect("approve GateC succeeds");
        assert!(matches!(
            approved.gate_states[&Stage::GateC],
            GateState::Approved { .. }
        ));
    }

    #[tokio::test]
    async fn runs_resume_budget_paused_run_succeeds_after_budget_set() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Budget Resume Project".to_string(),
                "Test budget pause & resume".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");
        let run = rpc
            .start_run(
                &owner,
                project.id,
                "Budgeted project".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("run started");

        // Simulate a budget-paused run (spent_cents == 100, budget_cents == 100).
        let (mut stored, v) = store.get_run_versioned(run.id).await.unwrap();
        stored.budget_cents = Some(100);
        stored.spent_cents = 100;
        stored.status = RunStatus::Paused;
        store.update_run_cas(&stored, v).await.unwrap();

        // Resuming before increasing budget fails.
        let err = rpc
            .resume_run(&owner, run.id)
            .await
            .expect_err("runs.resume must refuse while budget is exceeded");
        assert!(
            err.message().contains("Budget exceeded"),
            "unexpected error: {}",
            err.message()
        );

        // Increase budget via budget.set RPC.
        rpc.set_budget(&owner, project.id, 500)
            .await
            .expect("budget.set succeeds");

        // Now runs.resume succeeds.
        let resumed = rpc
            .resume_run(&owner, run.id)
            .await
            .expect("runs.resume succeeds after budget.set");
        assert_eq!(resumed.status, RunStatus::Running);
        assert_eq!(resumed.current_stage, Stage::GateA);
    }

    #[tokio::test]
    async fn daemon_restart_recovers_interrupted_run_and_runs_resume_resumes_it() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().to_path_buf();

        let run_id = {
            let store = Store::open_at(data_dir.join("warsha.db"))
                .await
                .expect("store opens");
            let now = Utc::now();
            let project = Project {
                id: ProjectId::new(),
                name: "Restart Recovery Project".to_string(),
                description: "Verify restart recovery".to_string(),
                language: "en".to_string(),
                created_at: now,
                updated_at: now,
                repo_path: None,
                repo_url: None,
                ..Default::default()
            };
            store.create_project(&project).await.unwrap();

            let mut gate_states = HashMap::new();
            for stage in Stage::all() {
                if stage.is_gate() {
                    gate_states.insert(*stage, GateState::Pending);
                }
            }
            let run = Run {
                id: RunId::new(),
                project_id: project.id,
                current_stage: Stage::Idea,
                gate_states: HashMap::new(),
                run_mode: warsha_core::RunMode::Agent,
                artifacts: HashMap::new(),
                created_at: now,
                updated_at: now,
                status: RunStatus::Running,
                budget_cents: None,
                spent_cents: 0,
                worktree_path: None,
                worktree_branch: None,
                confinement: None,
            };
            store.create_run(&run).await.unwrap();
            run.id
        };

        // Re-open / start daemon state over the existing data directory.
        let (state, store) = test_state(&data_dir).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        // Check that runs.get sees status = paused.
        let reloaded = rpc.get_run(&owner, run_id).await.unwrap();
        assert_eq!(reloaded.status, RunStatus::Paused);

        // Check that runs.events carries an {action: run_interrupted} event.
        let events = store.get_events(run_id).await.unwrap();
        assert!(events
            .iter()
            .any(|e| e.payload["action"] == "run_interrupted"));

        // Call runs.resume to resume the interrupted run.
        let resumed = rpc.resume_run(&owner, run_id).await.unwrap();
        assert_eq!(resumed.status, RunStatus::Running);
    }
}

mod runs_start_budget {
    use super::*;

    /// P-E1a: the start-time refusal surfaces through `runs.start`, and the
    /// owner's remedy — `budget.set` — makes the next `runs.start` succeed.
    #[tokio::test]
    async fn runs_start_refuses_over_budget_project_and_succeeds_after_budget_set() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Budget Start Project".to_string(),
                "Test start-time budget refusal".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");
        let run = rpc
            .start_run(
                &owner,
                project.id,
                "Budgeted project".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("first run starts");

        // The project's newest run has spent its whole budget.
        let (mut stored, version) = store.get_run_versioned(run.id).await.unwrap();
        stored.budget_cents = Some(100);
        stored.spent_cents = 100;
        stored.status = RunStatus::Paused;
        store.update_run_cas(&stored, version).await.unwrap();

        // runs.start is refused with the pipeline's message naming both numbers.
        let err = rpc
            .start_run(
                &owner,
                project.id,
                "Second run".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect_err("runs.start must refuse an over-budget project");
        assert!(
            err.message().contains("Project budget exhausted"),
            "unexpected error: {}",
            err.message()
        );
        assert!(
            err.message().contains("spent 100 of 100 cents"),
            "the refusal must name the spent and the budget: {}",
            err.message()
        );

        // budget.set raises the budget; the retried runs.start now succeeds and
        // the new run carries the raised budget.
        rpc.set_budget(&owner, project.id, 500)
            .await
            .expect("budget.set succeeds");
        let second = rpc
            .start_run(
                &owner,
                project.id,
                "Second run".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("runs.start succeeds after budget.set");
        assert_eq!(second.budget_cents, Some(500));
        // M-1: intake is dispatched on a background task, so the 1-cent charge it
        // records lands just after `runs.start` returns.
        await_intake_settled(&store, second.id).await;
        let settled = store.get_run(second.id).await.expect("the run is read");
        assert_eq!(settled.spent_cents, 1);
    }

    /// D-R11-BUDGET-1: the budget passed to `runs.start` is the budget the run
    /// records. Before the fix the argument did not exist, so a start recorded
    /// the inherited budget (here the prior run's 700) and ignored the owner's 5.
    #[tokio::test]
    async fn runs_start_records_the_budget_it_was_given() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Explicit Start Budget".to_string(),
                "The start call names the budget".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");
        let first = rpc
            .start_run(
                &owner,
                project.id,
                "Inherited budget".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("first run starts");
        let (mut stored, version) = store.get_run_versioned(first.id).await.unwrap();
        stored.budget_cents = Some(700);
        stored.status = RunStatus::Paused;
        store.update_run_cas(&stored, version).await.unwrap();

        let started = rpc
            .start_run(
                &owner,
                project.id,
                "Owner set five cents".to_string(),
                None,
                None,
                Some(5),
            )
            .await
            .expect("runs.start with an explicit budget succeeds");
        assert_eq!(started.budget_cents, Some(5));
        let recorded = store.get_run(started.id).await.unwrap();
        assert_eq!(recorded.budget_cents, Some(5));
    }

    /// N2 fix: `budget.set` and `budget.show` on a brand-new project with no runs
    /// must succeed without returning "No runs found for project".
    #[tokio::test]
    async fn budget_set_and_show_succeed_on_runless_project() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Runless Budget Project".to_string(),
                "A project that has no runs yet".to_string(),
                "ar".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");

        // 1. Calling show_budget before any run exists returns spent: 0, budget: None
        let initial_status = rpc
            .show_budget(&owner, project.id)
            .await
            .expect("show_budget on runless project must succeed");
        assert_eq!(initial_status.project_id, project.id);
        assert_eq!(initial_status.spent_cents, 0);
        assert_eq!(initial_status.budget_cents, None);
        assert_eq!(initial_status.remaining_cents, None);

        // 2. Calling set_budget on runless project succeeds (does NOT error with "No runs found for project")
        rpc.set_budget(&owner, project.id, 2500)
            .await
            .expect("set_budget on runless project must succeed");

        // 3. Calling show_budget again reflects the pending budget
        let updated_status = rpc
            .show_budget(&owner, project.id)
            .await
            .expect("show_budget after set_budget on runless project must succeed");
        assert_eq!(updated_status.project_id, project.id);
        assert_eq!(updated_status.spent_cents, 0);
        assert_eq!(updated_status.budget_cents, Some(2500));
        assert_eq!(updated_status.remaining_cents, Some(2500));

        // 4. Start a run for that project — start_run consumes the pending budget and applies it to the run
        let run = rpc
            .start_run(
                &owner,
                project.id,
                "Build an online bookstore".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("start_run must succeed");
        assert_eq!(run.budget_cents, Some(2500));
        // M-1: intake is dispatched on a background task, so the 1-cent charge it
        // records lands just after `runs.start` returns.
        await_intake_settled(&_store, run.id).await;

        // 5. show_budget after run creation must report the pending cents stored on the run (not None)
        let post_run_status = rpc
            .show_budget(&owner, project.id)
            .await
            .expect("show_budget after start_run must succeed");
        assert_eq!(post_run_status.project_id, project.id);
        assert_eq!(post_run_status.spent_cents, 1);
        assert_eq!(post_run_status.budget_cents, Some(2500));
        assert_eq!(post_run_status.remaining_cents, Some(2499));

        // 6. Calling show_budget / set_budget on a non-existent project fails with error
        let non_existent = ProjectId(uuid::Uuid::new_v4());
        assert!(
            rpc.show_budget(&owner, non_existent).await.is_err(),
            "show_budget on non-existent project must fail"
        );
        assert!(
            rpc.set_budget(&owner, non_existent, 1000).await.is_err(),
            "set_budget on non-existent project must fail"
        );
    }

    #[tokio::test]
    async fn apply_start_budget_propagates_failure() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let project = Project {
            id: ProjectId::new(),
            name: "Budget Error Project".to_string(),
            description: "Test".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            ..Default::default()
        };
        store
            .create_project(&project)
            .await
            .expect("project created");
        let phantom_run = Run {
            id: RunId::new(),
            project_id: project.id,
            current_stage: Stage::Idea,
            gate_states: HashMap::new(),
            artifacts: HashMap::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            status: RunStatus::Running,
            budget_cents: None,
            spent_cents: 0,
            worktree_path: None,
            worktree_branch: None,
            confinement: None,
            run_mode: warsha_core::RunMode::Agent,
        };

        let result = crate::apply_start_budget(&state, project.id, phantom_run, Some(500)).await;
        assert!(
            result.is_err(),
            "apply_start_budget must propagate set_run_budget failure rather than swallow it"
        );
    }

    #[tokio::test]
    async fn runs_start_budget_failure_marks_run_failed_and_leaves_no_running_row() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Injected Budget Fail".to_string(),
                "Budget fail test".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");

        sqlx::query(
            "CREATE TRIGGER fail_budget_update BEFORE UPDATE OF budget_cents ON runs \
             WHEN OLD.version >= 2 \
             BEGIN SELECT RAISE(ABORT, 'injected budget persistence failure'); END;",
        )
        .execute(store.pool())
        .await
        .expect("trigger created");

        let start_res = rpc
            .start_run(
                &owner,
                project.id,
                "Build something".to_string(),
                None,
                None,
                Some(500),
            )
            .await;
        assert!(
            start_res.is_err(),
            "runs.start must fail when budget update fails"
        );

        let runs = rpc
            .list_runs(&owner, project.id)
            .await
            .expect("runs listed");
        assert!(
            !runs
                .iter()
                .any(|r| r.status == warsha_core::RunStatus::Running),
            "no running row must remain after start budget failure: {:?}",
            runs
        );
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, warsha_core::RunStatus::Failed);
    }

    #[tokio::test]
    async fn runs_start_budget_failure_cleans_up_worktree_dir() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let repo_dir = crate::test_util::fresh_tempdir();
        std::fs::write(repo_dir.path().join("base.txt"), "base").expect("base file");
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
            vec!["add", "."],
            vec!["commit", "-qm", "base"],
        ] {
            let status = std::process::Command::new("git")
                .current_dir(repo_dir.path())
                .args(&args)
                .status()
                .expect("git runs");
            assert!(status.success(), "git {args:?} failed");
        }

        let project = rpc
            .create_project(
                &owner,
                "Budget Fail Worktree Cleanup".to_string(),
                "Budget fail worktree test".to_string(),
                "en".to_string(),
                None,
                None,
                Some(repo_dir.path().to_str().expect("utf8 path").to_string()),
                None,
            )
            .await
            .expect("project created");

        sqlx::query(
            "CREATE TRIGGER fail_budget_update_cleanup BEFORE UPDATE OF budget_cents ON runs \
             WHEN OLD.version >= 3 \
             BEGIN SELECT RAISE(ABORT, 'injected budget persistence failure'); END;",
        )
        .execute(store.pool())
        .await
        .expect("trigger created");

        let start_res = rpc
            .start_run(
                &owner,
                project.id,
                "Build something".to_string(),
                None,
                None,
                Some(500),
            )
            .await;
        assert!(
            start_res.is_err(),
            "runs.start must fail when budget update fails"
        );

        let runs = rpc
            .list_runs(&owner, project.id)
            .await
            .expect("runs listed");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, warsha_core::RunStatus::Failed);

        let worktree_path_str = runs[0]
            .worktree_path
            .as_ref()
            .expect("worktree path recorded on run");
        let worktree_path = std::path::PathBuf::from(worktree_path_str);

        // N13-4 proving assertion: worktree directory must be removed from disk
        assert!(
            !worktree_path.exists(),
            "worktree directory `{}` must be cleaned up on budget failure",
            worktree_path.display()
        );

        // In-memory map must also be clean
        assert!(
            !state.run_worktrees.read().await.contains_key(&runs[0].id),
            "run_worktrees map must not contain failed run"
        );
    }

    #[tokio::test]
    async fn fallback_cleanup_deregisters_worktree_and_deletes_branch_when_map_entry_missing() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let repo_dir = crate::test_util::fresh_tempdir();
        std::fs::write(repo_dir.path().join("base.txt"), "base").expect("base file");
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
            vec!["add", "."],
            vec!["commit", "-qm", "base"],
        ] {
            let status = std::process::Command::new("git")
                .current_dir(repo_dir.path())
                .args(&args)
                .status()
                .expect("git runs");
            assert!(status.success(), "git {args:?} failed");
        }

        let project = rpc
            .create_project(
                &owner,
                "Fallback Cleanup Proving Project".to_string(),
                "Testing fallback cleanup arm".to_string(),
                "en".to_string(),
                None,
                None,
                Some(repo_dir.path().to_str().expect("utf8 path").to_string()),
                None,
            )
            .await
            .expect("project created");

        let run_id = RunId::new();
        let worktrees_root = crate::test_util::fresh_tempdir();
        let worktree = warsha_pipeline::create_run_worktree(
            repo_dir.path(),
            worktrees_root.path(),
            &run_id.0.to_string(),
            "HEAD",
        )
        .await
        .expect("worktree created");

        let branch_name = format!("warsha/run-{}", run_id.0);

        assert!(worktree.path.exists());
        let list_out = std::process::Command::new("git")
            .current_dir(repo_dir.path())
            .args(["worktree", "list", "--porcelain"])
            .output()
            .expect("worktree list");
        assert!(String::from_utf8_lossy(&list_out.stdout)
            .contains(&worktree.path.to_string_lossy().to_string()));

        let branch_out = std::process::Command::new("git")
            .current_dir(repo_dir.path())
            .args(["branch", "--list", &branch_name])
            .output()
            .expect("branch list");
        assert!(String::from_utf8_lossy(&branch_out.stdout).contains(&branch_name));

        let run = Run {
            id: run_id,
            project_id: project.id,
            current_stage: Stage::Idea,
            gate_states: HashMap::new(),
            artifacts: HashMap::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            status: RunStatus::Running,
            budget_cents: None,
            spent_cents: 0,
            worktree_path: Some(worktree.path.to_string_lossy().to_string()),
            worktree_branch: Some(branch_name.clone()),
            confinement: None,
            run_mode: warsha_core::RunMode::Agent,
        };
        store.create_run(&run).await.expect("run created");

        // Explicitly assert state.run_worktrees map entry is missing
        assert!(!state.run_worktrees.read().await.contains_key(&run_id));

        // Inject budget update failure
        sqlx::query(
            "CREATE TRIGGER fail_budget_update_fallback BEFORE UPDATE OF budget_cents ON runs \
             BEGIN SELECT RAISE(ABORT, 'injected budget persistence failure'); END;",
        )
        .execute(store.pool())
        .await
        .expect("trigger created");

        let res = crate::apply_start_budget(&state, project.id, run, Some(500)).await;
        assert!(res.is_err(), "apply_start_budget must fail");

        // 1. Directory removed
        assert!(
            !worktree.path.exists(),
            "worktree directory must be removed in fallback arm"
        );

        // 2. Worktree deregistered
        let list_after = std::process::Command::new("git")
            .current_dir(repo_dir.path())
            .args(["worktree", "list", "--porcelain"])
            .output()
            .expect("worktree list");
        let list_str = String::from_utf8_lossy(&list_after.stdout);
        assert!(
            !list_str.contains(&worktree.path.to_string_lossy().to_string()),
            "worktree must be deregistered from git"
        );

        // 3. Run branch deleted
        let branch_after = std::process::Command::new("git")
            .current_dir(repo_dir.path())
            .args(["branch", "--list", &branch_name])
            .output()
            .expect("branch list");
        let branch_str = String::from_utf8_lossy(&branch_after.stdout);
        assert!(
            branch_str.trim().is_empty(),
            "run branch must be deleted in fallback arm"
        );
    }

    #[tokio::test]
    async fn fallback_cleanup_uses_worktree_branch_hint_when_porcelain_lookup_yields_none() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let repo_dir = crate::test_util::fresh_tempdir();
        std::fs::write(repo_dir.path().join("base.txt"), "base").expect("base file");
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
            vec!["add", "."],
            vec!["commit", "-qm", "base"],
        ] {
            let status = std::process::Command::new("git")
                .current_dir(repo_dir.path())
                .args(&args)
                .status()
                .expect("git runs");
            assert!(status.success(), "git {args:?} failed");
        }

        let project = rpc
            .create_project(
                &owner,
                "Fallback Hint Proving Project".to_string(),
                "Testing fallback branch hint".to_string(),
                "en".to_string(),
                None,
                None,
                Some(repo_dir.path().to_str().expect("utf8 path").to_string()),
                None,
            )
            .await
            .expect("project created");

        let run_id = RunId::new();
        let branch_name = format!("warsha/run-{}", run_id.0);

        // Create the branch in the git repo directly without registering a worktree
        // so porcelain lookup yields None
        let status = std::process::Command::new("git")
            .current_dir(repo_dir.path())
            .args(["branch", &branch_name])
            .status()
            .expect("git branch created");
        assert!(status.success());

        // Create a non-existent dummy worktree path
        let non_existent_wt_path = repo_dir.path().join("does-not-exist-worktree");

        let run = Run {
            id: run_id,
            project_id: project.id,
            current_stage: Stage::Idea,
            gate_states: HashMap::new(),
            artifacts: HashMap::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            status: RunStatus::Running,
            budget_cents: None,
            spent_cents: 0,
            worktree_path: Some(non_existent_wt_path.to_string_lossy().to_string()),
            worktree_branch: Some(branch_name.clone()),
            confinement: None,
            run_mode: warsha_core::RunMode::Agent,
        };
        store.create_run(&run).await.expect("run created");

        // Inject budget update failure
        sqlx::query(
            "CREATE TRIGGER fail_budget_update_fallback_hint BEFORE UPDATE OF budget_cents ON runs \
             BEGIN SELECT RAISE(ABORT, 'injected budget persistence failure'); END;",
        )
        .execute(store.pool())
        .await
        .expect("trigger created");

        let res = crate::apply_start_budget(&state, project.id, run, Some(500)).await;
        assert!(res.is_err(), "apply_start_budget must fail");

        // Verify run branch was deleted using run.worktree_branch hint
        let branch_after = std::process::Command::new("git")
            .current_dir(repo_dir.path())
            .args(["branch", "--list", &branch_name])
            .output()
            .expect("branch list");
        let branch_str = String::from_utf8_lossy(&branch_after.stdout);
        assert!(
            branch_str.trim().is_empty(),
            "run branch must be deleted via fallback branch hint when porcelain lookup yields None"
        );
    }

    #[tokio::test]
    async fn fallback_cleanup_branch_hint_preserves_non_warsha_branch_prefix_guard() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let repo_dir = crate::test_util::fresh_tempdir();
        std::fs::write(repo_dir.path().join("base.txt"), "base").expect("base file");
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
            vec!["add", "."],
            vec!["commit", "-qm", "base"],
        ] {
            let status = std::process::Command::new("git")
                .current_dir(repo_dir.path())
                .args(&args)
                .status()
                .expect("git runs");
            assert!(status.success(), "git {args:?} failed");
        }

        let project = rpc
            .create_project(
                &owner,
                "Prefix Guard Proving Project".to_string(),
                "Testing prefix guard on branch hint".to_string(),
                "en".to_string(),
                None,
                None,
                Some(repo_dir.path().to_str().expect("utf8 path").to_string()),
                None,
            )
            .await
            .expect("project created");

        // Create a custom branch without warsha/run- prefix
        let safe_branch = "user-protected-branch";
        let status = std::process::Command::new("git")
            .current_dir(repo_dir.path())
            .args(["branch", safe_branch])
            .status()
            .expect("git branch created");
        assert!(status.success());

        let run_id = RunId::new();
        let non_existent_wt_path = repo_dir.path().join("does-not-exist-worktree");

        let run = Run {
            id: run_id,
            project_id: project.id,
            current_stage: Stage::Idea,
            gate_states: HashMap::new(),
            artifacts: HashMap::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            status: RunStatus::Running,
            budget_cents: None,
            spent_cents: 0,
            worktree_path: Some(non_existent_wt_path.to_string_lossy().to_string()),
            worktree_branch: Some(safe_branch.to_string()),
            confinement: None,
            run_mode: warsha_core::RunMode::Agent,
        };
        store.create_run(&run).await.expect("run created");

        // Inject budget update failure
        sqlx::query(
            "CREATE TRIGGER fail_budget_update_prefix_guard BEFORE UPDATE OF budget_cents ON runs \
             BEGIN SELECT RAISE(ABORT, 'injected budget persistence failure'); END;",
        )
        .execute(store.pool())
        .await
        .expect("trigger created");

        let res = crate::apply_start_budget(&state, project.id, run, Some(500)).await;
        assert!(res.is_err(), "apply_start_budget must fail");

        // Verify protected branch was NOT deleted because of prefix guard
        let branch_after = std::process::Command::new("git")
            .current_dir(repo_dir.path())
            .args(["branch", "--list", safe_branch])
            .output()
            .expect("branch list");
        let branch_str = String::from_utf8_lossy(&branch_after.stdout);
        assert!(
            branch_str.contains(safe_branch),
            "protected branch without warsha/run- prefix must not be deleted by fallback hint"
        );
    }

    #[tokio::test]
    async fn explicit_budget_on_runs_start_lifts_project_exhaustion() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Exhausted Budget Project".to_string(),
                "Testing budget exhaustion lift".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");

        // Start first run with budget 0: project budget becomes 0, spent 0 (exhausted)
        let first = rpc
            .start_run(
                &owner,
                project.id,
                "Run 1 with zero budget".to_string(),
                None,
                None,
                Some(0),
            )
            .await
            .expect("start_run with budget 0 succeeds");
        assert_eq!(first.budget_cents, Some(0));

        // Starting a second run with None for budget_cents fails because project budget is exhausted
        let err = rpc
            .start_run(
                &owner,
                project.id,
                "Run 2 without budget".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect_err(
                "second run without explicit budget must be refused due to project exhaustion",
            );
        assert!(
            err.message().contains("spent 0 of 0 cents")
                || err.message().to_lowercase().contains("exhausted"),
            "error must cite exhaustion: {:?}",
            err.message()
        );

        // Starting a third run with an explicit budget of 11 lifts exhaustion and succeeds
        let third = rpc
            .start_run(
                &owner,
                project.id,
                "Run 3 with explicit budget 11".to_string(),
                None,
                None,
                Some(11),
            )
            .await
            .expect("start_run with explicit budget 11 must succeed and lift project exhaustion");
        assert_eq!(third.budget_cents, Some(11));
    }
}

mod runs_followup {
    use super::*;

    #[tokio::test]
    async fn stale_followup_cannot_resurrect_cancel_and_valid_followup_bumps_version() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Followup Integrity Project".to_string(),
                "Test followup CAS and cancel refusal".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");
        // The pipeline's own start, not `runs.start`: the RPC spawns an intake task
        // that commits the brief and the Idea -> GateA advance, each a version bump
        // of its own. This test counts the versions that followup and cancel write,
        // so it must be the only writer on the run row.
        let run = state
            .pipeline
            .start_run(project.id, "Initial idea")
            .await
            .expect("run started");

        let (initial_run, initial_version) = store
            .get_run_versioned(run.id)
            .await
            .expect("initial versioned run");
        assert_eq!(initial_run.status, RunStatus::Running);

        // 1. Valid followup succeeds and bumps the version (initial_version -> initial_version + 1).
        let followed = rpc
            .followup_run(
                &owner,
                run.id,
                "Clarify onboarding requirements".to_string(),
            )
            .await
            .expect("valid followup succeeds");
        assert_eq!(followed.status, RunStatus::Running);

        let (bumped_run, bumped_version) = store
            .get_run_versioned(run.id)
            .await
            .expect("reloaded versioned run");
        assert_eq!(
            bumped_version,
            initial_version + 1,
            "valid followup must bump run version"
        );
        assert!(bumped_run.artifacts.contains_key("followup"));

        // 2. Cancel the run — bumps version again (initial_version + 1 -> initial_version + 2).
        let cancelled = rpc
            .cancel_run(&owner, run.id, Some("User cancelled".to_string()))
            .await
            .expect("cancel succeeds");
        assert_eq!(cancelled.status, RunStatus::Cancelled);

        let (cancelled_run, cancel_version) = store
            .get_run_versioned(run.id)
            .await
            .expect("cancelled versioned run");
        assert_eq!(cancel_version, initial_version + 2);
        assert_eq!(cancelled_run.status, RunStatus::Cancelled);

        // 3. Followup on a cancelled run must be refused with an RPC error and not resurrect it.
        let cancel_err = rpc
            .followup_run(&owner, run.id, "Attempt followup after cancel".to_string())
            .await
            .expect_err("followup on cancelled run must be refused");
        assert!(
            cancel_err.message().contains("cancelled"),
            "expected cancelled refusal message, got: {}",
            cancel_err.message()
        );

        // 4. Verify stale snapshot cannot overwrite Cancelled status via CAS.
        let mut stale_snapshot = bumped_run.clone(); // Running at bumped_version
        stale_snapshot.updated_at = Utc::now();
        let stale_cas = store.update_run_cas(&stale_snapshot, bumped_version).await;
        assert!(
            stale_cas.is_err(),
            "stale followup snapshot must fail CAS against cancelled version"
        );

        let (after_run, after_version) = store.get_run_versioned(run.id).await.unwrap();
        assert_eq!(after_run.status, RunStatus::Cancelled);
        assert_eq!(after_version, cancel_version);

        // 5. In-flight cancel signal on a live run also refuses followup before DB commit.
        // Same reason as above: no intake task may bump the version under the
        // "refused followup must not bump version" assertion.
        let run2 = state
            .pipeline
            .start_run(project.id, "In-flight cancel signal test")
            .await
            .expect("run2 started");
        let (_, run2_initial_v) = store.get_run_versioned(run2.id).await.unwrap();
        let ctrl2 = state.pipeline.control_for(run2.id).await;
        let _ = ctrl2.cancel_tx.send(true);
        let flag_err = rpc
            .followup_run(&owner, run2.id, "Should see cancel signal".to_string())
            .await
            .expect_err("followup must be refused when cancel signal is set");
        assert!(flag_err.message().contains("cancelled"));
        let (run2_after, run2_v) = store.get_run_versioned(run2.id).await.unwrap();
        assert_eq!(
            run2_v, run2_initial_v,
            "refused followup under cancel flag must not bump version"
        );
        assert!(!run2_after.artifacts.contains_key("followup"));

        // 6. Terminal (Completed) run must also refuse followup with an RPC error.
        let mut completed_run = bumped_run;
        completed_run.id = RunId::new();
        completed_run.status = RunStatus::Completed;
        store.create_run(&completed_run).await.unwrap();
        let terminal_err = rpc
            .followup_run(&owner, completed_run.id, "Late followup".to_string())
            .await
            .expect_err("followup on terminal run must be refused");
        assert!(
            terminal_err.message().contains("terminal"),
            "expected terminal refusal message, got: {}",
            terminal_err.message()
        );
    }
}

mod provider_truth {
    use super::*;

    #[tokio::test]
    async fn unrouted_stage_role_returns_explicit_error_and_writes_zero_artifacts() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Provider Truth Project".to_string(),
                "Verify unrouted role fails explicitly".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");
        let run = rpc
            .start_run(
                &owner,
                project.id,
                "Task tracker app".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("run started");

        // Advance Idea -> GateA.
        let at_gate = rpc
            .advance_run(&owner, run.id)
            .await
            .expect("advance to GateA succeeds");
        assert_eq!(at_gate.current_stage, Stage::GateA);

        // Approve GateA.
        rpc.approve_gate(&owner, run.id, Stage::GateA, None)
            .await
            .expect("GateA approves");

        // Next advance attempts Stage::Research (Role::Researcher), which is unrouted.
        let err = rpc
            .advance_run(&owner, run.id)
            .await
            .expect_err("unrouted stage role must return an explicit error");
        assert!(
            err.message().contains("No provider routed") || err.message().contains("Researcher"),
            "unexpected error message: {}",
            err.message()
        );

        // Verify zero artifacts were fabricated for research.
        let reloaded = store.get_run(run.id).await.expect("reloaded run");
        assert!(
            !reloaded.artifacts.contains_key("research"),
            "no artifact must be fabricated when role is unrouted"
        );
        assert_eq!(reloaded.status, RunStatus::Paused);

        // Verify a provider_required error event was emitted.
        let events = store.get_events(run.id).await.expect("events reloaded");
        assert!(
            events
                .iter()
                .any(|e| e.payload["action"] == "provider_required"),
            "expected provider_required event"
        );
    }

    #[tokio::test]
    async fn unrouted_followup_returns_explicit_error_and_writes_no_artifact() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        // Route Intake so start_run executes, then clear router so followup is unrouted.
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Followup Truth Project".to_string(),
                "Test unrouted followup".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");
        let run = rpc
            .start_run(
                &owner,
                project.id,
                "Followup test idea".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("run started");

        *state.providers.write().await = ProviderRouter::new();

        let err = state
            .pipeline
            .followup_run(run.id, "Tell me more")
            .await
            .expect_err("unrouted pipeline followup must return an explicit error");
        assert!(
            err.to_string().contains("No provider routed") || err.to_string().contains("Intake"),
            "unexpected error message: {err}"
        );

        let reloaded = store.get_run(run.id).await.expect("reloaded run");
        assert!(
            !reloaded.artifacts.contains_key("followup"),
            "no followup artifact should be recorded"
        );
    }

    #[tokio::test]
    async fn explicitly_routed_provider_succeeds_and_produces_artifacts() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;

        // Explicitly route Researcher and PM to mock provider.
        for role in [Role::Researcher, Role::PM] {
            state.providers.write().await.set_role_routing(RoleRouting {
                role,
                targets: vec![RoutingTarget {
                    provider_id: "mock".to_string(),
                    model_id: "mock-model".to_string(),
                    weight: 100,
                }],
                fallback_enabled: false,
                budget_cents_per_run: None,
            });
        }

        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Explicit Routing Project".to_string(),
                "Test explicit routing".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");
        let run = rpc
            .start_run(
                &owner,
                project.id,
                "Explicit routing idea".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("run started");

        rpc.advance_run(&owner, run.id).await.expect("to GateA");
        rpc.approve_gate(&owner, run.id, Stage::GateA, None)
            .await
            .expect("approve GateA");

        let advanced = rpc
            .advance_run(&owner, run.id)
            .await
            .expect("advance succeeds with explicitly routed provider");
        assert_eq!(advanced.current_stage, Stage::GateB);

        let reloaded = store.get_run(run.id).await.expect("reloaded run");
        assert!(reloaded.artifacts.contains_key("research"));
        assert!(reloaded.artifacts.contains_key("prd_spec"));
    }

    #[tokio::test]
    async fn unrouted_stage_resumes_cleanly_once_provider_is_routed() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let project = rpc
            .create_project(
                &owner,
                "Resume After Routing Project".to_string(),
                "Test resuming after adding provider".to_string(),
                "en".to_string(),
                None,
                None,
                None,
                None,
            )
            .await
            .expect("project created");
        let run = rpc
            .start_run(
                &owner,
                project.id,
                "Resume idea".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("run started");

        rpc.advance_run(&owner, run.id).await.expect("to GateA");
        rpc.approve_gate(&owner, run.id, Stage::GateA, None)
            .await
            .expect("approve GateA");

        // Advance fails because Researcher is unrouted.
        rpc.advance_run(&owner, run.id)
            .await
            .expect_err("advance fails unrouted");

        let paused_run = store.get_run(run.id).await.unwrap();
        assert_eq!(paused_run.status, RunStatus::Paused);

        // Now configure routing for Researcher and PM.
        for role in [Role::Researcher, Role::PM] {
            state.providers.write().await.set_role_routing(RoleRouting {
                role,
                targets: vec![RoutingTarget {
                    provider_id: "mock".to_string(),
                    model_id: "mock-model".to_string(),
                    weight: 100,
                }],
                fallback_enabled: false,
                budget_cents_per_run: None,
            });
        }

        // Resuming now succeeds and executes the previously unrouted stage.
        let resumed = rpc
            .resume_run(&owner, run.id)
            .await
            .expect("resume succeeds after adding routing");
        assert_eq!(resumed.status, RunStatus::Running);
        assert_eq!(resumed.current_stage, Stage::GateB);

        let reloaded = store.get_run(run.id).await.unwrap();
        assert!(reloaded.artifacts.contains_key("research"));
    }
}

pub(crate) mod agent_lock {
    use super::*;

    #[tokio::test]
    async fn a_second_agent_state_call_answers_while_a_command_runs() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state_with(temp.path(), |config| {
            config.allowed_commands = vec!["ping".to_string(), "sleep".to_string()];
        })
        .await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();
        // The turn is a run's own loop (`agent.turn` is retired by OD-E2); the
        // mode `agent.state` answers is still the daemon-wide record.
        let run_id = approved_agent_run(&state, &store).await;
        state
            .agent_loop
            .write()
            .await
            .approve_agent_mode("owner")
            .expect("approve agent mode");

        #[cfg(windows)]
        let cmd_text = "run command ping -n 3 127.0.0.1".to_string();
        #[cfg(not(windows))]
        let cmd_text = "run command sleep 2".to_string();

        let state_clone = state.clone();
        let owner_clone = owner.clone();
        let turn_handle = tokio::spawn(async move {
            let rpc_bg = WarshaRpc::new(state_clone);
            rpc_bg.agent_turn_run(&owner_clone, run_id, cmd_text).await
        });

        // Give the turn time to prepare and enter child command execution
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let start = std::time::Instant::now();
        let state_res = rpc.agent_state(&owner, None).await;
        let elapsed = start.elapsed();

        assert!(
            elapsed < std::time::Duration::from_millis(500),
            "agent.state was blocked across command execution: elapsed = {elapsed:?}"
        );
        let agent_state = state_res.expect("agent_state should succeed while command runs");
        assert_eq!(agent_state.mode, warsha_pipeline::AgentMode::Agent);

        let turn_res = turn_handle
            .await
            .expect("turn task finished")
            .expect("the run's turn succeeded");
        assert_eq!(turn_res.tools.len(), 1);
        assert!(
            turn_res.tools[0].success,
            "unexpected tool failure: {:?}",
            turn_res.tools[0]
        );
    }

    /// A run's todos are the run's: the turn's finished todo comes back on the
    /// run's own result, and repeated reads of the daemon-wide record answer
    /// without deadlocking and without showing it.
    #[tokio::test]
    async fn concurrent_agent_state_queries_answer_while_a_run_turn_keeps_its_todos() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state_with(temp.path(), |config| {
            config.allowed_commands = vec!["ping".to_string(), "sleep".to_string()];
        })
        .await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();
        let run_id = approved_agent_run(&state, &store).await;

        state
            .agent_loop
            .write()
            .await
            .approve_agent_mode("owner")
            .expect("approve agent mode");

        #[cfg(windows)]
        let cmd_text = "run command ping -n 2 127.0.0.1".to_string();
        #[cfg(not(windows))]
        let cmd_text = "run command sleep 1".to_string();

        let state_clone = state.clone();
        let owner_clone = owner.clone();
        let turn_handle = tokio::spawn(async move {
            let rpc_bg = WarshaRpc::new(state_clone);
            rpc_bg.agent_turn_run(&owner_clone, run_id, cmd_text).await
        });

        tokio::time::sleep(std::time::Duration::from_millis(60)).await;

        for _ in 0..5 {
            let st = rpc
                .agent_state(&owner, None)
                .await
                .expect("agent_state query");
            assert_eq!(st.mode, warsha_pipeline::AgentMode::Agent);
            // The running turn's todo lives in the run's own loop, so the
            // daemon-wide record has none to show.
            assert!(
                st.todos.is_empty(),
                "a run's turn wrote the daemon-wide record: {:?}",
                st.todos
            );
            tokio::time::sleep(std::time::Duration::from_millis(15)).await;
        }

        let turn_res = turn_handle
            .await
            .expect("turn task finished")
            .expect("the run's turn succeeded");
        assert_eq!(turn_res.tools.len(), 1);
        assert!(turn_res.tools[0].success);
        assert_eq!(turn_res.todos.len(), 1);
        assert_eq!(turn_res.todos[0].status, warsha_pipeline::TodoStatus::Done);

        let final_state = rpc
            .agent_state(&owner, None)
            .await
            .expect("final agent_state query");
        assert!(final_state.todos.is_empty());
    }

    #[tokio::test]
    async fn agent_command_execution_obeys_daemon_allowed_commands_policy() {
        let temp = crate::test_util::fresh_tempdir();
        // A toolchain name and a program inside the data directory are both
        // admitted by configuration, so the test covers the two ways the
        // policy can allow a program.
        let fixture = fixture_program(temp.path());
        let allowed = fixture.clone();
        let (state, store) = test_state_with(temp.path(), move |config| {
            config.allowed_commands = vec!["cargo".to_string(), allowed];
        })
        .await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();
        // The run's loop is built from this daemon's configuration, which is what
        // makes the per-run turn the one under test.
        let run_id = approved_agent_run(&state, &store).await;

        // Shell execution must be refused by the wired CommandPolicy
        let turn_res = rpc
            .agent_turn_run(&owner, run_id, "run command sh -c id".to_string())
            .await
            .expect("turn completes with failed tool result");
        assert_eq!(turn_res.tools.len(), 1);
        assert!(!turn_res.tools[0].success);
        assert!(turn_res.tools[0].output.contains("refused"));

        // Allow-listed cargo --version succeeds
        let turn_cargo = rpc
            .agent_turn_run(&owner, run_id, "run command cargo --version".to_string())
            .await
            .expect("turn completes with ok tool result");
        assert_eq!(turn_cargo.tools.len(), 1);
        assert!(turn_cargo.tools[0].success);
        assert!(turn_cargo.tools[0].output.contains("cargo"));

        // `git` is in the default allow-list but not in this daemon's
        // configured set (`cargo` and the data-directory fixture): a revert
        // to `CommandPolicy::default()` would run it, so this half makes the
        // test distinguish the wired configuration from the default.
        let turn_git = rpc
            .agent_turn_run(&owner, run_id, "run command git --version".to_string())
            .await
            .expect("turn completes with failed tool result");
        assert_eq!(turn_git.tools.len(), 1);
        assert!(
            !turn_git.tools[0].success,
            "git is default-allowed but was not configured, so it must be refused: {:?}",
            turn_git.tools[0]
        );
        assert!(
            turn_git.tools[0]
                .output
                .contains("not in the allowed commands list"),
            "expected the configured allow-list refusal, got {:?}",
            turn_git.tools[0].output
        );

        // A program admitted by configuration inside the data directory runs
        // under the same policy; the allow-list is not limited to bare names.
        let turn_ok = rpc
            .agent_turn_run(&owner, run_id, format!("run command \"{fixture}\" --list"))
            .await
            .expect("turn completes with ok tool result");
        assert_eq!(turn_ok.tools.len(), 1);
        assert!(turn_ok.tools[0].success);
        assert!(
            turn_ok.tools[0].output.contains("fixture"),
            "the allowed program's output is the turn's: {}",
            turn_ok.tools[0].output
        );
    }

    /// Two turns in one run must not interleave: the run's session covers
    /// prepare → execute → finish, so the shorter turn finishes *after* the
    /// longer one that started first. Without the session lock both execute at
    /// once and the shorter one finishes first.
    #[tokio::test]
    async fn two_concurrent_turns_are_serialized_by_the_turn_gate() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state_with(temp.path(), |config| {
            config.allowed_commands = vec!["ping".to_string(), "sleep".to_string()];
        })
        .await;
        let owner = owner_ext();
        let run_id = approved_agent_run(&state, &store).await;

        #[cfg(windows)]
        let (long_cmd, short_cmd) = (
            "run command ping -n 4 127.0.0.1".to_string(),
            "run command ping -n 2 127.0.0.1".to_string(),
        );
        #[cfg(not(windows))]
        let (long_cmd, short_cmd) = (
            "run command sleep 2".to_string(),
            "run command sleep 1".to_string(),
        );

        let started = std::time::Instant::now();
        let long_rpc = WarshaRpc::new(state.clone());
        let short_rpc = WarshaRpc::new(state.clone());
        let long_owner = owner.clone();
        let long = tokio::spawn(async move {
            let result = long_rpc.agent_turn_run(&long_owner, run_id, long_cmd).await;
            (result, started.elapsed())
        });
        // Let the first turn reach its command before the second asks for
        // the gate, so the two are genuinely concurrent.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let short_owner = owner.clone();
        let short = tokio::spawn(async move {
            let result = short_rpc
                .agent_turn_run(&short_owner, run_id, short_cmd)
                .await;
            (result, started.elapsed())
        });

        let (long_result, long_at) = long.await.expect("long turn task");
        let (short_result, short_at) = short.await.expect("short turn task");
        for (label, result) in [("long", long_result), ("short", short_result)] {
            let turn = result.expect("turn completes");
            assert_eq!(turn.tools.len(), 1);
            assert!(
                turn.tools[0].success,
                "{label} turn tool failed: {:?}",
                turn.tools[0]
            );
        }
        assert!(
            short_at > long_at,
            "the second turn finished before the first, so turns interleaved: \
             long={long_at:?} short={short_at:?}"
        );
    }

    /// The mode RPCs answer the daemon-wide record when they carry no run id, and
    /// a turn is a run's own loop, so a switch to Plan no longer waits for a
    /// command that is already executing: the barrier left with the retired
    /// `agent.turn`. OD-E2b puts it back where it belongs — a `run_id` makes the
    /// switch take the run's own session lock, which the turn holds throughout.
    #[tokio::test]
    async fn plan_mode_answers_while_a_runs_command_runs() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = test_state_with(temp.path(), |config| {
            config.allowed_commands = vec!["ping".to_string(), "sleep".to_string()];
        })
        .await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();
        let run_id = approved_agent_run(&state, &store).await;

        state
            .agent_loop
            .write()
            .await
            .approve_agent_mode("owner")
            .expect("approve agent mode");

        #[cfg(windows)]
        let cmd_text = "run command ping -n 4 127.0.0.1".to_string();
        #[cfg(not(windows))]
        let cmd_text = "run command sleep 2".to_string();

        let state_clone = state.clone();
        let owner_clone = owner.clone();
        let turn_handle = tokio::spawn(async move {
            let rpc_bg = WarshaRpc::new(state_clone);
            rpc_bg.agent_turn_run(&owner_clone, run_id, cmd_text).await
        });

        // Give the turn time to start its command.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let start = std::time::Instant::now();
        let transition = rpc
            .return_agent_to_plan(&owner, None)
            .await
            .expect("plan_mode succeeds");
        let waited = start.elapsed();

        assert_eq!(transition.from, warsha_pipeline::AgentMode::Agent);
        assert_eq!(transition.to, warsha_pipeline::AgentMode::Plan);
        assert!(
            waited < std::time::Duration::from_millis(1500),
            "plan_mode waited for a run's command: waited = {waited:?}"
        );

        let agent_state = rpc.agent_state(&owner, None).await.expect("state");
        assert_eq!(agent_state.mode, warsha_pipeline::AgentMode::Plan);

        turn_handle
            .await
            .expect("turn task finished")
            .expect("the run's turn succeeded");
    }
}

/// KEEL K5b: plugins go through the process policy, and a launch gets only the
/// environment its row names.
mod spawn_hardening {
    use super::*;
    use serde_json::Value;
    use std::io::BufRead;

    const ENV_MARKER: &str = "WARSHA_K5_WARSHA_ENV_PROBE";
    const DAEMON_ONLY: &str = "WARSHA_K5_WARSHA_DAEMON_ONLY";

    /// A stdio MCP server that answers `tools/list` with its whole environment.
    ///
    /// A plain test that returns immediately unless its parent passes the marker,
    /// so this costs a no-op in an ordinary run and no ignored-test budget.
    #[test]
    fn env_probe() {
        if std::env::var_os(ENV_MARKER).is_none() {
            return;
        }
        // libtest writes `test <name> ... ` without a newline before a non-ignored
        // test; end that line so every reply below is clean JSON.
        println!();
        let mut dump: Vec<String> = std::env::vars()
            .map(|(key, value)| format!("{key}={value}"))
            .collect();
        dump.sort();
        let dump = dump.join(";");
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            let Ok(request) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(id) = request.get("id").cloned() else {
                continue;
            };
            let result = match request.get("method").and_then(Value::as_str).unwrap_or("") {
                "initialize" => serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "serverInfo": { "name": "warsha-env-probe", "version": "1.0.0" },
                }),
                "tools/list" => serde_json::json!({
                    "tools": [{
                        "name": "env",
                        "description": format!("ENVDUMP {dump}"),
                        "inputSchema": { "type": "object" },
                    }],
                }),
                _ => serde_json::json!({}),
            };
            println!(
                "{}",
                serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result })
            );
        }
    }

    /// Named so a Windows fixture copy's `--list` output contains `fixture`.
    #[test]
    fn fixture_marker() {}

    fn test_binary() -> String {
        std::env::current_exe()
            .expect("the test binary names itself")
            .to_string_lossy()
            .into_owned()
    }

    /// A manifest that launches this test binary's env probe.
    fn probe_manifest(exe: &str, enabled: bool, env: Value) -> String {
        serde_json::json!({
            "name": "K5 Probe",
            "transport": "stdio",
            "command": exe,
            "args": [
                "--exact",
                "tests::spawn_hardening::env_probe",
                "--nocapture",
                "--test-threads",
                "1",
            ],
            "env": env,
            "enabled": enabled,
        })
        .to_string()
    }

    fn legacy_definition(command: &str) -> PluginDefinition {
        PluginDefinition {
            id: "legacy-pack".to_string(),
            name: "Legacy".to_string(),
            description: "a row written before the policy checked installs".to_string(),
            transport: "stdio".to_string(),
            command: Some(command.to_string()),
            args: Vec::new(),
            env: HashMap::new(),
            enabled: false,
            tools: Vec::new(),
            source: String::new(),
        }
    }

    #[tokio::test]
    async fn install_refuses_a_command_outside_the_allow_list() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();
        let manifest = serde_json::json!({
            "name": "Off List",
            "transport": "stdio",
            "command": "curl",
            "args": ["https://example.test/install.sh"],
            "enabled": false,
        })
        .to_string();

        let err = rpc
            .install_plugin(&owner, manifest)
            .await
            .expect_err("a command outside the allow-list must be refused");
        assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
        assert!(
            state
                .settings
                .get_plugin("off-list")
                .await
                .expect("the catalog answers")
                .is_none(),
            "a refused pack must leave no row behind"
        );
    }

    #[tokio::test]
    async fn install_refuses_an_unpinned_package_launch() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let unpinned = serde_json::json!({
            "name": "Unpinned",
            "transport": "stdio",
            "command": "npx",
            "args": ["@modelcontextprotocol/server-github"],
            "enabled": false,
        })
        .to_string();
        let err = rpc
            .install_plugin(&owner, unpinned)
            .await
            .expect_err("an unpinned package must be refused at install");
        assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
        assert!(
            state
                .settings
                .get_plugin("unpinned")
                .await
                .expect("the catalog answers")
                .is_none(),
            "a refused pack must leave no row behind"
        );

        let pinned = serde_json::json!({
            "name": "Pinned",
            "transport": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github@2025.4.8"],
            "enabled": false,
        })
        .to_string();
        rpc.install_plugin(&owner, pinned)
            .await
            .expect("a pinned package installs");
    }

    #[tokio::test]
    async fn a_fresh_daemon_seeds_every_bundled_pack_disabled() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let plugins = rpc.list_plugins(&owner).await.expect("plugins list");
        assert_eq!(plugins.len(), warsha_core::bundled_plugins().len());
        let enabled: Vec<&str> = plugins
            .iter()
            .filter(|plugin| plugin.enabled)
            .map(|plugin| plugin.id.as_str())
            .collect();
        assert!(
            enabled.is_empty(),
            "a fresh daemon must seed every bundled pack disabled, but enabled: {enabled:?}"
        );
    }

    #[tokio::test]
    async fn a_stored_row_the_policy_refuses_never_launches() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let row = wave2::plugin_row(&legacy_definition("curl")).expect("a row serialises");
        state
            .settings
            .save_plugin(&row)
            .await
            .expect("the row saves");
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let err = rpc
            .toggle_plugin(&owner, "legacy-pack".to_string(), true)
            .await
            .expect_err("a row the policy would refuse must not launch");
        assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
        let stored = state
            .settings
            .get_plugin("legacy-pack")
            .await
            .expect("the catalog answers")
            .expect("the row is still there");
        assert!(
            !stored.enabled,
            "a refused enable must not store the pack as enabled"
        );
        assert!(
            state.mcp.list().await.is_empty(),
            "nothing may be spawned for a refused pack"
        );
    }

    #[tokio::test]
    async fn configure_refuses_before_filing_its_environment() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let row = wave2::plugin_row(&legacy_definition("curl")).expect("a row serialises");
        state
            .settings
            .save_plugin(&row)
            .await
            .expect("the row saves");
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let mut env = HashMap::new();
        env.insert(
            "GITHUB_TOKEN".to_string(),
            "material-never-filed".to_string(),
        );
        let err = rpc
            .configure_plugin(&owner, "legacy-pack".to_string(), env)
            .await
            .expect_err("a pack the policy refuses cannot be configured");
        assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
        assert!(
            state
                .secrets
                .load("plugin:legacy-pack:GITHUB_TOKEN")
                .await
                .is_err(),
            "a refused configure must not file the environment in the keychain"
        );
    }

    #[tokio::test]
    async fn a_launch_gets_only_the_named_keychain_secret() {
        let temp = crate::test_util::fresh_tempdir();
        let exe = test_binary();
        let allowed = exe.clone();
        let (state, _store) = test_state_with(temp.path(), move |config| {
            config.allowed_commands = vec![allowed];
        })
        .await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        std::env::set_var(DAEMON_ONLY, "leak");
        let manifest = probe_manifest(
            &exe,
            true,
            serde_json::json!({
                ENV_MARKER: "1",
                "PROBE_SECRET": "material-secret-value",
            }),
        );
        let installed = rpc
            .install_plugin(&owner, manifest)
            .await
            .expect("the probe pack installs");
        std::env::remove_var(DAEMON_ONLY);

        let stored = state
            .settings
            .get_plugin(&installed.id)
            .await
            .expect("the catalog answers")
            .expect("the row exists");
        assert!(
            !stored.env_json.contains("material-secret-value"),
            "the row must hold a reference, not the token: {}",
            stored.env_json
        );

        let toggled = rpc
            .toggle_plugin(&owner, installed.id.clone(), true)
            .await
            .expect("the probe pack enables");
        assert!(toggled.enabled);

        let connections = state.mcp.list().await;
        let connection = connections
            .iter()
            .find(|connection| connection.config.name == installed.id)
            .expect("the pack is connected");
        assert!(connection.status.is_connected(), "{connection:?}");
        let description = connection
            .tool_definitions
            .first()
            .expect("the probe lists one tool")
            .description
            .clone();
        assert!(
            description.contains("PROBE_SECRET=material-secret-value"),
            "the keychain value must reach the child: {description}"
        );
        assert!(
            description.contains(&format!("{ENV_MARKER}=1")),
            "every named variable reaches the child: {description}"
        );
        assert!(
            !description.contains(&format!("{DAEMON_ONLY}=leak")),
            "the daemon's own environment must not be inherited: {description}"
        );
        assert!(
            !description.contains("HOME="),
            "the user profile must not be inherited: {description}"
        );

        let disabled = rpc
            .toggle_plugin(&owner, installed.id.clone(), false)
            .await
            .expect("the pack disables and disconnects cleanly");
        assert!(!disabled.enabled);
        assert!(state
            .mcp
            .list()
            .await
            .iter()
            .all(|connection| !connection.status.is_connected()));
    }

    /// A keychain seam that records which accounts were read.
    ///
    /// `InMemorySecretStore` cannot answer "was this account read at all", which is
    /// the half of R-KEEL row 5 a refusal on its own does not prove: a daemon that
    /// read the foreign account and *then* refused would pass every other assertion
    /// in this module. It delegates everything to the in-memory store, so a test can
    /// still seed an account and read one back.
    #[derive(Debug, Default)]
    struct CountingSecretStore {
        inner: InMemorySecretStore,
        loads: std::sync::Mutex<Vec<String>>,
    }

    impl CountingSecretStore {
        fn loads(&self) -> Vec<String> {
            self.loads
                .lock()
                .expect("the load log is not poisoned")
                .clone()
        }
    }

    #[async_trait]
    impl SecretStore for CountingSecretStore {
        async fn store(&self, account: &str, key: &str) -> warsha_providers::Result<()> {
            self.inner.store(account, key).await
        }

        async fn load(&self, account: &str) -> warsha_providers::Result<String> {
            self.loads
                .lock()
                .expect("the load log is not poisoned")
                .push(account.to_string());
            self.inner.load(account).await
        }

        async fn delete(&self, account: &str) -> warsha_providers::Result<()> {
            self.inner.delete(account).await
        }
    }

    /// The probe manifest with an id the test chose, so the pack's own keychain
    /// account (`plugin:{id}:{KEY}`) is known before the install derives anything.
    fn probe_manifest_with_id(exe: &str, id: &str, env: Value) -> String {
        let mut manifest: Value =
            serde_json::from_str(&probe_manifest(exe, false, env)).expect("a JSON manifest");
        manifest["id"] = serde_json::json!(id);
        manifest.to_string()
    }

    #[tokio::test]
    async fn a_pack_may_name_its_own_keychain_account() {
        let temp = crate::test_util::fresh_tempdir();
        let exe = test_binary();
        let allowed = exe.clone();
        let secrets = Arc::new(CountingSecretStore::default());
        // Filed the way `plugins.install` files material: under the pack's own
        // account. The row below names that address instead of the value.
        secrets
            .store(
                "plugin:own-account-pack:PROBE_SECRET",
                "own-account-material",
            )
            .await
            .expect("the own account is filed");
        let injected = secrets.clone();
        let (state, _store) = test_state_with_seams(
            temp.path(),
            move |config| {
                config.allowed_commands = vec![allowed];
            },
            None,
            Some(injected as Arc<dyn SecretStore>),
            None,
        )
        .await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let manifest = probe_manifest_with_id(
            &exe,
            "own-account-pack",
            serde_json::json!({
                ENV_MARKER: "1",
                "PROBE_SECRET": "${secrets:plugin:own-account-pack:PROBE_SECRET}",
            }),
        );
        let installed = rpc
            .install_plugin(&owner, manifest)
            .await
            .expect("the probe pack installs");
        assert_eq!(installed.id, "own-account-pack");
        let stored = state
            .settings
            .get_plugin(&installed.id)
            .await
            .expect("the catalog answers")
            .expect("the row exists");
        assert!(
            stored
                .env_json
                .contains("${secrets:plugin:own-account-pack:PROBE_SECRET}"),
            "a reference is stored as the owner wrote it: {}",
            stored.env_json
        );

        let toggled = rpc
            .toggle_plugin(&owner, installed.id.clone(), true)
            .await
            .expect("a pack naming its own account launches");
        assert!(toggled.enabled);

        let connection = state
            .mcp
            .list()
            .await
            .into_iter()
            .find(|connection| connection.config.name == installed.id)
            .expect("the pack is connected");
        assert!(connection.status.is_connected(), "{connection:?}");
        let description = connection
            .tool_definitions
            .first()
            .expect("the probe lists one tool")
            .description
            .clone();
        assert!(
            description.contains("PROBE_SECRET=own-account-material"),
            "the own account's value must reach the child: {description}"
        );
        // Two accounts are read: the one the manifest named and the one the install
        // filed for `ENV_MARKER` (material is filed under the pack's own account,
        // never stored in the row). Both belong to this pack.
        let mut loaded = secrets.loads();
        loaded.sort();
        assert_eq!(
            loaded,
            vec![
                "plugin:own-account-pack:PROBE_SECRET".to_string(),
                format!("plugin:own-account-pack:{ENV_MARKER}"),
            ],
            "the launch reads exactly the accounts this pack filed for itself"
        );

        rpc.toggle_plugin(&owner, installed.id.clone(), false)
            .await
            .expect("the pack disables and disconnects cleanly");
    }

    #[tokio::test]
    async fn a_pack_cannot_read_another_packs_keychain_account() {
        let temp = crate::test_util::fresh_tempdir();
        let exe = test_binary();
        let allowed = exe.clone();
        let secrets = Arc::new(CountingSecretStore::default());
        // The foreign account holds a value: a daemon that read it before refusing
        // would have the material in hand, and the load log below would show it.
        secrets
            .store("plugin:other-pack:TOKEN", "foreign-material")
            .await
            .expect("the foreign account is filed");
        let injected = secrets.clone();
        let (state, _store) = test_state_with_seams(
            temp.path(),
            move |config| {
                config.allowed_commands = vec![allowed];
            },
            None,
            Some(injected as Arc<dyn SecretStore>),
            None,
        )
        .await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();

        let manifest = probe_manifest_with_id(
            &exe,
            "greedy-pack",
            serde_json::json!({ "PROBE_SECRET": "${secrets:plugin:other-pack:TOKEN}" }),
        );
        let installed = rpc
            .install_plugin(&owner, manifest)
            .await
            .expect("the reference is stored as written, so the install succeeds");
        assert!(
            secrets.loads().is_empty(),
            "filing a reference must not read a keychain account: {:?}",
            secrets.loads()
        );

        let err = rpc
            .toggle_plugin(&owner, installed.id.clone(), true)
            .await
            .expect_err("a pack naming another pack's account must be refused");
        assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
        assert!(
            err.message().contains("plugin:other-pack:TOKEN"),
            "the refusal names the offending account, got: {}",
            err.message()
        );
        assert!(
            err.message().contains("plugin:greedy-pack:PROBE_SECRET"),
            "the refusal names the pack's own account, got: {}",
            err.message()
        );
        assert!(
            secrets.loads().is_empty(),
            "the refusal must happen before any keychain read: {:?}",
            secrets.loads()
        );
        assert!(
            state.mcp.list().await.is_empty(),
            "nothing may be launched for a refused pack"
        );
        assert!(
            !state
                .settings
                .get_plugin(&installed.id)
                .await
                .expect("the catalog answers")
                .expect("the row exists")
                .enabled,
            "a refused enable must not leave the pack stored as enabled"
        );
    }

    /// An MCP transport that is the real one except that its `disconnect` fails.
    ///
    /// A disconnect that genuinely fails has no natural seam on this side: the real
    /// manager reports failure only when a live child will not die, which a test
    /// cannot stage without a second principal. So the failure is injected at the
    /// transport — the exact edge `toggle_plugin` calls — while `connect`,
    /// `connect_with` and `list` stay the real manager, so the pack under test owns
    /// a real, still-running child when the stop is refused.
    struct FailingDisconnectMcp {
        inner: Arc<dyn McpManager>,
    }

    #[async_trait]
    impl McpManager for FailingDisconnectMcp {
        async fn connect(
            &self,
            config: warsha_pipeline::mcp_transport::McpServerConfig,
        ) -> std::result::Result<(), warsha_pipeline::McpTransportError> {
            self.inner.connect(config).await
        }

        async fn connect_with(
            &self,
            config: warsha_pipeline::mcp_transport::McpServerConfig,
            options: warsha_pipeline::mcp_transport::McpLaunchOptions,
        ) -> std::result::Result<(), warsha_pipeline::McpTransportError> {
            self.inner.connect_with(config, options).await
        }

        async fn disconnect(
            &self,
            name: &str,
        ) -> std::result::Result<(), warsha_pipeline::McpTransportError> {
            // The shape the real manager produces when `stop` is refused, so the
            // error the RPC hands back is the one a genuine failure would give.
            Err(warsha_pipeline::McpTransportError::Stop {
                name: name.to_string(),
                source: warsha_pipeline::ProcessError::Stop {
                    id: name.to_string(),
                    source: std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "the child would not die",
                    ),
                },
            })
        }

        async fn list(&self) -> Vec<McpConnection> {
            self.inner.list().await
        }

        async fn send(
            &self,
            name: &str,
            payload: &str,
        ) -> std::result::Result<String, warsha_pipeline::McpTransportError> {
            self.inner.send(name, payload).await
        }

        async fn call_tool(
            &self,
            name: &str,
            tool: &str,
            arguments: serde_json::Value,
        ) -> std::result::Result<
            warsha_pipeline::mcp::McpToolResult,
            warsha_pipeline::McpTransportError,
        > {
            self.inner.call_tool(name, tool, arguments).await
        }
    }

    /// R-KEEL checkpoint row 16, the disable half — the inverse of the connect lie
    /// R-SEC-6 fixed: the row was persisted `disabled` *before* the child was
    /// stopped, so a disconnect that failed left it marked disabled with a live
    /// process behind it. It is still the caller's error, but the row goes back to
    /// what it said before the call.
    #[tokio::test]
    async fn a_failed_disconnect_leaves_the_row_enabled() {
        let temp = crate::test_util::fresh_tempdir();
        let exe = test_binary();
        let allowed = exe.clone();
        // The transport the daemon is built with is the real manager over its own
        // spawner — so the child below is a real process — behind the one seam that
        // refuses the stop.
        let processes: Arc<dyn ProcessManager> = InMemoryProcessManager::shared_with_policy(
            CommandPolicy::from_config(std::slice::from_ref(&allowed)),
        );
        let real: Arc<dyn McpManager> = Arc::new(InMemoryMcpManager::new(processes));
        let failing: Arc<dyn McpManager> = Arc::new(FailingDisconnectMcp {
            inner: real.clone(),
        });
        let (state, _store) = crate::tests::test_state_with_seams(
            temp.path(),
            move |config| {
                config.allowed_commands = vec![allowed];
            },
            None,
            None,
            Some(failing),
        )
        .await;
        let rpc = WarshaRpc::new(state.clone());
        let owner = owner_ext();
        // The env probe exits unless it is marked; this one has to stay up and
        // speak the protocol, which is what a stop can be refused against.
        let manifest = serde_json::json!({
            "name": "Connected MCP Plugin",
            "transport": "stdio",
            "command": exe,
            "args": ["--exact", "tests::mcp_probe_server", "--ignored", "--nocapture"],
            "enabled": false,
        })
        .to_string();
        let installed = rpc
            .install_plugin(&owner, manifest)
            .await
            .expect("the probe pack installs cleanly in disabled state");
        assert!(!installed.enabled);

        // Enabling brings up the real child the failed disconnect will leave running.
        let toggled = rpc
            .toggle_plugin(&owner, installed.id.clone(), true)
            .await
            .expect("the probe pack connects");
        assert!(toggled.enabled);
        let before = state
            .mcp
            .list()
            .await
            .into_iter()
            .find(|connection| connection.config.name == installed.id)
            .expect("the pack is connected");
        assert!(before.status.is_connected(), "{before:?}");
        assert!(before.process_id.is_some(), "{before:?}");

        let err = rpc
            .toggle_plugin(&owner, installed.id.clone(), false)
            .await
            .expect_err("a child that will not die must fail the disable");
        assert_eq!(rpc_error_code(&err), -32000);
        assert!(
            err.message().contains("could not stop MCP server"),
            "the caller gets the disconnect's own error, got: {}",
            err.message()
        );

        let stored = state
            .settings
            .get_plugin(&installed.id)
            .await
            .expect("the catalog answers")
            .expect("the row is still there");
        assert!(
            stored.enabled,
            "a failed disconnect must put the row back to enabled, not leave it \
             disabled beside a live child"
        );
        let after = state
            .mcp
            .list()
            .await
            .into_iter()
            .find(|connection| connection.config.name == installed.id)
            .expect("the connection is still listed");
        assert!(
            after.status.is_connected(),
            "the child that refused to die is still connected: {after:?}"
        );
        assert!(after.process_id.is_some(), "{after:?}");

        // Leave nothing running: the real transport is what stops this child.
        real.disconnect(&installed.id)
            .await
            .expect("the real transport stops the child");
    }
}

/// R-KEEL checkpoint row 9: the CSP headers are read off a real response.
///
/// The middleware's whole point was unverified by construction: deleting
/// `.layer(csp_middleware)` or any one of the three header inserts left the suite
/// green, because no test ever read a header off the wire. This drives [`http_app`] —
/// the app the listener actually serves — through its whole stack, on the one route
/// that needs no credential and on the static fallback, so both places a response can
/// come from are covered. Every assertion is an equality against the canonical value
/// ([`REMOTE_CSP`], `nosniff`, `DENY`), which is what makes a dropped layer or a
/// drifted string a failure rather than a pass.
///
/// The app is driven in process rather than over a socket on purpose: the other test
/// in this binary that starts a daemon (`the_startup_listener_lines_are_written_once`)
/// counts its startup lines through a thread-scoped subscriber, and a second daemon
/// starting in parallel makes that capture flaky — measured: a socket-level version of
/// this test left it red in 2 of 3 full runs, while 4 of 4 runs without this test were
/// green. Driving the router keeps the same assertion without adding a second caller
/// of the callsite that test counts.
#[tokio::test]
async fn the_http_listener_sends_the_canonical_csp_and_framing_headers() {
    use tower::ServiceExt as _;

    let temp = crate::test_util::fresh_tempdir();
    let bundle = temp.path().join("bundle");
    std::fs::create_dir_all(&bundle).expect("the bundle directory");
    std::fs::write(
        bundle.join("index.html"),
        "<div id=\"root\">csp probe</div>",
    )
    .expect("the bundle shell");
    let (state, _store) = test_state_with(temp.path(), |config| {
        config.remote_assets_dir = Some(bundle);
    })
    .await;

    // `/health` is the router's own route; `/index.html` is the static fallback.
    for path in ["/health", "/index.html"] {
        let mut request = axum::http::Request::builder()
            .uri(path)
            .body(axum::body::Body::empty())
            .expect("a request the listener would receive");
        // What `axum::serve(…into_make_service_with_connect_info())` supplies to the
        // auth layer: without it the ceiling has no peer to key on and the extractor
        // answers before the CSP layer runs.
        request
            .extensions_mut()
            .insert(ConnectInfo(std::net::SocketAddr::from((
                [127, 0, 0, 1],
                40_000,
            ))));
        let response = http_app(state.clone())
            .oneshot(request)
            .await
            .expect("the app answers");
        assert_eq!(
            response.status(),
            axum::http::StatusCode::OK,
            "{path} answered HTTP {}",
            response.status()
        );
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string)
        };
        assert_eq!(
            header("content-security-policy").as_deref(),
            Some(REMOTE_CSP),
            "{path} did not carry the canonical policy: the CSP middleware is not layered, \
             or its string is not the one `apps/remote/index.html` declares"
        );
        assert_eq!(
            header("x-content-type-options").as_deref(),
            Some("nosniff"),
            "{path} did not carry `X-Content-Type-Options: nosniff`"
        );
        assert_eq!(
            header("x-frame-options").as_deref(),
            Some("DENY"),
            "{path} did not carry `X-Frame-Options: DENY`"
        );
    }
}

/// R-BRIDGE-B3a on the daemon side: the two RPCs, the audit trail, redaction,
/// resolution through `mcp.permissions.set`, and the fact that a grant dies with
/// the process.
mod mcp_approval {
    use super::*;
    use std::sync::Mutex as StdMutex;
    use warsha_pipeline::mcp::McpTool;

    /// The obviously fake secrets T7 traces through every surface.
    const SECRET_ARGS: &str =
        r#"{"api_key":"SECRET-1","note":"Bearer SECRET-2","password":"SECRET-3","path":"a.txt"}"#;
    const SECRET_EXTRA: &str = r#"{"blob":"SECRET-4","path":"a.txt"}"#;

    /// A transport that records calls instead of making them.
    #[derive(Default)]
    struct ApprovalMcp {
        calls: StdMutex<Vec<(String, String, serde_json::Value)>>,
    }

    impl ApprovalMcp {
        fn count(&self) -> usize {
            self.calls
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .len()
        }
    }

    #[async_trait]
    impl McpManager for ApprovalMcp {
        async fn connect(
            &self,
            _config: warsha_pipeline::mcp_transport::McpServerConfig,
        ) -> std::result::Result<(), warsha_pipeline::McpTransportError> {
            Ok(())
        }
        async fn disconnect(
            &self,
            _name: &str,
        ) -> std::result::Result<(), warsha_pipeline::McpTransportError> {
            Ok(())
        }
        async fn list(&self) -> Vec<warsha_pipeline::McpConnection> {
            vec![warsha_pipeline::McpConnection {
                config: warsha_pipeline::mcp_transport::McpServerConfig {
                    name: "test_srv".to_string(),
                    transport: warsha_pipeline::mcp_transport::McpTransport::Stdio,
                    command: Some("dummy".to_string()),
                    args: vec![],
                },
                status: warsha_pipeline::McpStatus::Connected,
                process_id: Some("p1".to_string()),
                tools: vec!["echo".to_string()],
                // The schema the owner's summary is built against: `blob` is
                // marked secret by the server itself.
                tool_definitions: vec![McpTool {
                    name: "echo".to_string(),
                    description: "echo the arguments".to_string(),
                    input_schema: serde_json::json!({
                        "type": "object",
                        "properties": {
                            "blob": {"type": "string", "writeOnly": true},
                            "path": {"type": "string"},
                        },
                    }),
                    annotations: None,
                }],
            }]
        }
        async fn send(
            &self,
            name: &str,
            payload: &str,
        ) -> std::result::Result<String, warsha_pipeline::McpTransportError> {
            Ok(format!("{name}:{payload}"))
        }
        async fn call_tool(
            &self,
            name: &str,
            tool: &str,
            arguments: serde_json::Value,
        ) -> std::result::Result<
            warsha_pipeline::mcp::McpToolResult,
            warsha_pipeline::McpTransportError,
        > {
            self.calls
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push((name.to_string(), tool.to_string(), arguments));
            Ok(warsha_pipeline::mcp::McpToolResult {
                content: vec![warsha_pipeline::mcp::McpContent::Text {
                    text: "ok".to_string(),
                }],
                is_error: false,
            })
        }
    }

    async fn state_with_mcp(data_dir: &Path) -> (Arc<DaemonState>, Arc<Store>, Arc<ApprovalMcp>) {
        let mcp = Arc::new(ApprovalMcp::default());
        let manager: Arc<dyn McpManager> = mcp.clone();
        let (state, store) =
            test_state_with_seams(data_dir, |_| {}, None, None, Some(manager)).await;
        (state, store, mcp)
    }

    fn turn(arguments: &str) -> String {
        format!("call mcp test_srv/echo {arguments}")
    }

    /// The only pending approval the daemon holds.
    async fn only_pending(rpc: &WarshaRpc, state: &DaemonState) -> McpApproval {
        let listed = rpc
            .list_mcp_approvals(&owner_ext())
            .await
            .expect("the list answers");
        assert_eq!(listed.len(), 1, "unexpected approvals: {listed:?}");
        assert_eq!(state.mcp_approvals.pending_len(), 1);
        listed[0].clone()
    }

    /// T6: the answer RPC is owner-only, issues a grant, and writes no row.
    #[tokio::test]
    async fn allow_once_rpc_is_owner_only_and_never_writes_a_row() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, mcp) = state_with_mcp(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        let approver = DeviceId::new();
        let run_id = approved_agent_run(&state, &store).await;

        // A real turn on the run's own loop registers the ask.
        rpc.agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the turn answers");
        let pending = only_pending(&rpc, &state).await;
        assert_eq!(pending.server, "test_srv");
        assert_eq!(pending.tool, "echo");
        assert_eq!(pending.role, "agent");
        assert!(pending.id.starts_with("mcp-approval-"));
        assert_eq!(mcp.count(), 0, "an ask reached the transport");

        // A paired phone cannot read the queue or approve from it.
        let phone = paired_ext("phone-device");
        for (method, code) in [
            (
                "mcp.approvals.list",
                rpc_error_code(
                    &rpc.list_mcp_approvals(&phone)
                        .await
                        .expect_err("a phone cannot read the queue"),
                ),
            ),
            (
                "mcp.approvals.allow_once",
                rpc_error_code(
                    &rpc.allow_once_mcp_approval(&phone, pending.id.clone())
                        .await
                        .expect_err("a phone cannot approve"),
                ),
            ),
        ] {
            assert_eq!(code, -32002, "{method} was reachable by a paired device");
        }
        // The refusal changed nothing.
        only_pending(&rpc, &state).await;

        let answer = rpc
            .allow_once_mcp_approval(&owner_ext_as(approver), pending.id.clone())
            .await
            .expect("the owner grants");
        assert_eq!(answer.id, pending.id);
        assert_eq!(answer.run_id, run_id.0.to_string());
        assert_eq!(answer.server, "test_srv");
        assert_eq!(answer.tool, "echo");
        assert_eq!(answer.role, "agent");
        assert_eq!(answer.granted_by, approver.to_string());
        assert!(!answer.expires_at.is_empty());
        // The answer leaves the list; the grant is live.
        assert!(rpc
            .list_mcp_approvals(&owner_ext())
            .await
            .expect("the list answers")
            .is_empty());
        assert!(state
            .mcp_approvals
            .has_grant(&run_id.0.to_string(), "test_srv", "echo", "agent"));

        // Never a row: neither the table nor the store learned anything.
        assert!(rpc
            .list_mcp_permissions(&owner_ext())
            .await
            .expect("the permissions list answers")
            .rows
            .is_empty());
        assert!(
            store
                .load_mcp_permissions()
                .await
                .expect("the stored rows are readable")
                .is_empty(),
            "an allow_once grant wrote a permission row"
        );

        // The audit trail: one event, the four identifying fields, no arguments.
        let events = store.get_events(run_id).await.expect("the events are read");
        let allowed: Vec<&warsha_core::Event> = events
            .iter()
            .filter(|event| {
                event.payload.get("action") == Some(&serde_json::json!("mcp_allow_once"))
            })
            .collect();
        assert_eq!(allowed.len(), 1, "the answer wrote no single audit event");
        let event = allowed[0];
        assert_eq!(event.kind, warsha_core::EventKind::ToolCall);
        assert_eq!(event.run_id, run_id);
        assert_eq!(event.device_id, Some(approver));
        let payload = event.payload.as_object().expect("the payload is an object");
        let mut keys: Vec<&str> = payload.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["action", "question_id", "role", "server", "tool"]);
        assert_eq!(payload["question_id"], serde_json::json!(pending.id));
        assert_eq!(payload["server"], serde_json::json!("test_srv"));
    }

    /// T7: no secret value reaches the list, the events or a log line.
    ///
    /// The capture is mounted the way this suite's log-shape tests mount it — a
    /// plain test, a current-thread runtime, and `with_default` around the whole
    /// body — because a callsite first reached by another parallel test with no
    /// subscriber is cached as "never", and only a subscriber that answers
    /// `Interest::sometimes()` (the filter beside the capture) revives it.
    #[test]
    fn no_secret_argument_value_reaches_question_events_list_or_logs() {
        // The capture has to be the *process-wide* default here. A thread-local
        // one loses the `warshad` callsites: tracing caches, per callsite, whether
        // it is ever enabled, and a callsite another parallel test reached first is
        // frozen as "never" for every subscriber mounted afterwards. A global
        // subscriber registered once rebuilds that cache for the whole process, so
        // the line this test is looking for is written whatever the rest of the
        // suite has already done to the callsite.
        static GLOBAL_LOG: std::sync::OnceLock<LogCapture> = std::sync::OnceLock::new();
        let capture: &LogCapture = GLOBAL_LOG.get_or_init(|| {
            let capture = LogCapture::default();
            if tracing::subscriber::set_global_default(capture_subscriber(&capture)).is_ok() {
                tracing::callsite::rebuild_interest_cache();
            }
            capture
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("a current-thread runtime");
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");

        let (listed_json, events_json, stream_json, summary) = runtime.block_on(async move {
            let (state, store, _mcp) = state_with_mcp(&data_dir).await;
            let rpc = WarshaRpc::new(state.clone());
            let run_id = approved_agent_run(&state, &store).await;

            rpc.agent_turn_run(&owner_ext(), run_id, turn(SECRET_ARGS))
                .await
                .expect("the turn answers");
            // A second ask whose secret the *schema* marks, not its key.
            let run_two = approved_agent_run(&state, &store).await;
            rpc.agent_turn_run(&owner_ext(), run_two, turn(SECRET_EXTRA))
                .await
                .expect("the second turn answers");

            let listed = rpc
                .list_mcp_approvals(&owner_ext())
                .await
                .expect("the list answers");
            assert_eq!(listed.len(), 2);
            let listed_json = serde_json::to_string(&listed).expect("the reply serializes");
            let summary = listed[0].summary.clone();
            assert!(
                summary.contains("path"),
                "the summary dropped the harmless key: {summary}"
            );

            // The question the agent queued: a loop built by the same builder
            // `runs.start` uses, sharing this registry and this run id. The
            // registry de-duplicates the ask, so this is the very id and summary
            // the answer would resolve.
            let mut agent = build_agent_loop_in(
                &data_dir.join(AGENT_WORKSPACE_DIR),
                &state.config.allowed_commands,
                state.providers.clone(),
                state.mcp.clone(),
                state.mcp_permissions.clone(),
                state.mcp_approvals.clone(),
                Some(run_id.0.to_string()),
                Arc::new(RwLock::new(default_backend_kit("run"))),
                Some(warsha_core::ProjectPermissions {
                    confinement: warsha_core::Confinement::ReadOnly,
                    approval_mode: warsha_core::ApprovalMode::NeverAsk,
                    is_override: true,
                }),
            );
            agent
                .approve_agent_mode("owner")
                .expect("the owner approves the loop");
            agent.run_turn(&turn(SECRET_ARGS), &[]).await;
            let queued = agent.ask_queue.pending();
            let question = queued
                .iter()
                .find(|request| request.id == listed[0].id)
                .map(|request| request.question.clone())
                .expect("the ask carries the listed id");
            assert!(
                question.contains("test_srv::echo"),
                "the question does not name the call: {question}"
            );
            assert!(
                question.contains("path"),
                "the question dropped the harmless key: {question}"
            );
            for secret in ["SECRET-1", "SECRET-2", "SECRET-3"] {
                assert!(
                    !question.contains(secret),
                    "{secret} reached the queued question: {question}"
                );
            }

            // The answer path too: that is the daemon line it audits.
            rpc.allow_once_mcp_approval(&owner_ext(), listed[0].id.clone())
                .await
                .expect("the owner answers");

            let events = store.get_events(run_id).await.expect("the events are read");
            assert!(
                !events.is_empty(),
                "the turn wrote no events, so the event assertion proves nothing"
            );
            let events_json = serde_json::to_string(&events).expect("the events serialize");
            let sync = state.events.sync(0, Some(run_id)).await;
            let stream_json = serde_json::to_string(&sync.frames).expect("the stream serializes");
            (listed_json, events_json, stream_json, summary)
        });

        // Only this path's own lines: the capture is the process's, so another
        // test's line is not this test's evidence.
        let logs: String = capture
            .lines()
            .into_iter()
            .filter(|line| line.contains("mcp.approvals"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !logs.is_empty(),
            "the log capture saw nothing, so the log assertion proves nothing"
        );
        assert!(
            logs.contains("mcp.approvals.allow_once"),
            "the answer was not logged at all: {logs}"
        );

        for (surface, text) in [
            ("mcp.approvals.list", listed_json.as_str()),
            ("get_events", events_json.as_str()),
            ("events.sync", stream_json.as_str()),
            ("the daemon log", logs.as_str()),
        ] {
            for secret in ["SECRET-1", "SECRET-2", "SECRET-3", "SECRET-4"] {
                assert!(!text.contains(secret), "{secret} reached {surface}: {text}");
            }
        }
        assert!(summary.contains("path"), "{summary}");
    }

    /// T12 (M1): a run that completes purges what it left behind, and an ask
    /// that nobody ever answers stops waiting.
    ///
    /// The per-run cap bounds one run's residue; nothing bounded the process's,
    /// because a run that finishes through `runs.advance` used to purge nothing
    /// and an unresolved question had no horizon. Both ends are proved here: the
    /// terminal advance drops the run's grant *and* its open question, and the
    /// take path — every agent call passes through it — drops a question past
    /// `PENDING_TTL` while leaving a fresh one alone.
    #[tokio::test]
    async fn a_completed_run_and_a_stale_ask_leave_nothing_behind() {
        use std::time::Instant;
        use warsha_pipeline::PENDING_TTL;

        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, mcp) = state_with_mcp(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        let run_id = approved_agent_run(&state, &store).await;

        // One answered ask (a live grant) and one still waiting.
        rpc.agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"one"}"#))
            .await
            .expect("the first turn answers");
        let answered = only_pending(&rpc, &state).await;
        rpc.allow_once_mcp_approval(&owner_ext(), answered.id.clone())
            .await
            .expect("the owner grants");
        rpc.agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"two"}"#))
            .await
            .expect("the second turn answers");
        let waiting = only_pending(&rpc, &state).await;
        assert_ne!(answered.id, waiting.id, "the second ask reused an id");
        assert!(state
            .mcp_approvals
            .has_grant(&run_id.0.to_string(), "test_srv", "echo", "agent"));
        assert_eq!(mcp.count(), 0, "an ask reached the transport");

        // The run finishes: `runs.advance` from Feedback completes it. The run came
        // from `runs.start`, whose intake task bumps the row twice (brief commit,
        // Idea -> GateA); let it land first so the CAS below reads a version nothing
        // else is about to move.
        await_intake_settled(&store, run_id).await;
        let (mut run, version) = store
            .get_run_versioned(run_id)
            .await
            .expect("the run is stored");
        run.current_stage = warsha_core::Stage::Feedback;
        store
            .update_run_cas(&run, version)
            .await
            .expect("the run moves to Feedback");

        let advanced = rpc
            .advance_run(&owner_ext(), run_id)
            .await
            .expect("the run advances");
        assert_eq!(advanced.status, warsha_core::RunStatus::Completed);

        // Nothing of that run survives: no question, no grant.
        assert_eq!(
            state.mcp_approvals.pending_len(),
            0,
            "a completed run left a pending question behind"
        );
        assert!(
            rpc.list_mcp_approvals(&owner_ext())
                .await
                .expect("the list answers")
                .is_empty(),
            "mcp.approvals.list still shows a completed run's question"
        );
        assert!(
            !state
                .mcp_approvals
                .has_grant(&run_id.0.to_string(), "test_srv", "echo", "agent"),
            "a completed run left an unspent grant behind"
        );

        // The horizon: an ask nobody answers is dropped by the next call, while
        // one inside the horizon is not.
        let stale = state
            .mcp_approvals
            .register_pending(
                "run-that-died",
                "test_srv",
                "echo",
                "agent",
                &serde_json::json!({"msg": "stale"}),
                "msg: [hidden]".to_string(),
            )
            .expect("the stale ask registers");
        let fresh = state
            .mcp_approvals
            .register_pending(
                "run-that-died",
                "test_srv",
                "echo",
                "agent",
                &serde_json::json!({"msg": "fresh"}),
                "msg: [hidden]".to_string(),
            )
            .expect("the fresh ask registers");
        assert_eq!(state.mcp_approvals.pending_len(), 2);

        // The take path sweeps against the clock it is given.
        let now = Instant::now();
        assert_eq!(
            state.mcp_approvals.take_at(
                "run-that-died",
                "test_srv",
                "echo",
                "agent",
                &serde_json::json!({"msg": "fresh"}),
                now,
            ),
            warsha_pipeline::TakeOutcome::Missing
        );
        let answers = state.mcp_approvals.pending();
        assert!(
            answers.iter().any(|view| view.id == fresh),
            "a question inside the horizon was swept: {answers:?}"
        );

        let after_horizon = now + PENDING_TTL + std::time::Duration::from_secs(1);
        state.mcp_approvals.take_at(
            "run-that-died",
            "test_srv",
            "echo",
            "agent",
            &serde_json::json!({"msg": "other"}),
            after_horizon,
        );
        let answers = state.mcp_approvals.pending();
        assert!(
            !answers.iter().any(|view| view.id == stale),
            "a question past PENDING_TTL is still waiting: {answers:?}"
        );
        assert!(
            !answers.iter().any(|view| view.id == fresh),
            "a question past PENDING_TTL is still waiting: {answers:?}"
        );
        assert_eq!(
            state.mcp_approvals.pending_len(),
            0,
            "a killed run's questions pinned the process"
        );
    }

    /// T10: a grant is process memory — a fresh state over the same data asks again.
    #[tokio::test]
    async fn grants_and_pending_do_not_survive_a_restart() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, mcp) = state_with_mcp(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        let run_id = approved_agent_run(&state, &store).await;
        rpc.agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the turn answers");
        let pending = only_pending(&rpc, &state).await;
        rpc.allow_once_mcp_approval(&owner_ext(), pending.id.clone())
            .await
            .expect("the owner grants");
        assert!(state
            .mcp_approvals
            .has_grant(&run_id.0.to_string(), "test_srv", "echo", "agent"));

        // A fresh daemon over the same data directory: new registry, new loops.
        let (restarted, _store, _restarted_mcp) = state_with_mcp(&data_dir).await;
        assert!(restarted.mcp_approvals.pending().is_empty());
        assert!(!restarted.mcp_approvals.has_grant(
            &run_id.0.to_string(),
            "test_srv",
            "echo",
            "agent"
        ));

        // The same run, through the same builder the daemon uses at `runs.start`.
        let mut agent = build_agent_loop_in(
            &data_dir.join(AGENT_WORKSPACE_DIR),
            &restarted.config.allowed_commands,
            restarted.providers.clone(),
            restarted.mcp.clone(),
            restarted.mcp_permissions.clone(),
            restarted.mcp_approvals.clone(),
            Some(run_id.0.to_string()),
            Arc::new(RwLock::new(default_backend_kit("run"))),
            Some(warsha_core::ProjectPermissions {
                confinement: warsha_core::Confinement::ReadOnly,
                approval_mode: warsha_core::ApprovalMode::NeverAsk,
                is_override: true,
            }),
        );
        agent
            .approve_agent_mode("owner")
            .expect("the owner approves the restarted loop");
        let executed = agent.run_turn(&turn(r#"{"msg":"hi"}"#), &[]).await;
        assert!(!executed.tools[0].success);
        assert!(executed.tools[0].output.contains("approval required"));
        assert_eq!(mcp.count(), 0, "a restarted daemon granted a dead grant");
        assert_eq!(restarted.mcp_approvals.pending_len(), 1);
    }

    /// T11: allow-always and deny resolve the pending entry through the row write.
    #[tokio::test]
    async fn allow_always_and_deny_resolve_pending_through_permissions_set() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, mcp) = state_with_mcp(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        let run_id = approved_agent_run(&state, &store).await;

        rpc.agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the turn answers");
        only_pending(&rpc, &state).await;

        rpc.set_mcp_permission(
            &owner_ext(),
            "test_srv".to_string(),
            "echo".to_string(),
            "agent".to_string(),
            "allow".to_string(),
        )
        .await
        .expect("the row is written");
        // The ask left the list, and no grant was issued on the way out.
        assert!(rpc
            .list_mcp_approvals(&owner_ext())
            .await
            .expect("the list answers")
            .is_empty());
        assert!(!state
            .mcp_approvals
            .has_grant(&run_id.0.to_string(), "test_srv", "echo", "agent"));

        // The row decides now: the next call runs, with no grant involved.
        rpc.agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the turn answers");
        assert_eq!(mcp.count(), 1, "an allow row did not admit the call");

        // A new row: `ask` asks again, and `deny` resolves that ask and refuses.
        rpc.set_mcp_permission(
            &owner_ext(),
            "test_srv".to_string(),
            "echo".to_string(),
            "agent".to_string(),
            "ask".to_string(),
        )
        .await
        .expect("the row is written");
        rpc.agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the turn answers");
        only_pending(&rpc, &state).await;

        rpc.set_mcp_permission(
            &owner_ext(),
            "test_srv".to_string(),
            "echo".to_string(),
            "agent".to_string(),
            "deny".to_string(),
        )
        .await
        .expect("the row is written");
        assert!(rpc
            .list_mcp_approvals(&owner_ext())
            .await
            .expect("the list answers")
            .is_empty());

        let denied = rpc
            .agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the turn answers");
        assert!(!denied.tools[0].success);
        assert!(denied.tools[0].output.contains("denied by MCP permission"));
        assert_eq!(mcp.count(), 1, "a denied call reached the transport");
    }
}
/// R-EXT-2: the agent MCP tool call is on the run's stream (T1–T4), a loop with no
/// recorder is unchanged (T5), and a run's end is exactly one `run_finished` (T6/T8).
///
/// The transport is the in-process double the B3b fixtures use — records the call,
/// never starts a process, never reaches a network — and the model is the mock
/// provider, so nothing here spends or dials.
mod agent_tool_events {
    use super::*;
    use std::sync::Mutex as StdMutex;
    use warsha_pipeline::mcp::McpTool;

    /// The obviously fake secrets no event may carry (the B3b fixtures, verbatim).
    const SECRET_ARGS: &str =
        r#"{"api_key":"SECRET-1","note":"Bearer SECRET-2","password":"SECRET-3","path":"a.txt"}"#;

    /// A transport that records calls instead of making them, and can refuse.
    #[derive(Default)]
    struct RecordingMcp {
        calls: StdMutex<Vec<(String, String, serde_json::Value)>>,
        /// Answer every call with a transport error, which is T3's `failed` phase.
        refuse: bool,
    }

    impl RecordingMcp {
        fn answering() -> Self {
            Self::default()
        }

        fn refusing() -> Self {
            Self {
                calls: StdMutex::default(),
                refuse: true,
            }
        }

        fn count(&self) -> usize {
            self.calls
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .len()
        }
    }

    #[async_trait]
    impl McpManager for RecordingMcp {
        async fn connect(
            &self,
            _config: warsha_pipeline::mcp_transport::McpServerConfig,
        ) -> std::result::Result<(), warsha_pipeline::McpTransportError> {
            Ok(())
        }
        async fn disconnect(
            &self,
            _name: &str,
        ) -> std::result::Result<(), warsha_pipeline::McpTransportError> {
            Ok(())
        }
        async fn list(&self) -> Vec<warsha_pipeline::McpConnection> {
            vec![warsha_pipeline::McpConnection {
                config: warsha_pipeline::mcp_transport::McpServerConfig {
                    name: "test_srv".to_string(),
                    transport: warsha_pipeline::mcp_transport::McpTransport::Stdio,
                    command: Some("dummy".to_string()),
                    args: vec![],
                },
                status: warsha_pipeline::McpStatus::Connected,
                process_id: Some("p1".to_string()),
                tools: vec!["echo".to_string()],
                tool_definitions: vec![McpTool {
                    name: "echo".to_string(),
                    description: "echo the arguments".to_string(),
                    input_schema: serde_json::json!({
                        "type": "object",
                        "properties": {
                            "blob": {"type": "string", "writeOnly": true},
                            "path": {"type": "string"},
                        },
                    }),
                    annotations: None,
                }],
            }]
        }
        async fn send(
            &self,
            name: &str,
            payload: &str,
        ) -> std::result::Result<String, warsha_pipeline::McpTransportError> {
            Ok(format!("{name}:{payload}"))
        }
        async fn call_tool(
            &self,
            name: &str,
            tool: &str,
            arguments: serde_json::Value,
        ) -> std::result::Result<
            warsha_pipeline::mcp::McpToolResult,
            warsha_pipeline::McpTransportError,
        > {
            self.calls
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push((name.to_string(), tool.to_string(), arguments));
            if self.refuse {
                return Err(warsha_pipeline::McpTransportError::NotWired(
                    name.to_string(),
                ));
            }
            Ok(warsha_pipeline::mcp::McpToolResult {
                content: vec![warsha_pipeline::mcp::McpContent::Text {
                    text: "ok".to_string(),
                }],
                is_error: false,
            })
        }
    }

    /// The daemon over a temporary store, with `mcp` as the transport.
    async fn state_with_transport(
        data_dir: &Path,
    ) -> (Arc<DaemonState>, Arc<Store>, Arc<RecordingMcp>) {
        let mcp = Arc::new(RecordingMcp::answering());
        let transport: Arc<dyn McpManager> = mcp.clone();
        let (state, store) =
            test_state_with_seams(data_dir, |_| {}, None, None, Some(transport)).await;
        (state, store, mcp)
    }

    /// A project, a run the owner starts, and the Agent mode approval that lets a turn
    /// reach a tool — the shape `runs.start` gives a real run, including its own loop.
    async fn agent_run(state: &Arc<DaemonState>, store: &Arc<Store>) -> RunId {
        let project = Project {
            id: ProjectId::new(),
            name: "Agent Tool Project".to_string(),
            description: "Test".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
            ..Default::default()
        };
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state.clone());
        let run = rpc
            .start_run(
                &owner_ext(),
                project.id,
                "an agent turn".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("the run starts");
        rpc.approve_agent_mode(&owner_ext(), Some(run.id))
            .await
            .expect("the owner approves the run's loop");
        run.id
    }

    fn turn(arguments: &str) -> String {
        format!("call mcp test_srv/echo {arguments}")
    }

    /// Every `mcp_call` phase the run recorded, in store order.
    async fn phases(store: &Store, run_id: RunId) -> Vec<String> {
        store
            .get_events(run_id)
            .await
            .expect("the events are read")
            .into_iter()
            .filter(|event| event.payload.get("action") == Some(&serde_json::json!("mcp_call")))
            .map(|event| {
                event.payload["phase"]
                    .as_str()
                    .expect("a phase is a string")
                    .to_string()
            })
            .collect()
    }

    /// T1: an `allow` row records the call as `requested` then `succeeded`, and the
    /// transport really saw it once.
    #[tokio::test]
    async fn allow_row_records_requested_then_succeeded() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, mcp) = state_with_transport(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        let run_id = agent_run(&state, &store).await;
        rpc.set_mcp_permission(
            &owner_ext(),
            "test_srv".to_string(),
            "echo".to_string(),
            warsha_pipeline::MCP_AGENT_ROLE.to_string(),
            "allow".to_string(),
        )
        .await
        .expect("the owner allows the tool");

        let answer = rpc
            .agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the turn answers");
        assert!(answer.tools[0].success, "the allowed call did not run");

        assert_eq!(phases(&store, run_id).await, ["requested", "succeeded"]);
        let events = store.get_events(run_id).await.expect("the events are read");
        for event in &events {
            if event.payload.get("action") == Some(&serde_json::json!("mcp_call")) {
                assert_eq!(event.kind, warsha_core::EventKind::ToolCall);
                assert_eq!(event.role, None);
                assert_eq!(event.payload["server"], serde_json::json!("test_srv"));
                assert_eq!(event.payload["tool"], serde_json::json!("echo"));
            }
        }
        assert_eq!(
            mcp.count(),
            1,
            "the allowed call did not reach the transport once"
        );
    }

    /// T2: an `ask` row records `requested` then `approval_required` carrying the
    /// question id, reaches no transport, and the answered turn ends `succeeded` —
    /// in store order, with no phase written twice.
    #[tokio::test]
    async fn ask_row_records_the_question_then_the_granted_call() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, mcp) = state_with_transport(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        let run_id = agent_run(&state, &store).await;

        // An empty permission table is `ask` (never allow), so the first turn asks.
        let asked = rpc
            .agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the turn answers");
        assert!(!asked.tools[0].success);
        assert!(asked.tools[0].output.contains("approval"));

        let listed = rpc
            .list_mcp_approvals(&owner_ext())
            .await
            .expect("the list answers");
        assert_eq!(listed.len(), 1, "the ask queued no single question");
        let pending = listed[0].clone();
        assert_eq!(mcp.count(), 0, "an ask reached the transport");
        assert_eq!(
            phases(&store, run_id).await,
            ["requested", "approval_required"]
        );
        let events = store.get_events(run_id).await.expect("the events are read");
        let asked_event = events
            .iter()
            .find(|event| event.payload["phase"] == serde_json::json!("approval_required"))
            .expect("the approval-required event is recorded");
        assert_eq!(
            asked_event.payload["question_id"],
            serde_json::json!(pending.id)
        );

        rpc.allow_once_mcp_approval(&owner_ext(), pending.id.clone())
            .await
            .expect("the owner allows once");
        let answered = rpc
            .agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the second turn answers");
        assert!(answered.tools[0].success, "the granted call did not run");
        assert_eq!(
            mcp.count(),
            1,
            "the granted call reached the transport once"
        );

        // The whole life of the call, in `seq` order: the ask, then the call it admitted.
        assert_eq!(
            phases(&store, run_id).await,
            ["requested", "approval_required", "requested", "succeeded"]
        );
        assert_eq!(
            state.mcp_approvals.pending_len(),
            0,
            "the answered ask is still queued"
        );
    }

    /// T3: a `deny` row records `denied` and reaches no transport; a transport that
    /// refuses records `failed`.
    #[tokio::test]
    async fn deny_row_records_denied_and_a_transport_error_records_failed() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, mcp) = state_with_transport(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        let run_id = agent_run(&state, &store).await;
        rpc.set_mcp_permission(
            &owner_ext(),
            "test_srv".to_string(),
            "echo".to_string(),
            warsha_pipeline::MCP_AGENT_ROLE.to_string(),
            "deny".to_string(),
        )
        .await
        .expect("the owner denies the tool");
        let denied = rpc
            .agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the turn answers");
        assert!(!denied.tools[0].success);
        assert_eq!(mcp.count(), 0, "a denied call reached the transport");
        assert_eq!(phases(&store, run_id).await, ["requested", "denied"]);

        // The same row, allowed, against a transport that refuses: `failed`.
        let refusing_dir = temp.path().join("refusing");
        let refusing = Arc::new(RecordingMcp::refusing());
        let transport: Arc<dyn McpManager> = refusing.clone();
        let (refusing_state, refusing_store) =
            test_state_with_seams(&refusing_dir, |_| {}, None, None, Some(transport)).await;
        let refusing_rpc = WarshaRpc::new(refusing_state.clone());
        let failing_run = agent_run(&refusing_state, &refusing_store).await;
        refusing_rpc
            .set_mcp_permission(
                &owner_ext(),
                "test_srv".to_string(),
                "echo".to_string(),
                warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                "allow".to_string(),
            )
            .await
            .expect("the owner allows the tool");
        let failed = refusing_rpc
            .agent_turn_run(&owner_ext(), failing_run, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the turn answers");
        assert!(!failed.tools[0].success);
        assert_eq!(
            refusing.count(),
            1,
            "the failed call reached the transport once"
        );
        assert_eq!(
            phases(&refusing_store, failing_run).await,
            ["requested", "failed"]
        );
    }

    /// T4: every phase's payload is exactly the call's identifying fields and, on the
    /// asking phase, the question id — and no secret argument value is anywhere in
    /// the run's log, on any of the four phases.
    #[tokio::test]
    async fn every_phase_payload_names_the_call_and_never_an_argument() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, _mcp) = state_with_transport(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        let run_id = agent_run(&state, &store).await;

        // Ask with secrets, answer, call again with the same arguments, then allow a
        // fresh run's call so all four phases appear in this test.
        rpc.agent_turn_run(&owner_ext(), run_id, turn(SECRET_ARGS))
            .await
            .expect("the asking turn answers");
        let listed = rpc
            .list_mcp_approvals(&owner_ext())
            .await
            .expect("the list answers");
        rpc.allow_once_mcp_approval(&owner_ext(), listed[0].id.clone())
            .await
            .expect("the owner allows once");
        rpc.agent_turn_run(&owner_ext(), run_id, turn(SECRET_ARGS))
            .await
            .expect("the granted turn answers");

        let allowed_run = agent_run(&state, &store).await;
        rpc.set_mcp_permission(
            &owner_ext(),
            "test_srv".to_string(),
            "echo".to_string(),
            warsha_pipeline::MCP_AGENT_ROLE.to_string(),
            "allow".to_string(),
        )
        .await
        .expect("the owner allows the tool");
        rpc.agent_turn_run(&owner_ext(), allowed_run, turn(SECRET_ARGS))
            .await
            .expect("the allowed turn answers");
        rpc.set_mcp_permission(
            &owner_ext(),
            "test_srv".to_string(),
            "echo".to_string(),
            warsha_pipeline::MCP_AGENT_ROLE.to_string(),
            "deny".to_string(),
        )
        .await
        .expect("the owner denies the tool");
        let denied_run = agent_run(&state, &store).await;
        rpc.agent_turn_run(&owner_ext(), denied_run, turn(SECRET_ARGS))
            .await
            .expect("the denied turn answers");

        let mut seen_phases: Vec<String> = Vec::new();
        for run in [run_id, allowed_run, denied_run] {
            let events = store.get_events(run).await.expect("the events are read");
            let serialized = serde_json::to_string(&events).expect("the events serialize");
            for secret in ["SECRET-1", "SECRET-2", "SECRET-3", "SECRET-4"] {
                assert!(
                    !serialized.contains(secret),
                    "{secret} reached the run's event log"
                );
            }
            for event in events
                .iter()
                .filter(|event| event.payload.get("action") == Some(&serde_json::json!("mcp_call")))
            {
                let payload = event.payload.as_object().expect("the payload is an object");
                let mut keys: Vec<&str> = payload.keys().map(String::as_str).collect();
                keys.sort_unstable();
                let phase = payload["phase"].as_str().expect("a phase is a string");
                let expected: &[&str] = if phase == "approval_required" {
                    &["action", "phase", "question_id", "role", "server", "tool"]
                } else {
                    &["action", "phase", "role", "server", "tool"]
                };
                assert_eq!(keys, expected, "unexpected payload keys on phase {phase}");
                assert_eq!(payload["role"], serde_json::json!("agent"));
                seen_phases.push(phase.to_string());
            }
        }
        seen_phases.sort_unstable();
        seen_phases.dedup();
        assert_eq!(
            seen_phases,
            ["approval_required", "denied", "requested", "succeeded"],
            "the test did not exercise every phase"
        );
    }

    /// T5: a loop with no recorder behaves exactly as before — the ask is still queued,
    /// the call still runs, and nothing claims to have been observed.
    #[tokio::test]
    async fn a_loop_with_no_observer_records_nothing() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, _mcp) = state_with_transport(&data_dir).await;
        let run_id = agent_run(&state, &store).await;

        // The same builder `runs.start` uses, with the same run id — and no observer,
        // which is every unit test's loop and the daemon-wide one.
        let mut agent = build_agent_loop_in(
            &data_dir.join(AGENT_WORKSPACE_DIR),
            &state.config.allowed_commands,
            state.providers.clone(),
            state.mcp.clone(),
            state.mcp_permissions.clone(),
            state.mcp_approvals.clone(),
            Some(run_id.0.to_string()),
            Arc::new(RwLock::new(default_backend_kit("run"))),
            Some(warsha_core::ProjectPermissions {
                confinement: warsha_core::Confinement::ReadOnly,
                approval_mode: warsha_core::ApprovalMode::NeverAsk,
                is_override: true,
            }),
        );
        agent
            .approve_agent_mode("owner")
            .expect("the owner approves the loop");
        let answer = agent.run_turn(&turn(r#"{"msg":"hi"}"#), &[]).await;
        assert!(!answer.tools[0].success);
        assert_eq!(
            agent.ask_queue.pending().len(),
            1,
            "an unobserved loop stopped asking for approval"
        );
        assert_eq!(state.mcp_approvals.pending_len(), 1);
        assert!(
            phases(&store, run_id).await.is_empty(),
            "a loop with no observer wrote an mcp_call event"
        );
    }

    /// T6: reaching `Feedback` writes exactly one `run_finished{completed}`; a second
    /// advance and a replay add none.
    #[tokio::test]
    async fn a_completed_run_has_one_finished_event() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, _mcp) = state_with_transport(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        let run_id = agent_run(&state, &store).await;

        // `Feedback` is the last stage: advancing there is the completion (the same
        // move the preview tests make, so no model call is involved).
        let mut stored = store.get_run(run_id).await.expect("the run is stored");
        stored.current_stage = Stage::Feedback;
        store.update_run(&stored).await.expect("the stage moves");

        let finished = rpc
            .advance_run(&owner_ext(), run_id)
            .await
            .expect("the run advances");
        assert_eq!(finished.status, RunStatus::Completed);
        // A second advance finds a terminal run and writes nothing new.
        let again = rpc
            .advance_run(&owner_ext(), run_id)
            .await
            .expect("a terminal advance is not an error");
        assert_eq!(again.status, RunStatus::Completed);

        let events = store.get_events(run_id).await.expect("the events are read");
        let endings: Vec<&warsha_core::Event> = events
            .iter()
            .filter(|event| event.kind == warsha_core::EventKind::RunFinished)
            .collect();
        assert_eq!(endings.len(), 1, "the run has {endings:?}");
        assert_eq!(
            endings[0].payload,
            serde_json::json!({ "status": "completed" })
        );
        assert_eq!(endings[0].stage, Stage::Feedback);
        assert_eq!(endings[0].role, None);
        assert_eq!(endings[0].device_id, None);
    }

    /// T6: `runs.cancel` writes one `run_finished{cancelled}` naming the authenticated
    /// device, and cancelling again adds none.
    #[tokio::test]
    async fn a_cancelled_run_has_one_finished_event_naming_the_device() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, _mcp) = state_with_transport(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        let run_id = agent_run(&state, &store).await;
        let canceller = DeviceId::new();

        rpc.cancel_run(&owner_ext_as(canceller), run_id, None)
            .await
            .expect("the run cancels");
        rpc.cancel_run(&owner_ext_as(DeviceId::new()), run_id, None)
            .await
            .expect("cancelling a cancelled run is not an error");

        let events = store.get_events(run_id).await.expect("the events are read");
        let endings: Vec<&warsha_core::Event> = events
            .iter()
            .filter(|event| event.kind == warsha_core::EventKind::RunFinished)
            .collect();
        assert_eq!(endings.len(), 1, "the run has {endings:?}");
        assert_eq!(
            endings[0].payload,
            serde_json::json!({ "status": "cancelled" })
        );
        assert_eq!(endings[0].device_id, Some(canceller));
        assert!(
            events
                .iter()
                .any(|event| event.payload["action"] == serde_json::json!("run_cancelled")),
            "the reason event the run already wrote is gone"
        );
    }

    /// T6: a paused run is not over and writes no `run_finished`; a failed one writes
    /// exactly one `{failed}`.
    #[tokio::test]
    async fn a_paused_run_writes_none_and_a_failed_stage_writes_one() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, _mcp) = state_with_transport(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());

        // An empty router makes the researcher role unrouted: the run pauses.
        let paused_project = Project {
            id: ProjectId::new(),
            name: "Paused Project".to_string(),
            description: "Test".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
            ..Default::default()
        };
        store
            .create_project(&paused_project)
            .await
            .expect("the project");
        // Route Intake so start_run executes, then clear router before advancing past GateA.
        let mut r = ProviderRouter::new();
        let mock = warsha_providers::MockProvider::new("mock");
        r.register_provider(Box::new(mock));
        r.set_role_routing(RoleRouting {
            role: Role::Intake,
            targets: vec![RoutingTarget {
                provider_id: "mock".to_string(),
                model_id: "mock-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
        *state.providers.write().await = r;
        let paused_run = rpc
            .start_run(
                &owner_ext(),
                paused_project.id,
                "a run".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("the run starts");
        // M-1: intake runs on a background task, so wait for it to finish before
        // the router is emptied — otherwise the intake call itself would be the
        // one that records the pause.
        await_intake_settled(&store, paused_run.id).await;
        *state.providers.write().await = ProviderRouter::new();
        rpc.advance_run(&owner_ext(), paused_run.id)
            .await
            .expect("advance to the gate");
        rpc.approve_gate(&owner_ext(), paused_run.id, Stage::GateA, None)
            .await
            .expect("the gate approves");
        let _ = rpc.advance_run(&owner_ext(), paused_run.id).await;
        let paused = store.get_run(paused_run.id).await.expect("the run is read");
        assert_eq!(paused.status, RunStatus::Paused);
        assert!(
            !store
                .get_events(paused_run.id)
                .await
                .expect("the events are read")
                .iter()
                .any(|event| event.kind == warsha_core::EventKind::RunFinished),
            "a paused run recorded its end"
        );

        // A provider that refuses the call (not an unrouted role) fails the stage.
        let failing_dir = temp.path().join("failing");
        let (failing_state, failing_store, _failing_mcp) = state_with_transport(&failing_dir).await;
        let failing_rpc = WarshaRpc::new(failing_state.clone());
        let mut router = ProviderRouter::new();
        router.register_provider(Box::new(warsha_providers::MockProvider::new("mock-intake")));
        router.register_provider(Box::new(
            warsha_providers::MockProvider::new("mock-failing")
                .with_failure(warsha_providers::ProviderError::Auth("refused".to_string())),
        ));
        router.set_role_routing(RoleRouting {
            role: Role::Intake,
            targets: vec![RoutingTarget {
                provider_id: "mock-intake".to_string(),
                model_id: "mock-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
        router.set_role_routing(RoleRouting {
            role: Role::Researcher,
            targets: vec![RoutingTarget {
                provider_id: "mock-failing".to_string(),
                model_id: "mock-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
        *failing_state.providers.write().await = router;
        let failing_project = Project {
            id: ProjectId::new(),
            name: "Failing Project".to_string(),
            description: "Test".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
            ..Default::default()
        };
        failing_store
            .create_project(&failing_project)
            .await
            .expect("the project");
        let failing_run = failing_rpc
            .start_run(
                &owner_ext(),
                failing_project.id,
                "a run".to_string(),
                None,
                None,
                None,
            )
            .await
            .expect("the run starts");
        failing_rpc
            .advance_run(&owner_ext(), failing_run.id)
            .await
            .expect("advance to the gate");
        failing_rpc
            .approve_gate(&owner_ext(), failing_run.id, Stage::GateA, None)
            .await
            .expect("the gate approves");
        let _ = failing_rpc.advance_run(&owner_ext(), failing_run.id).await;
        let failed = failing_store
            .get_run(failing_run.id)
            .await
            .expect("the run is read");
        assert_eq!(failed.status, RunStatus::Failed);
        let endings: Vec<warsha_core::Event> = failing_store
            .get_events(failing_run.id)
            .await
            .expect("the events are read")
            .into_iter()
            .filter(|event| event.kind == warsha_core::EventKind::RunFinished)
            .collect();
        assert_eq!(endings.len(), 1, "the failed run has {endings:?}");
        assert_eq!(
            endings[0].payload,
            serde_json::json!({ "status": "failed" })
        );
    }

    /// T8: an open subscriber on the daemon's own event bus receives the tool call and
    /// the run's end — the frames the `/events` socket and `runs.subscribe` replay.
    #[tokio::test]
    async fn an_open_stream_receives_the_call_and_the_end() {
        let temp = crate::test_util::fresh_tempdir();
        let data_dir = temp.path().join("data");
        let (state, store, _mcp) = state_with_transport(&data_dir).await;
        let rpc = WarshaRpc::new(state.clone());
        let run_id = agent_run(&state, &store).await;
        rpc.set_mcp_permission(
            &owner_ext(),
            "test_srv".to_string(),
            "echo".to_string(),
            warsha_pipeline::MCP_AGENT_ROLE.to_string(),
            "allow".to_string(),
        )
        .await
        .expect("the owner allows the tool");

        // The subscription is taken before the work, as a socket would take it: the
        // store's bus is the one `/events` subscribes through, and every append
        // publishes on it.
        let mut stream = store.subscribe_events();
        rpc.agent_turn_run(&owner_ext(), run_id, turn(r#"{"msg":"hi"}"#))
            .await
            .expect("the turn answers");
        let mut stored = store.get_run(run_id).await.expect("the run is stored");
        stored.current_stage = Stage::Feedback;
        store.update_run(&stored).await.expect("the stage moves");
        rpc.advance_run(&owner_ext(), run_id)
            .await
            .expect("the run completes");

        let mut observed: Vec<(String, serde_json::Value)> = Vec::new();
        while let Ok(Ok(event)) =
            tokio::time::timeout(std::time::Duration::from_millis(250), stream.recv()).await
        {
            if event.run_id != run_id {
                continue;
            }
            observed.push((format!("{:?}", event.kind), event.payload.clone()));
        }
        assert!(
            observed.iter().any(|(kind, payload)| {
                kind == "ToolCall" && payload["action"] == serde_json::json!("mcp_call")
            }),
            "the stream carried no tool call: {observed:?}"
        );
        assert!(
            observed.iter().any(|(kind, payload)| kind == "RunFinished"
                && payload["status"] == serde_json::json!("completed")),
            "the stream carried no run_finished: {observed:?}"
        );
    }
}

#[tokio::test]
async fn a_protected_file_is_marked_and_not_read() {
    let temp = crate::test_util::fresh_tempdir();
    let root = temp.path().join("repo");
    std::fs::create_dir_all(&root).expect("the directory is made");
    std::fs::write(root.join(".env"), "SECRET=true").expect("a file is written");
    std::fs::write(root.join("config.rs"), "pub fn x() {}").expect("a file is written");

    // The list_tree and read_text tests.
    let entries = crate::wave2::list_tree(&root, &root).expect("the root lists");

    let env_entry = entries
        .iter()
        .find(|e| e.name == ".env")
        .expect("entry should exist");
    assert!(env_entry.protected, "protected files should be marked");

    crate::wave2::read_text(&root, &root.join(".env"))
        .expect_err("protected files should not be served");
    crate::wave2::read_text(&root, &root.join("config.rs"))
        .expect("normal files should be readable");
}

/// M6: an unrecognised `WARSHA_REMOTE_BIND` fails closed instead of falling back to the
/// default bind, and each recognised spelling lands on its variant.
#[test]
fn an_invalid_remote_bind_env_value_fails_closed() {
    struct EnvGuard;
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            std::env::remove_var("WARSHA_REMOTE_BIND");
        }
    }
    let _guard = EnvGuard;

    std::env::set_var("WARSHA_REMOTE_BIND", "everywhere");
    let error = crate::startup::apply_env_overrides(DaemonConfig::default())
        .expect_err("an unknown remote bind must be refused");
    assert!(
        matches!(&error, DaemonError::Config(message) if message.contains("WARSHA_REMOTE_BIND")),
        "unexpected error: {error}"
    );

    std::env::set_var("WARSHA_REMOTE_BIND", "tailscale");
    let config = crate::startup::apply_env_overrides(DaemonConfig::default())
        .expect("tailscale is a recognised value");
    assert_eq!(config.remote_bind, RemoteBind::Tailscale);

    std::env::set_var("WARSHA_REMOTE_BIND", "localhost");
    let config = crate::startup::apply_env_overrides(DaemonConfig::default())
        .expect("localhost is a recognised value");
    assert_eq!(config.remote_bind, RemoteBind::Localhost);
}

/// H1: `remote_bind = tailscale` listens on the Tailscale address and ALSO on
/// `127.0.0.1` (same ports) so the desktop app stays connected. The Tailscale adapter is
/// mocked as an interface named `tailscale0` holding `127.0.0.2` (a loopback address a
/// Linux host binds without a real adapter); it is never `0.0.0.0`.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn tailscale_bind_also_serves_the_loopback_companion() {
    let temp = crate::test_util::fresh_tempdir();
    let config = DaemonConfig {
        data_dir: temp.path().to_path_buf(),
        auth_token: "tailscale-token-0123456789abcdef".to_string(),
        http_port: 0,
        ws_port: 0,
        remote_bind: RemoteBind::Tailscale,
        ..Default::default()
    };
    let ifaces = vec![InterfaceInfo {
        name: "tailscale0".to_string(),
        ip: "127.0.0.2".parse().expect("an IP literal"),
    }];
    let handle = crate::startup::start_daemon_with_interfaces(
        config,
        Arc::new(InMemorySecretStore::new()),
        Arc::new(MockProviderFactory::new()),
        ifaces,
    )
    .await
    .expect("the daemon starts on the mocked Tailscale address");

    assert_eq!(handle.bind_addr().to_string(), "127.0.0.2");
    assert!(handle.has_loopback_companion());
    for port in [handle.http_port(), handle.rpc_port()] {
        tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("the loopback companion accepts connections");
        tokio::net::TcpStream::connect(("127.0.0.2", port))
            .await
            .expect("the Tailscale address accepts connections");
    }
    let rpc_port = handle.rpc_port();
    handle.shutdown().await;
    // Both listeners are released by shutdown.
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert!(
        tokio::net::TcpStream::connect(("127.0.0.1", rpc_port))
            .await
            .is_err(),
        "the companion RPC listener must be gone after shutdown"
    );
}

/// H1: with no Tailscale interface the daemon refuses to start rather than falling back.
#[tokio::test]
async fn tailscale_bind_without_an_interface_refuses_to_start() {
    let temp = crate::test_util::fresh_tempdir();
    let config = DaemonConfig {
        data_dir: temp.path().to_path_buf(),
        auth_token: "tailscale-token-0123456789abcdef".to_string(),
        http_port: 0,
        ws_port: 0,
        remote_bind: RemoteBind::Tailscale,
        ..Default::default()
    };
    let result = crate::startup::start_daemon_with_interfaces(
        config,
        Arc::new(InMemorySecretStore::new()),
        Arc::new(MockProviderFactory::new()),
        Vec::new(),
    )
    .await;
    assert!(matches!(result, Err(DaemonError::Config(_))));
}

#[tokio::test]
async fn auth_token_must_be_long_enough_for_non_loopback() {
    let config = DaemonConfig {
        bind_host: "192.168.1.5".to_string(),
        ..Default::default()
    };

    std::env::set_var("WARSHA_AUTH_TOKEN", "short");
    let error = crate::startup::apply_env_overrides(config.clone())
        .expect_err("short token on non-loopback must fail");
    assert!(
        error.to_string().contains("token too short"),
        "unexpected error: {error}"
    );

    std::env::set_var("WARSHA_AUTH_TOKEN", "a".repeat(32));
    crate::startup::apply_env_overrides(config.clone())
        .expect("32-char token on non-loopback must pass");
}

#[tokio::test]
async fn validate_token_for_config_tailscale_requires_long_token() {
    let mut config = DaemonConfig {
        remote_bind: RemoteBind::Tailscale,
        ..Default::default()
    };

    // Empty token should fail
    config.auth_token = "".to_string();
    assert!(crate::startup::validate_token_for_config(&config).is_err());

    // 15-char token should fail
    config.auth_token = "tailscale-token".to_string();
    assert!(crate::startup::validate_token_for_config(&config).is_err());

    // 32-char token should pass
    config.auth_token = "a".repeat(32);
    assert!(crate::startup::validate_token_for_config(&config).is_ok());
}

/// Proving test for watchdog / intake hang: `runs.cancel` promptly interrupts a hung provider dispatch.
#[tokio::test]
async fn cancel_during_hung_stage_stops_promptly() {
    let temp = crate::test_util::fresh_tempdir();
    let data_dir = temp.path().join("data");

    let mut router = ProviderRouter::new();
    // Long stage timeout (60s) so it would definitely hang without prompt cancellation
    router.set_dispatch_timeout(std::time::Duration::from_secs(60));
    let hung = warsha_providers::MockProvider::new("hung-provider").with_hang();
    router.register_provider(Box::new(hung));
    let mock = warsha_providers::MockProvider::new("mock");
    router.register_provider(Box::new(mock));
    router.set_role_routing(RoleRouting {
        role: Role::Intake,
        targets: vec![RoutingTarget {
            provider_id: "mock".to_string(),
            model_id: "mock-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });
    router.set_role_routing(RoleRouting {
        role: Role::Researcher,
        targets: vec![RoutingTarget {
            provider_id: "hung-provider".to_string(),
            model_id: "mock-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });

    let (state, store) = test_state_with_router(&data_dir, router).await;
    let rpc = WarshaRpc::new(state.clone());

    let project = Project {
        id: ProjectId::new(),
        name: "Hung Stage Cancel Project".to_string(),
        description: "Test".to_string(),
        language: "en".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        ..Default::default()
    };
    store
        .create_project(&project)
        .await
        .expect("project created");

    // The pipeline's own start, not `runs.start`: the RPC spawns an intake task that
    // commits the brief and advances Idea -> GateA, writing the run row and the
    // Intake session itself. This test overwrites the row to force an approved
    // GateA and then drives `advance_run`, so it must be the only writer; an intake
    // write landing after the overwrite moves the run (and the stage) under it.
    let run = state
        .pipeline
        .start_run(project.id, "test cancel while hanging")
        .await
        .expect("run starts");

    // Approve GateA so advance_run will enter Research stage and execute hung provider
    let mut updated_run = store.get_run(run.id).await.unwrap();
    updated_run.current_stage = Stage::GateA;
    updated_run.gate_states.insert(
        Stage::GateA,
        GateState::Approved {
            by: DeviceId::new(),
            at: Utc::now(),
        },
    );
    store.update_run(&updated_run).await.unwrap();

    let advance_rpc = WarshaRpc::new(state.clone());
    let run_id = run.id;
    let advance_handle =
        tokio::spawn(async move { advance_rpc.advance_run(&owner_ext(), run_id).await });

    // Wait until stage creates a working session
    let mut working = false;
    for _ in 0..50 {
        if let Ok(sessions) = store.list_sessions_by_run(run_id).await {
            if sessions
                .iter()
                .any(|s| s.status == warsha_core::SessionStatus::Working)
            {
                working = true;
                break;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(working, "stage must have entered Working session");

    // Cancel during hung stage: must return promptly and not wait for 60s timeout
    let canceller = DeviceId::new();
    let cancel_start = std::time::Instant::now();
    let cancel_res = tokio::time::timeout(
        std::time::Duration::from_secs(3),
        rpc.cancel_run(
            &owner_ext_as(canceller),
            run_id,
            Some("hung stage cancelled".to_string()),
        ),
    )
    .await
    .expect("cancel_run must return promptly and not hang");

    let cancelled_run = cancel_res.expect("cancel_run succeeds");
    assert_eq!(cancelled_run.status, RunStatus::Cancelled);
    assert!(
        cancel_start.elapsed() < std::time::Duration::from_secs(2),
        "cancellation took too long: {:?}",
        cancel_start.elapsed()
    );

    // advance_run background task must also resolve promptly
    let advance_outcome = tokio::time::timeout(std::time::Duration::from_secs(2), advance_handle)
        .await
        .expect("advance_run task must resolve promptly on cancellation");
    let advance_res = advance_outcome.expect("advance_run task joined cleanly");
    // Under prompt cancellation, advance_run resolves either with an error (cancellation
    // observed mid-flight) or with the cancelled run (if cancel completed the store CAS
    // update first). In neither case can it return a non-cancelled run or hang.
    match advance_res {
        Ok(advanced_run) => {
            assert_eq!(
                advanced_run.status,
                RunStatus::Cancelled,
                "advance_run resolved with Ok but run was not Cancelled"
            );
        }
        Err(_) => {
            // Cancelled mid-flight before run status updated
        }
    }

    // Verify stored state and events
    let final_run = store.get_run(run_id).await.unwrap();
    assert_eq!(final_run.status, RunStatus::Cancelled);

    let sessions = store.list_sessions_by_run(run_id).await.unwrap();
    assert!(!sessions.is_empty());
    for s in sessions {
        assert_ne!(
            s.status,
            warsha_core::SessionStatus::Working,
            "no session should remain in Working status after cancel"
        );
    }

    let events = store.get_events(run_id).await.unwrap();
    let has_cancelled_event = events.iter().any(|ev| {
        ev.kind == EventKind::RunFinished
            && ev.payload.get("status").and_then(|s| s.as_str()) == Some("cancelled")
    });
    assert!(
        has_cancelled_event,
        "must emit run_finished cancelled event"
    );
}

/// Wait until the intake dispatch `runs.start` spawns in the background (M-1) has
/// settled: the run left the Idea stage, or it stopped running altogether.
///
/// Before M-1 `runs.start` ran intake inline, so a test could read the store the
/// instant it returned. Now the caller returns a Running run at Idea and intake
/// lands a moment later, so a test that cares about the state *after* intake has
/// to wait for it here.
async fn await_intake_settled(store: &Store, run_id: RunId) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if let Ok(run) = store.get_run(run_id).await {
            if run.current_stage != Stage::Idea || run.status != RunStatus::Running {
                return;
            }
        }
        if std::time::Instant::now() >= deadline {
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
}

/// F-R20-1: start_run in Agent/Simple mode executes initial Idea (intake) stage
/// with mock provider, creating a session row, updating brief/idea artifacts,
/// and advancing to GateA for supervisor approval.
#[tokio::test]
async fn start_run_in_agent_mode_executes_intake_and_advances_to_gate_a() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = owner_ext();

    let project = rpc
        .create_project(
            &owner,
            "Intake Dispatch Project".to_string(),
            "A test project for intake dispatch".to_string(),
            "en".to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("project created");

    let run = rpc
        .start_run(
            &owner,
            project.id,
            "pomodoro timer with audio alert".to_string(),
            Some("agent".to_string()),
            None,
            Some(2500),
        )
        .await
        .expect("start_run succeeds");

    // M-1: start_run returns Running run immediately
    assert_eq!(
        run.status,
        RunStatus::Running,
        "start_run must return Running run immediately"
    );

    // Poll store until background intake completes and advances to GateA
    let start_time = std::time::Instant::now();
    let mut updated_run = store.get_run(run.id).await.unwrap();
    while start_time.elapsed() < std::time::Duration::from_secs(5) {
        updated_run = store.get_run(run.id).await.unwrap();
        let events = store.get_events(run.id).await.unwrap_or_default();
        if updated_run.current_stage == Stage::GateA
            && events
                .iter()
                .any(|ev| ev.kind == EventKind::StageStarted && ev.stage == Stage::GateA)
        {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    // Must advance beyond Stage::Idea to Stage::GateA
    assert_eq!(
        updated_run.current_stage,
        Stage::GateA,
        "intake execution must reach GateA"
    );

    // Session row for Intake must exist and be Done
    let sessions = store.list_sessions_by_run(run.id).await.unwrap();
    let intake_session = sessions
        .iter()
        .find(|s| s.role == Role::Intake)
        .expect("intake session must be created");
    assert_eq!(
        intake_session.status,
        warsha_core::SessionStatus::Done,
        "intake session must be Completed (Done)"
    );

    // Brief artifact must exist
    let updated_run = store.get_run(run.id).await.unwrap();
    assert!(
        updated_run.artifacts.contains_key("brief"),
        "brief artifact must be present"
    );
    assert!(
        updated_run.artifacts.contains_key("idea"),
        "idea artifact must be present"
    );

    // Events must include events beyond initial StageStarted: e.g. AgentStep
    // and StageStarted for GateA
    let events = store.get_events(run.id).await.unwrap();
    let has_agent_step = events.iter().any(|ev| {
        ev.kind == EventKind::AgentStep && ev.stage == Stage::Idea && ev.role == Some(Role::Intake)
    });
    assert!(
        has_agent_step,
        "must emit AgentStep event for intake during initial stage execution"
    );

    let started_gate_a = events
        .iter()
        .any(|ev| ev.kind == EventKind::StageStarted && ev.stage == Stage::GateA);
    assert!(started_gate_a, "must emit StageStarted for GateA");
}

/// R21-B2: Unrouted runs.start in Agent mode (no route, no env key, no fake)
/// surfaces Paused + provider_required immediately, without a 180s stall.
#[tokio::test]
async fn unrouted_agent_run_start_pauses_immediately_with_provider_required() {
    let temp = crate::test_util::fresh_tempdir();
    let empty_router = ProviderRouter::new();
    let (state, store) = test_state_with_router(temp.path(), empty_router).await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = owner_ext();

    let project = rpc
        .create_project(
            &owner,
            "Unrouted Intake Project".to_string(),
            "A test project for unrouted intake".to_string(),
            "en".to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("project created");

    let run = rpc
        .start_run(
            &owner,
            project.id,
            "unrouted idea".to_string(),
            Some("agent".to_string()),
            None,
            Some(2500),
        )
        .await
        .expect("start_run succeeds");

    // Poll the store briefly (with a short timeout like 2s, NOT 180s watchdog wait)
    // to verify the run records Paused + provider_required immediately. The error
    // event is appended just after the status CAS, so the loop waits for both.
    let start_time = std::time::Instant::now();
    let mut reloaded = store.get_run(run.id).await.unwrap();
    let mut provider_required = false;
    while start_time.elapsed() < std::time::Duration::from_secs(2) {
        reloaded = store.get_run(run.id).await.unwrap();
        let events = store.get_events(run.id).await.unwrap_or_default();
        provider_required = events.iter().any(|ev| {
            ev.kind == EventKind::Error
                && ev.payload.get("action").and_then(|v| v.as_str()) == Some("provider_required")
        });
        if reloaded.status == RunStatus::Paused && provider_required {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }

    assert_eq!(
        reloaded.status,
        RunStatus::Paused,
        "unrouted run must be Paused immediately, but was {:?}",
        reloaded.status
    );

    assert!(
        provider_required,
        "unrouted run must record Error event with action 'provider_required'"
    );
}

/// The failure transition must rebase a stage snapshot after another run-row writer.
#[tokio::test]
async fn unrouted_agent_run_start_rebases_pause_after_concurrent_budget_write() {
    let temp = crate::test_util::fresh_tempdir();
    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(warsha_providers::MockProvider::new("unrouted")));
    let (state, store) = test_state_with_router(temp.path(), router).await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = owner_ext();
    let project = rpc
        .create_project(
            &owner,
            "CAS pause".into(),
            "".into(),
            "en".into(),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();

    // Block dispatch until we own the same state lock used by budget/cancel writers.
    // Intake reads its version before taking the router read lock; no timing sleeps.
    let router_guard = state.providers.write().await;
    let run = rpc
        .start_run(
            &owner,
            project.id,
            "unrouted idea".into(),
            Some("agent".into()),
            None,
            Some(2500),
        )
        .await
        .unwrap();
    let ctrl = state.pipeline.control_for(run.id).await;
    let state_guard = ctrl.state_lock.lock().await;
    drop(router_guard);
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if store
                .list_sessions_by_run(run.id)
                .await
                .unwrap()
                .iter()
                .any(|s| s.role == Role::Intake && s.status == warsha_core::SessionStatus::Failed)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("unrouted dispatch finishes before the pause acquires state_lock");

    // Exactly the budget writer's read/modify/CAS, under its state_lock. The
    // failure path is queued behind us with the older stage snapshot/version.
    let (mut latest, version) = store.get_run_versioned(run.id).await.unwrap();
    latest.budget_cents = Some(4321);
    let budget_version = store.update_run_cas(&latest, version).await.unwrap();
    drop(state_guard);
    let tasks: Vec<_> = state.intake_tasks.lock().unwrap().drain(..).collect();
    for task in tasks {
        tokio::time::timeout(std::time::Duration::from_secs(2), task)
            .await
            .expect("intake settles promptly")
            .unwrap();
    }
    let (persisted, settled_version) = store.get_run_versioned(run.id).await.unwrap();
    assert_eq!(
        persisted.status,
        RunStatus::Paused,
        "pause must survive the stale stage version"
    );
    assert_eq!(
        persisted.budget_cents,
        Some(4321),
        "rebase must preserve the concurrent budget"
    );
    assert_eq!(
        settled_version,
        budget_version + 1,
        "pause must commit on the latest version"
    );
    let events = store.get_events(run.id).await.unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|ev| ev.kind == EventKind::Error
                && ev.payload.get("action").and_then(|v| v.as_str()) == Some("provider_required"))
            .count(),
        1
    );
}

/// F-R20-1: A run stalled at a non-gate stage without any sessions for longer than
/// dispatch_timeout must be reaped by the watchdog to Failed with stage_failed and retry_hint.
#[tokio::test]
async fn watchdog_reaps_stalled_stage_without_sessions() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;

    // Set a short dispatch timeout (1 second)
    state
        .providers
        .write()
        .await
        .set_dispatch_timeout(std::time::Duration::from_secs(1));

    let project = Project {
        id: ProjectId::new(),
        name: "Stall Test Project".to_string(),
        description: "Testing stall watchdog".to_string(),
        language: "en".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        ..Default::default()
    };
    store.create_project(&project).await.unwrap();

    let stalled_run = Run {
        id: RunId::new(),
        project_id: project.id,
        current_stage: Stage::Idea,
        gate_states: HashMap::new(),
        artifacts: HashMap::new(),
        created_at: Utc::now() - chrono::Duration::seconds(10),
        updated_at: Utc::now() - chrono::Duration::seconds(10),
        status: RunStatus::Running,
        budget_cents: Some(1000),
        spent_cents: 0,
        worktree_path: None,
        worktree_branch: None,
        confinement: None,
        run_mode: warsha_core::RunMode::Agent,
    };
    store.create_run(&stalled_run).await.unwrap();

    // Verify 0 sessions
    let sessions = store.list_sessions_by_run(stalled_run.id).await.unwrap();
    assert!(sessions.is_empty(), "stalled run has zero sessions");

    // Call check_stale_run
    let reaped = state
        .pipeline
        .check_stale_run(stalled_run.id)
        .await
        .expect("check_stale_run succeeds");

    assert_eq!(
        reaped.status,
        RunStatus::Failed,
        "watchdog must mark stalled run Failed"
    );

    // Verify error event with retry_hint
    let events = store.get_events(stalled_run.id).await.unwrap();
    let error_event = events
        .iter()
        .find(|ev| ev.kind == EventKind::Error)
        .expect("watchdog must emit Error event");
    assert_eq!(
        error_event.payload.get("action").and_then(|v| v.as_str()),
        Some("stage_failed")
    );
    assert_eq!(
        error_event
            .payload
            .get("retry_hint")
            .and_then(|v| v.as_str()),
        Some("Check model provider configuration and retry stage")
    );

    let finished_event = events
        .iter()
        .find(|ev| ev.kind == EventKind::RunFinished)
        .expect("watchdog must emit RunFinished event");
    assert_eq!(
        finished_event
            .payload
            .get("status")
            .and_then(|v| v.as_str()),
        Some("failed")
    );
}

#[tokio::test]
async fn active_run_with_fresh_working_session_is_not_reaped() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, store) = test_state(temp.path()).await;

    // Set a short dispatch timeout (1 second)
    state
        .providers
        .write()
        .await
        .set_dispatch_timeout(std::time::Duration::from_secs(1));

    let project = Project {
        id: ProjectId::new(),
        name: "Fresh Session Test Project".to_string(),
        description: "Testing active run watchdog immunity".to_string(),
        language: "en".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        ..Default::default()
    };
    store.create_project(&project).await.unwrap();

    // Run updated_at is older than the 1s timeout (10s ago)
    let active_run = Run {
        id: RunId::new(),
        project_id: project.id,
        current_stage: Stage::Idea,
        gate_states: HashMap::new(),
        artifacts: HashMap::new(),
        created_at: Utc::now() - chrono::Duration::seconds(10),
        updated_at: Utc::now() - chrono::Duration::seconds(10),
        status: RunStatus::Running,
        budget_cents: Some(1000),
        spent_cents: 0,
        worktree_path: None,
        worktree_branch: None,
        confinement: None,
        run_mode: warsha_core::RunMode::Agent,
    };
    store.create_run(&active_run).await.unwrap();

    // Create a fresh Working session (started_at = now, well within 1s timeout)
    let session = warsha_core::Session {
        id: warsha_core::SessionId::new(),
        run_id: Some(active_run.id),
        project_id: project.id,
        role: Role::Intake,
        backend: "native".to_string(),
        provider: "test-provider".to_string(),
        model: "test-model".to_string(),
        status: warsha_core::SessionStatus::Working,
        started_at: Utc::now(),
        ended_at: None,
        parent_session_id: None,
        cli_session_id: None,
    };
    store.create_session(&session).await.unwrap();

    // Call check_stale_run
    let checked = state
        .pipeline
        .check_stale_run(active_run.id)
        .await
        .expect("check_stale_run succeeds");

    assert_eq!(
        checked.status,
        RunStatus::Running,
        "watchdog must NOT reap run with active fresh working session"
    );

    // Verify session is still Working
    let sessions = store.list_sessions_by_run(active_run.id).await.unwrap();
    assert_eq!(sessions[0].status, warsha_core::SessionStatus::Working);

    // Verify no error events emitted
    let events = store.get_events(active_run.id).await.unwrap();
    assert!(
        !events.iter().any(|ev| ev.kind == EventKind::Error),
        "no error events should be emitted for healthy active run"
    );
}

/// A completed interview writes one provisioning row per rostered agent.
///
/// The walk is the desktop order: `projects.create`, then `interview.start` and
/// `interview.turn` on the real handlers, then `secretary.provisioning.list`.
/// The provider is the in-process mock. No key, no network.
#[tokio::test]
async fn secretary_interview_completion_writes_one_provisioning_row_per_rostered_agent() {
    let temp = crate::test_util::fresh_tempdir();
    let mut router = ProviderRouter::new();
    router.register_provider(Box::new(warsha_providers::MockProvider::new("mock")));
    router.set_role_routing(RoleRouting {
        role: Role::Secretary,
        targets: vec![RoutingTarget {
            provider_id: "mock".to_string(),
            model_id: "mock-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });
    let (state, store) = test_state_with_router(temp.path(), router).await;
    let rpc = WarshaRpc::new(state);
    let owner = owner_ext();

    let project = rpc
        .create_project(
            &owner,
            "Payments bakery".to_string(),
            "A checkout for a bakery".to_string(),
            "en".to_string(),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("project created");

    let start = rpc
        .interview_start(&owner, project.id, None)
        .await
        .expect("interview starts");
    assert!(
        matches!(
            start,
            crate::secretary::TurnOutcome::NextQuestion {
                topic: crate::secretary::Topic::Audience,
                ..
            }
        ),
        "a fresh interview asks the audience first"
    );

    // Topic order is fixed: audience, problem, status quo, scope, constraints,
    // success, non-goals. The mock answers are not JSON, so each reply lands in
    // the active slot. Payments plus a dashboard hire Security and the data expert.
    let replies = [
        "Bakery owners who take card payments",
        "Checkout fails when the card reader drops",
        "A paper book and a card machine, which lose the sale",
        "Card checkout, a daily sales dashboard",
        "Offline-first, Arabic RTL, under $20/month",
        "Complete a card payment without a dropped sale",
        "No payroll in v1",
    ];
    let mut done = false;
    for reply in replies {
        let outcome = rpc
            .interview_turn(&owner, project.id, reply.to_string())
            .await
            .expect("interview turn");
        if matches!(outcome, crate::secretary::TurnOutcome::Done { .. }) {
            done = true;
            break;
        }
    }
    assert!(done, "the seventh turn presents the roster");

    let rows = rpc
        .secretary_provisioning_list(&owner, project.id)
        .await
        .expect("provisioning list");
    let stored = store
        .list_provisioning(project.id.0)
        .await
        .expect("store read");
    assert_eq!(rows, stored, "the RPC is the store read the desktop uses");

    let ids: Vec<&str> = rows.iter().map(|row| row.agent_id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["data", "pm", "reviewer", "secretary", "security"],
        "one row per rostered agent, ordered by agent id"
    );
    for row in &rows {
        assert!(!row.skills.is_empty(), "{} has skills", row.agent_id);
        assert!(!row.source.is_empty(), "{} has a source", row.agent_id);
        assert!(row.audited, "{} is audited", row.agent_id);
        assert!(
            !row.source.contains("sk-"),
            "{} source is not a secret",
            row.agent_id
        );
    }
    let secretary = rows
        .iter()
        .find(|row| row.agent_id == "secretary")
        .expect("secretary row");
    assert!(
        secretary.tools.is_empty(),
        "the catalog assigns the Secretary no tools, and that empty assignment is stored"
    );
    assert!(rows
        .iter()
        .any(|row| row.agent_id != "secretary" && !row.tools.is_empty()));
    assert_eq!(
        rows.iter()
            .find(|row| row.agent_id == "security")
            .map(|row| row.role.as_str()),
        Some("security")
    );
    assert_eq!(
        rows.iter()
            .find(|row| row.agent_id == "data")
            .map(|row| row.role.as_str()),
        Some("researcher")
    );
}

fn sample_chat_request() -> warsha_providers::ChatRequest {
    warsha_providers::ChatRequest {
        model: "test-model".to_string(),
        messages: vec![warsha_providers::ChatMessage {
            role: warsha_providers::MessageRole::User,
            content: "hello".to_string(),
        }],
        temperature: None,
        max_tokens: None,
        stream: false,
    }
}

async fn engage_provider_cooldown(state: &DaemonState, name: &str) {
    {
        let mut router = state.providers.write().await;
        router.register_provider(Box::new(
            warsha_providers::MockProvider::new(name).with_failure(
                warsha_providers::ProviderError::Http(401, "Unauthorized".to_string()),
            ),
        ));
        router.set_role_routing(RoleRouting {
            role: Role::Coder,
            targets: vec![RoutingTarget {
                provider_id: name.to_string(),
                model_id: "test-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
    }

    let first = {
        let router = state.providers.read().await;
        router
            .chat_with_fallback(Role::Coder, "cooldown-proj", sample_chat_request())
            .await
    };
    assert!(
        matches!(first, Err(warsha_providers::ProviderError::Http(401, _))),
        "expected HTTP 401 failure to engage cooldown, got {first:?}"
    );
    assert!(
        state.providers.read().await.is_in_cooldown(name),
        "provider {name} must be in cooldown after HTTP 401"
    );

    let second = {
        let router = state.providers.read().await;
        router
            .chat_with_fallback(Role::Coder, "cooldown-proj", sample_chat_request())
            .await
    };
    assert!(
        matches!(second, Err(warsha_providers::ProviderError::NotFound(_))),
        "expected cooldown skip while in cooldown, got {second:?}"
    );
}

#[tokio::test]
async fn provider_add_clears_cooldown_and_is_immediately_callable() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = owner_ext();

    engage_provider_cooldown(&state, "my-qwen").await;

    rpc.add_provider(
        &owner,
        "my-qwen".to_string(),
        "qwen".to_string(),
        "sk-fixed-provider-key-12345".to_string(),
        Some("http://127.0.0.1:9/v1".to_string()),
    )
    .await
    .expect("providers.add succeeds");

    assert!(
        !state.providers.read().await.is_in_cooldown("my-qwen"),
        "providers.add must reset provider cooldown"
    );

    let call = state
        .providers
        .read()
        .await
        .chat_with_fallback(Role::Coder, "cooldown-proj", sample_chat_request())
        .await;
    assert!(
        call.is_ok(),
        "provider must be immediately callable after providers.add, got {call:?}"
    );
}

#[tokio::test]
async fn provider_test_clears_cooldown_when_healthy() {
    use std::io::{BufRead, BufReader, Write};
    use std::sync::atomic::{AtomicU16, Ordering};

    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().expect("local addr").port();
    let status_code = Arc::new(AtomicU16::new(401));
    let status_ref = Arc::clone(&status_code);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let Ok(cloned) = stream.try_clone() else {
                break;
            };
            let mut reader = BufReader::new(cloned);
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok() && line != "\r\n" {
                line.clear();
            }
            let code = status_ref.load(Ordering::SeqCst);
            let body = if code == 200 { r#"{"data":[]}"# } else { "{}" };
            let response = format!(
                "HTTP/1.1 {code} stub\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });

    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = owner_ext();

    rpc.add_provider(
        &owner,
        "my-qwen".to_string(),
        "qwen".to_string(),
        "sk-test-provider-key-12345".to_string(),
        Some(format!("http://127.0.0.1:{port}/v1")),
    )
    .await
    .expect("providers.add succeeds");

    engage_provider_cooldown(&state, "my-qwen").await;

    // An unhealthy test must NOT clear the cooldown.
    let unhealthy = rpc.test_provider(&owner, "my-qwen".to_string(), None).await;
    assert!(unhealthy.is_err(), "401 test_provider must fail");
    assert!(
        state.providers.read().await.is_in_cooldown("my-qwen"),
        "failed providers.test must leave cooldown intact"
    );

    // Once the endpoint accepts the key, a healthy test clears the cooldown.
    status_code.store(200, Ordering::SeqCst);
    let healthy = rpc
        .test_provider(&owner, "my-qwen".to_string(), None)
        .await
        .expect("200 test_provider must succeed");
    assert!(healthy.healthy);
    assert!(
        !state.providers.read().await.is_in_cooldown("my-qwen"),
        "healthy providers.test must reset provider cooldown"
    );

    // With a working adapter registered under the same id, calls succeed immediately.
    state
        .providers
        .write()
        .await
        .register_provider(Box::new(warsha_providers::MockProvider::new("my-qwen")));
    let call = state
        .providers
        .read()
        .await
        .chat_with_fallback(Role::Coder, "cooldown-proj", sample_chat_request())
        .await;
    assert!(
        call.is_ok(),
        "provider must be immediately callable after healthy providers.test, got {call:?}"
    );
}

#[tokio::test]
async fn provider_auth_complete_and_disconnect_clear_cooldown() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = owner_ext();

    engage_provider_cooldown(&state, "my-qwen").await;

    // Even if a working adapter is registered, cooldown still blocks calls until reset.
    state
        .providers
        .write()
        .await
        .register_provider(Box::new(warsha_providers::MockProvider::new("my-qwen")));
    assert!(state.providers.read().await.is_in_cooldown("my-qwen"));

    rpc.provider_auth_complete(
        &owner,
        "my-qwen".to_string(),
        "sk-oauth-token-12345".to_string(),
    )
    .await
    .expect("providers.auth_complete succeeds");

    assert!(
        !state.providers.read().await.is_in_cooldown("my-qwen"),
        "providers.auth_complete must reset provider cooldown"
    );

    let call = state
        .providers
        .read()
        .await
        .chat_with_fallback(Role::Coder, "cooldown-proj", sample_chat_request())
        .await;
    assert!(
        call.is_ok(),
        "provider must be immediately callable after providers.auth_complete, got {call:?}"
    );

    engage_provider_cooldown(&state, "my-qwen").await;
    rpc.provider_disconnect(&owner, "my-qwen".to_string())
        .await
        .expect("providers.disconnect succeeds");
    assert!(
        !state.providers.read().await.is_in_cooldown("my-qwen"),
        "providers.disconnect must reset provider cooldown"
    );
}

#[tokio::test]
async fn provider_remove_clears_cooldown() {
    let temp = crate::test_util::fresh_tempdir();
    let (state, _store) = test_state(temp.path()).await;
    let rpc = WarshaRpc::new(state.clone());
    let owner = owner_ext();

    rpc.add_provider(
        &owner,
        "my-qwen".to_string(),
        "qwen".to_string(),
        "sk-remove-provider-key-12345".to_string(),
        Some("http://127.0.0.1:9/v1".to_string()),
    )
    .await
    .expect("providers.add succeeds");

    engage_provider_cooldown(&state, "my-qwen").await;

    rpc.remove_provider(&owner, "my-qwen".to_string())
        .await
        .expect("providers.remove succeeds");

    assert!(
        !state.providers.read().await.is_in_cooldown("my-qwen"),
        "providers.remove must reset provider cooldown"
    );

    // Calling the removed provider directly via a routing hits RemovedProvider rather than
    // being silently skipped by a stale cooldown entry.
    state.providers.write().await.set_role_routing(RoleRouting {
        role: Role::Coder,
        targets: vec![RoutingTarget {
            provider_id: "my-qwen".to_string(),
            model_id: "test-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });
    let removed_err = state
        .providers
        .read()
        .await
        .chat_with_fallback(Role::Coder, "cooldown-proj", sample_chat_request())
        .await
        .expect_err("removed provider must fail");
    assert!(
        removed_err.to_string().contains("was removed"),
        "expected RemovedProvider refusal rather than cooldown skip, got {removed_err}"
    );
}
