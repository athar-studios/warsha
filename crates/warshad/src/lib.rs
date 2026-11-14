//! Warshad — Daemon binary: local API (JSON-RPC over Unix socket / named pipe + localhost HTTP/WebSocket with token)

use base64::Engine as _;
use chrono::Utc;
use jsonrpsee::{
    core::{async_trait, RpcResult},
    server::ServerBuilder,
    types::ErrorObject,
};
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
use warsha_core::*;
use warsha_git::GitHubClient;
use warsha_pipeline::mcp_permission::{McpPermissionSource, ToolPermission};
#[allow(unused_imports)] // read only by `mod tests`
use warsha_pipeline::AgentLoop;
use warsha_pipeline::MCP_AGENT_ROLE;
use warsha_pipeline::{
    AgentMode, AgentTurnResult, BackendKind, BackendKit, CommandPolicy, CrashReport,
    CrashReportStore, HandoffBundle, HandoffManager, InMemoryCrashReportStore, InMemoryMcpManager,
    InMemoryPairingStore, InMemoryPreferenceStore, InMemoryProcessManager,
    InMemoryStoreReviewStore, LivePreview, LivePreviewManager, ManagedProcess, McpApprovals,
    McpConnection, McpManager, ModeTransition, PairingStore, PhonePairing, Preference,
    PreferenceSignal, PreferenceStore, ProcessManager, ProcessStatus, ProcessSummary, Routine,
    RoutineRegistry, RoutineRunner, RoutineScheduler, RunAgentSessions, RunMode, RunModeConfig,
    RunWorktree, StaticPermissions, StoreReview, StoreReviewStore, AGENT_ROLE,
};
use warsha_providers::{
    probe_endpoint, HealthCheck, KeychainSecretStore, OneClickProvider, ProviderRouter,
    ProviderSetupWizard, SecretStore,
};
use warsha_remote::DeviceRegistry;
use warsha_store::{Store, StoredProvider};

mod auth;
mod events;
mod http;
mod lock;
mod mcp_approvals;
mod providers;
mod settings;
mod skills;
mod state;
mod wave2;

pub use auth::{
    anonymous_session, owner_session, session_extensions, Actor, ActorRole, DaemonError,
    MethodPolicy, Policy, ProcessPolicy, QuotaConfig, RateGovernor, RateLimitConfig, RpcExtensions,
    Sessions, Tier, DEFAULT_ALLOWED_COMMANDS, METHOD_POLICIES,
};
use auth::{
    bearer_token, retry_after_header, subprotocol_token, RpcAuthLayer, EVENTS_PATH,
    EVENTS_SUBPROTOCOL,
};
use events::events_handler;
pub use events::{
    EventSequencer, RunStreamSync, SequencedEventFrame, StreamSync, EVENT_REPLAY_CAPACITY,
};
use http::{http_app, origin_is_loopback, pairing_origin, resolve_bind_host};
pub use http::{REMOTE_ASSETS_DIR_ENV, REMOTE_CSP};
use lock::acquire_lock;
pub use mcp_approvals::{McpApproval, McpApprovalAnswer};
pub use providers::{
    adapter_kind, keychain_credentials, AdapterKind, DeferredProvider, KeychainProviderFactory,
    MockProviderFactory, ProviderFactory, RemovedProvider,
};
pub use settings::{SettingsError, SettingsStore};
pub(crate) use state::paired_device_is_active;
pub use state::{
    scrub_event_payload, windows_firewall_command, AppState, DaemonArgs, DaemonConfig,
    DaemonHandle, DaemonState, McpPermissionRow, McpPermissionsReply,
};

pub type Result<T> = std::result::Result<T, DaemonError>;

// --- P-H1 A8: `rpc-core` region (`WarshaRpc` + impl, `rpc_*` error helpers, permission
// store) moved to rpc/mod.rs; kept crate-visible here. ---
mod rpc;
pub use rpc::WarshaRpc;
pub(crate) use rpc::{
    now_epoch_secs, provider_refusal, refuse_a_permission_governed_frame, rpc_error,
    rpc_invalid_params, rpc_policy_refused, DaemonPermissionStore,
};
// --- end P-H1 A8 ---

// ============================================================= /end event stream

// --- P-H1 A4: `state` region (DaemonState + MCP permission DTOs) moved to state.rs; facade above. ---

// --- P-H1 A1: `api` region (WarshaApi trait + DTOs) moved to api.rs; kept crate-visible here. ---
mod api;
#[allow(unused_imports)] // read only by `mod tests`
pub(crate) use api::provider_model;
pub(crate) use api::{non_empty, provider_endpoint};
pub use api::{
    AgentState, BudgetStatus, GateSummary, GateSummaryState, HealthCapabilities, HealthResponse,
    ProviderRecord, RoleRoutingConfig, RoutingTargetConfig, WarshaApiServer,
};
// --- end P-H1 A1 ---

// --- P-H1 A7: `runtime` region (agent loop + role routing) moved to runtime.rs; kept crate-visible here. ---
mod runtime;
pub use runtime::AgentLoopSnapshot;
pub(crate) use runtime::{
    apply_role_routings, build_agent_loop, build_agent_loop_in, register_configured_providers,
    routing_config, routing_for, seed_agent_snapshot, seed_role_routings, store_agent_snapshot,
    store_role_routings, AGENT_METER_KEY, AGENT_WORKSPACE_DIR, MOCK_PROVIDER_ID,
};
// --- end P-H1 A7 ---

#[async_trait]
impl WarshaApiServer for WarshaRpc {
    async fn health(&self, ext: &RpcExtensions) -> RpcResult<HealthResponse> {
        self.authorize(ext, "health").await?;
        let capabilities = self.state.probe_capabilities().await;
        let status = if capabilities.daemon {
            "healthy".to_string()
        } else {
            "degraded".to_string()
        };
        Ok(HealthResponse {
            status,
            version: env!("CARGO_PKG_VERSION").to_string(),
            uptime_seconds: self.start_time.elapsed().as_secs(),
            capabilities,
        })
    }

