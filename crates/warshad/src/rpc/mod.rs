//! The daemon's JSON-RPC core: the `WarshaRpc` type and its inherent methods, the
//! `rpc_*` error constructors, and the permission-store adapter the pipeline reads.
//!
//! Moved out of `lib.rs` unchanged (P-H1 step A8, pure move). `lib.rs` re-exports
//! [`WarshaRpc`] publicly and the helpers at crate visibility, so every existing
//! `warshad::…` / `crate::…` path still resolves.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use jsonrpsee::{
    core::{async_trait, RpcResult},
    types::{ErrorObject, ErrorObjectOwned},
};
use tracing::{info, warn};
use warsha_core::*;
use warsha_pipeline::{AgentMode, BackendKit, ModeTransition, SlashCommand};
use warsha_providers::OneClickProvider;
use warsha_store::{
    Store, StoredHarness, StoredIntegration, StoredPlugin, StoredProvider, StoredSkill,
};

use crate::skills::{catalog_from_registry, verified_skill_registry};
use crate::{
    auth, paired_device_is_active, store_agent_snapshot, wave2, Actor, ActorRole,
    AgentLoopSnapshot, DaemonState, Policy, ProcessPolicy, Result, RpcExtensions,
};

/// The JSON-RPC error a `providers.*` refusal carries.
///
/// The message is the reason the owner is shown, and every message this module
/// builds is written for that: no key, no request headers, no base URL that could
/// carry a token in its query string.
pub(crate) fn provider_refusal(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(-32000, message.into(), None::<()>)
}

/// RPC implementation
pub struct WarshaRpc {
    pub(crate) state: Arc<DaemonState>,
    pub(crate) start_time: std::time::Instant,
}

impl WarshaRpc {
    pub fn new(state: Arc<DaemonState>) -> Self {
        Self {
            state,
            start_time: std::time::Instant::now(),
        }
    }

    /// Resolve the Secretary's daily spend cap in cents:
    /// 1. Explicit `daily_spend_cap_cents` on `Role::Secretary` routing config when set.
    /// 2. Otherwise the smallest existing per-run default (`solo-bench` = 100 cents),
    ///    capped lower if a role already configures a smaller per-run budget.
    pub(crate) async fn secretary_daily_cap_cents(&self) -> u64 {
        let routings = self.state.role_routings.read().await;
        if let Some(cap) = routings
            .get(&Role::Secretary)
            .and_then(|cfg| cfg.daily_spend_cap_cents)
        {
            return cap;
        }
        let smallest_configured = routings
            .values()
            .filter_map(|cfg| cfg.budget_cents_per_run)
            .min();
        match smallest_configured {
            Some(configured) => configured.min(crate::secretary::DEFAULT_SECRETARY_DAILY_CAP_CENTS),
            None => crate::secretary::DEFAULT_SECRETARY_DAILY_CAP_CENTS,
        }
    }

    /// The run a preview for `project_id` is in context of, if there is one.
    ///
    /// The newest run of the project that has not finished: that is the run a
    /// server started now is registered under, and the run whose server
    /// `preview.status` answers for (R-BRIDGE-B5 D4). A project with no live run —
    /// a preview started outside a run, or after every run ended — has no run
    /// context, and the preview stays the project's own.
    ///
    /// The wire is frozen (OD-B2): `preview.start` and `preview.status` carry the
    /// project and nothing else, so the context a call arrives in is read from the
    /// store rather than added to the params.
    pub(crate) async fn live_run_id(&self, project_id: &str) -> Option<String> {
        let id = ProjectId(uuid::Uuid::parse_str(project_id.trim()).ok()?);
        let runs = self.state.store.list_runs(id).await.ok()?;
        // `list_runs` is newest first, so the first unfinished one is the newest.
        runs.into_iter()
            .find(|run| {
                !matches!(
                    run.status,
                    RunStatus::Completed | RunStatus::Failed | RunStatus::Cancelled
                )
            })
            .map(|run| run.id.0.to_string())
    }

