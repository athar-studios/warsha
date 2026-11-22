//! The daemon's agent runtime: how a loop is built, what of it survives a restart, and
//! how the owner's routing table reaches the router.
//!
//! Moved out of `lib.rs` unchanged (P-H1 step A7, pure move). `lib.rs` re-exports
//! [`AgentLoopSnapshot`] at the crate root, so every existing `warshad::…` path still
//! resolves.
//!
//! One item moved further than the region: `WarshaRpc::backend_kit` — the kit
//! resolution an export reads — came with it (P-H1 finding F5, PM decision in
//! `DECISIONS.md` 2026-11-14). It sat inside `impl WarshaRpc`, so leaving it behind
//! would have kept kit resolution in the RPC core while the loop it feeds lives here;
//! the method lives here now and the RPC core keeps only the call.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::warn;
use warsha_core::*;
use warsha_pipeline::{
    AgentLoop, AskUserQueue, BackendKit, CommandPolicy, FilesystemToolExecutor, McpApprovals,
    McpManager, MessageBus, ModeManager, ProviderRouterAdapter, StaticPermissions, TodoList,
    AGENT_ROLE,
};
use warsha_providers::ProviderRouter;

use crate::{
    default_backend_kit, DaemonError, DeferredProvider, ProviderFactory, Result, RoleRoutingConfig,
    RoutingTargetConfig, SettingsStore, WarshaRpc,
};

/// Directory under the daemon's data directory the agent loop's file tools read
/// and write in.
///
/// One directory per daemon, not one per run: an agent turn is the owner's
/// conversation and belongs to no run, so every path a turn names resolves inside
/// this single directory — and nothing outside it, because
/// [`FilesystemToolExecutor`] refuses a path that escapes. Pointing the loop at a
/// project's repository instead is a caller's decision, and is not made here.
pub(crate) const AGENT_WORKSPACE_DIR: &str = "workspace";

/// The budget meter key the agent turn's model calls are recorded under.
///
/// A turn belongs to no run, so its spend cannot be metered against a project id.
/// The router's cost meter keys on this one stable string instead, which is what
/// `ProviderRouterAdapter` takes as its `project_id`.
pub(crate) const AGENT_METER_KEY: &str = "agent-loop";

/// The daemon-wide agent loop (`agent.state` / `agent.approve_mode` / `agent.plan_mode`
/// — its turn RPC `agent.turn` is retired): the real filesystem tool layer under the
/// daemon's data directory, and the real provider router behind the model call,
/// routed as [`AGENT_ROLE`].
///
/// Both halves are seams the loop only reports on: with no role routing set the
/// loop answers that no provider is routed for the agent role, and a tool request
/// whose path leaves the workspace is refused — neither is a panic and neither is
/// a silent no-op.
pub(crate) fn build_agent_loop(
    data_dir: &Path,
    allowed_commands: &[String],
    providers: Arc<RwLock<ProviderRouter>>,
    mcp: Arc<dyn McpManager>,
    mcp_permissions: Arc<StaticPermissions>,
    mcp_approvals: Arc<McpApprovals>,
    backend_kit: Arc<RwLock<BackendKit>>,
) -> Arc<RwLock<AgentLoop>> {
    Arc::new(RwLock::new(build_agent_loop_in(
        &data_dir.join(AGENT_WORKSPACE_DIR),
        allowed_commands,
        providers,
        mcp,
        mcp_permissions,
        mcp_approvals,
        // The daemon-wide loop turns for no run, so it never consumes a grant and
        // never registers a pending entry: its `agent.turn` is retired (OD-E2).
        None,
        backend_kit,
        None,
    )))
}