    async fn list_projects(&self, ext: &RpcExtensions) -> RpcResult<Vec<Project>> {
        self.authorize(ext, "projects.list").await?;
        self.state
            .store
            .list_projects()
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn create_project(
        &self,
        ext: &RpcExtensions,
        name: String,
        description: String,
        language: String,
    ) -> RpcResult<Project> {
        self.authorize(ext, "projects.create").await?;
        let project = Project {
            id: ProjectId::new(),
            name,
            description,
            language,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
        };
        self.state
            .store
            .create_project(&project)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        Ok(project)
    }

    async fn get_project(&self, ext: &RpcExtensions, id: ProjectId) -> RpcResult<Project> {
        self.authorize(ext, "projects.get").await?;
        self.state
            .store
            .get_project(id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    /// Attach an existing repository to a project (ENGINE E3).
    ///
    /// The path is validated with the same probe `create_run_worktree` runs before it
    /// asks git for a checkout, so `projects.attach` cannot record a path that
    /// `runs.start` would then fail (and cancel a run) on.
    ///
    /// A project that already names a repository is refused rather than overwritten:
    /// re-attaching is a decision the owner makes on purpose, and a silent replacement
    /// would move every future run of the project onto a different checkout while the
    /// runs already started keep their old worktrees — the half-attach the E3 packet
    /// forbids. Detaching first is the explicit route to a different repository.
    async fn attach_project(
        &self,
        ext: &RpcExtensions,
        project_id: ProjectId,
        repo_path: String,
    ) -> RpcResult<Project> {
        self.authorize(ext, "projects.attach").await?;
        let mut project = self
            .state
            .store
            .get_project(project_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        if let Some(existing) = project
            .repo_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
        {
            return Err(ErrorObject::owned(
                -32000,
                format!(
                    "project {} already has the repository `{existing}`; \
                     it must be detached before another is attached",
                    project_id.0
                ),
                None::<()>,
            ));
        }
        let path = repo_path.trim();
        warsha_pipeline::worktree::validate_repository(std::path::Path::new(path))
            .await
            .map_err(|e| {
                ErrorObject::owned(-32000, format!("cannot attach `{path}`: {e}"), None::<()>)
            })?;
        project.repo_path = Some(path.to_string());
        project.updated_at = Utc::now();
        self.state
            .store
            .update_project(&project)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        Ok(project)
    }

    async fn start_run(
        &self,
        ext: &RpcExtensions,
        project_id: ProjectId,
        idea: String,
    ) -> RpcResult<Run> {
        self.authorize(ext, "runs.start").await?;
        let run = self
            .state
            .pipeline
            .start_run(project_id, &idea)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        // Wire active harness + enabled skills + enabled plugins into run start context (F2)
        let active_harness = self
            .state
            .settings
            .get_active_harness(&project_id.to_string())
            .await
            .ok()
            .flatten()
            .unwrap_or_else(|| "autonomous-factory".to_string());
        let enabled_skills: Vec<String> = self
            .state
            .settings
            .list_skills()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|s| s.enabled)
            .map(|s| s.id)
            .collect();
        let enabled_plugins: Vec<String> = self
            .state
            .settings
            .list_plugins()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|p| p.enabled)
            .map(|p| p.id)
            .collect();

        tracing::info!(
            target: "audit",
            run_id = %run.id.0,
            stage = ?run.current_stage,
            harness = %active_harness,
            skills = ?enabled_skills,
            plugins = ?enabled_plugins,
            "run start audit context"
        );

        // ENGINE E3 wiring: a project that names a repository gets a per-run
        // worktree, so two runs cannot edit one checkout. A run whose worktree
        // cannot be created is cancelled rather than left to execute in the shared
        // workspace — the failure is visible instead of silently sharing files.
        let project = self
            .state
            .store
            .get_project(project_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        if let Some(repo_path) = project
            .repo_path
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
        {
            let root = self.state.config.data_dir.join("worktrees");
            match warsha_pipeline::create_run_worktree(
                std::path::Path::new(repo_path),
                &root,
                &run.id.0.to_string(),
                "HEAD",
            )
            .await
            {
                Ok(worktree) => {
                    self.state
                        .run_worktrees
                        .write()
                        .await
                        .insert(run.id, worktree);
                }
                Err(error) => {
                    let _ = self
                        .state
                        .pipeline
                        .cancel_run(run.id, Some("worktree creation failed".to_string()))
                        .await;
                    return Err(ErrorObject::owned(
                        -32000,
                        format!(
                            "the run was cancelled because its worktree could not be created: {error}"
                        ),
                        None::<()>,
                    ));
                }
            }
        }

        // ENGINE E2 wiring: each run gets its own loop bound to its own checkout
        // (the worktree when it has one, else the daemon workspace), inserted under
        // the run id. `agent.turn_run` runs the turn there; `agent.turn`, the legacy
        // single conversation, is retired by OD-E2 and refuses.
        let workspace = match self.state.run_worktrees.read().await.get(&run.id) {
            Some(worktree) => worktree.path.clone(),
            None => self.state.config.data_dir.join(AGENT_WORKSPACE_DIR),
        };
        let backend_kit = Arc::new(RwLock::new(default_backend_kit("run")));
        let per_run_loop = build_agent_loop_in(
            &workspace,
            &self.state.config.allowed_commands,
            self.state.providers.clone(),
            self.state.mcp.clone(),
            self.state.mcp_permissions.clone(),
            self.state.mcp_approvals.clone(),
            Some(run.id.0.to_string()),
            backend_kit,
        );
        if self
            .state
            .agent_sessions
            .insert(run.id, per_run_loop)
            .is_err()
        {
            warn!(run_id = %run.id.0, "the run already had an agent session");
        }

        Ok(run)
    }

    async fn run_worktree(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
    ) -> RpcResult<Option<RunWorktree>> {
        self.authorize(ext, "runs.worktree").await?;
        Ok(self.state.run_worktrees.read().await.get(&run_id).cloned())
    }

    /// Collect the diff, changed paths and one measured test run for Gate C.
    async fn gate_evidence(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        program: String,
        args: Vec<String>,
    ) -> RpcResult<warsha_pipeline::GateEvidence> {
        self.authorize(ext, "gates.evidence").await?;
        let run = self
            .state
            .store
            .get_run(run_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        if run.current_stage != Stage::GateC {
            return Err(ErrorObject::owned(
                -32000,
                format!(
                    "gate evidence is for Gate C; the run is at {:?}",
                    run.current_stage
                ),
                None::<()>,
            ));
        }
        let work_dir =
            {
                let worktrees = self.state.run_worktrees.read().await;
                match worktrees.get(&run_id) {
                    Some(worktree) => worktree.path.clone(),
                    None => return Err(ErrorObject::owned(
                        -32000,
                        "the run has no worktree; Gate C evidence needs a repository-backed run"
                            .to_string(),
                        None::<()>,
                    )),
                }
            };
        // The test program is the owner's, but it is still judged by the same
        // command policy as RunCommand: no shell, the allow-list, no traversal.
        let policy = CommandPolicy::from_config(&self.state.config.allowed_commands);
        policy
            .check_program(&program)
            .map_err(|e| ErrorObject::owned(-32005, e.to_string(), None::<()>))?;
        let evidence =
            warsha_pipeline::collect_gate_evidence(&policy, &work_dir, "HEAD", &program, &args)
                .await
                .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        // The preview joins the diff and the tests (ENGINE E5). It is read from what
        // the manager already tracks for the run's project and it is read in that
        // run's context (R-BRIDGE-B5 D4): evidence is a run's own evidence, so a
        // server another live run owns is not this run's preview. It is never
        // started: a run with no preview is the explicit `None` the caller sees,
        // not an error and not a server launched to fill the gap.
        let preview = self
            .state
            .previews
            .status(&run.project_id.to_string(), Some(&run.id.0.to_string()))
            .await
            .ok();
        Ok(evidence.with_preview(preview))
    }

    async fn get_run(&self, ext: &RpcExtensions, run_id: RunId) -> RpcResult<Run> {
        self.authorize(ext, "runs.get").await?;
        self.state
            .store
            .get_run(run_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn list_runs(&self, ext: &RpcExtensions, project_id: ProjectId) -> RpcResult<Vec<Run>> {
        self.authorize(ext, "runs.list").await?;
        self.state
            .store
            .list_runs(project_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn get_events(&self, ext: &RpcExtensions, run_id: RunId) -> RpcResult<Vec<Event>> {
        self.authorize(ext, "runs.events").await?;
        let token = self.state.config.auth_token.clone();
        let mut events = self
            .state
            .store
            .get_events(run_id)
            .await
            .map_err(rpc_error)?;
        // The store holds the payload as it was written; the wire never sees a secret.
        for event in &mut events {
            scrub_event_payload(&mut event.payload, &token);
        }
        Ok(events)
    }

    async fn approve_gate(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        stage: Stage,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run> {
        let actor = self.authorize(ext, "gates.approve").await?;
        let approver = self.gate_approver(&actor, device_id, "gates.approve")?;
        self.state
            .pipeline
            .approve_gate(run_id, stage, approver)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn reject_gate(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        stage: Stage,
        reason: String,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run> {
        let actor = self.authorize(ext, "gates.reject").await?;
        let approver = self.gate_approver(&actor, device_id, "gates.reject")?;
        self.state
            .pipeline
            .reject_gate(run_id, stage, reason, approver)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn request_changes(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        stage: Stage,
        notes: String,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run> {
        let actor = self.authorize(ext, "gates.changes").await?;
        let approver = self.gate_approver(&actor, device_id, "gates.changes")?;
        self.state
            .pipeline
            .request_changes(run_id, stage, notes, approver)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn list_gates(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Vec<GateSummary>> {
        self.authorize(ext, "gates.list").await?;
        // Accepted for the gates block's legacy param shape, and believed for nothing:
        // this read records no identity, so there is no session claim to compare it to
        // and no caller-named device that changes what is answered.
        let _ = device_id;
        // Read from `Run.gate_states` through the store's run getter — **not** from
        // `Store::list_gates`. The `gates` table's only writer, `create_gate`, has no
        // production caller, so a table-backed read would answer `[]` for every run and
        // turn every queue into a silent lie (the trap DECISIONS.md 2026-11-03 #25
        // records; `Run.gate_states` is what the pipeline seeds on `start_run` and what
        // `gates.approve`/`reject`/`changes` mutate, so it is the live truth).
        let run = self
            .state
            .store
            .get_run(run_id)
            .await
            .map_err(|e| rpc_error(e.to_string()))?;
        Ok(Stage::all()
            .iter()
            .filter(|stage| stage.is_gate())
            .map(|stage| GateSummary {
                stage: *stage,
                state: run
                    .gate_states
                    .get(stage)
                    .cloned()
                    .unwrap_or_default()
                    .into(),
            })
            .collect())
    }

    async fn list_providers(&self, ext: &RpcExtensions) -> RpcResult<Vec<ProviderRecord>> {
        self.authorize(ext, "providers.list").await?;
        let stored = self
            .state
            .settings
            .load_providers()
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        Ok(stored.into_iter().map(ProviderRecord::from).collect())
    }

    /// Add a provider: keychain first, then the settings row.
    ///
    /// The order is the point. A keychain that refuses (a locked keyring, a
    /// platform with no secret service) must leave no row behind, because a
    /// configured provider whose key is missing is a provider every
    /// `providers.test` would refuse — recorded as if the owner had finished
    /// setup. Nothing here logs the key, echoes it in an error, or writes it
    /// anywhere but the store it was handed.
    async fn add_provider(
        &self,
        ext: &RpcExtensions,
        name: String,
        kind: String,
        key: String,
        api_base: Option<String>,
    ) -> RpcResult<ProviderRecord> {
        self.authorize(ext, "providers.add").await?;
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(provider_refusal("a provider needs a name"));
        }
        if name == MOCK_PROVIDER_ID {
            // The daemon's own offline adapter holds this id, and every automated test
            // routes to it. A row that claimed it would be registered now and skipped
            // at the next start (`register_configured_providers` leaves the id to the
            // mock), which is a provider that works until it quietly does not.
            return Err(provider_refusal(format!(
                "{MOCK_PROVIDER_ID} is the daemon's own offline provider; choose another name"
            )));
        }
        let kind = kind.trim().to_string();
        if kind.is_empty() {
            return Err(provider_refusal(format!(
                "provider {name} needs a kind (open_router, deep_seek, kimi, glm, qwen or custom)"
            )));
        }
        let api_base = non_empty(api_base);
        // A pasted key arrives with the whitespace the paste carried; the wizard's
        // own check trims before it judges, so the key that is stored and later sent
        // as a bearer token is the trimmed one and not a key with a newline in it.
        let key = key.trim().to_string();

        // The endpoint has to be known before anything is stored: the kind's
        // default when the caller sent none, and a refusal when there is none.
        let endpoint = api_base.clone().or_else(|| {
            OneClickProvider::from_tag(&kind)
                .and_then(OneClickProvider::default_base_url)
                .map(str::to_string)
        });
        let Some(endpoint) = endpoint else {
            return Err(provider_refusal(format!(
                "no base URL is known for provider kind {kind}; send api_base with the provider"
            )));
        };

        // The two input checks that belong to `add`: the URL parses and the key is
        // usable. The model is not checked here — `add` has no model to check, and
        // `providers.test` is where that field is reported.
        let inputs = ProviderSetupWizard::test_connection(&endpoint, &key, "");
        if let Some(reason) = inputs.url_reason {
            return Err(provider_refusal(reason));
        }
        if let Some(reason) = inputs.key_reason {
            return Err(provider_refusal(reason));
        }

        self.state.secrets.store(&name, &key).await.map_err(|e| {
            provider_refusal(format!(
                "the API key could not be stored in the OS keychain: {e}"
            ))
        })?;

        let provider = StoredProvider {
            name: name.clone(),
            kind,
            api_base,
            enabled: true,
            created_at: u64::try_from(Utc::now().timestamp()).unwrap_or_default(),
        };
        self.state
            .settings
            .save_provider(&provider)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        // The row is the owner's half of a provider and the router is the callable half.
        // Registering the deferred adapter here is what makes a provider usable by the
        // next turn rather than only by the daemon after the next restart — and
        // registering calls nothing: the adapter is built on its first use, so a fresh
        // daemon with three configured providers still starts with no network at all.
        self.state
            .providers
            .write()
            .await
            .register_provider(Box::new(DeferredProvider::new(
                provider.clone(),
                Arc::clone(&self.state.provider_factory),
            )));

        info!("provider {name} configured");
        Ok(provider.into())
    }

    /// Test a stored provider for real: is the input well formed, then does the
    /// endpoint answer and accept the key.
    ///
    /// A refusal is an error rather than `{healthy: false}`, because the desktop
    /// client's `providers.test` treats a resolved call as a passing test — the
    /// wizard could not tell an unhealthy result from a healthy one. The reason
    /// therefore travels in the error's message (what the wizard shows) and in its
    /// `data` as the [`HealthCheck`] the RPC declares.
    async fn test_provider(
        &self,
        ext: &RpcExtensions,
        name: String,
        model: Option<String>,
    ) -> RpcResult<HealthCheck> {
        self.authorize(ext, "providers.test").await?;
        let provider = self
            .state
            .settings
            .load_provider(&name)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?
            .ok_or_else(|| provider_refusal(format!("no provider named {name} is configured")))?;

        let endpoint = provider_endpoint(&provider).ok_or_else(|| {
            provider_refusal(format!(
                "no base URL is known for provider kind {}; add it again with api_base",
                provider.kind
            ))
        })?;
        let key = self.state.secrets.load(&name).await.map_err(|e| {
            provider_refusal(format!(
                "the API key for {name} could not be read from the OS keychain: {e}"
            ))
        })?;

        // Resolve test probe model per D1:
        // 1. Explicit model param
        // 2. Custom model registered for this provider that is enabled
        // 3. Role routing targeting this provider
        // 4. OneClickProvider default
        // 5. Kind-specific fallback
        let resolved_model = self.resolve_test_model(&provider, model).await;

        // No network yet: a malformed URL or a key the owner typed with a space in
        // it is refused here, from the wizard's own checks.
        if let Some(reason) =
            ProviderSetupWizard::test_connection(&endpoint, &key, &resolved_model).reason()
        {
            return Err(provider_refusal(reason));
        }

        let health = probe_endpoint(&endpoint, &key).await;
        if health.healthy {
            return Ok(health);
        }

        let reason = health
            .error
            .clone()
            .unwrap_or_else(|| "the connection test failed".to_string());
        warn!("provider {name} failed its connection test: {reason}");
        Err(ErrorObject::owned(-32000, reason, Some(health)))
    }

    async fn check_provider_models(
        &self,
        ext: &RpcExtensions,
        name: String,
    ) -> RpcResult<warsha_providers::ModelCatalogDiff> {
        self.authorize(ext, "providers.check_models").await?;
        // A handle rather than a lock held across the catalog call (audit N-3): this
        // reaches the provider over the network, and a read guard kept through it would
        // make an owner's `providers.add` wait for a round trip it has nothing to do with.
        let router = {
            let guard = self.state.providers.read().await;
            (*guard).clone()
        };
        router
            .check_model_updates(&name, &[])
            .await
            .map_err(|e| rpc_error(e.to_string()))
    }

    async fn list_devices(
        &self,
        ext: &RpcExtensions,
    ) -> RpcResult<Vec<warsha_remote::DeviceIdentity>> {
        self.authorize(ext, "devices.list").await?;
        Ok(self.state.devices.list_devices().await)
    }

    async fn pair_device(
        &self,
        ext: &RpcExtensions,
        pairing_data: warsha_remote::PairingData,
    ) -> RpcResult<()> {
        // Owner-only (audit H2): a paired device must not be able to enrol another.
        self.authorize(ext, "devices.pair").await?;

        // A pairing consumes an offer, and the offer's deadline is the one the daemon
        // enforces from then on (audit H1). Refuse a stale one before writing anything,
        // so an expired QR leaves neither a device row nor a pairing record behind.
        if pairing_data.is_expired() {
            return Err(rpc_error(
                "this pairing has expired; mint a fresh one from the daemon's pairing \
                 screen (`devices.pair-start`) or with `warsha pair`"
                    .to_string(),
            ));
        }
        let expires_at = u64::try_from(pairing_data.expires_at.timestamp())
            .map_err(|_| rpc_error("this pairing's expiry is before the Unix epoch".to_string()))?;

        let device = warsha_remote::DeviceIdentity {
            device_id: pairing_data.device_id,
            static_public: pairing_data.static_public,
            name: "Paired Device".to_string(),
            created_at: Utc::now(),
            revoked: false,
            revoked_at: None,
        };
        self.state
            .devices
            .add_device(device)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        {
            let mut pairings = self.state.pairings.write().await;
            if pairings.get(&pairing_data.device_id.to_string()).is_none() {
                pairings
                    .create_with_expiry(
                        &pairing_data.device_id.to_string(),
                        &pairing_data.secret_token(),
                        now_epoch_secs(),
                        Some(expires_at),
                    )
                    .map_err(|e| rpc_error(e.to_string()))?;
            }
        }
        self.save_pairings().await?;
        Ok(())
    }

    async fn start_pairing(&self, ext: &RpcExtensions) -> RpcResult<warsha_remote::PairingOffer> {
        // Owner-only, deliberately (see `crates/warshad/src/auth.rs`): this is the method
        // that mints the credential the daemon will later trust a caller as, so a caller
        // that is already only a paired device must not be able to hand out a second one.
        self.authorize(ext, "devices.pair-start").await?;

        // The address a phone is sent to, taken from the socket the daemon actually bound
        // and not from the configuration that asked for it: a link may never advertise an
        // address the daemon is not listening on, which is the one way parts A and B of
        // this change could disagree and produce a pairing that cannot be used.
        let server_origin = self.state.pairing_origin.get().cloned().ok_or_else(|| {
            rpc_error(
                "this daemon has no resolved listening origin to advertise yet; a pairing link \
                 would send a phone to an address it cannot reach. If the daemon is bound to a \
                 wildcard address (0.0.0.0), set `advertised_host` to the address your phone \
                 reaches this machine at"
                    .to_string(),
            )
        })?;
        let loopback_only = origin_is_loopback(&server_origin);

        let device = warsha_remote::DeviceIdentity::generate("Pairing in progress".to_string())
            .map_err(|error| rpc_error(error.to_string()))?;
        // `relay_url` is `None` on purpose. The daemon keeps a `RunModeConfig` per mode and
        // no single one of them is "the mode this daemon serves" — there is no active-mode
        // state to read — and the relay path carries encrypted frames rather than this RPC
        // surface, so naming one would be a guess about where the phone connects. The
        // origin in the pairing link is what a phone dials today; see DECISIONS/PLAN for the
        // relay as its own milestone.
        let offer = warsha_remote::PairingOffer::new(&device, &server_origin, None, loopback_only)
            .map_err(|error| rpc_error(error.to_string()))?;
        // The stored pairing dies with the offer: the same deadline the QR carries is
        // written beside the secret, so a restart cannot turn a 10-minute credential
        // into a permanent one (audit H1).
        let expires_at = u64::try_from(offer.expires_at().timestamp())
            .map_err(|_| rpc_error("this pairing's expiry is before the Unix epoch".to_string()))?;

        // The secret itself is never logged: the origin and the expiry are what an owner
        // and a reviewer need, and a pairing line in a log is otherwise a bearer token in
        // a file that gets shipped to support (audit N-1).
        self.state
            .devices
            .add_device(device.clone())
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        {
            let mut pairings = self.state.pairings.write().await;
            pairings
                .create_with_expiry(
                    &device.device_id.to_string(),
                    &offer.pairing.secret_token(),
                    now_epoch_secs(),
                    Some(expires_at),
                )
                .map_err(|error| rpc_error(error.to_string()))?;
        }
        self.save_pairings().await?;

        info!(
            "minted a pairing for device {} at {server_origin}, valid until {}",
            offer.pairing.device_id,
            offer.expires_at().to_rfc3339()
        );
        Ok(offer)
    }

    async fn revoke_device(&self, ext: &RpcExtensions, device_id: DeviceId) -> RpcResult<()> {
        self.authorize(ext, "devices.revoke").await?;
        self.state
            .devices
            .revoke_device(device_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        {
            let mut pairings = self.state.pairings.write().await;
            pairings
                .revoke(&device_id.to_string())
                .map_err(|e| rpc_error(e.to_string()))?;
        }
        self.save_pairings().await?;
        Ok(())
    }

    // Providers
    async fn remove_provider(
        &self,
        ext: &RpcExtensions,
        name: String,
    ) -> RpcResult<ProviderRecord> {
        self.authorize(ext, "providers.remove").await?;
        let provider = self
            .state
            .settings
            .load_provider(&name)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?
            .ok_or_else(|| provider_refusal(format!("no provider named {name} is configured")))?;

        // The keychain goes first, and a failure there stops the removal: the
        // account is the provider's name, so a row deleted while its key stayed
        // behind would be an entry nothing could ever overwrite or reach again.
        self.state.secrets.delete(&name).await.map_err(|e| {
            provider_refusal(format!(
                "the API key could not be removed from the OS keychain: {e}"
            ))
        })?;
        self.state
            .settings
            .delete_provider(&name)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        // The router may already hold a built adapter with this provider's key inside
        // its request headers, and a row that is gone does not take that back. Putting a
        // refusal under the same id is what makes removal a removal rather than the
        // deletion of the record that it happened.
        self.state
            .providers
            .write()
            .await
            .register_provider(Box::new(RemovedProvider::new(&name)));

        // Routings that name it go too, written through in the same order `roles.set`
        // uses: stored first, then honoured. Leaving them would leave a role whose every
        // call fails with a provider the owner can no longer see in `providers.list`.
        let (table, dropped) = {
            let current = self.state.role_routings.read().await;
            let mut table: HashMap<Role, RoleRoutingConfig> = HashMap::clone(&current);
            let mut dropped: Vec<String> = Vec::new();
            table.retain(|_, config| {
                let names = config
                    .targets
                    .iter()
                    .any(|target| target.provider_id.trim() == name);
                if names {
                    dropped.push(config.role.clone());
                }
                !names
            });
            (table, dropped)
        };
        if !dropped.is_empty() {
            store_role_routings(&self.state.settings, &table)
                .await
                .map_err(|error| {
                    rpc_error(format!(
                        "the provider is removed but its routings could not be rewritten: {error}"
                    ))
                })?;
            *self.state.role_routings.write().await = table;
            info!(
                "routings for {} role(s) dropped with provider {name}",
                dropped.len()
            );
        }

        info!("provider {name} removed");
        Ok(provider.into())
    }

    // Roles.
    //
    // The routing an owner sets is the routing a turn follows: `roles.set` hands it to
    // the router *and* to the daemon's settings, so the model the owner chose answers
    // the next call and every call after a restart. Both halves matter — a routing kept
    // only in memory was C2's second gap, and one kept only on disk is a preference
    // nobody honours.
    async fn list_roles(&self, ext: &RpcExtensions) -> RpcResult<Vec<RoleRoutingConfig>> {
        self.authorize(ext, "roles.list").await?;
        let routings = self.state.role_routings.read().await;
        let mut configs: Vec<RoleRoutingConfig> = routings.values().cloned().collect();
        configs.sort_by(|left, right| left.role.cmp(&right.role));
        Ok(configs)
    }

    /// Route one role, or refuse the request and change nothing.
    ///
    /// Three things have to hold before the router is touched (audit H-01, H-07):
    ///
    /// - the role is one the pipeline knows, and every target names both a provider and
    ///   a model — an empty target resolves to nothing at the call, which is a slower
    ///   way of saying no;
    /// - every named provider is one the owner configured (or the daemon's own mock).
    ///   A routing to a name with no row behind it would be a routing that silently
    ///   never spends, and an owner who reads a `200` here is entitled to believe the
    ///   next call reaches that provider;
    /// - the settings write succeeds before the in-memory table is replaced, so a
    ///   refused write leaves the daemon routing exactly what it was routing.
    async fn set_role(&self, ext: &RpcExtensions, config: RoleRoutingConfig) -> RpcResult<()> {
        self.authorize(ext, "roles.set").await?;
        let (role, routing) = routing_for(&config).map_err(rpc_error)?;
        // Normalised through the core routing, so what is stored is what was honoured:
        // a caller who sent `INTAKE` or a target with a trailing space gets the same
        // table back from `roles.list` as the router is running.
        let stored = routing_config(role, &routing);

        for target in &stored.targets {
            if target.provider_id == MOCK_PROVIDER_ID {
                continue;
            }
            let configured = self
                .state
                .settings
                .load_provider(&target.provider_id)
                .await
                .map_err(|error| rpc_error(error.to_string()))?;
            if configured.is_none() {
                return Err(rpc_policy_refused(format!(
                    "role {} names provider {}, which is not configured",
                    stored.role, target.provider_id
                )));
            }
        }

        // Order is the whole of the durability story: the table is written to the
        // daemon's settings *before* the router is told, so a settings write that fails
        // changes nothing at all — no live routing that a restart forgets, and no
        // stored routing the running daemon does not honour.
        let table = {
            let current = self.state.role_routings.read().await;
            let mut table: HashMap<Role, RoleRoutingConfig> = HashMap::clone(&current);
            table.insert(role, stored.clone());
            table
        };
        store_role_routings(&self.state.settings, &table)
            .await
            .map_err(|error| {
                rpc_error(format!(
                    "the routing for {} could not be stored, so nothing was changed: {error}",
                    stored.role
                ))
            })?;

        // The router holds the adapter a routing names by the time the routing exists,
        // because a provider added by `providers.add` registered its adapter then. The
        // agent role's per-run ceiling, when the owner named one, is installed against
        // the key agent turns are metered under: the router checks it before every
        // attempt, so the cap written here is the cap that stops a paid call (H-07).
        //
        // A routing that names no ceiling replaces the old one with a ceiling that cannot
        // be reached rather than leaving the previous cap in place: the router has no way
        // to forget a budget, and a silently retained cap is a setting the owner removed
        // and the daemon still enforces.
        {
            let mut router = self.state.providers.write().await;
            if role == AGENT_ROLE {
                let cents = stored.budget_cents_per_run.unwrap_or(u64::MAX);
                router.set_budget(AGENT_METER_KEY, cents);
            }
            router.set_role_routing(routing);
        }
        *self.state.role_routings.write().await = table;

        info!("role {} routed", stored.role);
        Ok(())
    }

    // Budget
    async fn show_budget(
        &self,
        ext: &RpcExtensions,
        project_id: ProjectId,
    ) -> RpcResult<BudgetStatus> {
        self.authorize(ext, "budget.show").await?;
        let runs = self
            .state
            .store
            .list_runs(project_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        let run = runs
            .first()
            .ok_or_else(|| ErrorObject::owned(-32000, "No runs found for project", None::<()>))?;
        Ok(BudgetStatus {
            project_id,
            budget_cents: run.budget_cents,
            spent_cents: run.spent_cents,
            remaining_cents: run.budget_cents.map(|b| b.saturating_sub(run.spent_cents)),
        })
    }

    async fn set_budget(
        &self,
        ext: &RpcExtensions,
        project_id: ProjectId,
        cents: u64,
    ) -> RpcResult<()> {
        self.authorize(ext, "budget.set").await?;
        let runs = self
            .state
            .store
            .list_runs(project_id)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        let run = runs
            .first()
            .ok_or_else(|| ErrorObject::owned(-32000, "No runs found for project", None::<()>))?;
        self.state
            .pipeline
            .set_run_budget(run.id, cents)
            .await
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;
        Ok(())
    }

    // Backend kit (PLAN.md M19)
    async fn export_backend(
        &self,
        ext: &RpcExtensions,
        run_id: String,
        output_dir: String,
    ) -> RpcResult<String> {
        self.authorize(ext, "backend.export").await?;
        // The kit is the project's, not the run's: the stored row is keyed by
        // project id, so a second run of one project exports the same schema
        // instead of starting a second, empty one. It is loaded (the daemon's copy,
        // then the stored row, then the default) and re-remembered, so an export is
        // the write-through that would otherwise never happen for a kit that was
        // only read. The dump, the storage archive stem and the header all name the
        // project, not the run.
        let (key, project_name) = self.project_for_run(&run_id).await;
        let kit = self.backend_kit(&key, &project_name).await;
        self.remember_backend_kit(&key, &kit).await?;

        kit.export_to_dir(&output_dir)
            .map_err(|error| rpc_error(error.to_string()))
    }

    // Continue on server (PLAN.md M6a)
    async fn create_handoff(
        &self,
        ext: &RpcExtensions,
        run_id: String,
        files: Vec<(String, String)>,
    ) -> RpcResult<String> {
        self.authorize(ext, "handoff.create").await?;
        let manager = HandoffManager::new();
        let captured: Vec<(&str, &str)> = files
            .iter()
            .map(|(path, content)| (path.as_str(), content.as_str()))
            .collect();
        let bundle = manager.create_bundle(&run_id, &captured);

        // Bundles live under the daemon's data directory, next to the store.
        let dir = self.state.config.data_dir.join(HANDOFF_DIR);
        let dir = dir.to_string_lossy().into_owned();
        manager
            .write_bundle(&bundle, &dir)
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    async fn apply_handoff(
        &self,
        ext: &RpcExtensions,
        path: String,
        owner_wins: bool,
    ) -> RpcResult<String> {
        self.authorize(ext, "handoff.apply").await?;
        let encoded = std::fs::read_to_string(&path).map_err(|e| {
            ErrorObject::owned(-32000, format!("could not read `{path}`: {e}"), None::<()>)
        })?;
        let bundle: HandoffBundle = serde_json::from_str(&encoded).map_err(|e| {
            ErrorObject::owned(
                -32000,
                format!("`{path}` is not a handoff bundle: {e}"),
                None::<()>,
            )
        })?;

        // RunId → Run → Project.repo_path is the tree the bundle is written into.
        let root = self
            .working_tree_for_run(&bundle.run_id)
            .await
            .ok_or_else(|| {
                ErrorObject::owned(
                    -32000,
                    format!("run `{}` has no project repo to apply into", bundle.run_id),
                    None::<()>,
                )
            })?;

        // The apply copies every file it overwrites into
        // `{working_tree}/.warsha-backup/{timestamp}/` and then writes the files,
        // so the returned summary names the conflicts and that backup directory.
        let result = HandoffManager::new()
            .apply_to_disk(&bundle, &root.to_string_lossy(), owner_wins)
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))?;

        serde_json::to_string(&result)
            .map_err(|e| ErrorObject::owned(-32000, e.to_string(), None::<()>))
    }

    // Post-launch care (PLAN.md M17)
    async fn list_crash_reports(
        &self,
        ext: &RpcExtensions,
        run_id: String,
    ) -> RpcResult<Vec<CrashReport>> {
        self.authorize(ext, "postlaunch.crashes").await?;
        let reports = self.state.crash_reports.read().await.list();
        let wanted = run_id.trim();
        // A blank run id asks for every report, which is what the crash screen
        // shows before a run is selected.
        Ok(if wanted.is_empty() {
            reports
        } else {
            reports
                .into_iter()
                .filter(|report| report.run_id == wanted)
                .collect()
        })
    }

    async fn list_store_reviews(
        &self,
        ext: &RpcExtensions,
        store: String,
    ) -> RpcResult<Vec<StoreReview>> {
        self.authorize(ext, "postlaunch.reviews").await?;
        let reviews = self.state.store_reviews.read().await;
        let wanted = store.trim();
        Ok(if wanted.is_empty() {
            reviews.list()
        } else {
            reviews.list_by_store(wanted)
        })
    }

    // Agent workflow (PLAN.md M18, C2: the mode an owner approves is the mode that
    // spends, and both are the conversation the next daemon reads back).
    //
    // The three methods here share one rule from audit H-03: *who approved* is never a
    // value in the params. It is the device the transport authenticated, and a session
    // whose pairing names no device is refused instead of being recorded under a name
    // the daemon invented.
    /// The retired daemon-wide turn: refuse, and name the method that replaced it.
    ///
    /// The per-run loop is the one loop story (ENGINE E2, OD-E2), so this method no
    /// longer runs a turn. It stays on the wire because callers still name it —
    /// `packages/client`'s `agentTurn`, the desktop bench action and the e2e harness
    /// stub all do — and the smallest change the evidence supports is a refusal they
    /// can act on instead of a `-32601` they would read as a wiring bug. `authorize`
    /// runs first and its policy row stays, so the caller who may ask receives the
    /// migration message rather than a policy error.
    async fn agent_turn(&self, ext: &RpcExtensions, _input: String) -> RpcResult<AgentTurnResult> {
        self.authorize(ext, "agent.turn").await?;
        Err(ErrorObject::owned(
            -32000,
            "agent.turn is retired: start a run and use agent.turn_run with its run id",
            None::<()>,
        ))
    }

    /// Run one turn in one run's own loop and workspace.
    ///
    /// This is the one turn a daemon runs (ENGINE E2), so two runs cannot share
    /// context, todos, asks or mode state. The session is created at `runs.start`;
    /// a run that predates it has no session and is refused. `agent.turn`, the one
    /// conversation per daemon, is retired by OD-E2 and refuses.
    async fn agent_turn_run(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        input: String,
    ) -> RpcResult<AgentTurnResult> {
        self.authorize(ext, "agent.turn_run").await?;
        // Fail closed: a drifted skills lock refuses the turn instead of running it
        // with a catalog the owner's lock does not name.
        let skills = self.active_skill_catalog().await?;
        self.state
            .agent_sessions
            .run_turn(run_id, &input, &skills)
            .await
            .map_err(|error| ErrorObject::owned(-32000, error.to_string(), None::<()>))
    }

    /// Approve Agent mode for the session that asks.
    ///
    /// Plan mode is what a turn starts in, and the M18 rule is absolute: nothing
    /// edits a file or runs a tool until the owner approves. Until now the only caller
    /// that could approve was in-process, which meant Agent mode — the mode this daemon
    /// routes to a configured provider — was unreachable from the desktop. The approver
    /// recorded is the authenticated device, and a blank one is refused by the mode
    /// manager itself.
    ///
    /// `run_id` is OD-E2b: present, the approval is that run's own loop — the one
    /// `agent.turn_run` executes on, so the plan → approve → execute flow reaches Agent
    /// mode over the wire; absent, this is the daemon-wide record it always was.
    async fn approve_agent_mode(
        &self,
        ext: &RpcExtensions,
        run_id: Option<RunId>,
    ) -> RpcResult<ModeTransition> {
        self.agent_switch(ext, AgentMode::Agent, run_id).await
    }

    /// Return the conversation to Plan mode.
    ///
    /// The read-only direction is always allowed, which is why an owner can end Agent
    /// mode without another approval — and why the daemon can be put back to a state
    /// that cannot edit or spend by any session that can reach it. A `run_id` returns
    /// that run's own loop instead, by the same rule.
    async fn return_agent_to_plan(
        &self,
        ext: &RpcExtensions,
        run_id: Option<RunId>,
    ) -> RpcResult<ModeTransition> {
        self.agent_switch(ext, AgentMode::Plan, run_id).await
    }

    /// Report which mode the loop is in, and how it got there.
    ///
    /// A `run_id` answers for that run's own loop — the mode its next `agent.turn_run`
    /// runs in, its approvals and its todos — so the read agrees with a run-scoped
    /// `agent.approve_mode`; without one this is the daemon-wide record, unchanged.
    async fn agent_state(
        &self,
        ext: &RpcExtensions,
        run_id: Option<RunId>,
    ) -> RpcResult<AgentState> {
        self.authorize(ext, "agent.state").await?;
        if let Some(run_id) = run_id {
            let state = self
                .state
                .agent_sessions
                .state(run_id)
                .await
                .map_err(|error| rpc_error(error.to_string()))?;
            return Ok(AgentState {
                mode: state.mode,
                approvals: state.approvals,
                todos: state.todos,
                model_wired: state.model_wired,
            });
        }
        let agent_loop = self.state.agent_loop.read().await;
        Ok(AgentState {
            mode: agent_loop.mode(),
            approvals: agent_loop.mode_manager.history.clone(),
            todos: agent_loop.todo_list.items.clone(),
            // The loop's router seam is wired by `build_agent_loop`, so this answers the
            // question the owner actually has: is there a model behind the next turn.
            model_wired: agent_loop.has_router(),
        })
    }

    // Process spawning and MCP transports (PLAN.md M20)
    async fn spawn_process(
        &self,
        ext: &RpcExtensions,
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
    ) -> RpcResult<String> {
        self.authorize(ext, "process.spawn").await?;
        // Audit H-05: the owner's authority over a process table is not handed to a
        // caller that merely holds a token. The program has to be one the daemon's own
        // configuration allows, and the environment cannot carry a variable that
        // changes what the program is — `PATH`, `LD_PRELOAD`, `NODE_OPTIONS` and the
        // rest are execution hijacks wearing a configuration's clothes.
        let policy = self.process_policy();
        policy.check_command(&command).map_err(rpc_policy_refused)?;
        for key in env.keys() {
            policy.check_env(key).map_err(rpc_policy_refused)?;
        }
        self.state
            .processes
            .spawn(&command, &args, &env)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn stop_process(&self, ext: &RpcExtensions, id: String) -> RpcResult<()> {
        self.authorize(ext, "process.stop").await?;
        self.state
            .processes
            .stop(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn process_status(&self, ext: &RpcExtensions, id: String) -> RpcResult<ProcessStatus> {
        self.authorize(ext, "process.status").await?;
        self.state
            .processes
            .status(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn list_processes(&self, ext: &RpcExtensions) -> RpcResult<Vec<ProcessSummary>> {
        self.authorize(ext, "process.list").await?;
        // `list` hands back the record without its child handle; the summary is the
        // same facts in a type an RPC result (which must be clonable) can carry.
        Ok(self
            .state
            .processes
            .list()
            .await
            .iter()
            .map(ManagedProcess::summary)
            .collect())
    }

    async fn connect_mcp(
        &self,
        ext: &RpcExtensions,
        config: warsha_pipeline::mcp_transport::McpServerConfig,
    ) -> RpcResult<()> {
        self.authorize(ext, "mcp.connect").await?;
        // Audit H-05: an MCP server is a child process or an outbound endpoint, so the
        // same policy that bounds `process.spawn` bounds the transports here, and
        // stdio launches are restricted to pinned packages. An HTTP or WebSocket
        // server's URL is checked as a transport — TLS anywhere, plain http/ws only
        // on loopback.
        let policy = self.process_policy();
        match &config.transport {
            warsha_pipeline::mcp_transport::McpTransport::Stdio => {
                let command = config.command.as_deref().ok_or_else(|| {
                    rpc_policy_refused("a stdio MCP server names no program to start")
                })?;
                policy.check_command(command).map_err(rpc_policy_refused)?;
                wave2::require_pinned_launch(command, &config.args).map_err(rpc_policy_refused)?;
            }
            transport => {
                let url = transport.url().ok_or_else(|| {
                    rpc_policy_refused("an MCP transport names no endpoint to reach")
                })?;
                policy
                    .check_transport_url(url)
                    .map_err(rpc_policy_refused)?;
            }
        }
        // An `Http`/`WebSocket` config succeeds without connecting: the transport
        // is recorded and `mcp.list` reports it as disconnected (see
        // `McpServerConfig::is_wired`).
        self.state
            .mcp
            .connect(config)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn disconnect_mcp(&self, ext: &RpcExtensions, name: String) -> RpcResult<()> {
        self.authorize(ext, "mcp.disconnect").await?;
        self.state
            .mcp
            .disconnect(&name)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn list_mcp(&self, ext: &RpcExtensions) -> RpcResult<Vec<McpConnection>> {
        self.authorize(ext, "mcp.list").await?;
        Ok(self.state.mcp.list().await)
    }

    async fn send_mcp(
        &self,
        ext: &RpcExtensions,
        name: String,
        payload: String,
    ) -> RpcResult<String> {
        self.authorize(ext, "mcp.send").await?;
        // The raw seam is not a way around the permission table (R-KEEL row 6): a
        // `tools/call` frame is exactly the call `mcp.call` and the agent loop both
        // consult the table for, so it is refused before a byte reaches a child's
        // stdin. Every other method is the caller's own protocol and passes through
        // unchanged.
        refuse_a_permission_governed_frame(&payload)?;
        self.state
            .mcp
            .send(&name, &payload)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    /// Call one MCP tool on the owner's behalf (`mcp.call`).
    ///
    /// The table is consulted here exactly as the agent loop consults it (KEEL K6,
    /// R-KEEL row 6); without this, `mcp.call` would be the one path that reaches the
    /// transport with no `(server, tool, role)` check at all. The role is
    /// [`MCP_AGENT_ROLE`] and not a distinct `rpc` role on purpose: `agent` is the only
    /// role the daemon checks MCP calls under, so a second string would match none of
    /// the owner's existing rows and put every `mcp.call` at the default `Ask` — one
    /// table split into two rather than a boundary. There is no interactive approval on
    /// this path (the agent loop's ask queue belongs to the agent's turn), so `Ask` is
    /// refused with the grant the owner has to make rather than queued.
    async fn call_mcp(
        &self,
        ext: &RpcExtensions,
        name: String,
        tool: String,
        arguments: serde_json::Value,
    ) -> RpcResult<warsha_pipeline::mcp::McpToolResult> {
        self.authorize(ext, "mcp.call").await?;
        match self
            .state
            .mcp_permissions
            .check_permission(&name, &tool, MCP_AGENT_ROLE)
        {
            ToolPermission::Allow => {}
            ToolPermission::Deny => {
                return Err(rpc_policy_refused(format!(
                    "denied by MCP permission {name}::{tool}"
                )))
            }
            ToolPermission::Ask => {
                return Err(rpc_policy_refused(format!(
                    "`{name}::{tool}` is ask-gated for role `{MCP_AGENT_ROLE}` and `mcp.call` has no approval queue; grant it with mcp.permissions.set {{ server: \"{name}\", tool: \"{tool}\", role: \"{MCP_AGENT_ROLE}\", permission: \"allow\" }}"
                )))
            }
        }
        self.state
            .mcp
            .call_tool(&name, &tool, arguments)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn list_mcp_permissions(&self, ext: &RpcExtensions) -> RpcResult<McpPermissionsReply> {
        self.authorize(ext, "mcp.permissions.list").await?;
        let rows = self
            .state
            .mcp_permissions
            .snapshot()
            .into_iter()
            .map(|(server, tool, role, permission)| McpPermissionRow {
                server,
                tool,
                role,
                permission: permission.as_str().to_string(),
            })
            .collect();
        Ok(McpPermissionsReply {
            rows,
            agent_role: warsha_pipeline::MCP_AGENT_ROLE.to_string(),
            default_permission: warsha_pipeline::mcp_permission::ToolPermission::Ask
                .as_str()
                .to_string(),
        })
    }

    async fn set_mcp_permission(
        &self,
        ext: &RpcExtensions,
        server: String,
        tool: String,
        role: String,
        permission: String,
    ) -> RpcResult<McpPermissionRow> {
        self.authorize(ext, "mcp.permissions.set").await?;
        let permission = warsha_pipeline::mcp_permission::ToolPermission::parse_strict(&permission)
            .map_err(rpc_error)?;
        let updated_at = Utc::now().to_rfc3339();
        // Save first, then update memory: a write that failed must not leave the
        // running loop granting something the store does not hold.
        self.state
            .store
            .set_mcp_permission(&server, &tool, &role, permission.as_str(), &updated_at)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        self.state
            .mcp_permissions
            .set(&server, &tool, &role, permission);
        // The owner re-decided this key, so an answer they gave earlier no longer
        // stands: the pending entries the new row decides leave the list, and every
        // `allow_once` grant for the key is purged — whatever the value is, because
        // even `ask` means the earlier answer was overridden (D2.8, D3).
        self.state
            .mcp_approvals
            .resolve_by_row(&server, &tool, &role, permission);
        Ok(McpPermissionRow {
            server,
            tool,
            role,
            permission: permission.as_str().to_string(),
        })
    }

    async fn list_mcp_approvals(&self, ext: &RpcExtensions) -> RpcResult<Vec<McpApproval>> {
        self.authorize(ext, "mcp.approvals.list").await?;
        Ok(self
            .state
            .mcp_approvals
            .pending()
            .into_iter()
            .map(|view| McpApproval {
                id: view.id,
                run_id: view.run_id,
                server: view.server,
                tool: view.tool,
                role: view.role,
                summary: view.summary,
                requested_at: view.requested_at,
            })
            .collect())
    }

    async fn allow_once_mcp_approval(
        &self,
        ext: &RpcExtensions,
        id: String,
    ) -> RpcResult<McpApprovalAnswer> {
        let method = "mcp.approvals.allow_once";
        let actor = self.authorize(ext, method).await?;
        // The approver is the authenticated device, never a param: the same rule the
        // gate decisions and `agent.approve_mode` follow.
        let granted_by = self.gate_approver(&actor, None, method)?;

        let pending = self
            .state
            .mcp_approvals
            .pending()
            .into_iter()
            .find(|view| view.id == id)
            .ok_or_else(|| rpc_error(format!("no pending MCP approval has id `{id}`")))?;
        let run = self
            .state
            .store
            .get_run(
                pending
                    .run_id
                    .parse::<ulid::Ulid>()
                    .map(RunId)
                    .map_err(|error| {
                        rpc_error(format!("run id `{}` is not one: {error}", pending.run_id))
                    })?,
            )
            .await
            .map_err(rpc_error)?;

        // The record is written before the grant is issued, so a failed append is a
        // refused answer rather than an authorisation no audit trail carries.
        let event =
            mcp_approvals::allow_once_event(run.id, run.current_stage, &pending, granted_by);
        self.state
            .store
            .append_event(&event)
            .await
            .map_err(rpc_error)?;

        let grant = self
            .state
            .mcp_approvals
            .allow_once(&id, &granted_by.to_string())
            .map_err(|error| rpc_error(error.to_string()))?;
        info!(
            question_id = %grant.question_id,
            server = %grant.server,
            tool = %grant.tool,
            "mcp.approvals.allow_once granted a single-use call for the device the session authenticated"
        );
        Ok(McpApprovalAnswer::from(&grant))
    }

    // Live preview dev server (PLAN.md M5b + M20)
    //
    // A preview belongs to a project on the wire and to the run that started it in
    // the manager (R-BRIDGE-B5 D1). The wire is frozen (OD-B2), so the run context
    // a call arrives in is read here, from the store: a project's newest unfinished
    // run is the run a server started now belongs to, and the run whose server a
    // status call reports. With no live run the call is the project's, exactly as
    // before the run link existed.
    async fn start_preview(
        &self,
        ext: &RpcExtensions,
        project_id: String,
        command: String,
    ) -> RpcResult<LivePreview> {
        self.authorize(ext, "preview.start").await?;
        // The command line is quote-aware split by the pipeline (no shell) via
        // `split_command`, so a program or argument with spaces survives quoting.
        // The policy judges the program the pipeline will start, which is its
        // first token (audit H-05).
        let policy = self.process_policy();
        let (program, _) = warsha_pipeline::LivePreviewManager::split_command(&command)
            .map_err(|e| rpc_policy_refused(e.to_string()))?;
        policy.check_command(&program).map_err(rpc_policy_refused)?;
        let run_id = self.live_run_id(&project_id).await;
        self.state
            .previews
            .start(&project_id, &command, run_id.as_deref())
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn stop_preview(&self, ext: &RpcExtensions, project_id: String) -> RpcResult<()> {
        self.authorize(ext, "preview.stop").await?;
        self.state
            .previews
            .stop(&project_id)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn preview_status(
        &self,
        ext: &RpcExtensions,
        project_id: String,
    ) -> RpcResult<LivePreview> {
        self.authorize(ext, "preview.status").await?;
        let run_id = self.live_run_id(&project_id).await;
        self.state
            .previews
            .status(&project_id, run_id.as_deref())
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    // Settings that survive a restart (PLAN.md M20)
    async fn list_run_modes(&self, ext: &RpcExtensions) -> RpcResult<Vec<RunModeConfig>> {
        self.authorize(ext, "runmode.list").await?;
        // Mode order, not insertion order: the caller renders a switch, and a
        // switch whose rows move when one of them is saved is a switch that
        // reorders itself under the pointer.
        let modes = self.state.run_modes.read().await;
        Ok(RunMode::all()
            .into_iter()
            .filter_map(|mode| modes.get(&mode).cloned())
            .collect())
    }

    async fn set_run_mode(
        &self,
        ext: &RpcExtensions,
        config: RunModeConfig,
    ) -> RpcResult<RunModeConfig> {
        self.authorize(ext, "runmode.set").await?;
        // The rule a daemon has to pass before it binds is applied before the
        // config is stored: a mode that cannot be served is not a setting.
        config
            .validate()
            .map_err(|error| rpc_error(error.to_string()))?;
        self.state
            .settings
            .save_run_mode(&config)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        self.state
            .run_modes
            .write()
            .await
            .insert(config.mode, config.clone());
        Ok(config)
    }

    async fn get_backend(
        &self,
        ext: &RpcExtensions,
        run_id: String,
    ) -> RpcResult<Option<BackendKit>> {
        self.authorize(ext, "backend.get").await?;
        let (key, _project_name) = self.project_for_run(&run_id).await;
        // A project that never exported has no stored row, and reporting the
        // default as if it were one would invent a kit the owner never reviewed.
        // A kit set in this life does count: the owner asked for exactly that one.
        if let Some(kit) = self.state.backend_kits.read().await.get(&key) {
            return Ok(Some(kit.clone()));
        }
        self.state
            .settings
            .load_backend_kit(&key)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    async fn set_backend(
        &self,
        ext: &RpcExtensions,
        run_id: String,
        kit: BackendKit,
    ) -> RpcResult<()> {
        self.authorize(ext, "backend.set").await?;
        let (key, _project_name) = self.project_for_run(&run_id).await;
        self.remember_backend_kit(&key, &kit).await
    }

    async fn list_preferences(
        &self,
        ext: &RpcExtensions,
        project_id: String,
    ) -> RpcResult<Vec<Preference>> {
        self.authorize(ext, "preferences.list").await?;
        let preferences = self.state.stored_preferences.read().await;
        Ok(preferences
            .get(project_id.trim())
            .cloned()
            .unwrap_or_default())
    }

    async fn record_preference(
        &self,
        ext: &RpcExtensions,
        signal: PreferenceSignal,
    ) -> RpcResult<Vec<Preference>> {
        // A write on the read surface (re-audit N-8): the session's role decides whether
        // it may write, the tier is spent on the way in, and the actor is the verified one
        // rather than absent. The signal itself is unchanged on the wire.
        self.authorize(ext, "preferences.record").await?;
        let project_id = signal.project_id.trim().to_string();
        {
            let mut store = self.state.preferences.write().await;
            // The clock is what the decay is measured against, and it is not the
            // wall clock of the store: without this a signal recorded by a
            // long-running daemon would be scored against the last write.
            store.advance_to(now_epoch_secs());
            store
                .record_signal(signal)
                .map_err(|error| rpc_error(error.to_string()))?;
        }

        // The rows are the projection, so they are written before they are
        // reported: what this returns is what a restart would load.
        let memory = self.state.preferences.read().await.clone();
        self.state
            .settings
            .save_preferences(memory)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        let rows = self
            .state
            .settings
            .load_preferences(&project_id)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        self.state
            .stored_preferences
            .write()
            .await
            .insert(project_id, rows.clone());
        Ok(rows)
    }

    async fn list_pairings(&self, ext: &RpcExtensions) -> RpcResult<Vec<PhonePairing>> {
        self.authorize(ext, "pairing.list").await?;
        Ok(self.state.pairings.read().await.list())
    }

    async fn create_pairing(
        &self,
        ext: &RpcExtensions,
        device_id: String,
        secret: String,
    ) -> RpcResult<PhonePairing> {
        self.authorize(ext, "pairing.create").await?;
        let pairing = {
            let mut pairings = self.state.pairings.write().await;
            pairings
                .create(&device_id, &secret, now_epoch_secs())
                .map_err(|error| rpc_error(error.to_string()))?
        };
        self.save_pairings().await?;
        Ok(pairing)
    }

    async fn revoke_pairing(
        &self,
        ext: &RpcExtensions,
        device_id: String,
    ) -> RpcResult<PhonePairing> {
        self.authorize(ext, "pairing.revoke").await?;
        let pairing = {
            let mut pairings = self.state.pairings.write().await;
            pairings
                .revoke(&device_id)
                .map_err(|error| rpc_error(error.to_string()))?
        };
        self.save_pairings().await?;
        Ok(pairing)
    }

    async fn list_routines(&self, ext: &RpcExtensions) -> RpcResult<Vec<Routine>> {
        self.authorize(ext, "routines.list").await?;
        let registry = self.state.routines.read().await;
        Ok(registry.list().into_iter().cloned().collect())
    }

    async fn get_routine(&self, ext: &RpcExtensions, id: String) -> RpcResult<Option<Routine>> {
        self.authorize(ext, "routines.get").await?;
        let registry = self.state.routines.read().await;
        Ok(registry.get(&id).cloned())
    }

    async fn run_routine_now(&self, ext: &RpcExtensions, id: String) -> RpcResult<Routine> {
        self.authorize(ext, "routines.run_now").await?;
        self.state
            .routine_scheduler
            .run_now(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        let registry = self.state.routines.read().await;
        registry
            .get(&id)
            .cloned()
            .ok_or_else(|| rpc_error(format!("routine {id} not found")))
    }

    async fn pause_routine(&self, ext: &RpcExtensions, id: String) -> RpcResult<Routine> {
        self.authorize(ext, "routines.pause").await?;
        self.state
            .routine_scheduler
            .pause(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        let registry = self.state.routines.read().await;
        registry
            .get(&id)
            .cloned()
            .ok_or_else(|| rpc_error(format!("routine {id} not found")))
    }

    async fn resume_routine(&self, ext: &RpcExtensions, id: String) -> RpcResult<Routine> {
        self.authorize(ext, "routines.resume").await?;
        self.state
            .routine_scheduler
            .resume(&id)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        let registry = self.state.routines.read().await;
        registry
            .get(&id)
            .cloned()
            .ok_or_else(|| rpc_error(format!("routine {id} not found")))
    }

    async fn subscribe_run(
        &self,
        ext: &RpcExtensions,
        run_id: Option<RunId>,
        since_seq: Option<u64>,
    ) -> RpcResult<RunStreamSync> {
        self.authorize(ext, "runs.subscribe").await?;
        // No cursor means "start from where the stream is now", so nothing is replayed;
        // `0` means "everything the ring still holds".
        let sync = self.state.events.sync(since_seq.unwrap_or(0), run_id).await;
        let run = match run_id {
            Some(id) => self.state.store.get_run(id).await.ok(),
            None => None,
        };
        Ok(RunStreamSync {
            seq: sync.current_seq,
            gap_detected: sync.gap_detected,
            resync_required: sync.resync_required,
            dropped_count: sync.dropped_count,
            run,
            events: sync.frames,
        })
    }

    async fn advance_run(&self, ext: &RpcExtensions, run_id: RunId) -> RpcResult<Run> {
        self.authorize(ext, "runs.advance").await?;
        // No mock routing is seeded here: W5's pipeline dispatch answers an unrouted
        // role with the deterministic `FakeProvider` (or the env-configured model), so
        // a fresh daemon with no provider still advances a run offline with rich stage
        // artifacts. `advance_to_next_gate` walks the run to the next undecided gate
        // (passing approved ones) and marks a run that reaches `Feedback` completed.
        let run = self
            .state
            .pipeline
            .advance_to_next_gate(run_id)
            .await
            .map_err(rpc_error)?;

        // Record factory context on advance (F2)
        if let Ok(active_harness) = self
            .state
            .settings
            .get_active_harness(&run.project_id.to_string())
            .await
        {
            let harness_id = active_harness.unwrap_or_else(|| "autonomous-factory".to_string());
            let enabled_skills: Vec<String> = self
                .state
                .settings
                .list_skills()
                .await
                .unwrap_or_default()
                .into_iter()
                .filter(|s| s.enabled)
                .map(|s| s.id)
                .collect();
            let enabled_plugins: Vec<String> = self
                .state
                .settings
                .list_plugins()
                .await
                .unwrap_or_default()
                .into_iter()
                .filter(|p| p.enabled)
                .map(|p| p.id)
                .collect();

            tracing::info!(
                target: "audit",
                run_id = %run.id.0,
                stage = ?run.current_stage,
                harness = %harness_id,
                skills = ?enabled_skills,
                plugins = ?enabled_plugins,
                "run advance audit context"
            );
        }

        // The same rule `runs.cancel` follows, for the run that finishes instead of
        // being cancelled: a terminal run has no next call, so its last question and
        // any unspent grant are dead weight — and an unspent grant is an authority
        // nobody will be asked about again (D2.8).
        if matches!(
            run.status,
            RunStatus::Completed | RunStatus::Failed | RunStatus::Cancelled
        ) {
            self.state.mcp_approvals.purge_run(&run.id.0.to_string());
            // The run that just ended also stops the dev server it owns
            // (R-BRIDGE-B5 D2): a preview is a run's, not the project's, so it dies
            // with the run instead of being inherited by the next one. Best-effort
            // by construction — `stop_run` returns no error — so a dev server that
            // will not die is logged and never fails this close.
            self.state.previews.stop_run(&run.id.0.to_string()).await;
        }

        Ok(run)
    }

    async fn cancel_run(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        reason: Option<String>,
    ) -> RpcResult<Run> {
        self.authorize(ext, "runs.cancel").await?;
        let reason = Some(reason.unwrap_or_else(|| "Cancelled by user".to_string()));
        let cancelled = self
            .state
            .pipeline
            .cancel_run(run_id, reason)
            .await
            .map_err(rpc_error)?;
        // A cancelled run has no next call, so its pending questions and unspent
        // grants are dead weight — and an unspent grant is an authority nobody will
        // be asked about again (D2.8).
        self.state.mcp_approvals.purge_run(&run_id.0.to_string());
        // And the same close stops the preview it owns (R-BRIDGE-B5 D2), on the
        // same best-effort rule as the terminal arm above.
        self.state.previews.stop_run(&run_id.0.to_string()).await;
        Ok(cancelled)
    }

    async fn resume_run(&self, ext: &RpcExtensions, run_id: RunId) -> RpcResult<Run> {
        self.authorize(ext, "runs.resume").await?;
        self.state
            .pipeline
            .resume_run(run_id)
            .await
            .map_err(rpc_error)
    }

    async fn followup_run(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
        prompt: String,
    ) -> RpcResult<Run> {
        self.authorize(ext, "runs.followup").await?;
        let trimmed = prompt.trim();
        if trimmed.is_empty() {
            return Err(ErrorObject::owned(
                -32602,
                "runs.followup needs a non-empty prompt",
                None::<()>,
            ));
        }
        let ctrl = self.state.pipeline.control_for(run_id).await;
        let _state_guard = ctrl.state_lock.lock().await;
        if *ctrl.cancel_tx.borrow() {
            return Err(rpc_error("Cannot apply followup to a cancelled run"));
        }
        let (mut run, version) = self
            .state
            .store
            .get_run_versioned(run_id)
            .await
            .map_err(rpc_error)?;
        match run.status {
            RunStatus::Cancelled => {
                return Err(rpc_error("Cannot apply followup to a cancelled run"));
            }
            RunStatus::Completed | RunStatus::Failed => {
                return Err(rpc_error(format!(
                    "Cannot apply followup to a terminal ({:?}) run",
                    run.status
                )));
            }
            RunStatus::Running | RunStatus::Paused => {}
        }
        let content = format!(
            "Follow-up applied at stage {:?}: {}",
            run.current_stage, trimmed
        );
        let now = Utc::now();
        run.updated_at = now;
        run.artifacts.insert(
            "followup".to_string(),
            Artifact {
                name: "followup".to_string(),
                content: content.clone(),
                stage: run.current_stage,
                role: None,
                created_at: now,
                updated_at: now,
                version: 1,
            },
        );
        self.state
            .store
            .update_run_cas(&run, version)
            .await
            .map_err(rpc_error)?;
        // Persist the durable artifact file and event log only after the CAS state update succeeds.
        self.state
            .store
            .write_artifact(run.project_id, "followup", &content)
            .await
            .map_err(rpc_error)?;
        let event = Event {
            id: ulid::Ulid::new(),
            run_id,
            stage: run.current_stage,
            role: None,
            kind: EventKind::AgentStep,
            payload: serde_json::json!({
                "action": "followup",
                "prompt": trimmed,
                "response": content,
            }),
            cost_cents: None,
            tokens: None,
            created_at: now,
            device_id: None,
        };
        self.state
            .store
            .append_event(&event)
            .await
            .map_err(rpc_error)?;
        Ok(run)
    }

    async fn list_run_artifacts(
        &self,
        ext: &RpcExtensions,
        run_id: RunId,
    ) -> RpcResult<Vec<Artifact>> {
        self.authorize(ext, "runs.artifacts").await?;
        let run = self.state.store.get_run(run_id).await.map_err(rpc_error)?;
        let mut artifacts: Vec<Artifact> = run.artifacts.values().cloned().collect();
        artifacts.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(artifacts)
    }

    // ============================================== Wave 2 (harnesses, skills,
    // plugins, custom models, integrations, files)
    //
    // Six surfaces, one shape of method: `authorize` first, then read or write the
    // [`SettingsStore`] row, then answer with the record the *stored* row decodes to.
    // That last half is the rule the whole batch follows — a method never returns the
    // value the caller handed it if the store would have kept something else, so a
    // reply is a promise a restart can check. Secret material is the exception by
    // design: it is filed in the OS keychain and the row keeps a reference, so a
    // reply carries the reference and never the value.
    //
    // Refusals split the same way everywhere: `-32602` when the caller's document or
    // path is what is wrong, `-32000` when the daemon's own store, keychain or
    // filesystem failed.

    async fn list_harnesses(&self, ext: &RpcExtensions) -> RpcResult<Vec<HarnessDefinition>> {
        self.authorize(ext, "harness.list").await?;
        let active_id = self
            .state
            .settings
            .get_active_harness(ACTIVE_HARNESS_GLOBAL_KEY)
            .await
            .map_err(rpc_error)?
            .unwrap_or_else(|| "autonomous-factory".to_string());
        let rows = self
            .state
            .settings
            .list_harnesses()
            .await
            .map_err(rpc_error)?;
        Ok(rows
            .iter()
            .map(|row| {
                let mut def = wave2::harness_definition(row);
                def.active = def.id == active_id;
                def
            })
            .collect())
    }

    async fn get_harness(&self, ext: &RpcExtensions, id: String) -> RpcResult<HarnessDefinition> {
        self.authorize(ext, "harness.get").await?;
        let active_id = self
            .state
            .settings
            .get_active_harness(ACTIVE_HARNESS_GLOBAL_KEY)
            .await
            .map_err(rpc_error)?
            .unwrap_or_else(|| "autonomous-factory".to_string());
        let mut def = wave2::harness_definition(&self.stored_harness(&id).await?);
        def.active = def.id == active_id;
        Ok(def)
    }

    async fn import_harness(
        &self,
        ext: &RpcExtensions,
        content: String,
        format: Option<String>,
    ) -> RpcResult<HarnessDefinition> {
        self.authorize(ext, "harness.import").await?;
        let definition =
            wave2::parse_harness_import(&content, format.as_deref()).map_err(rpc_invalid_params)?;
        let row = wave2::harness_row(&definition).map_err(rpc_error)?;
        self.state
            .settings
            .save_harness(&row)
            .await
            .map_err(rpc_error)?;
        let active_id = self
            .state
            .settings
            .get_active_harness(ACTIVE_HARNESS_GLOBAL_KEY)
            .await
            .map_err(rpc_error)?
            .unwrap_or_else(|| "autonomous-factory".to_string());
        let mut def = wave2::harness_definition(&self.stored_harness(&row.id).await?);
        def.active = def.id == active_id;
        Ok(def)
    }

    /// Point a project — or, with no project, the daemon as a whole — at a harness.
    ///
    /// The selection is stored under the project id, and `global` is the key an
    /// unprojected run reads, so a browser that has not picked a project yet can
    /// still set the default its first run will use. Selecting a name that is not
    /// installed is refused here rather than at the first gate: a run that starts
    /// against a harness nobody has would fail in the middle of spending, and the
    /// owner would learn about it from a pipeline rather than from a settings screen.
    async fn select_harness(
        &self,
        ext: &RpcExtensions,
        harness_id: String,
        project_id: Option<String>,
    ) -> RpcResult<()> {
        self.authorize(ext, "harness.select").await?;
        self.stored_harness(&harness_id).await?;
        let key = project_id
            .as_deref()
            .map(str::trim)
            .filter(|project| !project.is_empty())
            .unwrap_or(ACTIVE_HARNESS_GLOBAL_KEY);
        self.state
            .settings
            .set_active_harness(key, &harness_id)
            .await
            .map_err(rpc_error)
    }

    /// Remove a user-authored harness.
    ///
    /// A bundled preset is refused: the seed at daemon start would write it back, and
    /// a delete that quietly undoes itself at the next restart is a worse answer than
    /// one that says which rows it cannot remove. The `global` selection is cleared
    /// when it named the harness being removed, because that is the one key this
    /// method can read; per-project selections are left alone (the store has no way to
    /// enumerate them) and `harness.get` is what tells a run that its selection is
    /// gone.
    async fn delete_harness(&self, ext: &RpcExtensions, id: String) -> RpcResult<()> {
        self.authorize(ext, "harness.delete").await?;
        let stored = self.stored_harness(&id).await?;
        if stored.is_preset {
            return Err(rpc_invalid_params(format!(
                "`{id}` is a bundled harness; harness.delete removes the ones you imported, \
                 and a preset returns at the next start because the daemon ships it"
            )));
        }
        self.state
            .settings
            .delete_harness(&id)
            .await
            .map_err(rpc_error)?;
        if self
            .state
            .settings
            .get_active_harness(ACTIVE_HARNESS_GLOBAL_KEY)
            .await
            .map_err(rpc_error)?
            .as_deref()
            == Some(id.as_str())
        {
            self.state
                .settings
                .clear_active_harness(ACTIVE_HARNESS_GLOBAL_KEY)
                .await
                .map_err(rpc_error)?;
        }
        Ok(())
    }

    /// The installed skills, in the shape the owner manages them in.
    ///
    /// Every row, enabled or not: a screen that could only see the enabled ones could
    /// not switch one back on. `skill_catalog()` remains the in-process registry the
    /// agent loop runs, built from exactly these rows with the disabled ones dropped.
    async fn list_skills(&self, ext: &RpcExtensions) -> RpcResult<Vec<SkillDefinition>> {
        self.authorize(ext, "skills.list").await?;
        let rows = self.state.settings.list_skills().await.map_err(rpc_error)?;
        let mut skills = Vec::with_capacity(rows.len());
        for row in &rows {
            skills.push(wave2::skill_definition(row).map_err(rpc_error)?);
        }
        Ok(skills)
    }

    async fn import_skill(
        &self,
        ext: &RpcExtensions,
        url_or_content: String,
        name: Option<String>,
    ) -> RpcResult<SkillDefinition> {
        self.authorize(ext, "skills.import").await?;
        let definition = wave2::parse_skill_import(&url_or_content, name.as_deref())
            .map_err(rpc_invalid_params)?;
        let row = wave2::skill_row(&definition).map_err(rpc_error)?;
        self.state
            .settings
            .save_skill(&row)
            .await
            .map_err(rpc_error)?;
        let stored = self
            .state
            .settings
            .get_skill(&row.id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| {
                rpc_error(format!(
                    "the skill `{}` was not in the store after saving",
                    row.id
                ))
            })?;
        wave2::skill_definition(&stored).map_err(rpc_error)
    }

    /// Set one skill's flag to the value the caller named.
    ///
    /// The store's `toggle_skill` *flips*, which is what a keyboard shortcut wants and
    /// is not what an `enabled: bool` parameter is: flipping a skill that is already
    /// in the requested state would switch it off. So the row is read, and flipped only
    /// when the flip is the change asked for.
    async fn toggle_skill(
        &self,
        ext: &RpcExtensions,
        id: String,
        enabled: bool,
    ) -> RpcResult<SkillDefinition> {
        self.authorize(ext, "skills.toggle").await?;
        let row = self.stored_skill(&id).await?;
        if row.enabled != enabled {
            self.state
                .settings
                .toggle_skill(&id)
                .await
                .map_err(rpc_error)?;
        }
        let stored = self
            .state
            .settings
            .get_skill(&id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| {
                rpc_error(format!(
                    "the skill `{id}` vanished while it was being enabled"
                ))
            })?;
        wave2::skill_definition(&stored).map_err(rpc_error)
    }

    async fn delete_skill(&self, ext: &RpcExtensions, id: String) -> RpcResult<()> {
        self.authorize(ext, "skills.delete").await?;
        self.stored_skill(&id).await?;
        self.state
            .settings
            .delete_skill(&id)
            .await
            .map_err(rpc_error)?;
        Ok(())
    }

    async fn list_plugins(&self, ext: &RpcExtensions) -> RpcResult<Vec<PluginDefinition>> {
        self.authorize(ext, "plugins.list").await?;
        let rows = self
            .state
            .settings
            .list_plugins()
            .await
            .map_err(rpc_error)?;
        let mut plugins = Vec::with_capacity(rows.len());
        for row in &rows {
            plugins.push(wave2::plugin_definition(row).map_err(rpc_error)?);
        }
        Ok(plugins)
    }

    async fn install_plugin(
        &self,
        ext: &RpcExtensions,
        manifest_json_or_url: String,
    ) -> RpcResult<PluginDefinition> {
        self.authorize(ext, "plugins.install").await?;
        let mut definition =
            wave2::parse_plugin_manifest(&manifest_json_or_url).map_err(rpc_invalid_params)?;
        // KEEL K5b: the pack's program is judged before its environment is filed
        // and before any row exists, so a refused pack leaves nothing behind.
        self.check_plugin_launch(&definition)?;
        // A manifest may name a token outright, and this is the seam that decides
        // where it lives: the keychain holds the value, the row holds the reference.
        let env = self
            .file_plugin_env(&definition.id, &definition.env)
            .await?;
        definition.env = env;
        let row = wave2::plugin_row(&definition).map_err(rpc_error)?;
        self.state
            .settings
            .save_plugin(&row)
            .await
            .map_err(rpc_error)?;
        let stored = self
            .state
            .settings
            .get_plugin(&row.id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| {
                rpc_error(format!(
                    "the plugin `{}` was not in the store after saving",
                    row.id
                ))
            })?;
        wave2::plugin_definition(&stored).map_err(rpc_error)
    }

    async fn toggle_plugin(
        &self,
        ext: &RpcExtensions,
        id: String,
        enabled: bool,
    ) -> RpcResult<PluginDefinition> {
        self.authorize(ext, "plugins.toggle").await?;
        let row = self.stored_plugin(&id).await?;
        let checked = wave2::plugin_definition(&row).map_err(rpc_error)?;
        // Enabling is the moment a row becomes a process. A row written before
        // this check existed must not launch a program — or fetch a package — the
        // policy would refuse today; disabling only stops a process and is always
        // allowed (KEEL K5b).
        let mut launch_env = HashMap::new();
        if enabled {
            self.check_plugin_launch(&checked)?;
            launch_env = self.resolved_plugin_env(&checked).await?;
        }
        // Whether this call is the one that rewrites the row — the flag the rollback below
        // keys on, because a toggle to the state the row already has wrote nothing to undo.
        let flipped = row.enabled != enabled;
        if flipped {
            self.state
                .settings
                .toggle_plugin(&id)
                .await
                .map_err(rpc_error)?;
        }
        let updated = self.stored_plugin(&id).await?;
        let def = wave2::plugin_definition(&updated).map_err(rpc_error)?;
        // Sync with MCP manager (F2). The child gets exactly the pack's resolved
        // environment on top of the process manager's floor; its failure is the
        // RPC's failure, not a warning in a log nobody reads.
        if enabled && def.transport == "stdio" {
            if let Some(cmd) = &def.command {
                if !cmd.trim().is_empty() {
                    let mcp_cfg = warsha_pipeline::mcp_transport::McpServerConfig::new_stdio(
                        &def.id,
                        cmd,
                        def.args.clone(),
                    );
                    if let Err(error) = self
                        .state
                        .mcp
                        .connect_with(
                            mcp_cfg,
                            warsha_pipeline::mcp_transport::McpLaunchOptions::with_env(launch_env),
                        )
                        .await
                    {
                        // The row was persisted before the spawn, so a connect that fails
                        // would leave it saying `enabled` with no process behind it, and
                        // nothing re-derives that until the next toggle (R-KEEL
                        // checkpoint row 16). Restore the state the row had before this
                        // call — and still return the connect's own error, which is the
                        // RPC's contract. A rollback that fails too is named inside that
                        // error rather than swallowed.
                        let rollback = if flipped {
                            self.state.settings.toggle_plugin(&id).await.err()
                        } else {
                            None
                        };
                        return Err(match rollback {
                            None => rpc_error(error.to_string()),
                            Some(rollback_error) => rpc_error(format!(
                                "{error} (the row could not be put back the way it was: \
                                 {rollback_error})"
                            )),
                        });
                    }
                }
            }
        } else if !enabled
            && def.transport == "stdio"
            && def
                .command
                .as_deref()
                .map(|c| !c.trim().is_empty())
                .unwrap_or(false)
        {
            if let Err(error) = self.state.mcp.disconnect(&def.id).await {
                // The mirror of the connect above, in the other direction (R-KEEL
                // checkpoint row 16, the disable half): the row was persisted
                // `disabled` before the child was stopped, so a disconnect that fails
                // would leave it saying disabled with a live process behind it, and
                // nothing re-derives that until the next toggle. Restore the state the
                // row had before this call — and still return the disconnect's own
                // error, which is the RPC's contract.
                let rollback = if flipped {
                    self.state.settings.toggle_plugin(&id).await.err()
                } else {
                    None
                };
                return Err(match rollback {
                    None => rpc_error(error.to_string()),
                    Some(rollback_error) => rpc_error(format!(
                        "{error} (the row could not be put back the way it was: \
                         {rollback_error})"
                    )),
                });
            }
        }
        Ok(def)
    }

    /// Replace a pack's environment map, filing anything secret in the keychain.
    ///
    /// The map the caller sends is the whole map, not a patch: a key that was there
    /// and is not named now is gone from the row, and the keychain entry beside it is
    /// left for the next `configure` of that key to overwrite — a remove of an entry
    /// this method cannot see the owner asking for would be a delete nobody requested.
    async fn configure_plugin(
        &self,
        ext: &RpcExtensions,
        id: String,
        env: HashMap<String, String>,
    ) -> RpcResult<PluginDefinition> {
        self.authorize(ext, "plugins.configure").await?;
        let mut row = self.stored_plugin(&id).await?;
        // KEEL K5b: judge the program and the variable names before a value is
        // filed in the keychain or the row is rewritten. A refused configure must
        // not leave half its environment stored.
        let mut candidate = wave2::plugin_definition(&row).map_err(rpc_error)?;
        candidate.env = env.clone();
        self.check_plugin_launch(&candidate)?;
        let references = self.file_plugin_env(&id, &env).await?;
        // The row is about to lose its previous environment, so keep it: a connect with the
        // new one that fails must not leave the row describing a child that was never
        // started (R-KEEL checkpoint row 16, the `configure` half).
        let previous_env_json = row.env_json.clone();
        row.env_json = serde_json::to_string(&references).map_err(rpc_error)?;
        self.state
            .settings
            .save_plugin(&row)
            .await
            .map_err(rpc_error)?;
        let updated = self.stored_plugin(&id).await?;
        let def = wave2::plugin_definition(&updated).map_err(rpc_error)?;
        // Sync with MCP manager if enabled (F2), with the references resolved
        // against the keychain only now, for this one child.
        if def.enabled && def.transport == "stdio" {
            if let Some(cmd) = &def.command {
                if !cmd.trim().is_empty() {
                    let launch_env = self.resolved_plugin_env(&def).await?;
                    let mcp_cfg = warsha_pipeline::mcp_transport::McpServerConfig::new_stdio(
                        &def.id,
                        cmd,
                        def.args.clone(),
                    );
                    if let Err(error) = self
                        .state
                        .mcp
                        .connect_with(
                            mcp_cfg,
                            warsha_pipeline::mcp_transport::McpLaunchOptions::with_env(launch_env),
                        )
                        .await
                    {
                        // Put the previous environment back: the caller still gets the
                        // connect's error, but the row is not left naming an environment
                        // whose child never started. The keychain entries the new
                        // environment filed stay, for the next configure of those keys to
                        // overwrite — the same rule a key this call stopped naming follows.
                        row.env_json = previous_env_json;
                        let rollback = self.state.settings.save_plugin(&row).await.err();
                        return Err(match rollback {
                            None => rpc_error(error.to_string()),
                            Some(rollback_error) => rpc_error(format!(
                                "{error} (the previous environment could not be restored: \
                                 {rollback_error})"
                            )),
                        });
                    }
                }
            }
        }
        Ok(def)
    }

    async fn remove_plugin(&self, ext: &RpcExtensions, id: String) -> RpcResult<()> {
        self.authorize(ext, "plugins.remove").await?;
        let row = self.stored_plugin(&id).await?;
        // Keychain first, exactly as `providers.remove` does it: a row deleted while
        // its secrets stayed behind would be an address nothing could reach again.
        let def = wave2::plugin_definition(&row).map_err(rpc_error)?;
        for account in wave2::filed_secret_accounts(&def.env) {
            self.state.secrets.delete(&account).await.map_err(|error| {
                rpc_error(format!(
                    "the secret `{account}` could not be removed from the OS keychain: {error}"
                ))
            })?;
        }
        self.state
            .settings
            .delete_plugin(&id)
            .await
            .map_err(rpc_error)?;
        Ok(())
    }

    async fn list_custom_models(
        &self,
        ext: &RpcExtensions,
        provider: Option<String>,
    ) -> RpcResult<Vec<CustomModelRecord>> {
        self.authorize(ext, "models.list").await?;
        let rows = self
            .state
            .settings
            .list_custom_models()
            .await
            .map_err(rpc_error)?;
        let wanted = provider
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string);
        Ok(rows
            .iter()
            .map(wave2::custom_model_record)
            .filter(|record| match &wanted {
                Some(name) => &record.provider == name,
                None => true,
            })
            .collect())
    }

    /// Register one model by hand under one provider.
    ///
    /// The pair `(provider, model_id)` is the key, so this is an upsert: the second
    /// call with the same pair is the owner correcting a label or a window, not a
    /// second row. The provider does not have to be configured yet — an owner who
    /// knows the model id they want can write it down before the key arrives, and
    /// routing is what fails later, honestly, with its own refusal.
    async fn add_custom_model(
        &self,
        ext: &RpcExtensions,
        provider: String,
        model_id: String,
        display_name: Option<String>,
        context_window: Option<u32>,
    ) -> RpcResult<CustomModelRecord> {
        self.authorize(ext, "models.add").await?;
        if provider.trim().is_empty() || model_id.trim().is_empty() {
            return Err(rpc_invalid_params(
                "models.add needs both a provider and a model id: the pair is the row's key",
            ));
        }
        let record = CustomModelRecord {
            provider: provider.trim().to_string(),
            model_id: model_id.trim().to_string(),
            display_name: display_name
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty()),
            context_window,
            enabled: true,
        };
        self.state
            .settings
            .save_custom_model(&wave2::custom_model_row(&record))
            .await
            .map_err(rpc_error)?;
        let stored = self
            .state
            .settings
            .get_custom_model(&record.provider, &record.model_id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| rpc_error("the custom model was not in the store after saving"))?;
        Ok(wave2::custom_model_record(&stored))
    }

    async fn remove_custom_model(
        &self,
        ext: &RpcExtensions,
        provider: String,
        model_id: String,
    ) -> RpcResult<()> {
        self.authorize(ext, "models.remove").await?;
        self.state
            .settings
            .delete_custom_model(&provider, &model_id)
            .await
            .map_err(rpc_error)?;
        Ok(())
    }

    async fn list_integrations(&self, ext: &RpcExtensions) -> RpcResult<Vec<IntegrationStatus>> {
        self.authorize(ext, "integrations.list").await?;
        self.integration_statuses().await
    }

    /// Connect one external service.
    ///
    /// The token halves of the config ride the write once and are then gone from the
    /// daemon's view of the row: they are filed under `integration:{id}` and
    /// `integration:{id}:bot`, and what the settings database keeps is the non-secret
    /// half. `connected` therefore means "this daemon holds a credential or a webhook
    /// for it", which is the strongest claim a daemon that has not opened a socket can
    /// honestly make.
    async fn connect_integration(
        &self,
        ext: &RpcExtensions,
        id: String,
        config: IntegrationConfig,
    ) -> RpcResult<IntegrationStatus> {
        self.authorize(ext, "integrations.connect").await?;
        let id = id.trim().to_string();
        if id.is_empty() {
            return Err(rpc_invalid_params(
                "integrations.connect needs an integration id to file the configuration under",
            ));
        }
        let token_account = wave2::integration_secret_account(&id);
        let bot_account = wave2::integration_bot_secret_account(&id);
        match config
            .token
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            Some(token) => self
                .state
                .secrets
                .store(&token_account, token)
                .await
                .map_err(|e| {
                    rpc_error(format!(
                        "the token could not be stored in the OS keychain: {e}"
                    ))
                })?,
            None => self
                .state
                .secrets
                .delete(&token_account)
                .await
                .map_err(|e| rpc_error(format!("the stale token could not be removed: {e}")))?,
        }
        match config
            .bot_token
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
        {
            Some(bot_token) => self
                .state
                .secrets
                .store(&bot_account, bot_token)
                .await
                .map_err(|e| {
                    rpc_error(format!(
                        "the bot token could not be stored in the OS keychain: {e}"
                    ))
                })?,
            None => {
                self.state.secrets.delete(&bot_account).await.map_err(|e| {
                    rpc_error(format!("the stale bot token could not be removed: {e}"))
                })?
            }
        }

        let stored_token = config
            .token
            .as_deref()
            .map(str::trim)
            .is_some_and(|t| !t.is_empty());
        let stored_bot = config
            .bot_token
            .as_deref()
            .map(str::trim)
            .is_some_and(|t| !t.is_empty());
        let webhook = config
            .webhook_url
            .as_deref()
            .map(str::trim)
            .is_some_and(|url| !url.is_empty());
        let redacted = wave2::redact_config(&config);
        let name = match self
            .state
            .settings
            .get_integration(&id)
            .await
            .map_err(rpc_error)?
        {
            Some(row) if !row.name.trim().is_empty() => row.name,
            _ => wave2::integration_name(&id),
        };
        let row = wave2::integration_row(
            &id,
            &name,
            stored_token || stored_bot || webhook,
            &redacted,
            Some(now_epoch_secs()),
        )
        .map_err(rpc_error)?;
        self.state
            .settings
            .save_integration(&row, Some(&row.config_json))
            .await
            .map_err(rpc_error)?;
        self.integration_status_of(&id).await
    }

    /// Disconnect one service: the credentials go, the shape stays.
    ///
    /// The workspace, channel and webhook the owner typed are kept so a re-connect is
    /// one token away rather than a form refilled, and `connected` is written false
    /// because the daemon no longer holds anything to connect with.
    async fn disconnect_integration(
        &self,
        ext: &RpcExtensions,
        id: String,
    ) -> RpcResult<IntegrationStatus> {
        self.authorize(ext, "integrations.disconnect").await?;
        let row = self.stored_integration(&id).await?;
        for account in [
            wave2::integration_secret_account(&row.id),
            wave2::integration_bot_secret_account(&row.id),
        ] {
            self.state.secrets.delete(&account).await.map_err(|e| {
                rpc_error(format!(
                    "the credential could not be removed from the OS keychain: {e}"
                ))
            })?;
        }
        let config = wave2::integration_config(&row).map_err(rpc_error)?;
        let disconnected =
            wave2::integration_row(&row.id, &row.name, false, &config, row.configured_at)
                .map_err(rpc_error)?;
        self.state
            .settings
            .save_integration(&disconnected, Some(&disconnected.config_json))
            .await
            .map_err(rpc_error)?;
        self.integration_status_of(&row.id).await
    }

    /// Report what a daemon that opens no socket can know about an integration.
    ///
    /// This is the one method under the Spend tier, and the reason it does not spend:
    /// a check that reached GitHub or Slack would be the daemon using an owner's quota
    /// on their behalf, and this batch's rule is that no RPC quietly goes to a third
    /// party. So `ok` means "the configuration is complete and filed" and `unconfigured`
    /// names the half that is missing — and neither word claims a connection was made.
    /// A future live probe is a separate decision with its own budget, not a detail of
    /// this method.
    async fn test_integration(
        &self,
        ext: &RpcExtensions,
        id: String,
    ) -> RpcResult<IntegrationTestResult> {
        self.authorize(ext, "integrations.test").await?;
        let row = self.stored_integration(&id).await?;
        let config = wave2::integration_config(&row).map_err(rpc_error)?;
        let has_token = self
            .state
            .secrets
            .load(&wave2::integration_secret_account(&row.id))
            .await
            .is_ok();
        let has_bot_token = self
            .state
            .secrets
            .load(&wave2::integration_bot_secret_account(&row.id))
            .await
            .is_ok();
        let has_webhook = config
            .webhook_url
            .as_ref()
            .map(|url| !url.trim().is_empty())
            .unwrap_or(false);
        let missing: Vec<&str> = match row.id.as_str() {
            "github" => {
                if !has_token {
                    vec!["an access token"]
                } else {
                    Vec::new()
                }
            }
            "slack" => {
                if !has_webhook && !has_bot_token {
                    vec!["a webhook URL or bot token"]
                } else {
                    Vec::new()
                }
            }
            _ => {
                if !has_token && !has_webhook && !has_bot_token {
                    vec!["an access token, webhook URL, or bot token"]
                } else {
                    Vec::new()
                }
            }
        };
        Ok(IntegrationTestResult {
            status: if missing.is_empty() {
                "ok".to_string()
            } else {
                "unconfigured".to_string()
            },
            message: if missing.is_empty() {
                format!(
                    "`{}` is configured and its credential is filed in the OS keychain; \
                     no live request was made, so this says nothing about the service",
                    row.id
                )
            } else {
                format!(
                    "`{}` is missing {}: integrations.connect writes the configuration, \
                     and no live request is made from here",
                    row.id,
                    missing.join(" or ")
                )
            },
        })
    }

    async fn list_project_files(
        &self,
        ext: &RpcExtensions,
        project_id: String,
        path: Option<String>,
    ) -> RpcResult<Vec<FileEntry>> {
        self.authorize(ext, "files.tree").await?;
        let root = self.project_files_root(&project_id).await;
        let dir = match path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(relative) => {
                let joined = wave2::safe_join(&root, relative).map_err(rpc_invalid_params)?;
                wave2::resolve_inside(&root, &joined).map_err(rpc_invalid_params)?
            }
            None => root.clone(),
        };
        wave2::list_tree(&root, &dir).map_err(rpc_error)
    }

    async fn read_project_file(
        &self,
        ext: &RpcExtensions,
        project_id: String,
        path: String,
    ) -> RpcResult<FileContent> {
        self.authorize(ext, "files.read").await?;
        let root = self.project_files_root(&project_id).await;
        let joined = wave2::safe_join(&root, &path).map_err(rpc_invalid_params)?;
        let file = wave2::resolve_inside(&root, &joined).map_err(rpc_invalid_params)?;
        wave2::read_text(&root, &file).map_err(rpc_error)
    }
}

/// The store's answer to "is this run still live", for the preview manager.
///
/// `warsha-pipeline` owns the preview entries and knows nothing about run records,
/// so the daemon hands it this oracle (R-BRIDGE-B5 D3). A run the store still has
/// and that has not finished is live, and its preview is not another run's to take.
/// A run the store no longer has, an id that is not a run id, or a store read that
/// fails is *not* live: a preview entry whose owner cannot be proved alive is
/// swept, which is what keeps a new run on the project from inheriting a server a
/// dead run left behind.
struct StoreRunLiveness {
    store: Arc<Store>,
}

#[async_trait]
impl warsha_pipeline::RunLiveness for StoreRunLiveness {
    async fn is_live(&self, run_id: &str) -> bool {
        let Ok(id) = run_id.parse::<ulid::Ulid>() else {
            return false;
        };
        match self.store.get_run(RunId(id)).await {
            Ok(run) => !matches!(
                run.status,
                RunStatus::Completed | RunStatus::Failed | RunStatus::Cancelled
            ),
            Err(_) => false,
        }
    }
}

/// Directory under the daemon's data directory that holds handoff bundles.
const HANDOFF_DIR: &str = "handoff";

/// The selection key a harness carries when no project was named.
///
/// `harnesses_active` is keyed by a text id and every other caller in this module uses
/// a project's UUID; `global` is the one key that cannot collide with a UUID, so the
/// daemon-wide default and a project's override live in the same table without either
/// pretending to be the other. A project id that a caller *does* pass is used verbatim
/// as its key, which is what `harness.select` from a browser and a run's own project
/// both read.
const ACTIVE_HARNESS_GLOBAL_KEY: &str = "global";

/// The local PocketBase address PLAN.md M19 documents for a generated project.
const LOCAL_POCKETBASE_URL: &str = "http://127.0.0.1:8090";

/// The backend kit a project starts from until it exports or sets one of its own.
///
/// PocketBase is the PLAN's preferred backend, and the project name is what the
/// export header and the storage archive stem are made of.
fn default_backend_kit(project_name: &str) -> BackendKit {
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

    // The wiring side owns the environment selection: the pipeline never reads
    // `WARSHA_CODING_BACKEND` or names a backend, it only accepts an injected one.
    if let Some(backend) = BackendFactory::from_env() {
        pipeline = pipeline.with_coding_backend(Arc::from(backend));
    }
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
    let mcp: Arc<dyn McpManager> = Arc::new(InMemoryMcpManager::new(processes.clone()));
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
    let bind = resolve_bind_host(&config)?;
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
    let allowed_origins = config
        .allowed_origins
        .clone()
        .into_iter()
        .filter_map(|o| o.parse::<axum::http::HeaderValue>().ok())
        .collect::<Vec<axum::http::HeaderValue>>();
    let rpc_cors = CorsLayer::new()
        .allow_origin(allowed_origins.clone())
        .allow_methods(Any)
        .allow_headers(Any);
    let rpc_auth_layer = RpcAuthLayer {
        state: state.clone(),
    };
    let rpc_server = ServerBuilder::default()
        .set_http_middleware(
            tower::ServiceBuilder::new()
                .layer(rpc_cors)
                .layer(rpc_auth_layer),
        )
        .build(rpc_addr)
        .await
        .map_err(|e| DaemonError::Config(format!("could not bind RPC server: {e}")))?;
    let actual_rpc_port = rpc_server.local_addr()?.port();
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
fn write_private_file(path: &Path, content: &str) -> std::io::Result<()> {
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
    Ok(apply_env_overrides(config))
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
fn apply_env_overrides(mut config: DaemonConfig) -> DaemonConfig {
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
    config
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

// `SlashCommandRegistry` has no non-test reader now that the skill-registry helpers
// live in `skills` (P-H1 A2); the test modules below still name it via `use super::*`.
#[cfg(test)]
use warsha_pipeline::SlashCommandRegistry;

// The auth layer's own pieces that only the test modules below name (P-H1 A3):
// production code reaches the rest through the crate-root import above.
#[cfg(test)]
use auth::{origin_allowed, RpcAuthService};
#[cfg(test)]
use axum::extract::ConnectInfo;
#[cfg(test)]
use jsonrpsee::core::BoxError;
#[cfg(test)]
use jsonrpsee::server::{HttpRequest, HttpResponse};

// The skill-registry helpers the test modules below name through `use super::*`
// (P-H1 A2/A8): production code reaches the rest through the crate-root imports above.
#[cfg(test)]
use skills::*;
#[cfg(test)]
use warsha_pipeline::SlashCommand;
#[cfg(test)]
use warsha_store::{StoredHarness, StoredPlugin, StoredSkill};

#[cfg(test)]
mod tests {
    use super::*;
    use warsha_providers::InMemorySecretStore;

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
        let providers = Arc::new(RwLock::new(agent_router_with_mock()));
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
        let mut pipeline = warsha_pipeline::PipelineEngine::new(
            store.clone(),
            providers.clone(),
            settings.clone(),
        );

        // The wiring side owns the environment selection: the pipeline never reads
        // `WARSHA_CODING_BACKEND` or names a backend, it only accepts an injected one.
        if let Some(backend) = BackendFactory::from_env() {
            pipeline = pipeline.with_coding_backend(Arc::from(backend));
        }
        let pipeline = Arc::new(pipeline);
        let identity = warsha_remote::DeviceIdentity::generate("test daemon".to_string())
            .expect("a device identity");

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
            LivePreviewManager::new(processes.clone()).with_run_liveness(Arc::new(
                StoreRunLiveness {
                    store: store.clone(),
                },
            )),
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
            devices: Arc::new(DeviceRegistry::new(identity)),
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
            repo_path: None,
            repo_url: None,
        };
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state.clone());
        let run = rpc
            .start_run(&owner_ext(), project.id, "An agent turn".to_string())
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
        // until someone remembers to write one.
        let source = include_str!("api.rs");
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
        let device = warsha_remote::DeviceIdentity::generate("phone".to_string())
            .expect("a device identity");
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
            uuid::Uuid::parse_str("00000000-0000-0000-0000-00000000000a")
                .expect("a fixed device id"),
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
            repo_url: None,
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
            artifacts: HashMap::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            status: RunStatus::Running,
            budget_cents: None,
            spent_cents: 0,
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
            .start_run(&owner_ext(), project.id, "the first run".to_string())
            .await
            .expect("run A starts");
        let started = rpc
            .start_preview(&owner_ext(), project.id.to_string(), command.clone())
            .await
            .expect("run A starts the project's preview");

        let second = rpc
            .start_run(&owner_ext(), project.id, "the second run".to_string())
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
            .start_run(&owner_ext(), project.id, "a run".to_string())
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
            .start_run(&owner_ext(), project.id, "a run".to_string())
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
            .start_run(&owner_ext(), project.id, "the run that dies".to_string())
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
            .start_run(&owner_ext(), project.id, "the next run".to_string())
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
            .start_run(&owner_ext(), project.id, "a run".to_string())
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
            .check_provider_models(&owner_ext(), "ollama_test".to_string())
            .await
            .expect("check_provider_models succeeds");
        assert_eq!(diff.provider, "ollama_test");
        assert_eq!(diff.new_models.len(), 1);
        assert_eq!(diff.new_models[0].id, "qwen2.5-coder:7b");

        assert!(rpc
            .check_provider_models(&owner_ext(), "non_existent".to_string())
            .await
            .is_err());
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
    fn capture_subscriber(
        capture: &LogCapture,
    ) -> impl tracing::Subscriber + Send + Sync + 'static {
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
                let handle =
                    start_daemon_with_secrets(config, Arc::new(InMemorySecretStore::new()))
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
        // count above only sees the one start this test performed.
        let source = include_str!("lib.rs");
        let production = source
            .split("#[cfg(test)]")
            .next()
            .expect("the crate has a test module to exclude");
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
                )
                .await
                .expect("project created");
            let run = rpc
                .start_run(&owner, project.id, "Idea for resume auth".to_string())
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
                )
                .await
                .expect("project created");
            let run = rpc
                .start_run(&owner, project.id, "Clinic booking app".to_string())
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
                )
                .await
                .expect("project created");
            let run = rpc
                .start_run(&owner, project.id, "Budgeted project".to_string())
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
                    gate_states,
                    artifacts: HashMap::new(),
                    created_at: now,
                    updated_at: now,
                    status: RunStatus::Running,
                    budget_cents: None,
                    spent_cents: 0,
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
                )
                .await
                .expect("project created");
            let run = rpc
                .start_run(&owner, project.id, "Budgeted project".to_string())
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
                .start_run(&owner, project.id, "Second run".to_string())
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
                .start_run(&owner, project.id, "Second run".to_string())
                .await
                .expect("runs.start succeeds after budget.set");
            assert_eq!(second.budget_cents, Some(500));
            assert_eq!(second.spent_cents, 0);
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
                )
                .await
                .expect("project created");
            let run = rpc
                .start_run(&owner, project.id, "Initial idea".to_string())
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
            let run2 = rpc
                .start_run(
                    &owner,
                    project.id,
                    "In-flight cancel signal test".to_string(),
                )
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
                )
                .await
                .expect("project created");
            let run = rpc
                .start_run(&owner, project.id, "Task tracker app".to_string())
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
                err.message().contains("No provider routed")
                    || err.message().contains("Researcher"),
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
            // Replace router with an empty one so even Intake is unrouted.
            *state.providers.write().await = ProviderRouter::new();

            let rpc = WarshaRpc::new(state.clone());
            let owner = owner_ext();

            let project = rpc
                .create_project(
                    &owner,
                    "Followup Truth Project".to_string(),
                    "Test unrouted followup".to_string(),
                    "en".to_string(),
                )
                .await
                .expect("project created");
            let run = rpc
                .start_run(&owner, project.id, "Followup test idea".to_string())
                .await
                .expect("run started");

            let err = state
                .pipeline
                .followup_run(run.id, "Tell me more")
                .await
                .expect_err("unrouted pipeline followup must return an explicit error");
            assert!(
                err.to_string().contains("No provider routed")
                    || err.to_string().contains("Intake"),
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
                )
                .await
                .expect("project created");
            let run = rpc
                .start_run(&owner, project.id, "Explicit routing idea".to_string())
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
                )
                .await
                .expect("project created");
            let run = rpc
                .start_run(&owner, project.id, "Resume idea".to_string())
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
        const SECRET_ARGS: &str = r#"{"api_key":"SECRET-1","note":"Bearer SECRET-2","password":"SECRET-3","path":"a.txt"}"#;
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

        async fn state_with_mcp(
            data_dir: &Path,
        ) -> (Arc<DaemonState>, Arc<Store>, Arc<ApprovalMcp>) {
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
            assert!(state.mcp_approvals.has_grant(
                &run_id.0.to_string(),
                "test_srv",
                "echo",
                "agent"
            ));

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
                let stream_json =
                    serde_json::to_string(&sync.frames).expect("the stream serializes");
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
            assert!(state.mcp_approvals.has_grant(
                &run_id.0.to_string(),
                "test_srv",
                "echo",
                "agent"
            ));
            assert_eq!(mcp.count(), 0, "an ask reached the transport");

            // The run finishes: `runs.advance` from Feedback completes it.
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
            assert!(state.mcp_approvals.has_grant(
                &run_id.0.to_string(),
                "test_srv",
                "echo",
                "agent"
            ));

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
            assert!(!state.mcp_approvals.has_grant(
                &run_id.0.to_string(),
                "test_srv",
                "echo",
                "agent"
            ));

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
}

#[cfg(test)]
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

// Declared last, after the test module above: `tests::the_startup_listener_lines_are_written_once`
// treats everything before the first `#[cfg(test)]` attribute in this file as the production
// part of the crate, and an earlier declaration here would empty that region.
#[cfg(test)]
pub(crate) mod test_util;

/// PAIR repair gates: Owner-only `pairing.list`, live WebSocket authority and the
/// event stream after revocation (`packets/PAIR/brief.md`).
#[cfg(test)]
mod pair_repair {
    use super::*;

    fn pairing(revoked: bool, expires_at: Option<u64>) -> PhonePairing {
        let mut pairing = PhonePairing::new_with_expiry(
            "11111111-1111-4111-8111-111111111111",
            "pair-repair-synthetic-secret",
            1_000,
            expires_at,
        );
        pairing.revoked = revoked;
        pairing
    }

    /// What `DaemonState::active_pairings` would hand the predicate at this clock.
    fn active_set(pairings: &[PhonePairing]) -> Vec<PhonePairing> {
        pairings
            .iter()
            .filter(|pairing| pairing.is_active_at(now_epoch_secs()))
            .cloned()
            .collect()
    }

    fn paired_ext(device_id: &str) -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::paired(&PhonePairing::new(
            device_id,
            "a-pairing-secret",
            1_700_000_000,
        )));
        ext
    }

    async fn seed_pairing(state: &DaemonState, device_id: &str) {
        state
            .pairings
            .write()
            .await
            .create_with_expiry(device_id, "a-pairing-secret", 1_700_000_000, None)
            .expect("the test pairing is recorded once");
    }

    #[test]
    fn pairing_list_owner_only() {
        let policy = auth::policy_of("pairing.list").expect("the method has a policy");
        assert_eq!(
            policy.policy,
            Policy::Owner,
            "pairing.list returns other devices' secrets and must be owner-only"
        );
    }

    #[test]
    fn ws_reauthorize() {
        let active = pairing(false, None);
        let actor = Actor::paired(&active);
        assert!(paired_device_is_active(&actor, &active_set(&[active])));
        assert!(!paired_device_is_active(
            &actor,
            &active_set(&[pairing(true, None)])
        ));
        assert!(!paired_device_is_active(
            &actor,
            &active_set(&[pairing(false, Some(1_001))])
        ));
        let owner = Actor::owner(DeviceId::new());
        assert!(paired_device_is_active(&owner, &[]));
    }

    #[tokio::test]
    async fn ws_reauthorize_rejects_revoked_or_expired_device_rpc() {
        let dir = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(dir.path()).await;
        let rpc = WarshaRpc::new(state.clone());
        let device_id = "test-ws-reauth-phone";
        seed_pairing(&state, device_id).await;

        let paired = paired_ext(device_id);
        assert!(rpc.authorize(&paired, "health").await.is_ok());

        // Revoke the pairing:
        assert!(state.pairings.write().await.revoke(device_id).is_ok());
        let err = rpc.authorize(&paired, "health").await.unwrap_err();
        assert_eq!(err.code(), -32001);
        assert!(err.message().contains("needs a still-active pairing"));
    }

    #[test]
    fn events_subscription_revoked() {
        let active = pairing(false, None);
        let actor = Actor::paired(&active);
        assert!(paired_device_is_active(&actor, &active_set(&[active])));
        assert!(!paired_device_is_active(
            &actor,
            &active_set(&[pairing(true, None)])
        ));
    }

    #[tokio::test]
    async fn events_subscription_revoked_does_not_replay_since_seq() {
        let dir = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(dir.path()).await;
        let device_id = "test-events-revoked-phone";
        seed_pairing(&state, device_id).await;

        let event = Event {
            id: ulid::Ulid::new(),
            run_id: RunId::new(),
            stage: Stage::Idea,
            role: None,
            kind: EventKind::StageStarted,
            payload: serde_json::json!({ "test": "data" }),
            cost_cents: None,
            tokens: None,
            created_at: Utc::now(),
            device_id: None,
        };
        state.events.publish(event).await;
        assert_eq!(state.events.current_seq(), 1);

        // Active pairing: sync gives frames
        let sync_before = state.events.sync(0, None).await;
        assert_eq!(sync_before.frames.len(), 1);

        // Revoke device:
        assert!(state.pairings.write().await.revoke(device_id).is_ok());
        let paired = paired_ext(device_id);
        let active_set = state.active_pairings().await;
        assert!(!paired_device_is_active(
            paired.get::<Actor>().expect("actor"),
            &active_set
        ));
    }

    /// K5.6: transport dispatch on install/toggle/configure never spawns a non-stdio command.
    mod k5_repair {
        use super::*;

        fn owner_ext() -> RpcExtensions {
            let mut ext = RpcExtensions::new();
            ext.insert(Actor::owner(DeviceId::new()));
            ext
        }

        fn legacy_http_row(id: &str) -> StoredPlugin {
            StoredPlugin {
                id: id.to_string(),
                name: "Legacy HTTP".to_string(),
                description: "test".to_string(),
                transport: "http".to_string(),
                command: Some("sh".to_string()),
                args_json: serde_json::to_string(&vec!["-c", "sleep 5"]).expect("args json"),
                env_json: "{}".to_string(),
                enabled: false,
                tools_json: "[]".to_string(),
                source: "user".to_string(),
            }
        }

        #[tokio::test]
        async fn transport_bypass_install_refuses_http_with_command() {
            let dir = crate::test_util::fresh_tempdir();
            let (state, _store) = crate::tests::test_state(dir.path()).await;
            let rpc = WarshaRpc::new(state.clone());
            let bad = r#"{"name":"bad-http","transport":"http","command":"sh","args":["-c","id"]}"#;
            assert!(rpc
                .install_plugin(&owner_ext(), bad.to_string())
                .await
                .is_err());
            assert!(state.processes.list().await.is_empty());
        }

        #[tokio::test]
        async fn transport_bypass_toggle_never_spawns_non_stdio_command() {
            let dir = crate::test_util::fresh_tempdir();
            let (state, _store) = crate::tests::test_state(dir.path()).await;
            state
                .settings
                .save_plugin(&legacy_http_row("legacy-http-toggle"))
                .await
                .expect("seed legacy row");
            let rpc = WarshaRpc::new(state.clone());
            let toggled = rpc
                .toggle_plugin(&owner_ext(), "legacy-http-toggle".to_string(), true)
                .await
                .expect("toggle succeeds without spawning");
            assert!(toggled.enabled);
            assert!(state.processes.list().await.is_empty());
        }

        #[tokio::test]
        async fn transport_bypass_configure_never_spawns_non_stdio_command() {
            let dir = crate::test_util::fresh_tempdir();
            let (state, _store) = crate::tests::test_state(dir.path()).await;
            let mut row = legacy_http_row("legacy-http-cfg");
            row.enabled = true;
            state
                .settings
                .save_plugin(&row)
                .await
                .expect("seed legacy enabled row");
            let rpc = WarshaRpc::new(state.clone());
            let configured = rpc
                .configure_plugin(&owner_ext(), "legacy-http-cfg".to_string(), HashMap::new())
                .await
                .expect("configure succeeds without spawning");
            assert_eq!(configured.transport, "http");
            assert!(state.processes.list().await.is_empty());
        }
    }

    /// K6.2: the daemon RPC surface and the end-to-end table at the agent call site.
    mod mcp_permission {
        use super::*;
        use warsha_pipeline::mcp_permission::ToolPermission;
        use warsha_pipeline::McpPermissionSource;

        fn owner_ext() -> RpcExtensions {
            let mut ext = RpcExtensions::new();
            ext.insert(Actor::owner(DeviceId::new()));
            ext
        }

        fn paired_ext(device_id: &str) -> RpcExtensions {
            let mut ext = RpcExtensions::new();
            ext.insert(Actor::paired(&PhonePairing::new(
                device_id,
                "a-pairing-secret",
                1_700_000_000,
            )));
            ext
        }

        async fn seed_pairing(state: &DaemonState, device_id: &str) {
            state
                .pairings
                .write()
                .await
                .create_with_expiry(device_id, "a-pairing-secret", 1_700_000_000, None)
                .expect("the test pairing is recorded once");
        }

        fn rpc_error_code(error: &jsonrpsee::types::ErrorObjectOwned) -> i32 {
            error.code()
        }

        #[derive(Default)]
        struct RecordingMcp {
            calls: std::sync::Mutex<Vec<(String, String)>>,
            sends: std::sync::Mutex<Vec<(String, String)>>,
        }

        impl RecordingMcp {
            fn calls(&self) -> usize {
                self.calls.lock().expect("the recording lock").len()
            }

            fn sends(&self) -> Vec<(String, String)> {
                self.sends.lock().expect("the recording lock").clone()
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
                        name: "srv".to_string(),
                        transport: warsha_pipeline::mcp_transport::McpTransport::Stdio,
                        command: Some("dummy".to_string()),
                        args: vec![],
                    },
                    status: warsha_pipeline::McpStatus::Connected,
                    process_id: Some("p1".to_string()),
                    tools: vec!["tool".to_string()],
                    tool_definitions: vec![],
                }]
            }
            async fn send(
                &self,
                name: &str,
                payload: &str,
            ) -> std::result::Result<String, warsha_pipeline::McpTransportError> {
                self.sends
                    .lock()
                    .expect("the recording lock")
                    .push((name.to_string(), payload.to_string()));
                Ok(payload.to_string())
            }
            async fn call_tool(
                &self,
                name: &str,
                tool: &str,
                _arguments: serde_json::Value,
            ) -> std::result::Result<
                warsha_pipeline::mcp::McpToolResult,
                warsha_pipeline::McpTransportError,
            > {
                self.calls
                    .lock()
                    .expect("the recording lock")
                    .push((name.to_string(), tool.to_string()));
                Ok(warsha_pipeline::mcp::McpToolResult {
                    content: vec![warsha_pipeline::mcp::McpContent::Text {
                        text: "ok".to_string(),
                    }],
                    is_error: false,
                })
            }
        }

        fn approved_agent_loop(
            permissions: Arc<StaticPermissions>,
            mcp: Arc<RecordingMcp>,
        ) -> AgentLoop {
            let mut agent_loop = AgentLoop::new();
            agent_loop
                .approve_agent_mode("owner")
                .expect("an approval is accepted");
            agent_loop.with_mcp(mcp).with_mcp_permissions(permissions)
        }

        fn call_tool_input() -> String {
            "call mcp srv/tool {\"msg\":\"hi\"}".to_string()
        }

        #[tokio::test]
        async fn set_then_list_round_trips_and_memory_updates() {
            let temp = crate::test_util::fresh_tempdir();
            let (state, _store) = crate::tests::test_state(temp.path()).await;
            let rpc = WarshaRpc::new(state);
            let owner = owner_ext();

            let row = rpc
                .set_mcp_permission(
                    &owner,
                    "srv".to_string(),
                    "tool".to_string(),
                    warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                    "allow".to_string(),
                )
                .await
                .expect("the owner sets a permission");
            assert_eq!(row.permission, "allow");

            let listed = rpc
                .list_mcp_permissions(&owner)
                .await
                .expect("the owner lists permissions");
            assert_eq!(listed.default_permission, "ask");
            assert_eq!(listed.agent_role, warsha_pipeline::MCP_AGENT_ROLE);
            assert_eq!(
                listed.rows,
                vec![McpPermissionRow {
                    server: "srv".to_string(),
                    tool: "tool".to_string(),
                    role: warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                    permission: "allow".to_string(),
                }]
            );
            // The running table changed with the store, before any restart.
            assert_eq!(
                rpc.state.mcp_permissions.check_permission(
                    "srv",
                    "tool",
                    warsha_pipeline::MCP_AGENT_ROLE
                ),
                ToolPermission::Allow
            );
            // An unknown permission is rejected, not defaulted.
            assert!(rpc
                .set_mcp_permission(
                    &owner,
                    "srv".to_string(),
                    "tool".to_string(),
                    warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                    "permit".to_string(),
                )
                .await
                .is_err());
        }

        #[tokio::test]
        async fn default_ask_blocks_the_agent_and_allow_lets_it_through() {
            let temp = crate::test_util::fresh_tempdir();
            let (state, _store) = crate::tests::test_state(temp.path()).await;
            let rpc = WarshaRpc::new(state);
            let owner = owner_ext();
            let mcp = Arc::new(RecordingMcp::default());
            let mut agent_loop =
                approved_agent_loop(rpc.state.mcp_permissions.clone(), mcp.clone());

            let blocked = agent_loop.run_turn(&call_tool_input(), &[]).await;
            assert!(
                !blocked.tools[0].success,
                "default Ask let the call through"
            );
            assert_eq!(mcp.calls(), 0, "default Ask reached the transport");
            assert_eq!(agent_loop.ask_queue.len(), 1);

            rpc.set_mcp_permission(
                &owner,
                "srv".to_string(),
                "tool".to_string(),
                warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                "allow".to_string(),
            )
            .await
            .expect("the owner grants the tool");

            let allowed = agent_loop.run_turn(&call_tool_input(), &[]).await;
            assert!(
                allowed.tools[0].success,
                "allow did not let the call through"
            );
            assert_eq!(mcp.calls(), 1, "allow did not call exactly once");
        }

        #[tokio::test]
        async fn a_paired_device_is_refused_both_permission_rpcs() {
            let temp = crate::test_util::fresh_tempdir();
            let (state, _store) = crate::tests::test_state(temp.path()).await;
            let device = uuid::Uuid::new_v4().to_string();
            seed_pairing(&state, &device).await;
            let rpc = WarshaRpc::new(state);
            let paired = paired_ext(&device);

            let listed = rpc
                .list_mcp_permissions(&paired)
                .await
                .expect_err("a paired device listed the permission table");
            assert_eq!(rpc_error_code(&listed), auth::rpc_codes::FORBIDDEN);
            let set = rpc
                .set_mcp_permission(
                    &paired,
                    "srv".to_string(),
                    "tool".to_string(),
                    warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                    "allow".to_string(),
                )
                .await
                .expect_err("a paired device wrote a permission");
            assert_eq!(rpc_error_code(&set), auth::rpc_codes::FORBIDDEN);
        }

        /// A daemon whose MCP transport is a recorder, so a test can say whether the
        /// transport was reached at all — the property R-KEEL row 6 is about.
        async fn state_with_recording_mcp(
            data_dir: &Path,
            mcp: Arc<RecordingMcp>,
        ) -> Arc<DaemonState> {
            let (state, _store) = crate::tests::test_state_with_seams(
                data_dir,
                |_| {},
                None,
                None,
                Some(mcp as Arc<dyn McpManager>),
            )
            .await;
            state
        }

        #[tokio::test]
        async fn call_mcp_refuses_a_denied_tool_and_never_reaches_the_transport() {
            let temp = crate::test_util::fresh_tempdir();
            let mcp = Arc::new(RecordingMcp::default());
            let state = state_with_recording_mcp(temp.path(), mcp.clone()).await;
            let rpc = WarshaRpc::new(state);
            let owner = owner_ext();
            rpc.set_mcp_permission(
                &owner,
                "srv".to_string(),
                "tool".to_string(),
                warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                "deny".to_string(),
            )
            .await
            .expect("the owner denies the tool");

            let err = rpc
                .call_mcp(
                    &owner,
                    "srv".to_string(),
                    "tool".to_string(),
                    serde_json::json!({}),
                )
                .await
                .expect_err("a denied tool must not be callable over RPC");
            assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
            assert!(
                err.message().contains("denied by MCP permission srv::tool"),
                "the refusal names the denied row, got: {}",
                err.message()
            );
            assert_eq!(mcp.calls(), 0, "a denied RPC call reached the transport");
        }

        #[tokio::test]
        async fn call_mcp_reaches_the_transport_once_when_allowed() {
            let temp = crate::test_util::fresh_tempdir();
            let mcp = Arc::new(RecordingMcp::default());
            let state = state_with_recording_mcp(temp.path(), mcp.clone()).await;
            let rpc = WarshaRpc::new(state);
            let owner = owner_ext();
            rpc.set_mcp_permission(
                &owner,
                "srv".to_string(),
                "tool".to_string(),
                warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                "allow".to_string(),
            )
            .await
            .expect("the owner grants the tool");

            let result = rpc
                .call_mcp(
                    &owner,
                    "srv".to_string(),
                    "tool".to_string(),
                    serde_json::json!({ "msg": "hi" }),
                )
                .await
                .expect("an allowed tool is called");
            assert!(!result.is_error);
            assert_eq!(mcp.calls(), 1, "allow did not call exactly once");
        }

        #[tokio::test]
        async fn call_mcp_refuses_a_tool_with_no_row() {
            let temp = crate::test_util::fresh_tempdir();
            let mcp = Arc::new(RecordingMcp::default());
            let state = state_with_recording_mcp(temp.path(), mcp.clone()).await;
            let rpc = WarshaRpc::new(state);
            let owner = owner_ext();

            // No row: the table defaults to Ask, and there is no approval queue on this
            // path, so the honest answer is a refusal that names the grant to make.
            let err = rpc
                .call_mcp(
                    &owner,
                    "srv".to_string(),
                    "tool".to_string(),
                    serde_json::json!({}),
                )
                .await
                .expect_err("a tool with no row must not be called over RPC");
            assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
            assert!(
                err.message().contains("ask-gated")
                    && err.message().contains("mcp.permissions.set"),
                "the refusal explains the default and the grant, got: {}",
                err.message()
            );
            assert_eq!(
                mcp.calls(),
                0,
                "an ask-gated RPC call reached the transport"
            );
        }

        #[tokio::test]
        async fn send_mcp_refuses_a_tools_call_frame_and_writes_any_other() {
            let temp = crate::test_util::fresh_tempdir();
            let mcp = Arc::new(RecordingMcp::default());
            let state = state_with_recording_mcp(temp.path(), mcp.clone()).await;
            let rpc = WarshaRpc::new(state);
            let owner = owner_ext();

            // Every spelling the child's parser would read as `tools/call`: the plain
            // frame, the JSON escape, and a second frame smuggled onto a later line.
            let refused_frames = [
                r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"tool","arguments":{}}}"#,
                r#"{"jsonrpc":"2.0","id":8,"method":"tools\u002fcall","params":{}}"#,
                "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/list\"}\n{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{}}",
            ];
            for payload in refused_frames {
                let err = rpc
                    .send_mcp(&owner, "srv".to_string(), payload.to_string())
                    .await
                    .expect_err("a tools/call frame must not be written");
                assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
                assert!(
                    err.message().contains("tools/call"),
                    "the refusal names the governed method, got: {}",
                    err.message()
                );
            }
            assert!(
                mcp.sends().is_empty(),
                "a refused frame reached the transport: {:?}",
                mcp.sends()
            );

            // Every other method is the caller's own protocol and passes unchanged.
            let frames = [
                r#"{"jsonrpc":"2.0","id":11,"method":"tools/list"}"#,
                r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            ];
            for payload in frames {
                assert_eq!(
                    rpc.send_mcp(&owner, "srv".to_string(), payload.to_string())
                        .await
                        .expect("another method passes through"),
                    payload
                );
            }
            assert_eq!(
                mcp.sends(),
                frames
                    .iter()
                    .map(|payload| ("srv".to_string(), payload.to_string()))
                    .collect::<Vec<_>>(),
                "each allowed frame reaches the transport exactly once, unchanged"
            );
        }
    }
}

/// The RPC listener refuses a present-but-unlisted Origin — including the WebSocket
/// upgrade a CORS layer cannot gate — while an absent Origin and the app origins
/// still reach the auth check (security audit LOW: no Origin check on the RPC WS).
#[cfg(test)]
mod origin_guard {
    use super::*;
    use jsonrpsee::core::http_helpers::Body;
    use std::future::Ready;
    use std::task::{Context, Poll};
    use tower::Service;

    #[derive(Clone)]
    struct Accepting;

    impl tower::Service<HttpRequest<Body>> for Accepting {
        type Response = HttpResponse;
        type Error = BoxError;
        type Future = Ready<std::result::Result<Self::Response, Self::Error>>;

        fn poll_ready(
            &mut self,
            _cx: &mut Context<'_>,
        ) -> Poll<std::result::Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }

        fn call(&mut self, _req: HttpRequest<Body>) -> Self::Future {
            std::future::ready(Ok(HttpResponse::new(Body::empty())))
        }
    }

    fn request(origin: Option<&str>) -> HttpRequest<Body> {
        let mut builder = axum::http::Request::builder().uri("/").method("POST");
        if let Some(origin) = origin {
            builder = builder.header(axum::http::header::ORIGIN, origin);
        }
        builder.body(Body::empty()).expect("the request builds")
    }

    async fn status(service: &mut RpcAuthService<Accepting>, origin: Option<&str>) -> u16 {
        Service::call(service, request(origin))
            .await
            .expect("the layer answers")
            .status()
            .as_u16()
    }

    #[tokio::test]
    async fn an_unlisted_origin_is_refused_before_the_credential() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let mut service = RpcAuthService {
            inner: Accepting,
            state,
        };
        assert_eq!(status(&mut service, Some("http://evil.example")).await, 403);
    }

    #[test]
    fn the_app_origins_are_always_allowed() {
        let configured = vec!["http://localhost:5173".to_string()];
        assert!(origin_allowed(&configured, "tauri://localhost"));
        assert!(origin_allowed(&configured, "http://tauri.localhost"));
        assert!(origin_allowed(&configured, "http://localhost:5173"));
        assert!(!origin_allowed(&configured, "http://evil.example"));
    }

    #[tokio::test]
    async fn the_app_origins_and_no_origin_reach_the_auth_check() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let mut service = RpcAuthService {
            inner: Accepting,
            state,
        };
        // No token is sent, so passing the origin guard means the auth refusal (401).
        assert_eq!(status(&mut service, None).await, 401);
        assert_eq!(status(&mut service, Some("tauri://localhost")).await, 401);
        assert_eq!(
            status(&mut service, Some("http://tauri.localhost")).await,
            401
        );
    }
}

/// ENGINE E3 wiring: `runs.start` gives a repository-backed project a per-run
/// worktree, and an unusable repository cancels the run instead of letting it
/// execute in the shared workspace.
#[cfg(test)]
mod e3_wiring {
    use super::*;
    use std::process::Command;

    fn owner() -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::owner(DeviceId::new()));
        ext
    }

    fn project(repo_path: Option<String>) -> Project {
        Project {
            id: ProjectId::new(),
            name: "Worktree Project".to_string(),
            description: "Test".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path,
            repo_url: None,
        }
    }

    fn git_repo(dir: &std::path::Path) {
        std::fs::write(dir.join("base.txt"), "base").expect("a base file");
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
            vec!["add", "."],
            vec!["commit", "-qm", "base"],
        ] {
            let status = Command::new("git")
                .current_dir(dir)
                .args(&args)
                .status()
                .expect("git runs");
            assert!(status.success(), "git {args:?} failed");
        }
    }

    #[tokio::test]
    async fn a_repository_backed_run_gets_its_own_worktree() {
        let temp = crate::test_util::fresh_tempdir();
        let repo = tempfile::tempdir().expect("a repo dir");
        git_repo(repo.path());
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project(Some(repo.path().display().to_string()));
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);

        let run = rpc
            .start_run(&owner(), project.id, "Build a todo app".to_string())
            .await
            .expect("the run starts");
        let worktree = rpc
            .run_worktree(&owner(), run.id)
            .await
            .expect("the worktree is reported")
            .expect("the run has a worktree");

        assert!(worktree.path.exists());
        let check = Command::new("git")
            .arg("-C")
            .arg(&worktree.path)
            .args(["rev-parse", "--is-inside-work-tree"])
            .output()
            .expect("git runs");
        assert!(check.status.success());
        assert_eq!(String::from_utf8_lossy(&check.stdout).trim(), "true");
    }

    #[tokio::test]
    async fn an_unusable_repository_cancels_the_run() {
        let temp = crate::test_util::fresh_tempdir();
        let plain = tempfile::tempdir().expect("a plain dir");
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project(Some(plain.path().display().to_string()));
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);

        let error = rpc
            .start_run(&owner(), project.id, "Build a todo app".to_string())
            .await
            .expect_err("a non-repository is refused");
        assert!(error.to_string().contains("worktree"), "{error}");
        let runs = store.list_runs(project.id).await.expect("the runs list");
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, RunStatus::Cancelled);
    }

    // ---- P-E3: `projects.attach`.
    //
    // Before this RPC a project's repository could only be named at
    // `projects.create` time, so a project created without one was stranded: no
    // later operation could give it a checkout, and `runs.start`'s worktree path
    // never ran for it. These tests are the three claims the RPC has to hold — the
    // repository lands on the row, an unusable path is refused and changes nothing,
    // and a project that already has one is not silently moved.

    #[tokio::test]
    async fn attaching_an_existing_repository_records_it_on_the_project() {
        let temp = crate::test_util::fresh_tempdir();
        let repo = tempfile::tempdir().expect("a repo dir");
        git_repo(repo.path());
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);

        // The shape `projects.create` always makes: no repository.
        let project = rpc
            .create_project(
                &owner(),
                "Attach Project".to_string(),
                "Test".to_string(),
                "en".to_string(),
            )
            .await
            .expect("the project is created");
        assert_eq!(project.repo_path, None);

        let path = repo.path().display().to_string();
        let attached = rpc
            .attach_project(&owner(), project.id, path.clone())
            .await
            .expect("the repository attaches");
        assert_eq!(attached.repo_path.as_deref(), Some(path.as_str()));

        // The response is not the claim: the row carries the path, both through the
        // read RPC and through the store a later `runs.start` reads it from.
        let read_back = rpc
            .get_project(&owner(), project.id)
            .await
            .expect("the project reads back");
        assert_eq!(read_back.repo_path.as_deref(), Some(path.as_str()));
        let stored = store
            .get_project(project.id)
            .await
            .expect("the project row");
        assert_eq!(stored.repo_path.as_deref(), Some(path.as_str()));
    }

    #[tokio::test]
    async fn attaching_a_path_that_is_not_a_repository_is_refused_and_changes_nothing() {
        let temp = crate::test_util::fresh_tempdir();
        let plain = tempfile::tempdir().expect("a plain dir");
        let missing = temp.path().join("no-such-repository");
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let project = rpc
            .create_project(
                &owner(),
                "Attach Project".to_string(),
                "Test".to_string(),
                "en".to_string(),
            )
            .await
            .expect("the project is created");

        // A real directory that is not a git repository, and a path that is not there
        // at all. Neither may attach, and neither may leave the row touched.
        for path in [
            plain.path().display().to_string(),
            missing.display().to_string(),
        ] {
            let error = rpc
                .attach_project(&owner(), project.id, path.clone())
                .await
                .expect_err("an unusable path is refused");
            assert!(
                error.to_string().contains(&path),
                "the error names the refused path `{path}`: {error}"
            );
            let stored = store
                .get_project(project.id)
                .await
                .expect("the project row");
            assert_eq!(
                stored.repo_path, None,
                "a refused attach half-attached {path}"
            );
            assert_eq!(
                stored.updated_at, project.updated_at,
                "a refused attach touched the project row"
            );
        }
    }

    #[tokio::test]
    async fn a_project_that_already_has_a_repository_refuses_a_second_attach() {
        let temp = crate::test_util::fresh_tempdir();
        let first = tempfile::tempdir().expect("a first repo");
        git_repo(first.path());
        let second = tempfile::tempdir().expect("a second repo");
        git_repo(second.path());
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project(Some(first.path().display().to_string()));
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);

        let error = rpc
            .attach_project(&owner(), project.id, second.path().display().to_string())
            .await
            .expect_err("a project with a repository refuses a second one");
        assert!(
            error.to_string().contains("already has the repository"),
            "the refusal says the project is already attached: {error}"
        );

        let stored = store
            .get_project(project.id)
            .await
            .expect("the project row");
        assert_eq!(
            stored.repo_path, project.repo_path,
            "the existing repository was overwritten"
        );
    }
}

/// ENGINE E1 wiring: the language a project is created in reaches the prompt its
/// run's stages render — a project created as `ar` through the daemon RPC speaks
/// Arabic to the provider, instead of the English the renderer used to hardcode.
#[cfg(test)]
mod e1_language_wiring {
    use super::*;
    use warsha_providers::{
        ChatChoice, ChatMessage, ChatProvider, ChatRequest, ChatResponse, ChatStreamChunk,
        HealthCheck, MessageRole, ModelInfo, ProviderError,
    };

    fn owner() -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::owner(DeviceId::new()));
        ext
    }

    /// A provider that records the system prompt of every stage it answers.
    struct PromptCapturingProvider {
        captured: Arc<std::sync::Mutex<Vec<String>>>,
    }

    #[async_trait::async_trait]
    impl ChatProvider for PromptCapturingProvider {
        fn id(&self) -> &str {
            "capturing"
        }

        fn kind(&self) -> ProviderKind {
            ProviderKind::CustomOpenAICompatible
        }

        async fn list_models(&self) -> std::result::Result<Vec<ModelInfo>, ProviderError> {
            Ok(vec![ModelInfo {
                id: "capturing-model".to_string(),
                name: "Capturing Model".to_string(),
                provider: "capturing".to_string(),
                context_window: 8192,
                max_output: 4096,
                pricing: ModelPricing {
                    input_per_million_cents: 0,
                    output_per_million_cents: 0,
                },
            }])
        }

        async fn health(&self) -> std::result::Result<HealthCheck, ProviderError> {
            Ok(HealthCheck {
                healthy: true,
                latency_ms: Some(0),
                error: None,
            })
        }

        async fn chat(
            &self,
            request: ChatRequest,
        ) -> std::result::Result<ChatResponse, ProviderError> {
            if let Some(message) = request.messages.first() {
                self.captured
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .push(message.content.clone());
            }
            Ok(ChatResponse {
                id: "capturing-response".to_string(),
                model: "capturing-model".to_string(),
                choices: vec![ChatChoice {
                    index: 0,
                    message: ChatMessage {
                        role: MessageRole::Assistant,
                        content: "# Research Report\n\nCaptured content.".to_string(),
                    },
                    finish_reason: Some("stop".to_string()),
                }],
                usage: TokenUsage {
                    input: 10,
                    output: 5,
                    total: 15,
                },
            })
        }

        async fn chat_stream(
            &self,
            _request: ChatRequest,
        ) -> std::result::Result<
            Box<
                dyn futures::Stream<Item = std::result::Result<ChatStreamChunk, ProviderError>>
                    + Send
                    + Unpin,
            >,
            ProviderError,
        > {
            Err(ProviderError::Other(
                "streaming is not part of this test".to_string(),
            ))
        }

        fn cost_of(
            &self,
            _model: &str,
            _usage: &TokenUsage,
        ) -> std::result::Result<u64, ProviderError> {
            Ok(1)
        }
    }

    /// An active harness whose Researcher prompt carries `{{language}}`, so the one
    /// stage this test reaches renders the project's language into what the provider
    /// receives.
    async fn store_language_harness(settings: &SettingsStore, project_id: ProjectId) {
        let definition = HarnessDefinition {
            id: "language-harness".to_string(),
            version: "1.0.0".to_string(),
            name: "Language Harness".to_string(),
            description: "Renders the research prompt in the project's language".to_string(),
            stages: vec![
                HarnessStage {
                    id: "research".to_string(),
                    role: Role::Researcher,
                    name: "Research".to_string(),
                    prompt_template: Some(
                        "---\nrole: researcher\nstage: research\n---\n\n\
                         Research the idea and answer in Language: `{{language}}`."
                            .to_string(),
                    ),
                    gate: None,
                    auto_advance: true,
                },
                HarnessStage {
                    id: "prd".to_string(),
                    role: Role::PM,
                    name: "PRD spec".to_string(),
                    prompt_template: Some(
                        "---\nrole: pm\nstage: prd_spec\n---\n\n\
                         Write the spec in Language: `{{language}}`."
                            .to_string(),
                    ),
                    gate: None,
                    auto_advance: true,
                },
            ],
            rules: HarnessRules {
                max_repair_iterations: 1,
                budget_cap_cents: None,
                allow_parallel_subagents: false,
                require_verification_receipt: false,
            },
            preset: false,
            active: false,
            created_at: Utc::now(),
        };
        settings
            .save_harness(&StoredHarness {
                id: "language-harness".to_string(),
                version: "1.0.0".to_string(),
                name: "Language Harness".to_string(),
                description: "Renders prompts in the project's language".to_string(),
                data_json: serde_json::to_string(&definition).expect("a harness definition"),
                is_preset: false,
                created_at: 1_735_689_600,
            })
            .await
            .expect("the harness is stored");
        settings
            .set_active_harness(&project_id.0.to_string(), "language-harness")
            .await
            .expect("the harness is active");
    }

    #[tokio::test]
    async fn a_project_created_in_arabic_renders_its_run_prompts_in_arabic() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;

        // Route the first executed stage to a provider that keeps the prompt.
        let captured = Arc::new(std::sync::Mutex::new(Vec::new()));
        {
            let mut router = state.providers.write().await;
            router.register_provider(Box::new(PromptCapturingProvider {
                captured: captured.clone(),
            }));
            for role in [Role::Researcher, Role::PM] {
                router.set_role_routing(RoleRouting {
                    role,
                    targets: vec![RoutingTarget {
                        provider_id: "capturing".to_string(),
                        model_id: "capturing-model".to_string(),
                        weight: 100,
                    }],
                    fallback_enabled: false,
                    budget_cents_per_run: None,
                });
            }
        }

        let rpc = WarshaRpc::new(state.clone());
        let owner = owner();
        // The project is created the way a client creates one: through the RPC, which
        // is what stores `language` on the row the pipeline later reads.
        let project = rpc
            .create_project(
                &owner,
                "عيادة أسنان".to_string(),
                "A dental clinic booking app".to_string(),
                "ar".to_string(),
            )
            .await
            .expect("the project is created");
        assert_eq!(project.language, "ar");
        store_language_harness(&state.settings, project.id).await;

        let run = rpc
            .start_run(&owner, project.id, "تطبيق حجز مواعيد".to_string())
            .await
            .expect("the run starts");
        let at_gate = rpc
            .advance_run(&owner, run.id)
            .await
            .expect("advance to Gate A");
        assert_eq!(at_gate.current_stage, Stage::GateA);
        rpc.approve_gate(&owner, run.id, Stage::GateA, None)
            .await
            .expect("Gate A approves");
        rpc.advance_run(&owner, run.id)
            .await
            .expect("the research stage executes");

        let prompts = captured
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        assert_eq!(
            prompts.len(),
            2,
            "the walk runs Research and the PRD spec before Gate B: {prompts:?}"
        );
        for prompt in &prompts {
            assert!(
                prompt.contains("Language: `ar`"),
                "the project's language never reached the renderer: {prompt}"
            );
            assert!(
                !prompt.contains("Language: `en`"),
                "the prompt still hardcoded English: {prompt}"
            );
        }
    }
}