    /// The working tree a handoff bundle is applied to.
    ///
    /// The bundle names the run, the run names the project, and the project's
    /// `repo_path` is where that project's files live. `None` when any link is
    /// missing (a bundle whose run id is not a ULID, a run the store does not
    /// have, a project with no repo yet): an apply writes files, so the caller
    /// refuses instead of writing into the daemon's own bundle directory.
    pub(crate) async fn working_tree_for_run(&self, run_id: &str) -> Option<PathBuf> {
        let id = run_id.parse::<ulid::Ulid>().ok()?;
        let run = self.state.store.get_run(RunId(id)).await.ok()?;
        let project = self.state.store.get_project(run.project_id).await.ok()?;
        project.repo_path.map(PathBuf::from)
    }

    /// The project behind a run: its id and its name, or the run id as both.
    ///
    /// The settings rows are keyed by project while the RPCs are addressed by run,
    /// so this is the one place that resolution happens: RunId → Run → Project.
    /// A link that is missing (a bundle whose run id is not a ULID, a run the store
    /// does not have, a project that was deleted) falls back to the run id as both
    /// the key and the name, which keeps an export of an unregistered run working
    /// instead of failing on a project that was never stored.
    pub(crate) async fn project_for_run(&self, run_id: &str) -> (String, String) {
        let fallback = || (run_id.to_string(), run_id.to_string());
        let Ok(id) = run_id.parse::<ulid::Ulid>() else {
            return fallback();
        };
        let Ok(run) = self.state.store.get_run(RunId(id)).await else {
            return fallback();
        };
        let Ok(project) = self.state.store.get_project(run.project_id).await else {
            return fallback();
        };
        let name = if project.name.trim().is_empty() {
            run_id.to_string()
        } else {
            project.name
        };
        (project.id.to_string(), name)
    }

    /// Remember a kit: on disk first, then in memory.
    ///
    /// That order is what makes the in-memory copy trustworthy — it never holds a
    /// change the file refused — and it is why a failed write is an error the
    /// caller sees rather than a setting the owner only thinks they made.
    pub(crate) async fn remember_backend_kit(&self, key: &str, kit: &BackendKit) -> RpcResult<()> {
        self.state
            .settings
            .save_backend_kit(key, kit)
            .await
            .map_err(|error| rpc_error(error.to_string()))?;
        self.state
            .backend_kits
            .write()
            .await
            .insert(key.to_string(), kit.clone());
        Ok(())
    }

    /// Write the daemon's pairings through to the settings file.
    ///
    /// The whole list is written because a revocation is a value on the row rather
    /// than a delete: the table has to mirror the store exactly, or a phone the
    /// owner revoked would come back paired after a restart.
    pub(crate) async fn save_pairings(&self) -> RpcResult<()> {
        let pairings = self.state.pairings.read().await.clone();
        self.state
            .settings
            .save_pairings(pairings)
            .await
            .map_err(|error| rpc_error(error.to_string()))
    }

    /// One Wave 2 row or the refusal that it is not installed.
    ///
    /// The four readers below share one shape because the four catalogs are managed
    /// the same way: a write names a row, and a row that is not in the store is the
    /// caller's mistake (`-32602`), not the daemon's. The message names what *is*
    /// installed only by count, because a catalog can be long and a browser that got
    /// the id wrong already has the list call to make.
    pub(crate) async fn stored_harness(&self, id: &str) -> RpcResult<StoredHarness> {
        self.state
            .settings
            .get_harness(id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| rpc_invalid_params(format!("no harness `{id}` is installed")))
    }

    pub(crate) async fn stored_skill(&self, id: &str) -> RpcResult<StoredSkill> {
        self.state
            .settings
            .get_skill(id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| rpc_invalid_params(format!("no skill `{id}` is installed")))
    }

    pub(crate) async fn stored_plugin(&self, id: &str) -> RpcResult<StoredPlugin> {
        self.state
            .settings
            .get_plugin(id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| rpc_invalid_params(format!("no plugin `{id}` is installed")))
    }

    pub(crate) async fn stored_integration(&self, id: &str) -> RpcResult<StoredIntegration> {
        self.state
            .settings
            .get_integration(id)
            .await
            .map_err(rpc_error)?
            .ok_or_else(|| {
                rpc_invalid_params(format!(
                    "no integration `{id}` is connected; integrations.connect writes one"
                ))
            })
    }