/// The same loop bound to an explicit workspace: a run's own worktree when it has
/// one, or the daemon's default workspace for the legacy single conversation.
/// Every seam a loop is built from, beside the workspace it runs in.
///
/// Eight positional arguments is one more than clippy allows and, more to the
/// point, four of them are the MCP triple plus a run id that only make sense
/// together: a caller that wired a registry and forgot the run id would fail every
/// grant lookup silently, so they stay in one list at the call site.
#[allow(clippy::too_many_arguments)]
pub(crate) fn build_agent_loop_in(
    workspace_dir: &Path,
    allowed_commands: &[String],
    providers: Arc<RwLock<ProviderRouter>>,
    mcp: Arc<dyn McpManager>,
    mcp_permissions: Arc<StaticPermissions>,
    mcp_approvals: Arc<McpApprovals>,
    run_id: Option<String>,
    backend_kit: Arc<RwLock<BackendKit>>,
    permissions: Option<ProjectPermissions>,
) -> AgentLoop {
    // Effective permission resolved from run-specific policy.
    let policy = permissions
        .map(warsha_pipeline::policy_for_permissions)
        .unwrap_or_default();
    if let Err(error) = std::fs::create_dir_all(workspace_dir) {
        // The turn still starts; every `RunCommand`/file tool that needs the
        // workspace will fail its `current_dir`, so say why here instead of
        // leaving only an opaque per-command spawn error.
        warn!(
            "the agent workspace `{}` could not be created: {error}",
            workspace_dir.display()
        );
    }
    let command_policy = CommandPolicy::from_config(allowed_commands)
        // B3: owner rules sit on top of the allowlist, never instead of it.
        // The daemon-wide loop carries no rules yet — the per-run store is
        // loaded from the settings table when a run starts (rules.load RPC).
        // An empty store evaluates every tool to `Allow` (= axis default), so
        // installing it unconditionally changes nothing until rules are set.
        .with_rule_store(Arc::new(InMemoryRuleStore::new()));
    let tools = FilesystemToolExecutor::new(workspace_dir.to_path_buf())
        .with_protection(Some(policy))
        .with_read_before_write(policy.read_before_write)
        .with_command_policy(command_policy)
        // B3: native `RunCommand` asks go to the same shared queue the MCP
        // asks use. The daemon-wide loop (run id `None`) can never register
        // one — `register_pending` is only reached with a run id present.
        .with_mcp_approvals(mcp_approvals.clone(), run_id.clone());
    let router = ProviderRouterAdapter::new(providers, AGENT_ROLE, AGENT_METER_KEY);
    let agent_loop = AgentLoop::with_tool_executor(Box::new(tools))
        .with_router(Arc::new(router))
        .with_mcp(mcp)
        .with_mcp_permissions(mcp_permissions)
        .with_mcp_approvals(mcp_approvals)
        .with_backend_kit(backend_kit);
    // A run's loop carries its id so a one-time grant can be bound to it; the
    // daemon-wide loop passes none and can therefore never consume one.
    match run_id {
        Some(run_id) => agent_loop.with_run_id(run_id),
        None => agent_loop,
    }
}

/// The settings document the role routing table is kept in.
const ROLE_ROUTINGS_DOCUMENT: &str = "role-routings";

/// The settings document the agent loop's conversation state is kept in.
const AGENT_LOOP_DOCUMENT: &str = "agent-loop";

/// The settings document owner-defined custom coding backends are kept in (R-NEXT N2).
pub(crate) const CUSTOM_BACKENDS_DOCUMENT: &str = "custom-backends";

/// The settings document per-project and per-role coding backend selections are kept in (R-NEXT N2).
pub(crate) const BACKEND_ROUTINGS_DOCUMENT: &str = "backend-routings";

/// Stored per-project / per-role coding backend selection configuration.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BackendRoutingsConfig {
    #[serde(default)]
    pub default_backend: Option<String>,
    #[serde(default)]
    pub role_backends: HashMap<String, String>,
    #[serde(default)]
    pub project_backends: HashMap<String, String>,
}

/// The provider id the daemon's own offline provider is registered under.
///
/// A routing may name it, and it is the only adapter that answers without a key or a
/// network — which is why it is the one thing every daemon starts with.
pub(crate) const MOCK_PROVIDER_ID: &str = "mock";

/// What of the agent loop survives a restart.
///
/// Four pieces, and only the four the owner can see: the mode and every switch that
/// got it there (the approval history the AC asks for), the todo list, the questions
/// the loop asked and the answers it was given, and the notes on the message bus. The
/// transcript is deliberately absent — the loop's own compactor holds it and hands out
/// no way to put one back, so a restart starts a bounded context rather than replaying
/// a memory nobody approved keeping.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AgentLoopSnapshot {
    /// Plan ↔ Agent state, with every approved switch.
    pub modes: ModeManager,
    /// What the loop said it would do, one item per turn.
    pub todos: TodoList,
    /// The `ask_user` questions and their answers.
    pub questions: AskUserQueue,
    /// The `send_message` notes.
    pub notes: MessageBus,
}