/// ENGINE E2 wiring: `agent.turn_run` runs a turn in the run's own loop, created
/// at `runs.start`; an unknown run is refused instead of borrowing the legacy loop.
#[cfg(test)]
mod e2_wiring {
    use super::*;

    fn owner() -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::owner(DeviceId::new()));
        ext
    }

    fn project() -> Project {
        Project {
            id: ProjectId::new(),
            name: "Sessions Project".to_string(),
            description: "Test".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
        }
    }

    #[tokio::test]
    async fn a_run_turn_uses_the_runs_own_session() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project();
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);

        let first = rpc
            .start_run(&owner(), project.id, "Build a todo app".to_string())
            .await
            .expect("the first run starts");
        let turn = rpc
            .agent_turn_run(&owner(), first.id, "hello".to_string())
            .await
            .expect("the run's turn runs");
        assert_eq!(turn.mode, AgentMode::Plan);
        assert!(
            turn.response.contains("Plan (nothing executed)"),
            "{}",
            turn.response
        );

        let second = rpc
            .start_run(&owner(), project.id, "Second idea".to_string())
            .await
            .expect("the second run starts");
        assert!(rpc.state.agent_sessions.contains(first.id));
        assert!(rpc.state.agent_sessions.contains(second.id));
    }

    #[tokio::test]
    async fn an_unknown_run_has_no_session() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);

        let error = rpc
            .agent_turn_run(&owner(), RunId::new(), "hello".to_string())
            .await
            .expect_err("an unknown run has no session");
        assert!(error.to_string().contains("no agent session"), "{error}");
    }

    // ---- ENGINE E2b (OD-E2b): the mode RPCs reach one run's own loop.
    //
    // `agent.approve_mode` / `agent.plan_mode` / `agent.state` take an optional
    // `run_id`: present, they operate on that run's loop (the one `agent.turn_run`
    // executes on); absent, they are the daemon-wide record they always were. The
    // tests below are the two-sided proof — the per-run flow executes, one run's
    // approval does not reach another run or the daemon loop, and the old behavior
    // without a run id is unchanged.

    /// OD-E2b's acceptance test: a run moves Plan → Approved → Agent over the wire,
    /// and the command its Plan turn proposed executes on the next turn.
    #[tokio::test]
    async fn approving_a_run_over_the_wire_executes_its_next_turn() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project();
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);
        let owner = owner();

        let run = rpc
            .start_run(&owner, project.id, "Write the note".to_string())
            .await
            .expect("the run starts");

        // The turn a run starts with plans and executes nothing.
        let input = "write file notes/wire.md: approved over the wire";
        let planned = rpc
            .agent_turn_run(&owner, run.id, input.to_string())
            .await
            .expect("the plan turn runs");
        assert_eq!(planned.mode, AgentMode::Plan);
        assert!(planned.tools.is_empty(), "{:?}", planned.tools);
        let written = temp.path().join("workspace").join("notes").join("wire.md");
        assert!(!written.exists(), "a Plan turn wrote {}", written.display());

        // The owner approves THAT run's loop, over the wire.
        let transition = rpc
            .approve_agent_mode(&owner, Some(run.id))
            .await
            .expect("the run's loop is approved");
        assert_eq!(transition.to, AgentMode::Agent);
        assert!(
            transition.is_owner_approved(),
            "the approval must name the authenticated device: {transition:?}"
        );

        // The read agrees with the write: the same run's state is Agent and carries
        // the switch the approval recorded.
        let run_state = rpc
            .agent_state(&owner, Some(run.id))
            .await
            .expect("the run's state is served");
        assert_eq!(run_state.mode, AgentMode::Agent);
        assert_eq!(
            run_state
                .approvals
                .last()
                .map(|switch| switch.approved_by.as_str()),
            Some(transition.approved_by.as_str())
        );

        // ...and the run's next turn executes; the real file layer wrote the file.
        let executed = rpc
            .agent_turn_run(&owner, run.id, input.to_string())
            .await
            .expect("the approved turn runs");
        assert_eq!(executed.mode, AgentMode::Agent);
        assert_eq!(executed.tools.len(), 1);
        assert!(
            executed.tools[0].success,
            "unexpected tool: {:?}",
            executed.tools[0]
        );
        assert_eq!(
            std::fs::read_to_string(&written).expect("the file is readable"),
            "approved over the wire"
        );

        // The daemon-wide record is not what was approved: it is still in Plan.
        assert_eq!(
            rpc.agent_state(&owner, None)
                .await
                .expect("the daemon-wide record")
                .mode,
            AgentMode::Plan
        );
    }

    /// The isolation pair: one run's approval is that run's alone.
    #[tokio::test]
    async fn approving_one_run_leaves_the_other_run_and_the_daemon_loop_in_plan() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project();
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);
        let owner = owner();

        let first = rpc
            .start_run(&owner, project.id, "First".to_string())
            .await
            .expect("the first run starts");
        let second = rpc
            .start_run(&owner, project.id, "Second".to_string())
            .await
            .expect("the second run starts");

        rpc.approve_agent_mode(&owner, Some(first.id))
            .await
            .expect("the first run's loop is approved");

        let first_input = "write file notes/first.md: one";
        let second_input = "write file notes/second.md: two";
        let first_turn = rpc
            .agent_turn_run(&owner, first.id, first_input.to_string())
            .await
            .expect("the approved run turns");
        let second_turn = rpc
            .agent_turn_run(&owner, second.id, second_input.to_string())
            .await
            .expect("the unapproved run turns");

        assert_eq!(first_turn.mode, AgentMode::Agent);
        assert_eq!(first_turn.tools.len(), 1);
        assert!(first_turn.tools[0].success);
        // The run that was not approved is still a plan, and its proposed write never
        // reached the file layer.
        assert_eq!(second_turn.mode, AgentMode::Plan);
        assert!(second_turn.tools.is_empty(), "{:?}", second_turn.tools);
        assert!(
            second_turn.response.contains("Plan (nothing executed)"),
            "{}",
            second_turn.response
        );
        let workspace = temp.path().join("workspace").join("notes");
        assert!(workspace.join("first.md").is_file());
        assert!(
            !workspace.join("second.md").exists(),
            "one run's approval let another run's command run"
        );
        assert_eq!(
            rpc.agent_state(&owner, Some(second.id))
                .await
                .expect("the second run's state")
                .mode,
            AgentMode::Plan
        );
        assert_eq!(
            rpc.agent_state(&owner, None)
                .await
                .expect("the daemon-wide record")
                .mode,
            AgentMode::Plan
        );
    }

    /// The compatibility pin at the wire: no run id, no change — the daemon-wide loop
    /// is the record `agent.approve_mode` moves, exactly as before OD-E2b.
    #[tokio::test]
    async fn without_a_run_id_the_daemon_loop_is_the_one_that_switches() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project();
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);
        let owner = owner();

        let run = rpc
            .start_run(&owner, project.id, "Untouched".to_string())
            .await
            .expect("the run starts");

        let transition = rpc
            .approve_agent_mode(&owner, None)
            .await
            .expect("the daemon-wide record is approved");
        assert_eq!(transition.to, AgentMode::Agent);
        assert_eq!(
            rpc.agent_state(&owner, None)
                .await
                .expect("the daemon-wide record")
                .mode,
            AgentMode::Agent
        );

        // The run's own loop was not part of that switch: it still plans, and its
        // proposed write does not run.
        assert_eq!(
            rpc.agent_state(&owner, Some(run.id))
                .await
                .expect("the run's state")
                .mode,
            AgentMode::Plan
        );
        let planned = rpc
            .agent_turn_run(&owner, run.id, "write file notes/global.md: no".to_string())
            .await
            .expect("the run's turn runs");
        assert_eq!(planned.mode, AgentMode::Plan);
        assert!(planned.tools.is_empty(), "{:?}", planned.tools);
        assert!(!temp
            .path()
            .join("workspace")
            .join("notes")
            .join("global.md")
            .exists());

        // The read-only direction is unchanged too.
        let back = rpc
            .return_agent_to_plan(&owner, None)
            .await
            .expect("the daemon-wide record returns to plan");
        assert_eq!(back.to, AgentMode::Plan);
    }

    /// A run can be put back into Plan over the wire, and its next turn executes
    /// nothing again.
    #[tokio::test]
    async fn a_run_returns_to_plan_over_the_wire() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project();
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);
        let owner = owner();

        let run = rpc
            .start_run(&owner, project.id, "Return".to_string())
            .await
            .expect("the run starts");
        // The daemon-wide record goes to Agent as well, so the return below has to be
        // shown to move the run's loop and not that one.
        rpc.approve_agent_mode(&owner, None)
            .await
            .expect("the daemon-wide record is approved");
        rpc.approve_agent_mode(&owner, Some(run.id))
            .await
            .expect("the run's loop is approved");
        assert_eq!(
            rpc.agent_state(&owner, Some(run.id))
                .await
                .expect("the run's state")
                .mode,
            AgentMode::Agent
        );

        let back = rpc
            .return_agent_to_plan(&owner, Some(run.id))
            .await
            .expect("the run's loop returns to plan");
        assert_eq!(back.from, AgentMode::Agent);
        assert_eq!(back.to, AgentMode::Plan);
        assert_eq!(
            rpc.agent_state(&owner, Some(run.id))
                .await
                .expect("the run's state")
                .mode,
            AgentMode::Plan
        );
        assert_eq!(
            rpc.agent_state(&owner, None)
                .await
                .expect("the daemon-wide record")
                .mode,
            AgentMode::Agent,
            "a run's return to plan moved the daemon-wide record"
        );

        let planned = rpc
            .agent_turn_run(&owner, run.id, "write file notes/back.md: no".to_string())
            .await
            .expect("the run's turn runs");
        assert_eq!(planned.mode, AgentMode::Plan);
        assert!(planned.tools.is_empty(), "{:?}", planned.tools);
        assert!(!temp
            .path()
            .join("workspace")
            .join("notes")
            .join("back.md")
            .exists());
    }

    /// An unknown run id is a clean refusal that names the run, on all three RPCs.
    #[tokio::test]
    async fn an_unknown_run_is_refused_by_the_run_scoped_mode_rpcs() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner();
        let unknown = RunId::new();
        let named = unknown.0.to_string();

        let refusals = [
            rpc.approve_agent_mode(&owner, Some(unknown))
                .await
                .expect_err("an unknown run is not approved"),
            rpc.return_agent_to_plan(&owner, Some(unknown))
                .await
                .expect_err("an unknown run is not returned to plan"),
            rpc.agent_state(&owner, Some(unknown))
                .await
                .expect_err("an unknown run has no state"),
        ];
        for error in refusals {
            let message = error.to_string();
            assert!(message.contains("no agent session"), "{message}");
            assert!(
                message.contains(&named),
                "the error did not name {named}: {message}"
            );
        }
    }
}