    /// File a plugin pack's environment values, returning what the row keeps.
    ///
    /// Anything that is already a `${…}` reference is stored as written — the owner
    /// may be pointing at the process environment or at an entry filed for another
    /// pack, and the daemon has no business second-guessing that. Everything else is
    /// treated as secret material and moved to the keychain under an account namespaced
    /// by the pack, so two packs that both want `GITHUB_TOKEN` hold two secrets and the
    /// row carries only the address. A keychain that refuses is a refusal of the whole
    /// call: an environment half-filed would launch a pack with a token the owner
    /// believes is set.
    pub(crate) async fn file_plugin_env(
        &self,
        id: &str,
        env: &HashMap<String, String>,
    ) -> RpcResult<HashMap<String, String>> {
        let (references, secrets) = wave2::split_plugin_env(id, env);
        for (account, value) in secrets {
            self.state
                .secrets
                .store(&account, &value)
                .await
                .map_err(|error| {
                    rpc_error(format!(
                        "the value for `{account}` could not be stored in the OS keychain: {error}"
                    ))
                })?;
        }
        Ok(references)
    }

    /// Judge a pack against the daemon's process policy before it is stored or
    /// launched (KEEL K5b).
    ///
    /// Three questions, each answered by the same policy `process.spawn` and
    /// `mcp.connect` are held to: is the program allowed, does it name a pinned
    /// release rather than "whatever is newest", and is every environment name one
    /// the daemon hands to a child at all. An HTTP pack launches nothing here and
    /// has no program to judge.
    pub(crate) fn check_plugin_launch(&self, definition: &PluginDefinition) -> RpcResult<()> {
        if definition.transport != "stdio" {
            return Ok(());
        }
        let command = definition.command.as_deref().unwrap_or("").trim();
        let policy = self.process_policy();
        policy.check_command(command).map_err(rpc_policy_refused)?;
        wave2::require_pinned_launch(command, &definition.args).map_err(rpc_policy_refused)?;
        for key in definition.env.keys() {
            policy.check_env(key).map_err(rpc_policy_refused)?;
        }
        Ok(())
    }

    /// The environment a plugin launch gives its child, with references resolved.
    ///
    /// A row holds `${secrets:…}` addresses, not material; the values are read
    /// here, at launch, so a token reaches exactly the one child that needs it and
    /// never a settings row, a log line or an `mcp.list` reply (KEEL K5a/K5b).
    ///
    /// Only keychain references are resolved. `${env:…}` would smuggle the
    /// daemon's own environment into a child — the inheritance this packet exists
    /// to remove — and `${config:…}` has no daemon-wide value to substitute; both
    /// are refused rather than guessed.
    ///
    /// The *account* a pack may name is bounded too (R-KEEL row 5): a reference must
    /// equal [`wave2::plugin_env_account`] for this pack and this variable, so a
    /// manifest cannot read `plugin:other-pack:TOKEN`, a provider's key or an
    /// integration's token by writing its address into its own row. The comparison is
    /// against the account string the daemon itself composes when it files a value,
    /// and it runs **before** the keychain is touched: a foreign address is refused
    /// without a read.
    pub(crate) async fn resolved_plugin_env(
        &self,
        definition: &PluginDefinition,
    ) -> RpcResult<HashMap<String, String>> {
        let mut resolved = HashMap::with_capacity(definition.env.len());
        for (key, value) in &definition.env {
            let trimmed = value.trim();
            let Some(account) = trimmed
                .strip_prefix("${secrets:")
                .and_then(|rest| rest.strip_suffix('}'))
            else {
                return Err(rpc_policy_refused(format!(
                    "the pack `{}` wants `{key}` from `{trimmed}`; this daemon launches a pack only with keychain references (`${{secrets:…}}`) because it has no value for anything else",
                    definition.id
                )));
            };
            let own_account = wave2::plugin_env_account(&definition.id, key);
            if account != own_account {
                return Err(rpc_policy_refused(format!(
                    "the pack `{}` wants `{key}` from the keychain account `{account}`; a pack may read only its own account (`{own_account}`), so this launch is refused",
                    definition.id
                )));
            }
            let secret = self.state.secrets.load(account).await.map_err(|error| {
                rpc_error(format!(
                    "the secret `{account}` for `{key}` could not be read from the OS keychain: {error}"
                ))
            })?;
            resolved.insert(key.clone(), secret);
        }
        Ok(resolved)
    }