impl AgentLoopSnapshot {
    /// The current state of `loop_`, as one document.
    pub(crate) fn of(loop_: &AgentLoop) -> Self {
        Self {
            modes: loop_.mode_manager.clone(),
            todos: loop_.todo_list.clone(),
            questions: loop_.ask_queue.clone(),
            notes: loop_.message_bus.clone(),
        }
    }

    /// Put this state into a freshly built loop.
    pub(crate) fn restore(self, loop_: &mut AgentLoop) {
        let Self {
            modes,
            todos,
            questions,
            notes,
        } = self;
        loop_.mode_manager = modes;
        loop_.todo_list = todos;
        loop_.ask_queue = questions;
        loop_.message_bus = notes;
    }
}

/// The routing table as it was stored, or empty when nothing was stored.
///
/// A document that cannot be read is a warning and an empty table rather than a failed
/// start: a daemon that refused to boot would leave the owner with no way to see or fix
/// what it wrote, and an unrouted role already refuses every call it would have made.
pub(crate) async fn seed_role_routings(
    settings: &SettingsStore,
) -> Result<HashMap<Role, RoleRoutingConfig>> {
    let stored = match settings.load_document(ROLE_ROUTINGS_DOCUMENT).await {
        Ok(stored) => stored,
        Err(error) => {
            warn!("the routing table could not be read and starts empty: {error}");
            return Ok(HashMap::new());
        }
    };
    let Some(stored) = stored else {
        return Ok(HashMap::new());
    };
    let configs: Vec<RoleRoutingConfig> = match serde_json::from_value(stored) {
        Ok(configs) => configs,
        Err(error) => {
            warn!("the routing table is not a routing table and starts empty: {error}");
            return Ok(HashMap::new());
        }
    };
    let mut routings = HashMap::new();
    for config in configs {
        match routing_key(&config) {
            Ok(role) => {
                routings.insert(role, config);
            }
            Err(reason) => {
                // A row the daemon cannot honour is dropped here rather than kept and
                // refused at every call: the owner sees it the next time they set it.
                warn!("a stored routing is not usable and was dropped: {reason}");
            }
        }
    }
    Ok(routings)
}

/// The custom coding engine backends as stored in settings (R-NEXT N2).
pub(crate) async fn seed_custom_backends(
    settings: &SettingsStore,
) -> Result<Vec<warsha_core::config::CustomBackendDefinition>> {
    let stored = match settings.load_document(CUSTOM_BACKENDS_DOCUMENT).await {
        Ok(stored) => stored,
        Err(error) => {
            warn!("the custom backends document could not be read: {error}");
            return Ok(Vec::new());
        }
    };
    let Some(stored) = stored else {
        return Ok(Vec::new());
    };
    match serde_json::from_value::<Vec<warsha_core::config::CustomBackendDefinition>>(stored) {
        Ok(defs) => Ok(defs),
        Err(error) => {
            warn!("the custom backends document is not valid: {error}");
            Ok(Vec::new())
        }
    }
}

/// The per-project / per-role backend routing config as stored in settings (R-NEXT N2).
pub(crate) async fn seed_backend_routings(
    settings: &SettingsStore,
) -> Result<BackendRoutingsConfig> {
    let stored = match settings.load_document(BACKEND_ROUTINGS_DOCUMENT).await {
        Ok(stored) => stored,
        Err(error) => {
            warn!("the backend routings document could not be read: {error}");
            return Ok(BackendRoutingsConfig::default());
        }
    };
    let Some(stored) = stored else {
        return Ok(BackendRoutingsConfig::default());
    };
    match serde_json::from_value::<BackendRoutingsConfig>(stored) {
        Ok(cfg) => Ok(cfg),
        Err(error) => {
            warn!("the backend routings document is not valid: {error}");
            Ok(BackendRoutingsConfig::default())
        }
    }
}