/// ENGINE E2 (OD-E2): the legacy daemon-wide `agent.turn` is retired. It refuses
/// with a migration error naming the per-run method, its policy row still gates the
/// refusal, and `agent.turn_run` still runs a turn end to end.
#[cfg(test)]
mod e2_legacy_retired {
    use super::*;

    fn owner() -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::owner(DeviceId::new()));
        ext
    }

    fn project() -> Project {
        Project {
            id: ProjectId::new(),
            name: "Retired Loop Project".to_string(),
            description: "Test".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
        }
    }

    #[tokio::test]
    async fn agent_turn_refuses_with_the_migration_message() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);

        let error = rpc
            .agent_turn(&owner(), "hello".to_string())
            .await
            .expect_err("the retired turn refuses");
        let message = error.to_string();
        assert!(message.contains("agent.turn is retired"), "{message}");
        // The refusal names what to use instead: a run's own loop.
        assert!(message.contains("agent.turn_run"), "{message}");
        // `authorize` ran first and its row still admits the owner, so what a caller
        // receives is the migration message and not a policy refusal.
        assert_ne!(
            error.code(),
            auth::rpc_codes::FORBIDDEN,
            "the refusal must be the migration message, not a policy error: {message}"
        );
    }

    #[tokio::test]
    async fn agent_turn_still_needs_an_authenticated_owner() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);

        // No actor at all: the policy row refuses before the retirement message, which
        // is what shows the row is still the gate it was and not a leftover.
        let error = rpc
            .agent_turn(&RpcExtensions::new(), "hello".to_string())
            .await
            .expect_err("an unauthenticated session is refused");
        assert_eq!(error.code(), auth::rpc_codes::UNAUTHENTICATED, "{error}");
        assert!(!error.to_string().contains("is retired"), "{error}");
    }

    #[tokio::test]
    async fn the_per_run_method_still_runs_a_turn() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project();
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);

        let run = rpc
            .start_run(&owner(), project.id, "Build a todo app".to_string())
            .await
            .expect("the run starts");
        let turn = rpc
            .agent_turn_run(&owner(), run.id, "hello".to_string())
            .await
            .expect("the run's turn runs");
        assert_eq!(turn.mode, AgentMode::Plan);
        assert!(
            turn.response.contains("Plan (nothing executed)"),
            "{}",
            turn.response
        );
    }
}