    /// One integration's status, with the keychain consulted for what the row omits.
    ///
    /// `has_token` is "an entry exists", never "a token was read": the value is not
    /// brought into memory to answer a listing, and a reply that carried it would put
    /// a secret on the wire the browser reads.
    pub(crate) async fn integration_status_of(&self, id: &str) -> RpcResult<IntegrationStatus> {
        let row = self.stored_integration(id).await?;
        wave2::integration_status(
            &row,
            self.state
                .secrets
                .load(&wave2::integration_secret_account(&row.id))
                .await
                .is_ok(),
            self.state
                .secrets
                .load(&wave2::integration_bot_secret_account(&row.id))
                .await
                .is_ok(),
        )
        .map_err(rpc_error)
    }

    /// Every integration the daemon has been connected, by name.
    pub(crate) async fn integration_statuses(&self) -> RpcResult<Vec<IntegrationStatus>> {
        let rows = self
            .state
            .settings
            .list_integrations()
            .await
            .map_err(rpc_error)?;
        let mut statuses = Vec::with_capacity(rows.len());
        for row in &rows {
            statuses.push(
                wave2::integration_status(
                    row,
                    self.state
                        .secrets
                        .load(&wave2::integration_secret_account(&row.id))
                        .await
                        .is_ok(),
                    self.state
                        .secrets
                        .load(&wave2::integration_bot_secret_account(&row.id))
                        .await
                        .is_ok(),
                )
                .map_err(rpc_error)?,
            );
        }
        Ok(statuses)
    }

    /// The directory a project's files are browsed from.
    ///
    /// A project with a working tree is browsed there, because that is the tree the
    /// agent edits and the one an owner wants to read. A project without one — created
    /// by name alone, or a caller that passed an id the store has never seen — is
    /// browsed from `<data_dir>/files/<sanitised id>`, which is a directory the daemon
    /// owns and the agent's own file tools can write into. The fallback is what makes
    /// `files.*` answerable for every id a browser can hold, and the sanitising is what
    /// stops an unknown id from choosing where it lives.
    pub(crate) async fn project_files_root(&self, project_id: &str) -> PathBuf {
        let repo_path = match uuid::Uuid::parse_str(project_id.trim()) {
            Ok(id) => self
                .state
                .store
                .get_project(ProjectId(id))
                .await
                .ok()
                .and_then(|project| project.repo_path),
            Err(_) => None,
        };
        wave2::project_files_root(
            &self.state.config.data_dir,
            project_id,
            repo_path.as_deref(),
        )
    }

    /// The daemon's command policy, read from its configuration (security audit H-05).
    ///
    /// Built per call rather than stored, because the configuration it comes from is
    /// the daemon's own and never a request's: an RPC cannot widen the allow-list, and
    /// a state that cached a list nothing can change would only be a second copy of it.
    pub(crate) fn process_policy(&self) -> ProcessPolicy {
        ProcessPolicy::from_config(
            &self.state.config.allowed_commands,
            &self.state.config.data_dir,
        )
    }

    /// The verified caller behind this request, its ceiling spent, and its role
    /// checked against what the method asks for.
    ///
    /// Everything an RPC is allowed to know about who is asking comes through here,
    /// which is the point (security audit H-03, H-04): the actor was put in the
    /// request's extensions by the transport after it checked the credential, and a
    /// method that skipped this call would know nothing about its caller at all.
    ///
    /// Three refusals, each with its own code so a client can tell them apart:
    /// `-32001` for no verified session, `-32004` for a caller past a ceiling (the
    /// RPC form of the HTTP 429 the daemon's other listener answers with), and
    /// `-32002` for a caller that is verified but not the owner.
    pub(crate) async fn authorize(&self, ext: &RpcExtensions, method: &str) -> RpcResult<Actor> {
        let policy = auth::policy_of(method)
            .ok_or_else(|| rpc_forbidden(format!("{method} is not a method this daemon serves")))?;

        let actor = ext
            .get::<Actor>()
            .cloned()
            .ok_or_else(|| rpc_unauthenticated(format!("{method} needs a verified session")))?;

        // The tier is keyed on the authenticated identity, so one device's flood is
        // not another device's refusal (audit H-01).
        let ceiling = self.state.rates.check(policy.tier, actor.key());
        if !ceiling.is_allowed() {
            let secs = ceiling.retry_after_secs();
            self.state.report_refusal(policy.method, actor.key());
            return Err(rpc_rate_limited(secs));
        }

        let required = match policy.policy {
            Policy::Session => ActorRole::Paired,
            Policy::Owner => ActorRole::Owner,
        };
        if !actor.role().covers(required) {
            return Err(rpc_forbidden(format!(
                "{method} is the daemon owner's; this session is a paired device"
            )));
        }
        // The transport verified the credential at the connection's start, and a
        // WebSocket keeps that verdict frozen; re-read the store so a revoked or
        // expired device is refused on its next message (PAIR research finding 2).
        if !paired_device_is_active(&actor, &self.state.active_pairings().await) {
            return Err(rpc_unauthenticated(format!(
                "{method} needs a still-active pairing; this device was revoked or its pairing expired"
            )));
        }
        Ok(actor)
    }