/// Write the backend routings configuration to the daemon's settings (R-NEXT GAP-H1).
pub(crate) async fn store_backend_routings(
    settings: &SettingsStore,
    config: &BackendRoutingsConfig,
) -> Result<()> {
    let document = serde_json::to_value(config).map_err(|error| {
        DaemonError::Config(format!(
            "the backend routings could not be encoded: {error}"
        ))
    })?;
    settings
        .save_document(BACKEND_ROUTINGS_DOCUMENT, &document)
        .await?;
    Ok(())
}

/// The per-project / per-role backend routing config as loaded from settings.
pub(crate) async fn load_backend_routings(settings: &SettingsStore) -> BackendRoutingsConfig {
    seed_backend_routings(settings).await.unwrap_or_default()
}

/// The loop's stored conversation, if there is one.
pub(crate) async fn seed_agent_snapshot(
    settings: &SettingsStore,
) -> Result<Option<AgentLoopSnapshot>> {
    let stored = match settings.load_document(AGENT_LOOP_DOCUMENT).await {
        Ok(stored) => stored,
        Err(error) => {
            warn!("the agent conversation could not be read and starts fresh: {error}");
            return Ok(None);
        }
    };
    let Some(stored) = stored else {
        return Ok(None);
    };
    match serde_json::from_value::<AgentLoopSnapshot>(stored) {
        Ok(snapshot) => Ok(Some(snapshot)),
        Err(error) => {
            warn!("the agent conversation is not one this daemon can hold: {error}");
            Ok(None)
        }
    }
}

/// Give the router an adapter for every provider the owner has configured.
///
/// Nothing here calls a provider: what is registered is a [`DeferredProvider`], which
/// holds the row and the factory and builds the real adapter on the first call. That is
/// what lets a restart bring the configured providers back with no network at all — a
/// daemon that phoned home on boot would be slow, and one that started offline would
/// come up broken.
///
/// The count it answers is what a start-up log line carries, and nothing else: no key,
/// no endpoint, no provider name beyond the ones the owner chose to type.
pub(crate) async fn register_configured_providers(
    providers: &Arc<RwLock<ProviderRouter>>,
    settings: &SettingsStore,
    factory: &Arc<dyn ProviderFactory>,
) -> Result<usize> {
    let stored = settings.load_providers().await?;
    let mut registered = 0;
    for provider in stored {
        if !provider.enabled {
            continue;
        }
        if provider.name == MOCK_PROVIDER_ID || provider.name == "mock-503" {
            // The daemon's own offline provider owns this id; a row that tries to take
            // it is refused rather than silently replacing what every test routes to.
            warn!(
                "a stored provider is named {} and was not registered",
                provider.name
            );
            continue;
        }
        let deferred = DeferredProvider::new(provider.clone(), Arc::clone(factory));
        providers
            .write()
            .await
            .register_provider(Box::new(deferred));
        registered += 1;
    }
    Ok(registered)
}

/// Hand the router the owner's routing table.
///
/// Each role gets its targets in the order the owner set them (the router walks them
/// as a fallback list), and the agent role's per-run ceiling, when it names one, is
/// installed against [`AGENT_METER_KEY`] — the key every agent turn is metered under —
/// so the cap an owner writes is the cap the router enforces before it spends.
pub(crate) async fn apply_role_routings(
    providers: &Arc<RwLock<ProviderRouter>>,
    routings: &HashMap<Role, RoleRoutingConfig>,
) {
    let mut router = providers.write().await;
    for config in routings.values() {
        let Ok((role, routing)) = routing_for(config) else {
            continue;
        };
        if role == AGENT_ROLE {
            if let Some(cents) = routing.budget_cents_per_run {
                router.set_budget(AGENT_METER_KEY, cents);
            }
        }
        router.set_role_routing(routing);
    }
}

/// The role a config names, or the reason it names nothing.
fn role_from_name(name: &str) -> std::result::Result<Role, String> {
    serde_json::from_value::<Role>(serde_json::Value::String(name.trim().to_string()))
        .map_err(|_| format!("{name} is not one of the roles the pipeline knows"))
}

