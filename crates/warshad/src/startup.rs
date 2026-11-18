//! The daemon's startup path: the `start_daemon` family, the seeded stores a fresh
//! state is built from, and the config/env/secret-file helpers that feed them.
//!
//! Moved out of `lib.rs` unchanged (P-H1 step A9, pure move). `lib.rs` re-exports
//! [`start_daemon`], [`start_daemon_with_secrets`],
//! [`start_daemon_with_provider_factory`], [`run_daemon`] and [`load_or_create_config`]
//! at the crate root, so every existing `warshad::…` path still resolves; the seed and
//! config helpers stay crate-visible to the modules that read them.

use base64::Engine as _;
use jsonrpsee::server::ServerBuilder;
use keyring::Entry;
use rand::TryRngCore;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info, warn};
use warsha_backends::BackendFactory;
use warsha_git::GitHubClient;
use warsha_pipeline::{
    BackendKind, BackendKit, CommandPolicy, InMemoryCrashReportStore, InMemoryMcpManager,
    InMemoryPairingStore, InMemoryPreferenceStore, InMemoryProcessManager,
    InMemoryStoreReviewStore, LivePreviewManager, McpApprovals, McpManager, Preference,
    ProcessManager, RoutineRegistry, RoutineRunner, RoutineScheduler, RunAgentSessions, RunMode,
    RunModeConfig, StaticPermissions,
};
use warsha_providers::{KeychainSecretStore, ProviderRouter, SecretStore};
use warsha_remote::DeviceRegistry;
use warsha_store::Store;

use crate::auth::cors_origins;
#[allow(unused_imports)] // named only by the doc link on `start_daemon_with_provider_factory`
use crate::MockProviderFactory;
use crate::{
    acquire_lock, apply_role_routings, build_agent_loop, enumerate_interfaces, http_app,
    mcp_approvals, mcp_http, pairing_origin, register_configured_providers, resolve_listener_bind,
    scrub_event_payload, seed_agent_snapshot, seed_backend_routings, seed_custom_backends,
    seed_role_routings, wave2, windows_firewall_command, DaemonArgs, DaemonConfig, DaemonError,
    DaemonHandle, DaemonPermissionStore, DaemonState, EventSequencer, KeychainProviderFactory,
    ProcessPolicy, ProviderFactory, RateGovernor, RemoteBind, Result, RpcAuthLayer, Sessions,
    SettingsStore, StoreRunLiveness, WarshaApiServer, WarshaRpc, LOCAL_POCKETBASE_URL,
    MOCK_PROVIDER_ID, REMOTE_ASSETS_DIR_ENV,
};

/// The backend kit a project starts from until it exports or sets one of its own.
///
/// PocketBase is the PLAN's preferred backend, and the project name is what the
/// export header and the storage archive stem are made of.
pub(crate) fn default_backend_kit(project_name: &str) -> BackendKit {
    BackendKit::from_project(project_name, LOCAL_POCKETBASE_URL, BackendKind::PocketBase)
}

/// Every project id in the store, as the strings the settings rows are keyed by.
///
/// The `ProjectId`'s display form is the UUID the RPCs and the settings columns
/// both use, which is what makes one key meaningful in both places.
async fn project_ids(store: &Store) -> Result<Vec<String>> {
    Ok(store
        .list_projects()
        .await?
        .into_iter()
        .map(|project| project.id.to_string())
        .collect())
}

/// Every run mode: the stored config where the owner saved one, the mode's
/// default where they never did.
///
/// Both halves matter. All three modes are present because `runmode.list` reports
/// a switch, and a mode that was stored comes back exactly as it was stored —
/// including a Hosted mode with no relay, which [`RunModeConfig::validate`] keeps
/// refusing until the owner names one rather than this function inventing it.
async fn seed_run_modes(settings: &SettingsStore) -> Result<HashMap<RunMode, RunModeConfig>> {
    let mut modes: HashMap<RunMode, RunModeConfig> = RunMode::all()
        .into_iter()
        .map(|mode| (mode, RunModeConfig::for_mode(mode)))
        .collect();
    for stored in settings.load_run_modes().await? {
        modes.insert(stored.mode, stored);
    }
    Ok(modes)
}

/// The stored backend kits of every project in the store, by project id.
///
/// A project with no stored row is absent rather than defaulted: the default names
/// the project, and only the RPC that resolves a run knows which project it is.
async fn seed_backend_kits(
    store: &Store,
    settings: &SettingsStore,
) -> Result<HashMap<String, BackendKit>> {
    let kits = settings
        .load_backend_kits(project_ids(store).await?)
        .await?;
    Ok(kits.into_iter().collect())
}

/// The stored preference rows of every project in the store, by project id.
///
/// The signals themselves are not stored — the table keeps the derived score — so
/// this is what `preferences.list` answers with after a restart, and the daemon's
/// signal log starts empty.
async fn seed_preferences(
    store: &Store,
    settings: &SettingsStore,
) -> Result<HashMap<String, Vec<Preference>>> {
    let rows = settings
        .load_all_preferences(project_ids(store).await?)
        .await?;
    Ok(rows.into_iter().collect())
}

/// The stored phone pairings, revocation included.
async fn seed_pairings(settings: &SettingsStore) -> Result<InMemoryPairingStore> {
    Ok(settings.load_pairings().await?)
}

/// Start the daemon and return a handle for management.
/// Accepts `http_port` and `ws_port` of 0 to let the OS choose ports.
pub async fn start_daemon(config: DaemonConfig) -> Result<DaemonHandle> {
    start_daemon_with_secrets(config, Arc::new(KeychainSecretStore::new())).await
}