    /// The device a gate decision is recorded against — the session's, always.
    ///
    /// `claimed` is the legacy `device_id` parameter the shape of this RPC still
    /// carries so a client that has not been updated parses. It is checked against
    /// the authenticated session and never believed: a caller that names a different
    /// device is refused with `-32003` rather than being recorded as that device,
    /// which is exactly the failure audit H-03 described.
    pub(crate) fn gate_approver(
        &self,
        actor: &Actor,
        claimed: Option<DeviceId>,
        method: &str,
    ) -> RpcResult<DeviceId> {
        let verified = actor.device_id().ok_or_else(|| {
            rpc_identity_mismatch(format!(
                "{method} records the deciding device, and this session's pairing does not name one"
            ))
        })?;
        if let Some(claimed) = claimed {
            if claimed != verified {
                warn!(
                    "{method} refused: the session is {verified} but the request named {claimed}"
                );
                return Err(rpc_identity_mismatch(format!(
                    "{method} was called as {verified} with {claimed} in its params; a device id in a request does not decide who is asking"
                )));
            }
        }
        Ok(verified)
    }

    /// Write the loop's conversation to the daemon's settings.
    async fn store_agent(&self, snapshot: &AgentLoopSnapshot) -> Result<()> {
        store_agent_snapshot(&self.state.settings, snapshot).await
    }

    /// Ask for one of the two agent modes, on the session's own authority.
    ///
    /// The order is the one `roles.set` uses and for the same reason: the record has to
    /// survive before the switch does. So the loop is switched, the history is written,
    /// and a write that fails puts the loop back to exactly what it was and refuses —
    /// because an approval the next daemon does not know about is an approval that lets
    /// a tool run under a name no audit trail carries (audit H-03).
    ///
    /// The same rule applies to a run's loop, but the record is a different one:
    /// `run_id` names it (OD-E2b), and the switch happens on the loop the run's turns
    /// run in, which is held by the session registry for the run's lifetime. The
    /// settings snapshot is the daemon-wide conversation's, so it is neither written
    /// nor rolled back here: a run's loop does not outlive this process, and a restart
    /// starts it in Plan again, so there is no approval a restart could honour that
    /// this process had not already applied.
    ///
    /// The approver is never taken from the params. [`Self::gate_approver`] is what says
    /// so, and it is shared with the gate methods for exactly that reason: one rule, in
    /// one place, with one refusal code.
    pub(crate) async fn agent_switch(
        &self,
        ext: &RpcExtensions,
        to: AgentMode,
        run_id: Option<RunId>,
    ) -> RpcResult<ModeTransition> {
        let method = match to {
            AgentMode::Agent => "agent.approve_mode",
            AgentMode::Plan => "agent.plan_mode",
        };
        let actor = self.authorize(ext, method).await?;
        let approver = self.gate_approver(&actor, None, method)?.to_string();

        if let Some(run_id) = run_id {
            let transition = match to {
                // A switch into Agent mode is the one that needs the name: the mode
                // manager refuses a blank approver itself, so this cannot invent one.
                AgentMode::Agent => {
                    self.state
                        .agent_sessions
                        .approve_agent_mode(run_id, approver.as_str())
                        .await
                }
                AgentMode::Plan => self.state.agent_sessions.return_to_plan_mode(run_id).await,
            }
            .map_err(|error| rpc_error(error.to_string()))?;
            info!(
                run_id = %run_id.0,
                "{method} recorded on the run's own loop for the device the session authenticated"
            );
            return Ok(transition);
        }

        let mut agent_loop = self.state.agent_loop.write().await;
        let before = AgentLoopSnapshot::of(&agent_loop);
        let transition = match to {
            // A switch into Agent mode is the one that needs the name: the mode manager
            // refuses a blank approver itself, so this cannot invent one.
            AgentMode::Agent => agent_loop.approve_agent_mode(approver.as_str()),
            AgentMode::Plan => agent_loop.return_to_plan_mode(),
        }
        .map_err(|error| rpc_error(error.to_string()))?;
        let after = AgentLoopSnapshot::of(&agent_loop);
        drop(agent_loop);

        if let Err(error) = self.store_agent(&after).await {
            // Undo the live switch, so nothing runs in a mode no record approved.
            let mut guard = self.state.agent_loop.write().await;
            before.restore(&mut guard);
            return Err(rpc_error(format!(
                "{method} could not be recorded, so the mode did not change: {error}"
            )));
        }
        info!("{method} recorded for the device the session authenticated");
        Ok(transition)
    }