/// ENGINE E5 wiring: `gates.evidence` returns Gate C evidence for a
/// repository-backed run, with the test program judged by the command policy.
#[cfg(test)]
mod e5_wiring {
    use super::*;
    use std::process::Command;

    fn owner() -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::owner(DeviceId::new()));
        ext
    }

    fn code(error: &jsonrpsee::types::ErrorObjectOwned) -> i32 {
        error.code()
    }

    fn project(repo_path: Option<String>) -> Project {
        Project {
            id: ProjectId::new(),
            name: "Evidence Project".to_string(),
            description: "Test".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path,
            repo_url: None,
        }
    }

    fn git_repo(dir: &std::path::Path) {
        std::fs::write(dir.join("base.txt"), "base").expect("a base file");
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
            vec!["add", "."],
            vec!["commit", "-qm", "base"],
        ] {
            let status = Command::new("git")
                .current_dir(dir)
                .args(&args)
                .status()
                .expect("git runs");
            assert!(status.success(), "git {args:?} failed");
        }
    }

    async fn start(store: &Store, rpc: &WarshaRpc, project: &Project, gate_c: bool) -> Run {
        let run = rpc
            .start_run(&owner(), project.id, "Build a todo app".to_string())
            .await
            .expect("the run starts");
        if gate_c {
            let mut stored = store.get_run(run.id).await.expect("the run");
            stored.current_stage = Stage::GateC;
            store.update_run(&stored).await.expect("the stage moves");
        }
        run
    }

    #[tokio::test]
    async fn evidence_carries_the_diff_and_the_policy_checked_test() {
        let temp = crate::test_util::fresh_tempdir();
        let repo = tempfile::tempdir().expect("a repo");
        git_repo(repo.path());
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project(Some(repo.path().display().to_string()));
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);
        let run = start(&store, &rpc, &project, true).await;
        let worktree = rpc
            .run_worktree(&owner(), run.id)
            .await
            .expect("reported")
            .expect("a worktree");
        std::fs::write(worktree.path.join("base.txt"), "changed").expect("change");
        std::fs::write(worktree.path.join("made.txt"), "made").expect("create");

        let evidence = rpc
            .gate_evidence(
                &owner(),
                run.id,
                "git".to_string(),
                vec!["--version".to_string()],
            )
            .await
            .expect("the evidence is collected");

        assert!(evidence.diff.contains("base.txt"), "{}", evidence.diff);
        assert!(
            evidence.files_changed.iter().any(|path| path == "made.txt"),
            "{:?}",
            evidence.files_changed
        );
        assert!(evidence.tests.success);
        assert!(
            evidence.tests.stdout.contains("git version"),
            "{}",
            evidence.tests.stdout
        );
    }

    #[tokio::test]
    async fn a_shell_program_is_refused_by_policy() {
        let temp = crate::test_util::fresh_tempdir();
        let repo = tempfile::tempdir().expect("a repo");
        git_repo(repo.path());
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project(Some(repo.path().display().to_string()));
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);
        let run = start(&store, &rpc, &project, true).await;

        let error = rpc
            .gate_evidence(
                &owner(),
                run.id,
                "sh".to_string(),
                vec!["-c".to_string(), "true".to_string()],
            )
            .await
            .expect_err("a shell is refused by the command policy");
        assert_eq!(code(&error), auth::rpc_codes::POLICY_REFUSED);
    }

    #[tokio::test]
    async fn evidence_needs_gate_c_and_a_worktree() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project(None);
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);

        let not_gate_c = start(&store, &rpc, &project, false).await;
        let error = rpc
            .gate_evidence(
                &owner(),
                not_gate_c.id,
                "git".to_string(),
                vec!["--version".to_string()],
            )
            .await
            .expect_err("a run outside Gate C has no evidence");
        assert!(error.to_string().contains("Gate C"), "{error}");

        let gate_c = start(&store, &rpc, &project, true).await;
        let error = rpc
            .gate_evidence(
                &owner(),
                gate_c.id,
                "git".to_string(),
                vec!["--version".to_string()],
            )
            .await
            .expect_err("a run without a worktree has no evidence");
        assert!(error.to_string().contains("no worktree"), "{error}");
    }

    /// The address `tests::preview_probe` prints. That fixture constant is private
    /// to the `tests` module, so the same value is spelled here.
    const PROBE_URL: &str = "http://127.0.0.1:5199/";

    /// The command line that starts one `tests::preview_probe` dev server — the
    /// same probe the preview RPC tests run, named from this module.
    fn preview_probe_line() -> String {
        let exe = std::env::current_exe().expect("the test binary names itself");
        format!(
            "{} --exact tests::preview_probe --ignored --nocapture",
            exe.display()
        )
    }

    /// A state whose process policy admits the probe as a preview and `git` as the
    /// Gate C test program.
    async fn state_that_admits_the_preview(
        data_dir: &std::path::Path,
        command: &str,
    ) -> (Arc<DaemonState>, Arc<Store>) {
        let program = command
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_string();
        crate::tests::test_state_with_seams(
            data_dir,
            move |config| config.allowed_commands = vec!["git".to_string(), program],
            None,
            None,
            None,
        )
        .await
    }

    /// The preview joins the diff and the tests: a dev server the owner already runs
    /// for the run's project is recorded, with the URL it printed.
    #[tokio::test]
    async fn evidence_carries_the_url_of_a_running_preview() {
        let temp = crate::test_util::fresh_tempdir();
        let repo = tempfile::tempdir().expect("a repo");
        git_repo(repo.path());
        let command = preview_probe_line();
        let (state, store) = state_that_admits_the_preview(temp.path(), &command).await;
        let project = project(Some(repo.path().display().to_string()));
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);
        let run = start(&store, &rpc, &project, true).await;

        // The preview the panel starts: one per project, started before evidence.
        let started = rpc
            .start_preview(&owner(), project.id.to_string(), command)
            .await
            .expect("the preview starts");
        assert_eq!(started.url.as_deref(), Some(PROBE_URL));

        let evidence = rpc
            .gate_evidence(
                &owner(),
                run.id,
                "git".to_string(),
                vec!["--version".to_string()],
            )
            .await
            .expect("the evidence is collected");

        let preview = evidence
            .preview
            .expect("the running preview is part of the evidence");
        assert_eq!(preview.url.as_deref(), Some(PROBE_URL));
        assert_eq!(preview.status, ProcessStatus::Running);
        assert_eq!(preview.project_id, project.id.to_string());
        assert_eq!(preview.process_id, started.process_id);

        // Read-only: the evidence reported the preview that was already running.
        let after = rpc
            .preview_status(&owner(), project.id.to_string())
            .await
            .expect("the preview is still tracked");
        assert_eq!(after.process_id, started.process_id);
        assert_eq!(after.status, ProcessStatus::Running);

        rpc.stop_preview(&owner(), project.id.to_string())
            .await
            .expect("the preview stops");
    }

    /// No preview is an explicit `None` in the evidence, not an error and not a
    /// field that disappears from the response.
    #[tokio::test]
    async fn evidence_without_a_preview_carries_an_explicit_none() {
        let temp = crate::test_util::fresh_tempdir();
        let repo = tempfile::tempdir().expect("a repo");
        git_repo(repo.path());
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project(Some(repo.path().display().to_string()));
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state);
        let run = start(&store, &rpc, &project, true).await;

        let evidence = rpc
            .gate_evidence(
                &owner(),
                run.id,
                "git".to_string(),
                vec!["--version".to_string()],
            )
            .await
            .expect("a run with no preview still has Gate C evidence");

        assert!(
            evidence.preview.is_none(),
            "a preview appeared without one being started"
        );
        let value = serde_json::to_value(&evidence).expect("the evidence serialises");
        assert!(
            value.get("preview").is_some_and(serde_json::Value::is_null),
            "an absent preview must be an explicit null: {value}"
        );
    }

    /// The read-only pin: collecting evidence never starts a dev server.
    #[tokio::test]
    async fn evidence_collection_never_starts_a_preview() {
        let temp = crate::test_util::fresh_tempdir();
        let repo = tempfile::tempdir().expect("a repo");
        git_repo(repo.path());
        let (state, store) = crate::tests::test_state(temp.path()).await;
        let project = project(Some(repo.path().display().to_string()));
        store.create_project(&project).await.expect("the project");
        let rpc = WarshaRpc::new(state.clone());
        let run = start(&store, &rpc, &project, true).await;

        rpc.gate_evidence(
            &owner(),
            run.id,
            "git".to_string(),
            vec!["--version".to_string()],
        )
        .await
        .expect("the evidence is collected");

        // The manager is the state the pin reads: the project was never started, and
        // it is still not started after the evidence was collected.
        let previews = state.previews.list().await;
        assert!(
            previews.is_empty(),
            "evidence collection started a preview: {previews:?}"
        );
        assert!(
            state
                .previews
                .status(&project.id.to_string(), Some(&run.id.0.to_string()))
                .await
                .is_err(),
            "evidence collection registered a preview for the run's project"
        );
    }
}
/// ENGINE E8 (pilot): the whole loop once, end to end, on the daemon's own mock
/// provider — attach a repository, start a run, let the run's own agent loop edit
/// its worktree, walk the pipeline to Gate C, take the decision, and collect the
/// evidence a reviewer reads.
///
/// It is `#[ignore]`d because it spawns two child processes (the Gate C test
/// program and the preview server), which a plain unit-test run should not: it runs
/// with `cargo test -p warshad -- --ignored pilot`. No key, no secret and no
/// network to a real model API is involved: every model call is answered by
/// `MockProvider`, and the two child processes are this test binary itself.
#[cfg(test)]
mod e8_wiring {
    use super::*;
    use std::process::Command;