/// Start the daemon with the secret store it should keep provider keys in.
///
/// The production entry point ([`start_daemon`]) passes the OS keychain. This one
/// exists because the keychain is not always there: a headless CI container or a
/// WSL shell with no D-Bus secret service refuses `keyring` with
/// `PlatformFailure`, and an integration test that drove `providers.add` through
/// it would be testing the runner. The daemon's behaviour is otherwise identical,
/// and the key that a test writes is the key `providers.test` reads back.
///
/// It installs [`KeychainProviderFactory`], the production adapter factory: a test
/// that wants the *provider construction* to be offline as well uses
/// [`start_daemon_with_provider_factory`].
pub async fn start_daemon_with_secrets(
    config: DaemonConfig,
    secrets: Arc<dyn SecretStore>,
) -> Result<DaemonHandle> {
    start_daemon_with_provider_factory(config, secrets, Arc::new(KeychainProviderFactory::new()))
        .await
}

/// Start the daemon with both of its injectable seams named: where keys live, and
/// what builds an adapter for a configured provider.
///
/// The second seam is what closes C2's real-provider gap offline. The daemon's
/// production behaviour is [`KeychainProviderFactory`], which reads the OS keychain —
/// so an integration test that used it would need a keychain, and one that got a
/// keychain would be making a real call. [`MockProviderFactory`] answers the same
/// rows with the workspace's mock adapter under the same ids, which lets a test drive
/// the whole path a configured provider takes: row, routing, registered adapter,
/// agent turn, restart, and the routing and the turn still there afterwards.
pub async fn start_daemon_with_provider_factory(
    config: DaemonConfig,
    secrets: Arc<dyn SecretStore>,
    provider_factory: Arc<dyn ProviderFactory>,
) -> Result<DaemonHandle> {
    start_daemon_with_interfaces(config, secrets, provider_factory, enumerate_interfaces()).await
}