    pub(crate) async fn resolve_test_model(
        &self,
        provider: &StoredProvider,
        explicit_model: Option<String>,
    ) -> String {
        if let Some(m) = explicit_model
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
        {
            return m;
        }

        if let Ok(models) = self.state.settings.list_custom_models().await {
            if let Some(m) = models.into_iter().find(|m| {
                m.enabled
                    && (m.provider.eq_ignore_ascii_case(&provider.name)
                        || m.provider.eq_ignore_ascii_case(&provider.kind))
            }) {
                if !m.model_id.trim().is_empty() {
                    return m.model_id;
                }
            }
        }

        let routings = self.state.role_routings.read().await;
        for config in routings.values() {
            for target in &config.targets {
                if (target.provider_id.eq_ignore_ascii_case(&provider.name)
                    || target.provider_id.eq_ignore_ascii_case(&provider.kind))
                    && !target.model_id.trim().is_empty()
                {
                    return target.model_id.clone();
                }
            }
        }

        if let Some(default_m) =
            OneClickProvider::from_tag(&provider.kind).and_then(OneClickProvider::default_model)
        {
            if !default_m.trim().is_empty() {
                return default_m.to_string();
            }
        }

        let kind = provider.kind.to_lowercase();
        if kind.contains("anthropic") {
            "claude-3-5-haiku-latest".to_string()
        } else if kind.contains("ollama") {
            "llama3.2".to_string()
        } else if kind.contains("fake") || kind.contains("mock") {
            "fake-model".to_string()
        } else {
            "gpt-4o-mini".to_string()
        }
    }

    /// The catalog a turn is offered: the composer's built-in commands, then every
    /// enabled skill of the installed registry (ENGINE P-E6).
    ///
    /// The skills are the settings rows loaded into a `warsha_pipeline::SkillRegistry`
    /// and verified against [`SKILLS_LOCK_FILE`], so a lock that disagrees with the
    /// install refuses the catalog instead of serving a set the owner's lock does not
    /// name. Role scoping rides the same registry: [`warsha_pipeline::SkillRegistry::skills_for_role`]
    /// narrows a catalog to one role's pack, and a pack naming a skill that is not
    /// installed is an error there rather than a silent skip.
    pub(crate) async fn active_skill_catalog(&self) -> RpcResult<Vec<SlashCommand>> {
        let rows = self.state.settings.list_skills().await.map_err(rpc_error)?;
        let registry = verified_skill_registry(&self.state.config.data_dir, &rows)
            .map_err(rpc_policy_refused)?;
        catalog_from_registry(&registry, &rows, None).map_err(rpc_policy_refused)
    }
}

/// Seconds since the Unix epoch, or `0` on a clock that cannot answer.
///
/// A settings row is stamped with this when the caller does not supply a time, and
/// a stamp is diagnostic: a host whose clock sits before 1970 records `0` rather
/// than refusing the write.
pub(crate) fn now_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
}

/// A caller's document, path or name is what is wrong: JSON-RPC's own
/// "invalid params", the same code `runs.followup` uses for an empty prompt.
///
/// Wave 2 answers with it whenever the refusal is about what the caller sent — an
/// unparseable manifest, a `..` in a path, a delete of a row that is not there — so a
/// client can tell "you sent that wrong" from "my store failed" without reading prose.
pub(crate) fn rpc_invalid_params(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(-32602, message.into(), None::<()>)
}