    /// The address the preview's probe prints. `tests::preview_probe` owns that
    /// fixture and its constant is private to the `tests` module, so the same value
    /// is spelled here — exactly as the E5 wiring tests do.
    const PROBE_URL: &str = "http://127.0.0.1:5199/";

    /// What the Gate C test program prints, and what the evidence must carry: the
    /// reviewer is shown the measured output, not a claim that a test ran.
    const TEST_MARKER: &str = "e8 pilot gate c test probe: ok";

    fn owner() -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::owner(DeviceId::new()));
        ext
    }

    /// A repository with one committed file, which is what `projects.attach` takes
    /// and what the run's worktree is created from.
    fn git_repo(dir: &std::path::Path) {
        std::fs::write(dir.join("base.txt"), "base").expect("a base file");
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "Test"],
            vec!["add", "."],
            vec!["commit", "-qm", "base"],
        ] {
            let status = Command::new("git")
                .current_dir(dir)
                .args(&args)
                .status()
                .expect("git runs");
            assert!(status.success(), "git {args:?} failed");
        }
    }

    fn current_exe() -> String {
        std::env::current_exe()
            .expect("the test binary names itself")
            .display()
            .to_string()
    }

    /// The Gate C test program: one passing test of this binary, selected exactly.
    ///
    /// It stands in for a project's own `cargo test` — the daemon only ever sees a
    /// program, its arguments and the measured result, and this is a real program
    /// that really exits 0 and really prints [`TEST_MARKER`]. `#[ignore]` keeps it
    /// out of a plain `cargo test`; the pilot runs it by name.
    #[test]
    #[ignore = "run by the E8 pilot as its Gate C test program"]
    fn gate_c_test_probe() {
        println!("{TEST_MARKER}");
    }

    /// The program and arguments the pilot measures at Gate C.
    fn test_program() -> (String, Vec<String>) {
        (
            current_exe(),
            vec![
                "--exact".to_string(),
                "e8_wiring::gate_c_test_probe".to_string(),
                "--ignored".to_string(),
                "--nocapture".to_string(),
            ],
        )
    }

    /// The command line that starts one `tests::preview_probe` dev server — the
    /// probe the E5 preview tests run, named from this module.
    fn preview_line() -> String {
        format!(
            "{} --exact tests::preview_probe --ignored --nocapture",
            current_exe()
        )
    }

    /// The daemon state the pilot runs on. The test binary is the only allow-listed
    /// program because it is both the Gate C test program and the preview server;
    /// everything else is the state a real daemon would build, with the mock
    /// provider registered.
    async fn pilot_state(data_dir: &std::path::Path) -> (Arc<DaemonState>, Arc<Store>) {
        let program = current_exe();
        crate::tests::test_state_with_seams(
            data_dir,
            move |config| config.allowed_commands = vec![program],
            None,
            None,
            None,
        )
        .await
    }

    /// Route the seven roles the walk to Gate C meets to the daemon's own mock
    /// provider, through `roles.set` — the RPC an owner uses, so the walk is not
    /// reading a table a test wrote behind the daemon's back.
    async fn route_the_walk_to_the_mock(rpc: &WarshaRpc, owner: &RpcExtensions) {
        for role in [
            Role::Intake,
            Role::Researcher,
            Role::PM,
            Role::Designer,
            Role::Architect,
            Role::Coder,
            Role::Reviewer,
        ] {
            let name = serde_json::to_value(role)
                .expect("a role serialises")
                .as_str()
                .expect("a role serialises as a name")
                .to_string();
            rpc.set_role(
                owner,
                RoleRoutingConfig {
                    role: name,
                    targets: vec![RoutingTargetConfig {
                        provider_id: MOCK_PROVIDER_ID.to_string(),
                        model_id: "mock-model".to_string(),
                        weight: 100,
                    }],
                    fallback_enabled: false,
                    budget_cents_per_run: None,
                },
            )
            .await
            .expect("the role routes to the mock provider");
        }
    }

    /// ENGINE E8's acceptance test: the loop a client drives, once, on the mock
    /// provider — `projects.create` → `projects.attach` → `runs.start` → the run's
    /// own agent turn → `runs.advance`/`gates.approve` to Gate C → `gates.evidence`
    /// → the Gate C decision.
    #[tokio::test]
    #[ignore = "pilot: spawns child processes; run with `cargo test -p warshad -- --ignored pilot`"]
    async fn pilot_attaches_a_repository_runs_decides_gate_c_and_collects_evidence() {
        let temp = crate::test_util::fresh_tempdir();
        let repo = tempfile::tempdir().expect("a repo dir");
        git_repo(repo.path());
        let (state, _store) = pilot_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner();

        // 1. `projects.create` → `projects.attach`: the entry point is the RPC a
        //    client calls, not a row written behind the daemon's back.
        let project = rpc
            .create_project(
                &owner,
                "Pilot Project".to_string(),
                "Pilot".to_string(),
                "en".to_string(),
            )
            .await
            .expect("the project is created");
        assert_eq!(
            project.repo_path, None,
            "a project starts with no repository"
        );
        let repo_path = repo.path().display().to_string();
        let attached = rpc
            .attach_project(&owner, project.id, repo_path.clone())
            .await
            .expect("the repository attaches");
        assert_eq!(attached.repo_path.as_deref(), Some(repo_path.as_str()));

        // 2. Every role the walk meets answers from the daemon's own mock provider.
        route_the_walk_to_the_mock(&rpc, &owner).await;

        // 3. `runs.start`: the run gets its own worktree of that repository.
        let run = rpc
            .start_run(&owner, project.id, "Build a todo app".to_string())
            .await
            .expect("the run starts");
        let worktree = rpc
            .run_worktree(&owner, run.id)
            .await
            .expect("the worktree is reported")
            .expect("the run has a worktree");
        assert!(worktree.path.is_dir(), "the run's worktree is a directory");
        assert_eq!(
            std::fs::read_to_string(worktree.path.join("base.txt")).expect("the checked-out file"),
            "base"
        );

        // 4. The run's own agent loop edits the run's worktree: Plan proposes and
        //    executes nothing, the owner approves that run, then the read the
        //    read-before-write rule needs and the write itself both run.
        let edit = "write file base.txt: built by the pilot";
        let planned = rpc
            .agent_turn_run(&owner, run.id, edit.to_string())
            .await
            .expect("the plan turn runs");
        assert_eq!(planned.mode, AgentMode::Plan);
        assert!(
            planned.tools.is_empty(),
            "a Plan turn executed {:?}",
            planned.tools
        );
        assert_eq!(
            std::fs::read_to_string(worktree.path.join("base.txt")).expect("the file"),
            "base",
            "a Plan turn changed the worktree"
        );

        rpc.approve_agent_mode(&owner, Some(run.id))
            .await
            .expect("the run's loop is approved");
        let read = rpc
            .agent_turn_run(&owner, run.id, "read file base.txt".to_string())
            .await
            .expect("the read turn runs");
        assert_eq!(read.mode, AgentMode::Agent);
        assert!(
            read.tools.iter().all(|tool| tool.success),
            "the read did not run: {:?}",
            read.tools
        );
        let written = rpc
            .agent_turn_run(&owner, run.id, edit.to_string())
            .await
            .expect("the approved write runs");
        assert_eq!(written.mode, AgentMode::Agent);
        assert!(
            written.tools.len() == 1 && written.tools[0].success,
            "the write did not run: {:?}",
            written.tools
        );
        assert_eq!(
            std::fs::read_to_string(worktree.path.join("base.txt")).expect("the file"),
            "built by the pilot"
        );

        // 5. The pipeline walks to Gate C the way a client drives it: advance to the
        //    next undecided gate, decide it, advance again.
        let at_gate_a = rpc
            .advance_run(&owner, run.id)
            .await
            .expect("the run reaches Gate A");
        assert_eq!(at_gate_a.current_stage, Stage::GateA);
        rpc.approve_gate(&owner, run.id, Stage::GateA, None)
            .await
            .expect("Gate A is approved");

        let at_gate_b = rpc
            .advance_run(&owner, run.id)
            .await
            .expect("the run reaches Gate B");
        assert_eq!(at_gate_b.current_stage, Stage::GateB);
        // The routed mock answered the stages before this gate, not a fake fallback.
        assert_eq!(
            at_gate_b.artifacts["research"].content, "Mock response",
            "the Research stage was not answered by the mock provider"
        );
        rpc.approve_gate(&owner, run.id, Stage::GateB, None)
            .await
            .expect("Gate B is approved");

        let at_gate_c = rpc
            .advance_run(&owner, run.id)
            .await
            .expect("the run reaches Gate C");
        assert_eq!(at_gate_c.current_stage, Stage::GateC);
        for stage in ["design", "plan_tasks", "code", "review_qa_security"] {
            assert_eq!(
                at_gate_c.artifacts[stage].content, "Mock response",
                "the {stage} stage was not answered by the mock provider"
            );
        }

        // 6. The preview the panel starts, then the evidence a Gate C reviewer reads.
        let preview = rpc
            .start_preview(&owner, project.id.to_string(), preview_line())
            .await
            .expect("the preview starts");
        assert_eq!(preview.url.as_deref(), Some(PROBE_URL));

        let (program, args) = test_program();
        let evidence = rpc
            .gate_evidence(&owner, run.id, program.clone(), args.clone())
            .await
            .expect("the evidence is collected");

        // The diff is the agent's change in the run's worktree...
        assert!(
            evidence.diff.contains("base.txt"),
            "the diff does not name the file the agent changed: {}",
            evidence.diff
        );
        assert!(
            evidence.diff.contains("built by the pilot"),
            "the diff does not carry the agent's content: {}",
            evidence.diff
        );
        assert!(
            evidence.files_changed.iter().any(|path| path == "base.txt"),
            "the changed paths do not name base.txt: {:?}",
            evidence.files_changed
        );
        // ...the measured test run is passing, and it is the program the caller named...
        assert!(evidence.tests.success, "{:?}", evidence.tests);
        assert_eq!(evidence.tests.program, program);
        assert_eq!(evidence.tests.args, args);
        assert_eq!(evidence.tests.exit_code, Some(0));
        assert!(
            evidence.tests.stdout.contains(TEST_MARKER),
            "the measured output is not the test's: {}",
            evidence.tests.stdout
        );
        // ...and the preview that is already up is part of it.
        let running = evidence
            .preview
            .as_ref()
            .expect("the running preview is part of the evidence");
        assert_eq!(running.url.as_deref(), Some(PROBE_URL));
        assert_eq!(running.status, ProcessStatus::Running);
        assert_eq!(running.project_id, project.id.to_string());
        assert_eq!(running.process_id, preview.process_id);

        // 7. The Gate C decision, over the wire. The run's ledger, the queue read
        //    and the run's event log all have to agree that it was decided.
        let decided = rpc
            .approve_gate(&owner, run.id, Stage::GateC, None)
            .await
            .expect("Gate C is approved");
        assert_eq!(
            decided.current_stage,
            Stage::GateC,
            "a decision must not move the run off the gate it decides"
        );
        assert!(
            matches!(
                decided.gate_states.get(&Stage::GateC),
                Some(GateState::Approved { .. })
            ),
            "the deciding run carries no approval: {:?}",
            decided.gate_states
        );

        let gates = rpc
            .list_gates(&owner, run.id, None)
            .await
            .expect("the queue is served");
        let gate_c = gates
            .iter()
            .find(|gate| gate.stage == Stage::GateC)
            .expect("Gate C is in the queue");
        assert!(
            matches!(gate_c.state, GateSummaryState::Approved { .. }),
            "the queue does not report the decision: {gate_c:?}"
        );

        let events = rpc
            .get_events(&owner, run.id)
            .await
            .expect("the run's events are served");
        let decision = events
            .iter()
            .find(|event| event.stage == Stage::GateC && event.kind == EventKind::GateDecision)
            .expect("the Gate C decision is on the run's log");
        assert_eq!(decision.payload["decision"], "approved");
        assert!(
            decision.payload["artifacts_sha256"].is_string(),
            "the decision does not name what it approved: {}",
            decision.payload
        );

        // 8. The evidence outlives the decision: the reviewer's record is the same
        //    one after the gate was decided, and the decision itself moves nothing
        //    the evidence measured.
        let after = rpc
            .gate_evidence(&owner, run.id, program, args)
            .await
            .expect("the evidence is still collectible after the decision");
        assert_eq!(after.diff, evidence.diff);
        assert_eq!(after.files_changed, evidence.files_changed);
        assert!(after.tests.success);
        assert_eq!(
            after
                .preview
                .as_ref()
                .expect("the preview is still up")
                .url
                .as_deref(),
            Some(PROBE_URL)
        );

        rpc.stop_preview(&owner, project.id.to_string())
            .await
            .expect("the preview stops");
    }
}