/// [`start_daemon_with_provider_factory`] with the host's network interfaces injected, so
/// a test can exercise `remote_bind = tailscale` without a real Tailscale adapter.
pub(crate) async fn start_daemon_with_interfaces(
    config: DaemonConfig,
    secrets: Arc<dyn SecretStore>,
    provider_factory: Arc<dyn ProviderFactory>,
    ifaces: Vec<crate::InterfaceInfo>,
) -> Result<DaemonHandle> {
    // The environment is consulted here and not only in [`load_or_create_config`]:
    // an embedded host that builds a [`DaemonConfig`] in-process still gets the
    // deployment knob of [`REMOTE_ASSETS_DIR_ENV`], and a configuration that named
    // a bundle directory directly is never overwritten by it.
    let mut config = config;
    if config.remote_assets_dir.is_none() {
        config.remote_assets_dir = env_string(REMOTE_ASSETS_DIR_ENV).map(PathBuf::from);
    }

    // Ensure single instance lock
    let lock_file = acquire_lock(&config.data_dir)?;

    // Ensure data directory exists
    std::fs::create_dir_all(&config.data_dir)?;

    // Initialize store with configurable path
    let db_path = config.data_dir.join("warsha.db");
    // The settings are the same database the async store uses: the four small
    // records a restart has to keep live beside the projects they configure, in one
    // file, so a project and the settings that describe it cannot be lost
    // separately. The migration runs here, before anything is served, so a file
    // that cannot be opened fails the start instead of the first setting the owner
    // changes.
    let settings = Arc::new(SettingsStore::open(&db_path).await?);
    if config.remote_bind == RemoteBind::Default {
        if let Ok(persisted_bind) = settings.load_remote_bind().await {
            config.remote_bind = persisted_bind;
        }
    }
    let store = Arc::new(Store::open_at(db_path).await?);

    // Initialize provider router
    let providers = Arc::new(RwLock::new(ProviderRouter::new()));

    // Register mock provider for testing
    providers
        .write()
        .await
        .register_provider(Box::new(warsha_providers::MockProvider::new(
            MOCK_PROVIDER_ID,
        )));
    // W5's deterministic fake provider: unrouted pipeline stages already answer
    // through it inside the pipeline's dispatch, and registering it here makes it
    // visible to `providers.list` and routable by the owner like any provider.
    providers
        .write()
        .await
        .register_provider(Box::new(warsha_providers::FakeProvider::new()));

    // The providers the owner configured, before anything is served. This is the
    // bridge C2 was missing: `providers.add` stores a row and files a key, and a
    // router that never learns about them answers every turn with "no model is
    // wired" — including the turn that comes after a restart, which is the one the
    // owner has no way to explain. Registration calls nothing: what is handed to
    // the router is a deferred adapter that builds on the first call.
    let configured =
        register_configured_providers(&providers, &settings, &provider_factory).await?;
    if configured > 0 {
        info!("registered {configured} configured provider(s)");
    }

    // The owner's routing table, read from the settings and handed to the router.
    // A role with no routing refuses its calls, which is the honest answer to a
    // daemon that was never told which provider speaks for it.
    let role_routings = seed_role_routings(&settings).await?;
    apply_role_routings(&providers, &role_routings).await;

    // Initialize pipeline
    // The daemon's SettingsStore implements SettingsProvider, so we can use it directly
    let mut pipeline =
        warsha_pipeline::PipelineEngine::new(store.clone(), providers.clone(), settings.clone());

    // R-NEXT N2: build the coding backend registry from the embedded catalog,
    // custom backend definitions in settings, per-project/role routings, and
    // WARSHA_CODING_BACKEND. Any unknown backend name is a named startup error (A16.11).
    let registry = Arc::new(warsha_pipeline::CodingBackendRegistry::new());
    for backend in BackendFactory::all_catalog() {
        registry.register(Arc::from(backend));
    }

    let custom_backends = seed_custom_backends(&settings).await?;
    for def in &custom_backends {
        def.validate().map_err(DaemonError::Other)?;
        registry.register(Arc::new(
            warsha_backends::CliBackend::from_custom_definition(def),
        ));
    }

    let backend_routings = seed_backend_routings(&settings).await?;
    if let Some(default_name) = backend_routings
        .default_backend
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if !registry.contains(default_name) {
            return Err(DaemonError::Other(format!(
                "unknown coding backend `{default_name}` configured in settings"
            )));
        }
        registry.set_default_backend(Some(default_name.to_string()));
    }
    for (role_str, backend_name) in &backend_routings.role_backends {
        let backend_name = backend_name.trim();
        if !registry.contains(backend_name) {
            return Err(DaemonError::Other(format!(
                "unknown coding backend `{backend_name}` configured in settings for role `{role_str}`"
            )));
        }
        let role: warsha_core::Role =
            serde_json::from_value(serde_json::Value::String(role_str.to_lowercase())).map_err(
                |_| DaemonError::Other(format!("unknown role `{role_str}` in backend routings")),
            )?;
        registry.set_role_backend(role, backend_name);
    }
    for (project_str, backend_name) in &backend_routings.project_backends {
        let backend_name = backend_name.trim();
        if !registry.contains(backend_name) {
            return Err(DaemonError::Other(format!(
                "unknown coding backend `{backend_name}` configured in settings for project `{project_str}`"
            )));
        }
        let project_uuid: uuid::Uuid = project_str.parse().map_err(|_| {
            DaemonError::Other(format!(
                "invalid project id `{project_str}` in backend routings"
            ))
        })?;
        registry.set_project_backend(warsha_core::ProjectId(project_uuid), backend_name);
    }

    // The wiring side owns the environment selection: the pipeline never reads
    // `WARSHA_CODING_BACKEND` or names a backend, it only accepts an injected registry.
    // A16.11: an unknown backend name in WARSHA_CODING_BACKEND is a named startup error.
    if let Ok(env_backend) = std::env::var(warsha_backends::CODING_BACKEND_ENV) {
        let trimmed = env_backend.trim();
        if !trimmed.is_empty() {
            if !registry.contains(trimmed) {
                return Err(DaemonError::Other(format!(
                    "unknown coding backend `{trimmed}` specified in {}",
                    warsha_backends::CODING_BACKEND_ENV
                )));
            }
            registry.set_default_backend(Some(trimmed.to_string()));
        }
    }

    pipeline = pipeline.with_backend_registry(registry);
    let pipeline = Arc::new(pipeline);

    // Initialize backends
    let backends = BackendFactory::all_available();

    // Initialize GitHub client if token available
    let github = if let Ok(token) = get_github_token() {
        Some(GitHubClient::new(&token)?)
    } else {
        None
    };

    // Initialize device registry
    let local_identity = warsha_remote::DeviceIdentity::generate("Warsha Daemon".to_string())?;
    let devices = Arc::new(DeviceRegistry::new(local_identity));

    // The live event bus is the store's: every `append_event` publishes on it, and
    // `/events` subscribes through `state.store`. There is deliberately no second
    // sender a handler could attach to and feed itself a silent stream.

    // One spawner for the daemon: the MCP stdio transport starts its server
    // through it and the live preview runs its dev server on it, so `process.list`
    // is the one place that names every child. It carries the configured
    // allow-list, so a restart re-checks the program the RPC edges admitted.
    let processes: Arc<dyn ProcessManager> = InMemoryProcessManager::shared_with_policy(
        CommandPolicy::from_config(&config.allowed_commands),
    );
    // R-EXT-4: `http` MCP servers are dialled through a client that re-applies the
    // same transport policy `mcp.connect` does — TLS anywhere, plain http only on
    // loopback — to every request and every redirect. The daemon is the only place
    // a socket exists: the pipeline keeps no HTTP client, so a manager with nothing
    // injected still records an `http` config instead of dialling it.
    let mcp_http = mcp_http::ReqwestMcpHttp::new(ProcessPolicy::from_config(
        &config.allowed_commands,
        &config.data_dir,
    ))
    .map_err(|error| DaemonError::Other(error.to_string()))?;
    let mcp: Arc<dyn McpManager> =
        Arc::new(InMemoryMcpManager::new(processes.clone()).with_http_client(Arc::new(mcp_http)));
    // The preview manager judges an owner run through the store (R-BRIDGE-B5 D3),
    // so a server whose run finished without its close running never blocks the next
    // run of the project.
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
    // The permission table is loaded before the loop exists, so a call's check
    // cannot race the load. A read error leaves every unseen row at `Ask`.
    let permission_store = DaemonPermissionStore {
        store: store.clone(),
    };
    let mcp_permissions = Arc::new(StaticPermissions::load_from(&permission_store).await);
    // The approval registry, with the daemon's own summarizer: the pipeline cannot
    // see this process's scrubber, so the redacting implementation is built here and
    // handed in through the seam.
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

    // The conversation the last daemon was having, if any: the mode it reached, who
    // approved each switch, the todos and the questions. Restored before the RPC
    // surface opens, so a restart reads back the conversation it was having rather
    // than a blank record.
    if let Some(snapshot) = seed_agent_snapshot(&settings).await? {
        let mut guard = agent_loop.write().await;
        snapshot.restore(&mut guard);
    }

    // Seed the four settings records from the file before the RPC surface opens.
    // A daemon that answered the first request from an empty switch while the
    // owner's settings sat on disk would be the bug this batch exists to fix, so
    // the seeding is part of starting rather than a background warm-up.
    let run_modes = seed_run_modes(&settings).await?;
    let backend_kits = seed_backend_kits(&store, &settings).await?;
    let stored_preferences = seed_preferences(&store, &settings).await?;
    let pairings = seed_pairings(&settings).await?;
    // The three Wave 2 catalogs, from `warsha-core` rather than from the file. They
    // are seeded because they are *shipped*: a fresh daemon must answer
    // `harness.list`, `skills.list` and `plugins.list` with the presets the product
    // documents, and only the empty case is filled — an owner who deleted a preset
    // deleted it on purpose, and a seed that rewrote their table every start would
    // delete that decision instead.
    wave2::seed_bundled_records(&settings).await?;
    let routines = Arc::new(RwLock::new(RoutineRegistry::new()));
    let routine_runner: Arc<dyn RoutineRunner + Send + Sync> =
        Arc::new(warsha_pipeline::UnavailableRoutineRunner::new());
    let routine_scheduler = Arc::new(RoutineScheduler::new(routines.clone(), routine_runner));

    // Which credential means which caller, and how often it may ask (audit H-01,
    // H-03, H-04). The owner session speaks as the daemon's own device, which is what
    // keeps the local desktop workflow exactly as it was: the app holds the daemon's
    // token, so it is the owner, and a gate it approves is recorded against this
    // machine. A phone joins that set only through a pairing secret the owner issued.
    let sessions = Arc::new(Sessions::new(
        config.auth_token.clone(),
        devices.local_identity().device_id,
    ));
    let rates = Arc::new(RateGovernor::new(&config.rate_limits));

    // The daemon-wide event stream. One sequencer gives every `/events` socket and every
    // `runs.subscribe` the same monotonic ordering and the same replay ring; the pump
    // spawned just below is its only writer, draining the store's event bus.
    let events = Arc::new(EventSequencer::new());

    let state = Arc::new(DaemonState {
        config: config.clone(),
        store,
        providers,
        pipeline,
        backends,
        github,
        devices,
        backend_kits: Arc::new(RwLock::new(backend_kits)),
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
        run_modes: Arc::new(RwLock::new(run_modes)),
        preferences: Arc::new(RwLock::new(InMemoryPreferenceStore::new())),
        stored_preferences: Arc::new(RwLock::new(stored_preferences)),
        pairings: Arc::new(RwLock::new(pairings)),
        secrets,
        routines,
        routine_scheduler,
        sessions,
        rates,
        role_routings: Arc::new(RwLock::new(role_routings)),
        provider_factory,
        // Filled the moment the RPC listener has bound — see [`DaemonState::pairing_origin`].
        pairing_origin: std::sync::OnceLock::new(),
        events,
    });

    // The single writer of the event stream: drain the store's event bus, scrub each
    // event against the daemon's own token, and publish it under the next `seq`. Running
    // it here — rather than in each producer — is what makes `seq` order equal the
    // store's arrival order and guarantees the *same* scrub runs whether an event came
    // from a pipeline stage, a gate decision, or one of the new `runs.*` writes.
    {
        let pump = Arc::clone(&state);
        let mut rx = pump.store.subscribe_events();
        tokio::spawn(async move {
            let token = pump.config.auth_token.clone();
            let sequencer = pump.events.clone();
            loop {
                match rx.recv().await {
                    Ok(mut event) => {
                        scrub_event_payload(&mut event.payload, &token);
                        sequencer.publish(event).await;
                    }
                    // The pump lags only if it is starved of the runtime; nothing is
                    // dropped from the durable record (the store already holds it), so
                    // resynchronising the bus and continuing is the whole recovery.
                    Err(broadcast::error::RecvError::Lagged(dropped)) => {
                        warn!("the event pump lagged the store bus by {dropped} events");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    // Recover any runs left in `Running` status from a previous unclean shutdown:
    // transition them to `Paused` and emit an `{ "action": "run_interrupted" }` event
    // so they are visible and resumable via `runs.resume`.
    let recovered = state.pipeline.recover_interrupted_runs().await?;
    if !recovered.is_empty() {
        info!(
            "recovered {} interrupted run(s) on startup",
            recovered.len()
        );
    }

    // Start JSON-RPC server (TCP for cross-platform compatibility)
    //
    // The host is the configuration's, not a literal: a phone cannot dial `127.0.0.1` and
    // reach this machine — it would be dialling itself. Loopback remains the default, and
    // every other address is an opt-in the owner made in the config file or with
    // `--bind-host` (see [`DaemonConfig::bind_host`] for why that posture is deliberate).
    let bind = resolve_listener_bind(&config, &ifaces)?;
    let rpc_addr: SocketAddr = SocketAddr::new(bind, config.ws_port);
    // The origins this daemon accepts, parsed once and used by both servers below.
    //
    // They are not optional for the RPC server: `warsha-desktop` serves its webview from
    // `http://tauri.localhost`, so every RPC call it makes is cross-origin and arrives with
    // `Content-Type: application/json`, which makes it a request a browser has to preflight. A
    // preflight carries no `Authorization` header, so the CORS layer has to sit *outside* the auth
    // layer: inside, every preflight would be answered "unauthorized" and the real POST would never
    // be sent. A client that sends no `Origin` (the CLI, a test) sees no CORS headers and is
    // unaffected.
    //
    // The list is `APP_ORIGINS` unioned with the configuration — the same union the WebSocket
    // origin gate applies, written once in `cors_origins`. The Android shell's page is the second
    // caller of that rule (R-UI-7): its origin is the app's own, not something a `config.toml`
    // lists, and a preflight answered without it leaves the paired page unable to read any answer.
    let rpc_cors = CorsLayer::new()
        .allow_origin(cors_origins(&config.allowed_origins))
        .allow_methods(Any)
        .allow_headers(Any);
    let rpc_auth_layer = RpcAuthLayer {
        state: state.clone(),
    };
    let rpc_server = ServerBuilder::default()
        .set_http_middleware(
            tower::ServiceBuilder::new()
                .layer(rpc_cors.clone())
                .layer(rpc_auth_layer.clone()),
        )
        .build(rpc_addr)
        .await
        .map_err(|e| DaemonError::Config(format!("could not bind RPC server: {e}")))?;
    let actual_rpc_port = rpc_server.local_addr()?.port();

    // H1: `remote_bind = tailscale` binds the Tailscale address only, which would cut the
    // desktop app off from `127.0.0.1`. Start a companion loopback RPC server (same state,
    // CORS and auth layers) on the same port. Never `0.0.0.0`, never another interface.
    let loopback_rpc_server = if config.remote_bind == RemoteBind::Tailscale
        && bind != std::net::Ipv4Addr::LOCALHOST
    {
        let loopback_addr = SocketAddr::new(std::net::Ipv4Addr::LOCALHOST.into(), actual_rpc_port);
        let companion = ServerBuilder::default()
            .set_http_middleware(
                tower::ServiceBuilder::new()
                    .layer(rpc_cors)
                    .layer(rpc_auth_layer),
            )
            .build(loopback_addr)
            .await
            .map_err(|e| {
                DaemonError::Config(format!("could not bind loopback RPC companion: {e}"))
            })?;
        info!("companion loopback JSON-RPC listening on {loopback_addr}");
        Some(companion.start(WarshaRpc::new(state.clone()).into_rpc()))
    } else {
        None
    };
    let mut loopback_http_task = None;

    // The origin a pairing link may advertise, decided now rather than at the call: this
    // is the moment the daemon knows the address it is actually reachable at, and
    // `devices.pair-start` must not put a port on a QR plate that no socket holds.
    //
    // A wildcard bind with no `advertised_host` is the one case that cannot be answered,
    // and the answer is a startup warning plus a refusal at the call — never a guess. The
    // listeners are already up by then, so a daemon that only *serves* is unaffected; only
    // minting a pairing needs the owner to say which address their phone dials.
    let resolved_origin =
        match pairing_origin(bind, actual_rpc_port, config.advertised_host.as_deref()) {
            Ok(origin) => {
                if state.pairing_origin.set(origin.clone()).is_err() {
                    warn!("the pairing origin was already set; this daemon served one before");
                }
                Some(origin)
            }
            Err(error) => {
                warn!(
                    "this daemon cannot yet say what address a phone should dial: {error}; \
                     `devices.pair-start` will refuse until it is answered"
                );
                None
            }
        };
    let rpc = WarshaRpc::new(state.clone());
    let rpc_handle = rpc_server.start(rpc.into_rpc());
    {
        let stopped_handle = rpc_handle.clone();
        tokio::spawn(async move {
            stopped_handle.stopped().await;
            info!("RPC server stopped");
        });
    }
    // The port was resolved from the socket before `.start()` consumed the server; the
    // handle it returns exposes no address, so that captured value is the only truthful
    // source for what this listener is bound to.
    info!(
        "JSON-RPC server listening on {}",
        SocketAddr::new(bind, actual_rpc_port)
    );

    // The HTTP/WebSocket app: its routes, the static fallback, the CSP and framing headers
    // and the auth/ceiling layer, assembled by [`http_app`] so the listener and the test
    // that asserts those headers drive exactly one app.
    let app = http_app(state.clone());

    // The same host as the RPC listener: a phone that can reach one must be able to
    // reach the other, and a daemon split across a loopback and a LAN address would be a
    // daemon whose pairing link works for half its surface.
    let http_addr = SocketAddr::new(bind, config.http_port);
    let http_listener = tokio::net::TcpListener::bind(http_addr).await?;
    let actual_http_port = http_listener.local_addr()?.port();
    info!(
        "HTTP server listening on http://{}",
        http_listener.local_addr()?
    );

    // A non-loopback bind publishes the daemon past this machine. On Windows the inbound
    // firewall rule for it is not created on the daemon's behalf — raising the firewall is
    // the owner's elevated, deliberate act — so the exact one-command fix is printed here
    // rather than left to be guessed. The address and the two ports only: never the token.
    if !bind.is_loopback() {
        let firewall = windows_firewall_command(actual_http_port, actual_rpc_port);
        info!("LAN bind on {bind}: open the Windows firewall with `{firewall}`");
        // Which host a peer dials. A wildcard bind cannot name one, so the owner's
        // `advertised_host` (a LAN address, or a Tailscale IP) is what makes the link real.
        let share_host = match config.advertised_host.as_deref().map(str::trim) {
            Some(host) if !host.is_empty() => host.to_string(),
            _ => bind.to_string(),
        };
        // Bracket a bare IPv6 address so the port separator stays unambiguous.
        let share_spelling = if share_host.contains(':') && !share_host.starts_with('[') {
            format!("[{share_host}]")
        } else {
            share_host
        };
        info!(
            "reachable over the local network or Tailscale at http://{share_spelling}:{actual_rpc_port} \
             (events at http://{share_spelling}:{actual_http_port})"
        );
    }

    // The HTTP listener is the daemon's surface that knows the peer address, and it
    // is the one that has to: a rate limit with no identity to key on falls back to
    // the address, and an unbounded `/events` is a socket-occupying denial of service
    // with no response code for it (audit H-01).
    //
    // H1: `remote_bind = tailscale` binds the Tailscale address only, which would cut the
    // desktop app off from `127.0.0.1`. The companion loopback HTTP listener shares the same
    // app (state, CORS, auth layers) on the same port number; it never binds `0.0.0.0`.
    if loopback_rpc_server.is_some() {
        let loopback_http_addr =
            SocketAddr::new(std::net::Ipv4Addr::LOCALHOST.into(), actual_http_port);
        let loopback_listener = tokio::net::TcpListener::bind(loopback_http_addr)
            .await
            .map_err(|e| {
                DaemonError::Config(format!("could not bind loopback HTTP companion: {e}"))
            })?;
        info!("companion loopback HTTP listening on http://{loopback_http_addr}");
        let loopback_app = app.clone();
        loopback_http_task = Some(tokio::spawn(async move {
            if let Err(e) = axum::serve(
                loopback_listener,
                loopback_app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            {
                error!("loopback HTTP server error: {}", e);
            }
        }));
    }
    let http_task = tokio::spawn(async move {
        if let Err(e) = axum::serve(
            http_listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        {
            error!("HTTP server error: {}", e);
        }
    });

    Ok(DaemonHandle {
        _lock_file: lock_file,
        http_task,
        rpc_server: rpc_handle,
        loopback_http_task,
        loopback_rpc_server,
        http_port: actual_http_port,
        rpc_port: actual_rpc_port,
        bind_addr: bind,
        pairing_origin: resolved_origin,
        // The daemon's own spawner, not a second one: the sweep at shutdown has to
        // see the children the RPCs started.
        processes: state.processes.clone(),
        // The runtime the servers are being driven on, kept so a handle that is
        // dropped without `shutdown` can still take its children with it. An `async fn`
        // only ever runs on a runtime, so asking for the current one cannot fail here.
        runtime: tokio::runtime::Handle::current(),
        reaped: std::sync::atomic::AtomicBool::new(false),
    })
}

/// Layer the command line over a configuration the daemon read from disk.
///
/// Its own function because the *shape* of each override is a decision, not an
/// accident: the two ports arrive with clap defaults and therefore always overwrite the
/// file (a wart this change leaves alone rather than silently widening), while the bind
/// address and the advertised host are `Option`s that overwrite only when the owner
/// actually passed them. That asymmetry is deliberate and load-bearing — `bind_host` is
/// the one field an owner may legitimately set in `config.toml` and never pass a flag
/// again, especially from the desktop shell that starts the daemon in-process and gives
/// them no way to pass one at all. A default here would put their LAN bind back to
/// loopback on every start.
fn apply_cli_overrides(config: &mut DaemonConfig, args: &DaemonArgs) {
    config.http_port = args.http_port;
    config.ws_port = args.ws_port;
    if let Some(bind_host) = args.bind_host.as_deref() {
        config.bind_host = bind_host.to_string();
    }
    if args.advertised_host.is_some() {
        config.advertised_host = args.advertised_host.clone();
    }
    if let Some(socket) = &args.socket {
        config.socket_path = socket.clone();
    }
}

/// Main daemon entry point (kept for CLI compatibility)
pub async fn run_daemon(args: DaemonArgs) -> Result<()> {
    // Load or create config
    let config = load_or_create_config(args.config.as_deref()).await?;

    // Override with CLI args
    let mut config = config;
    apply_cli_overrides(&mut config, &args);

    let handle = start_daemon(config).await?;
    // The listener lines are `start_daemon`'s to write — it is the one that knows the
    // ports it ended up on — and they are written there exactly once. Repeating them here
    // is what the load run recorded as a startup log with two of each line
    // (`bridge-io/security/load/report.md`, finding 3): a log a reviewer has to dedupe by
    // hand is a log that hides the lines that matter. The mode line stays, because which
    // mode the process came up in is a fact about *this* entry point, not about the
    // listeners.
    //
    // The address it names is the one the sockets bound, not `127.0.0.1`: an owner who
    // opted into a LAN bind reads a startup log that says where the daemon really is, and
    // an owner who did not sees loopback because that is what is listening.
    let bind = handle.bind_addr();
    info!(
        "warshad serving on http://{bind}:{} and RPC {bind}:{}",
        handle.http_port(),
        handle.rpc_port()
    );

    // Keep running until interrupted. True daemonization is not implemented yet,
    // so background mode also waits on Ctrl-C.
    if args.foreground {
        info!("warshad running in foreground mode");
    } else {
        info!("warshad running in background mode");
    }

    // Every exit path goes through the same shutdown, so no child outlives the
    // daemon: a signal that could not be listened for is waited out as an error
    // *after* the children are reaped, rather than returning early and leaving a
    // dev server holding its port.
    let interrupted = wait_for_shutdown_signal().await;
    handle.shutdown().await;
    interrupted?;
    Ok(())
}

/// Wait for the signal that says "stop this daemon".
///
/// Ctrl-C is what a terminal sends. On a service manager, in a container, or under a
/// plain `kill`, what arrives is SIGTERM — and a daemon that listened only for Ctrl-C
/// ignored it, so the stop that followed was a SIGKILL after a timeout: children kept
/// their ports, the lock was released only by the operating system, and the shutdown
/// path the code documents never ran. Both signals are answered the same way here:
/// return, and let [`run_daemon`] take the children down through the one shutdown.
///
/// Windows has no SIGTERM to catch, and a console close is the operating system's to
/// report; what covers a process that never gets to run its own code is
/// [`DaemonHandle`]'s drop sweep, plus the fact that the desktop shell runs the daemon
/// *inside* its own process, so an app that dies takes the daemon with it.
async fn wait_for_shutdown_signal() -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut terminate = signal(SignalKind::terminate())?;
        tokio::select! {
            interrupted = tokio::signal::ctrl_c() => interrupted,
            _ = terminate.recv() => Ok(()),
        }
    }
    #[cfg(not(unix))]
    {
        tokio::signal::ctrl_c().await
    }
}

/// Restrict a freshly created file to its owner on Windows.
///
/// The token file carries the daemon's owner token, so the ACL is written before the
/// content: an explicit DACL that grants the token's owner `FILE_ALL_ACCESS` and
/// nobody else, with inheritance removed so a permissive parent directory cannot
/// widen it. `SetNamedSecurityInfoW` with `pdacl: None` alongside
/// `DACL_SECURITY_INFORMATION` would write a NULL DACL — full access for everyone —
/// so the ACL is built explicitly from the process token's owner SID.
///
/// **Untested on Windows, recorded rather than assumed** (R-KEEL checkpoint row 18). The
/// property this function exists for — a second principal can open the token file and be
/// refused — needs a second principal to attempt the read, and no Windows host in this
/// tree runs the suite, so there is no `#[cfg(windows)]` test here. What the tree does
/// prove is the other half of the same claim on Unix
/// (`write_private_file_leaves_a_file_its_owner_alone_can_read_and_write`: the finished
/// file is `0600`), and that this function is wired *before* the content is written, in
/// the unix-neutral body of [`write_private_file`].
#[cfg(windows)]
fn restrict_file_to_owner(path: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE};
    use windows::Win32::Security::Authorization::{SetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows::Win32::Security::{
        AddAccessAllowedAce, GetLengthSid, GetTokenInformation, InitializeAcl, TokenOwner,
        ACCESS_ALLOWED_ACE, ACL, ACL_REVISION, DACL_SECURITY_INFORMATION,
        OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, TOKEN_OWNER, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    // `FILE_ALL_ACCESS`: STANDARD_RIGHTS_REQUIRED | SYNCHRONIZE | 0x1FF.
    const FILE_ALL_ACCESS: u32 = 0x001F_01FF;

    fn io_error(error: windows::core::Error) -> std::io::Error {
        std::io::Error::other(error)
    }

    let path_wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut token = HANDLE(std::ptr::null_mut());
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }.map_err(io_error)?;

    let result = (|| -> std::io::Result<()> {
        // The first call sizes the `TOKEN_OWNER` buffer and always answers
        // ERROR_INSUFFICIENT_BUFFER, which the crate surfaces as `Err`; only the
        // length it wrote is wanted here.
        let mut needed = 0u32;
        let _ = unsafe { GetTokenInformation(token, TokenOwner, None, 0, &mut needed) };
        if needed == 0 {
            return Err(std::io::Error::other(
                "GetTokenInformation(TokenOwner) returned no buffer size",
            ));
        }
        // `usize` words keep the buffer aligned for the `TOKEN_OWNER` read below.
        let mut owner_buffer =
            vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
        unsafe {
            GetTokenInformation(
                token,
                TokenOwner,
                Some(owner_buffer.as_mut_ptr() as *mut core::ffi::c_void),
                needed,
                &mut needed,
            )
        }
        .map_err(io_error)?;
        let owner_sid = unsafe { (*(owner_buffer.as_ptr() as *const TOKEN_OWNER)).Owner };

        // One access-allowed ACE for the owner, in an aligned buffer sized by the
        // documented `sizeof(ACL) + sizeof(ACCESS_ALLOWED_ACE) - sizeof(DWORD) +
        // GetLengthSid(sid)` formula.
        let sid_length = unsafe { GetLengthSid(owner_sid) };
        let acl_length = std::mem::size_of::<ACL>() + std::mem::size_of::<ACCESS_ALLOWED_ACE>()
            - std::mem::size_of::<u32>()
            + sid_length as usize;
        let mut acl_buffer = vec![0usize; acl_length.div_ceil(std::mem::size_of::<usize>())];
        let acl = acl_buffer.as_mut_ptr() as *mut ACL;
        unsafe { InitializeAcl(acl, acl_length as u32, ACL_REVISION) }.map_err(io_error)?;
        unsafe { AddAccessAllowedAce(acl, ACL_REVISION, FILE_ALL_ACCESS, owner_sid) }
            .map_err(io_error)?;

        let status = unsafe {
            SetNamedSecurityInfoW(
                PCWSTR(path_wide.as_ptr()),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION
                    | DACL_SECURITY_INFORMATION
                    | PROTECTED_DACL_SECURITY_INFORMATION,
                Some(owner_sid),
                None,
                Some(acl as *const ACL),
                None,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(std::io::Error::from_raw_os_error(status.0 as i32));
        }
        Ok(())
    })();

    unsafe {
        let _ = CloseHandle(token);
    }
    result
}

/// Write a configuration file atomically, owner-only on Unix and Windows.
///
/// The file carries the owner token, so it is created 0600 before any content is
/// written, and it is renamed into place so a concurrent reader sees either the
/// old file or the complete new one, never a truncated TOML document.
pub(crate) fn write_private_file(path: &Path, content: &str) -> std::io::Result<()> {
    use std::io::Write;
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.toml");
    let temporary = parent.join(format!(".{name}.tmp-{}", std::process::id()));
    let write = || -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temporary)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        }
        #[cfg(windows)]
        restrict_file_to_owner(&temporary)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()
    };
    if let Err(error) = write() {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = std::fs::rename(&temporary, path) {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

pub async fn load_or_create_config(config_path: Option<&Path>) -> Result<DaemonConfig> {
    let config_dir = dirs::config_dir()
        .map(|d| d.join("warsha"))
        .unwrap_or_else(|| PathBuf::from(".").join("warsha"));
    std::fs::create_dir_all(&config_dir)?;

    let default_config_path = config_dir.join("config.toml");
    let path = config_path.unwrap_or(&default_config_path);

    let config = if path.exists() {
        let content = std::fs::read_to_string(path)?;
        toml::from_str(&content)?
    } else {
        // Generate auth token
        let mut token = [0u8; 32];
        rand::rngs::OsRng
            .try_fill_bytes(&mut token)
            .map_err(|e| DaemonError::Config(e.to_string()))?;
        let auth_token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(token);

        let config = DaemonConfig {
            auth_token,
            ..Default::default()
        };

        // Save atomically with 0600 permissions: a concurrent reader (the desktop,
        // a smoke harness) must never parse a half-written file.
        let content = toml::to_string_pretty(&config)?;
        write_private_file(path, &content)?;

        // A brand-new daemon has just minted the one owner token it will never show
        // again, because after this the file already holds it. Printing it directly to stderr
        // is the way a headless operator captures that first token, and it is deliberately gated
        // behind `WARSHA_PRINT_BOOTSTRAP_TOKEN=1`: a normal run, and every test, must
        // not leak a freshly minted secret into a log file or collector (AGENTS.md).
        if std::env::var("WARSHA_PRINT_BOOTSTRAP_TOKEN")
            .ok()
            .is_some_and(|value| value == "1")
        {
            eprintln!("BOOTSTRAP_ADMIN_TOKEN={}", config.auth_token);
        }
        config
    };

    // The environment is the deployment-time knob, overlaid last so it wins over both
    // a `config.toml` and the defaults a fresh file was written from.
    apply_env_overrides(config)
}

/// Overlay `WARSHA_*` environment variables on a configuration the daemon read or made.
///
/// A container image sets the bind address and the ports without rewriting a
/// `config.toml`, and an operator supplies an already-held token through
/// `WARSHA_AUTH_TOKEN` instead of letting one be minted. A port that does not parse as
/// a `u16` is ignored rather than failing the start — a stray `WARSHA_HTTP_PORT=abc`
/// must not brick a deploy — while the bind address is passed through as written and
/// validated by [`resolve_bind_host`], which owns the error an owner should actually
/// see for a non-address.
///
/// Returns an error if an environment variable holds an invalid value, forcing a
/// startup failure instead of a silent fallback to a default that may not suit
/// the host's networking or auth requirements.
pub(crate) fn apply_env_overrides(mut config: DaemonConfig) -> Result<DaemonConfig> {
    if let Some(host) = env_string("WARSHA_BIND_HOST") {
        config.bind_host = host;
    }
    if let Some(host) = env_string("WARSHA_ADVERTISED_HOST") {
        config.advertised_host = Some(host);
    }
    if let Some(port) = env_port("WARSHA_HTTP_PORT") {
        config.http_port = port;
    }
    if let Some(port) = env_port("WARSHA_WS_PORT") {
        config.ws_port = port;
    }
    if let Some(dir) = env_string("WARSHA_DATA_DIR") {
        config.data_dir = PathBuf::from(dir);
    }
    if let Some(token) = env_string("WARSHA_AUTH_TOKEN") {
        config.auth_token = token;
    }
    if let Some(dir) = env_string(REMOTE_ASSETS_DIR_ENV) {
        config.remote_assets_dir = Some(PathBuf::from(dir));
    }
    if let Some(bind) = env_string("WARSHA_REMOTE_BIND") {
        match bind.to_lowercase().as_str() {
            "default" => config.remote_bind = RemoteBind::Default,
            "localhost" => config.remote_bind = RemoteBind::Localhost,
            "tailscale" => config.remote_bind = RemoteBind::Tailscale,
            invalid => {
                return Err(DaemonError::Config(format!(
                    "invalid WARSHA_REMOTE_BIND value: '{invalid}', expected 'default', 'localhost', or 'tailscale'"
                )));
            }
        }
    }
    Ok(config)
}

/// A non-empty environment value, trimmed; `None` when the name is unset, blank, or
/// not valid UTF-8.
fn env_string(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// An environment value parsed as a `u16` port number.
fn env_port(name: &str) -> Option<u16> {
    env_string(name).and_then(|value| value.parse::<u16>().ok())
}

fn get_github_token() -> Result<String> {
    // keyring 1.2's `Entry::new` is infallible (it returns `Entry`, not a `Result`).
    let entry = Entry::new("warsha", "github_token");
    entry
        .get_password()
        .map_err(|_| DaemonError::Config("GitHub token not in keychain".to_string()))
}