/// One JSON-RPC error object for every failure these methods can return.
///
/// `-32000` is the daemon's existing "server error" code; the message is the
/// `thiserror` rendering, which names the process, server or project involved.
pub(crate) fn rpc_error(message: impl std::fmt::Display) -> ErrorObjectOwned {
    ErrorObject::owned(-32000, message.to_string(), None::<()>)
}

/// The caller has no verified session: the transport could not say who it was.
fn rpc_unauthenticated(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(auth::rpc_codes::UNAUTHENTICATED, message.into(), None::<()>)
}

/// The caller is verified and not allowed: audit H-04's method-level refusal.
fn rpc_forbidden(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(auth::rpc_codes::FORBIDDEN, message.into(), None::<()>)
}

/// The caller named an identity that is not the one it authenticated as (audit H-03).
fn rpc_identity_mismatch(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(
        auth::rpc_codes::IDENTITY_MISMATCH,
        message.into(),
        None::<()>,
    )
}

/// The caller passed a ceiling — the RPC form of HTTP 429, carrying the wait so a
/// client can honour it (audit H-01).
fn rpc_rate_limited(retry_after_secs: u64) -> ErrorObjectOwned {
    ErrorObject::owned(
        auth::rpc_codes::RATE_LIMITED,
        format!("rate limited: retry after {retry_after_secs}s"),
        Some(serde_json::json!({ "retry_after_secs": retry_after_secs })),
    )
}

/// A command or transport the daemon will not start (audit H-05).
pub(crate) fn rpc_policy_refused(message: impl Into<String>) -> ErrorObjectOwned {
    ErrorObject::owned(auth::rpc_codes::POLICY_REFUSED, message.into(), None::<()>)
}

/// Refuse an `mcp.send` payload that carries a `tools/call` frame (R-KEEL row 6).
///
/// The transport writes the payload one frame per line, so every line is parsed as a
/// frame and its `method` compared after decoding rather than substring-searched: a
/// text search would miss `"tools\u002fcall"` or a `\/` escape that the child's own
/// parser decodes back into the governed method. A line that is not JSON is left to
/// the transport — it is not a frame this check could misread as a call.
pub(crate) fn refuse_a_permission_governed_frame(payload: &str) -> RpcResult<()> {
    for line in payload.lines() {
        let Ok(frame) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
            continue;
        };
        if frame.get("method").and_then(serde_json::Value::as_str) == Some("tools/call") {
            return Err(rpc_policy_refused(
                "`mcp.send` may not write a `tools/call` frame: that method is gated by the MCP permission table, and `mcp.call` is the path that consults it",
            ));
        }
    }
    Ok(())
}

/// The pipeline's permission-store seam over the daemon's SQLite store.
///
/// The orphan rule keeps the pipeline from implementing its own trait for the
/// store type, so the daemon adapts it here: one place maps the stored strings
/// through the total parser (unknown becomes `Ask`).
pub(crate) struct DaemonPermissionStore {
    pub(crate) store: Arc<Store>,
}

#[async_trait]
impl warsha_pipeline::McpPermissionStore for DaemonPermissionStore {
    async fn set_mcp_permission(
        &self,
        server: &str,
        tool: &str,
        role: &str,
        permission: warsha_pipeline::mcp_permission::ToolPermission,
        updated_at: &str,
    ) -> std::result::Result<(), String> {
        self.store
            .set_mcp_permission(server, tool, role, permission.as_str(), updated_at)
            .await
            .map_err(|error| error.to_string())
    }

    async fn load_mcp_permissions(
        &self,
    ) -> std::result::Result<
        Vec<(
            String,
            String,
            String,
            warsha_pipeline::mcp_permission::ToolPermission,
        )>,
        String,
    > {
        self.store
            .load_mcp_permissions()
            .await
            .map(|rows| {
                rows.into_iter()
                    .map(|(server, tool, role, permission)| {
                        (
                            server,
                            tool,
                            role,
                            warsha_pipeline::mcp_permission::ToolPermission::parse(&permission),
                        )
                    })
                    .collect()
            })
            .map_err(|error| error.to_string())
    }
}