/// The name a role is stored and answered under.
fn role_name(role: Role) -> String {
    serde_json::to_value(role)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// The role and validation of a routing request, before anything is written.
///
/// The role has to be one the pipeline knows, and every target has to name both a
/// provider and a model: a routing with an empty provider id is a routing that resolves
/// to nothing at the call, and refusing it here is what makes `roles.set` mean what it
/// says it means.
fn routing_key(config: &RoleRoutingConfig) -> std::result::Result<Role, String> {
    let role = role_from_name(&config.role)?;
    if config.targets.is_empty() {
        return Err(format!("role {} has no target", config.role));
    }
    for target in &config.targets {
        if target.provider_id.trim().is_empty() {
            return Err(format!(
                "role {} names a target with no provider",
                config.role
            ));
        }
        if target.model_id.trim().is_empty() {
            return Err(format!("role {} names a target with no model", config.role));
        }
    }
    Ok(role)
}

/// The routing the router is given, from the validated config.
pub(crate) fn routing_for(
    config: &RoleRoutingConfig,
) -> std::result::Result<(Role, RoleRouting), String> {
    let role = routing_key(config)?;
    let targets = config
        .targets
        .iter()
        .map(|target| RoutingTarget {
            provider_id: target.provider_id.trim().to_string(),
            model_id: target.model_id.trim().to_string(),
            weight: target.weight,
        })
        .collect();
    Ok((
        role,
        RoleRouting {
            role,
            targets,
            fallback_enabled: config.fallback_enabled,
            budget_cents_per_run: config.budget_cents_per_run,
        },
    ))
}

/// The config a stored routing is reported as.
pub(crate) fn routing_config(role: Role, routing: &RoleRouting) -> RoleRoutingConfig {
    RoleRoutingConfig {
        role: role_name(role),
        targets: routing
            .targets
            .iter()
            .map(|target| RoutingTargetConfig {
                provider_id: target.provider_id.clone(),
                model_id: target.model_id.clone(),
                weight: target.weight,
            })
            .collect(),
        fallback_enabled: routing.fallback_enabled,
        budget_cents_per_run: routing.budget_cents_per_run,
        daily_spend_cap_cents: None,
    }
}

/// Write the routing table to the daemon's settings.
///
/// An owner's routing is only worth having if the next daemon reads the same table, so
/// every change is written through rather than kept in memory: a routing that dies with
/// the process is a routing that has to be set again by whoever restarts it.
pub(crate) async fn store_role_routings(
    settings: &SettingsStore,
    routings: &HashMap<Role, RoleRoutingConfig>,
) -> Result<()> {
    let mut configs: Vec<RoleRoutingConfig> = routings.values().cloned().collect();
    // Sorted so the document a daemon writes is comparable across runs: the same table
    // written twice is the same bytes, which is what makes it reviewable.
    configs.sort_by(|left, right| left.role.cmp(&right.role));
    let document = serde_json::to_value(configs).map_err(|error| {
        DaemonError::Config(format!("the routing table could not be encoded: {error}"))
    })?;
    settings
        .save_document(ROLE_ROUTINGS_DOCUMENT, &document)
        .await?;
    Ok(())
}

/// Write the loop's conversation to the daemon's settings.
pub(crate) async fn store_agent_snapshot(
    settings: &SettingsStore,
    snapshot: &AgentLoopSnapshot,
) -> Result<()> {
    let document = serde_json::to_value(snapshot).map_err(|error| {
        DaemonError::Config(format!(
            "the agent conversation could not be encoded: {error}"
        ))
    })?;
    settings
        .save_document(AGENT_LOOP_DOCUMENT, &document)
        .await?;
    Ok(())
}

impl WarshaRpc {
    /// The kit of a project key: the daemon's copy, else the stored row, else the
    /// default for that project.
    ///
    /// The order is the point. The in-memory copy is what a `backend.set` in this
    /// life put there; the stored row is what an earlier life left; the default is
    /// what a project that never exported gets, so the first export of a new
    /// project is the empty schema rather than nothing at all.
    pub(crate) async fn backend_kit(&self, key: &str, project_name: &str) -> BackendKit {
        if let Some(kit) = self.state.backend_kits.read().await.get(key) {
            return kit.clone();
        }
        match self.state.settings.load_backend_kit(key).await {
            Ok(Some(kit)) => kit,
            Ok(None) => default_backend_kit(project_name),
            Err(error) => {
                // A kit that cannot be read is reported and the default stands in:
                // an export is still worth producing, and the row is left untouched
                // for the next read.
                warn!("could not read the backend kit for `{key}`: {error}");
                default_backend_kit(project_name)
            }
        }
    }
}
