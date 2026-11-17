//! Wire-contract surface for the daemon: the `WarshaApi` JSON-RPC trait (97 methods)
//! and the 15 DTOs it carries. Split out of `lib.rs` (P-H1 step A1, pure move).

use chrono::Utc;
use jsonrpsee::{core::RpcResult, proc_macros::rpc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use warsha_core::*;
use warsha_pipeline::{
    AgentMode, AgentTurnResult, BackendKit, CrashReport, LivePreview, McpConnection,
    ModeTransition, PhonePairing, Preference, PreferenceSignal, ProcessStatus, ProcessSummary,
    Routine, RunModeConfig, RunWorktree, StoreReview, TodoItem,
};
use warsha_providers::{HealthCheck, OneClickProvider};
use warsha_store::StoredProvider;

use crate::mcp_approvals::{PermissionAskAccepted, PermissionDecision};
use crate::{McpApproval, McpApprovalAnswer, McpPermissionRow, McpPermissionsReply, RunStreamSync};

/// JSON-RPC API trait
#[rpc(server)]
pub trait WarshaApi {
    // Every method on this surface takes `with_extensions` (security re-audit, LOAD-1
    // finding 1). Two things follow, and both are the point: the handler can reach the
    // [`Actor`] the transport verified, so the `Tier` its [`MethodPolicy`] names is
    // actually spent — a table entry nothing consults is a ceiling on paper — and a
    // request that never authenticated cannot get as far as the query. Before this, the
    // 24 read methods declared without extensions answered from the looser transport
    // ceiling only: the spike run proved it, refusing 1.3M requests with the transport
    // bucket while the `standard` bucket (240 burst, 1,200 a minute) never fired once.
    #[method(name = "health", with_extensions)]
    async fn health(&self) -> RpcResult<HealthResponse>;

    #[method(name = "projects.list", with_extensions)]
    async fn list_projects(&self) -> RpcResult<Vec<Project>>;

    #[method(name = "projects.create", with_extensions)]
    async fn create_project(
        &self,
        name: String,
        description: String,
        language: String,
        confinement: Option<Confinement>,
        approval_mode: Option<ApprovalMode>,
    ) -> RpcResult<Project>;

    #[method(name = "permissions.defaults.get", with_extensions)]
    async fn get_default_permissions(&self) -> RpcResult<ProjectPermissions>;

    #[method(name = "permissions.defaults.set", with_extensions)]
    async fn set_default_permissions(
        &self,
        confinement: Confinement,
        approval_mode: ApprovalMode,
    ) -> RpcResult<ProjectPermissions>;

    #[method(name = "permissions.project.get", with_extensions)]
    async fn get_project_permissions(&self, project_id: ProjectId)
        -> RpcResult<ProjectPermissions>;

    #[method(name = "permissions.project.set", with_extensions)]
    async fn set_project_permissions(
        &self,
        project_id: ProjectId,
        confinement: Option<Confinement>,
        approval_mode: Option<ApprovalMode>,
    ) -> RpcResult<ProjectPermissions>;

    #[method(name = "projects.get", with_extensions)]
    async fn get_project(&self, id: ProjectId) -> RpcResult<Project>;

    // ENGINE E3: a project's repository is not only a `projects.create` argument.
    // A project created without one can gain a repository later, as a project
    // operation, instead of being stranded repo-less for good.
    #[method(name = "projects.attach", with_extensions)]
    async fn attach_project(&self, project_id: ProjectId, repo_path: String) -> RpcResult<Project>;

    #[method(name = "runs.start", with_extensions)]
    async fn start_run(&self, project_id: ProjectId, idea: String) -> RpcResult<Run>;

    #[method(name = "runs.worktree", with_extensions)]
    async fn run_worktree(&self, run_id: RunId) -> RpcResult<Option<RunWorktree>>;

    #[method(name = "gates.evidence", with_extensions)]
    async fn gate_evidence(
        &self,
        run_id: RunId,
        program: String,
        args: Vec<String>,
    ) -> RpcResult<warsha_pipeline::GateEvidence>;

    #[method(name = "runs.get", with_extensions)]
    async fn get_run(&self, run_id: RunId) -> RpcResult<Run>;

    #[method(name = "runs.list", with_extensions)]
    async fn list_runs(&self, project_id: ProjectId) -> RpcResult<Vec<Run>>;

    #[method(name = "runs.events", with_extensions)]
    async fn get_events(&self, run_id: RunId) -> RpcResult<Vec<Event>>;

    #[method(name = "sessions.list", with_extensions)]
    async fn list_sessions(&self, run_id: RunId) -> RpcResult<Vec<Session>>;

    #[method(name = "sessions.tail", with_extensions)]
    async fn session_tail(&self, session_id: SessionId) -> RpcResult<Vec<String>>;

    #[method(name = "sessions.stop", with_extensions)]
    async fn session_stop(&self, session_id: SessionId) -> RpcResult<()>;

    // Gates (security audit H-03).
    //
    // The device that decided a gate is the device the *credential* authenticated —
    // the local desktop's owner session, or the phone whose pairing secret arrived —
    // and never a `device_id` in these params. The field is still accepted, as an
    // `Option` in the same positional slot, so a client written against the old shape
    // keeps parsing; its value is checked against the session and a mismatch is a
    // `-32003` refusal rather than a recorded approver. A client that stops sending it
    // changes nothing about what gets stored.
    #[method(name = "gates.approve", with_extensions)]
    async fn approve_gate(
        &self,
        run_id: RunId,
        stage: Stage,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run>;

    #[method(name = "gates.reject", with_extensions)]
    async fn reject_gate(
        &self,
        run_id: RunId,
        stage: Stage,
        reason: String,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run>;

    #[method(name = "gates.changes", with_extensions)]
    async fn request_changes(
        &self,
        run_id: RunId,
        stage: Stage,
        notes: String,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Run>;

    /// The gates queue of one run (#25): all four gate stages in `Stage::all()`
    /// order, each with its current state and `Pending` for a stage the run has no
    /// entry for.
    ///
    /// All four stages ride back rather than a pending-only filter because the
    /// desktop renders the whole ledger with who-decided-when
    /// (`apps/desktop/src/screens/GatesInbox.tsx`) while `SimpleMode.tsx` filters
    /// pending client-side. The state is the flat [`GateSummaryState`] the client
    /// declares, not the adjacent-tagged `warsha_core::GateState`.
    ///
    /// It is a read of `authorize`'s `Session`/`Standard` class (`runs.list`-style):
    /// a paired phone must be able to read the queue it is asked to decide, and
    /// `SimpleMode` polls this path. The `device_id` slot matches the gates block's
    /// legacy shape and is ignored — this read records no identity, and nothing here
    /// believes a caller-named device.
    #[method(name = "gates.list", with_extensions)]
    async fn list_gates(
        &self,
        run_id: RunId,
        device_id: Option<DeviceId>,
    ) -> RpcResult<Vec<GateSummary>>;

    #[method(name = "providers.list", with_extensions)]
    async fn list_providers(&self) -> RpcResult<Vec<ProviderRecord>>;

    #[method(name = "providers.auth_status", with_extensions)]
    async fn provider_auth_status(&self, name: String) -> RpcResult<AuthStatus>;

    #[method(name = "providers.auth_start", with_extensions)]
    async fn provider_auth_start(&self, name: String) -> RpcResult<AuthStartResponse>;

    #[method(name = "providers.auth_complete", with_extensions)]
    async fn provider_auth_complete(
        &self,
        name: String,
        code: String,
    ) -> RpcResult<AuthCompleteResponse>;

    #[method(name = "providers.disconnect", with_extensions)]
    async fn provider_disconnect(&self, name: String) -> RpcResult<()>;

    /// Add a provider and put its API key in the OS keychain.
    ///
    /// Four named parameters, which is the object the wizard already sends
    /// (`{ name, kind, key, api_base }`): the key rides on this one call and
    /// nowhere else, and `api_base` is `None` when the caller sent none.
    #[method(name = "providers.add", with_extensions)]
    async fn add_provider(
        &self,
        name: String,
        kind: String,
        key: String,
        api_base: Option<String>,
    ) -> RpcResult<ProviderRecord>;

    /// Test a stored provider's connection. A refusal is a JSON-RPC error whose
    /// message says why and whose `data` carries the [`HealthCheck`].
    #[method(name = "providers.test", with_extensions)]
    async fn test_provider(&self, name: String, model: Option<String>) -> RpcResult<HealthCheck>;

    /// Check a registered provider for model catalog updates without overwriting existing settings.
    #[method(name = "providers.check_models", with_extensions)]
    async fn check_provider_models(
        &self,
        name: String,
    ) -> RpcResult<warsha_providers::ModelCatalogDiff>;

    /// One provider's quota (A3): what the provider reports, what the daemon
    /// estimated from its own records, or unknown — never an invented limit.
    #[method(name = "providers.quota", with_extensions)]
    async fn provider_quota(&self, name: String) -> RpcResult<ProviderQuotaStatus>;

    /// Usage aggregated by one whitelisted dimension (A3).
    #[method(name = "usage.by_dimension", with_extensions)]
    async fn usage_by_dimension(
        &self,
        dimension: String,
        project_id: Option<ProjectId>,
    ) -> RpcResult<Vec<UsageRow>>;

    /// Usage aggregated by day or by month (A3).
    #[method(name = "usage.by_time", with_extensions)]
    async fn usage_by_time(
        &self,
        granularity: String,
        project_id: Option<ProjectId>,
    ) -> RpcResult<Vec<UsageTimeRow>>;

    /// A CLI-managed provider's rolling subscription window (A3): spend and
    /// request counts over the last 5 hours and the last 7 days, estimated
    /// from the daemon's own cost records — the provider exposes no limit.
    #[method(name = "usage.subscription_window", with_extensions)]
    async fn usage_subscription_window(&self) -> RpcResult<SubscriptionWindow>;

    #[method(name = "devices.list", with_extensions)]
    async fn list_devices(&self) -> RpcResult<Vec<warsha_remote::DeviceIdentity>>;

    #[method(name = "devices.pair", with_extensions)]
    async fn pair_device(&self, pairing_data: warsha_remote::PairingData) -> RpcResult<()>;

    /// `devices.pair-start` — mint a pairing and hand back what a phone can actually use.
    ///
    /// The producer the pairing path never had: `devices.pair` *consumes* a
    /// [`warsha_remote::PairingData`], and nothing in the product made one, so the desktop
    /// screen was showing a `Math.random()` string as a pairing code. This mints the
    /// 32-byte one-time secret and its ten-minute expiry (`PairingData::new`), and returns
    /// them together with the daemon's resolved listening origin as a pairing link and a QR
    /// plate (`PairingOffer`).
    ///
    /// Takes no parameter. The pairing's expiry, secret and origin are all the daemon's to
    /// decide, and a caller that could name them could name the address a phone is sent to.
    #[method(name = "devices.pair-start", with_extensions)]
    async fn start_pairing(&self) -> RpcResult<warsha_remote::PairingOffer>;

    #[method(name = "devices.revoke", with_extensions)]
    async fn revoke_device(&self, device_id: DeviceId) -> RpcResult<()>;

    // Providers
    #[method(name = "providers.remove", with_extensions)]
    async fn remove_provider(&self, name: String) -> RpcResult<ProviderRecord>;

    // Roles
    #[method(name = "roles.list", with_extensions)]
    async fn list_roles(&self) -> RpcResult<Vec<RoleRoutingConfig>>;

    #[method(name = "roles.set", with_extensions)]
    async fn set_role(&self, config: RoleRoutingConfig) -> RpcResult<()>;

    // Budget
    #[method(name = "budget.show", with_extensions)]
    async fn show_budget(&self, project_id: ProjectId) -> RpcResult<BudgetStatus>;

    #[method(name = "budget.set", with_extensions)]
    async fn set_budget(&self, project_id: ProjectId, cents: u64) -> RpcResult<()>;

    // Backend kit (PLAN.md M19) — first wiring batch
    #[method(name = "backend.export", with_extensions)]
    async fn export_backend(&self, run_id: String, output_dir: String) -> RpcResult<String>;

    // Continue on server (PLAN.md M6a) — first wiring batch
    #[method(name = "handoff.create", with_extensions)]
    async fn create_handoff(
        &self,
        run_id: String,
        files: Vec<(String, String)>,
    ) -> RpcResult<String>;

    #[method(name = "handoff.apply", with_extensions)]
    async fn apply_handoff(&self, path: String, owner_wins: bool) -> RpcResult<String>;

    // Post-launch care (PLAN.md M17) — read halves only
    #[method(name = "postlaunch.crashes", with_extensions)]
    async fn list_crash_reports(&self, run_id: String) -> RpcResult<Vec<CrashReport>>;

    #[method(name = "postlaunch.reviews", with_extensions)]
    async fn list_store_reviews(&self, store: String) -> RpcResult<Vec<StoreReview>>;

    // Agent workflow (PLAN.md M18) — the skills catalog, one turn, and the mode the
    // next turn runs in.
    //
    // The three `agent.*` writes take the session because the M18 rule is that Agent
    // mode exists only on an owner's approval, and audit H-03 is that an approval
    // records who gave it: the approver is the authenticated device and never a param.
    //
    // `skills.list` is the owner-facing catalog — every installed skill, the same
    // rows `skills.import`/`skills.toggle`/`skills.delete` manage. It is *not* the
    // slash-command registry the agent loop executes: `skill_catalog()` builds that
    // in-process from the enabled rows, and it is unchanged by this shape.
    #[method(name = "skills.list", with_extensions)]
    async fn list_skills(&self) -> RpcResult<Vec<SkillDefinition>>;

    #[method(name = "agent.turn", with_extensions)]
    async fn agent_turn(&self, input: String) -> RpcResult<AgentTurnResult>;

    #[method(name = "agent.turn_run", with_extensions)]
    async fn agent_turn_run(&self, run_id: RunId, input: String) -> RpcResult<AgentTurnResult>;

    /// Approve Agent mode — for one run's loop when `run_id` names one, else for the
    /// daemon-wide record (OD-E2b; the parameter is optional and the wire stays
    /// backward compatible).
    #[method(name = "agent.approve_mode", with_extensions)]
    async fn approve_agent_mode(&self, run_id: Option<RunId>) -> RpcResult<ModeTransition>;

    #[method(name = "agent.plan_mode", with_extensions)]
    async fn return_agent_to_plan(&self, run_id: Option<RunId>) -> RpcResult<ModeTransition>;

    #[method(name = "agent.state", with_extensions)]
    async fn agent_state(&self, run_id: Option<RunId>) -> RpcResult<AgentState>;

    // Process spawning and MCP transports (PLAN.md M20) — real child processes
    #[method(name = "process.spawn", with_extensions)]
    async fn spawn_process(
        &self,
        command: String,
        args: Vec<String>,
        env: HashMap<String, String>,
    ) -> RpcResult<String>;

    #[method(name = "process.stop", with_extensions)]
    async fn stop_process(&self, id: String) -> RpcResult<()>;

    #[method(name = "process.status", with_extensions)]
    async fn process_status(&self, id: String) -> RpcResult<ProcessStatus>;

    #[method(name = "process.list", with_extensions)]
    async fn list_processes(&self) -> RpcResult<Vec<ProcessSummary>>;

    #[method(name = "mcp.connect", with_extensions)]
    async fn connect_mcp(
        &self,
        config: warsha_pipeline::mcp_transport::McpServerConfig,
    ) -> RpcResult<()>;

    #[method(name = "mcp.disconnect", with_extensions)]
    async fn disconnect_mcp(&self, name: String) -> RpcResult<()>;

    #[method(name = "mcp.list", with_extensions)]
    async fn list_mcp(&self) -> RpcResult<Vec<McpConnection>>;

    #[method(name = "mcp.send", with_extensions)]
    async fn send_mcp(&self, name: String, payload: String) -> RpcResult<String>;

    #[method(name = "mcp.call", with_extensions)]
    async fn call_mcp(
        &self,
        name: String,
        tool: String,
        arguments: serde_json::Value,
    ) -> RpcResult<warsha_pipeline::mcp::McpToolResult>;

    #[method(name = "mcp.permissions.list", with_extensions)]
    async fn list_mcp_permissions(&self) -> RpcResult<McpPermissionsReply>;

    #[method(name = "mcp.permissions.set", with_extensions)]
    async fn set_mcp_permission(
        &self,
        server: String,
        tool: String,
        role: String,
        permission: String,
    ) -> RpcResult<McpPermissionRow>;

    /// Every MCP call waiting for the owner's answer, across runs.
    #[method(name = "mcp.approvals.list", with_extensions)]
    async fn list_mcp_approvals(&self) -> RpcResult<Vec<McpApproval>>;

    /// Answer one pending MCP call with a single-use grant.
    ///
    /// The grant is bound to the run, server, tool, role and exact arguments of the
    /// pending entry, lapses after `MCP_ONCE_GRANT_TTL`, and is spent by the next
    /// matching call. It writes no permission row: a restart is back to `Ask`.
    #[method(name = "mcp.approvals.allow_once", with_extensions)]
    async fn allow_once_mcp_approval(&self, id: String) -> RpcResult<McpApprovalAnswer>;

    /// Submit one permission ask on behalf of a run (B2: the approval bridge).
    ///
    /// The bridge (a subcommand of the CLI) forwards the backend CLI's asks
    /// here; the ask joins the same queue `mcp.approvals.list` serves, so the
    /// owner answers it through the one approval surface. The run-scoped token
    /// that authorises this call grants nothing else.
    #[method(name = "permissions.ask", with_extensions)]
    async fn submit_permission_ask(
        &self,
        run_id: String,
        server: String,
        tool: String,
        arguments: serde_json::Value,
        summary: String,
    ) -> RpcResult<PermissionAskAccepted>;

    /// Poll one submitted ask for its decision (B2: the approval bridge).
    #[method(name = "permissions.decision", with_extensions)]
    async fn poll_permission_decision(&self, id: String) -> RpcResult<PermissionDecision>;

    // Live preview dev server (PLAN.md M5b + M20)
    #[method(name = "preview.start", with_extensions)]
    async fn start_preview(&self, project_id: String, command: String) -> RpcResult<LivePreview>;

    #[method(name = "preview.stop", with_extensions)]
    async fn stop_preview(&self, project_id: String) -> RpcResult<()>;

    #[method(name = "preview.status", with_extensions)]
    async fn preview_status(&self, project_id: String) -> RpcResult<LivePreview>;

    // Settings that survive a restart (PLAN.md M20) — the four stored records.
    // Every method here writes through to the settings file before it answers, so
    // a restart sees the change; a write that could not be stored is an error the
    // caller sees rather than a change the owner believes they made.
    #[method(name = "runmode.list", with_extensions)]
    async fn list_run_modes(&self) -> RpcResult<Vec<RunModeConfig>>;

    #[method(name = "runmode.set", with_extensions)]
    async fn set_run_mode(&self, config: RunModeConfig) -> RpcResult<RunModeConfig>;

    #[method(name = "backend.get", with_extensions)]
    async fn get_backend(&self, run_id: String) -> RpcResult<Option<BackendKit>>;

    #[method(name = "backend.set", with_extensions)]
    async fn set_backend(&self, run_id: String, kit: BackendKit) -> RpcResult<()>;

    #[method(name = "preferences.list", with_extensions)]
    async fn list_preferences(&self, project_id: String) -> RpcResult<Vec<Preference>>;

    /// Record one taste signal.
    ///
    /// This is a **write** on the same surface as the reads, and it is measured like one
    /// (re-audit N-8): the session's role decides whether it may write, the `standard`
    /// tier's ceiling is spent on the way in, and the actor is the verified one rather
    /// than absent. The legacy signature — one `PreferenceSignal`, no identity field — is
    /// unchanged on the wire.
    #[method(name = "preferences.record", with_extensions)]
    async fn record_preference(&self, signal: PreferenceSignal) -> RpcResult<Vec<Preference>>;

    #[method(name = "pairing.list", with_extensions)]
    async fn list_pairings(&self) -> RpcResult<Vec<PhonePairing>>;

    #[method(name = "pairing.create", with_extensions)]
    async fn create_pairing(&self, device_id: String, secret: String) -> RpcResult<PhonePairing>;

    #[method(name = "pairing.revoke", with_extensions)]
    async fn revoke_pairing(&self, device_id: String) -> RpcResult<PhonePairing>;

    // Routines (PLAN.md M16)
    #[method(name = "routines.list", with_extensions)]
    async fn list_routines(&self) -> RpcResult<Vec<Routine>>;

    #[method(name = "routines.get", with_extensions)]
    async fn get_routine(&self, id: String) -> RpcResult<Option<Routine>>;

    #[method(name = "routines.run_now", with_extensions)]
    async fn run_routine_now(&self, id: String) -> RpcResult<Routine>;

    #[method(name = "routines.pause", with_extensions)]
    async fn pause_routine(&self, id: String) -> RpcResult<Routine>;

    #[method(name = "routines.resume", with_extensions)]
    async fn resume_routine(&self, id: String) -> RpcResult<Routine>;

    // The sequenced event stream. `runs.subscribe` is the RPC mirror of the `/events`
    // WebSocket's replay: it answers where the daemon-wide stream is and hands back the
    // buffered, scrubbed frames after the caller's cursor, so a client that cannot hold
    // a socket (or reconnects after one dropped) resynchronises from one call. Both
    // `run_id` and `since_seq` are optional: no run means every run, no cursor means the
    // current end (nothing replayed).
    #[method(name = "runs.subscribe", with_extensions)]
    async fn subscribe_run(
        &self,
        run_id: Option<RunId>,
        since_seq: Option<u64>,
    ) -> RpcResult<RunStreamSync>;

    /// Drive a run one gate forward. Walks `advance_to_next_gate` until the run reaches
    /// a gate, the final `Feedback` stage, or a terminal status; reaching `Feedback`
    /// completes the run. An unrouted pipeline role is answered by the pipeline's own
    /// dispatch (W5's deterministic fake provider, or the env-configured model), so a
    /// fresh daemon advances out of the box with no key and no network.
    #[method(name = "runs.advance", with_extensions)]
    async fn advance_run(&self, run_id: RunId) -> RpcResult<Run>;

    /// Cancel a running run. Sets the status to `Cancelled`, records why, and appends an
    /// `Error`-kind event carrying `{"action": "run_cancelled", …}` to the same stream a
    /// live viewer watches. (The stream needs *some* event kind for a cancellation and
    /// `warsha_core::EventKind` has no `StageFailed`; `Error` is the closest existing.)
    #[method(name = "runs.cancel", with_extensions)]
    async fn cancel_run(&self, run_id: RunId, reason: Option<String>) -> RpcResult<Run>;

    /// Resume a paused run (change-request loop, budget-exceeded pause, or restart recovery).
    #[method(name = "runs.resume", with_extensions)]
    async fn resume_run(&self, run_id: RunId) -> RpcResult<Run>;

    /// Add a follow-up to a run at its current stage. Writes a `followup` artifact and
    /// appends an `AgentStep` event with the prompt and the response, both of which flow
    /// to `/events`. An empty or whitespace-only prompt is refused with `-32602`.
    #[method(name = "runs.followup", with_extensions)]
    async fn followup_run(&self, run_id: RunId, prompt: String) -> RpcResult<Run>;

    /// The run's artifacts, sorted by name — the seam `ArtifactViewer.tsx` names.
    #[method(name = "runs.artifacts", with_extensions)]
    async fn list_run_artifacts(&self, run_id: RunId) -> RpcResult<Vec<Artifact>>;

    // Wave 2 — harnesses (PLAN.md M20's declarative pipelines).
    //
    // The five methods are one read pair and three writes over the `harnesses`
    // tables in [`SettingsStore`], seeded once from
    // [`warsha_core::bundled_harnesses`]. The row *is* the record: a list, a get and
    // an import all answer from what a restart would read back, so nothing an owner
    // does here is visible only until the next boot. `harness.import` reads a JSON
    // document and always stamps the result user-authored (`preset: false`), because
    // a harness the owner typed is not one the daemon ships, and re-importing the
    // same name replaces it rather than forking it. `harness.select` writes the
    // project's active pipeline — with no project it writes the daemon-wide default
    // under the key `global`, which is what an unprojected run reads. `harness.delete`
    // refuses a bundled preset: the seed would put it back on the next start, and a
    // delete that silently undoes itself is worse than one that says no.
    #[method(name = "harness.list", with_extensions)]
    async fn list_harnesses(&self) -> RpcResult<Vec<HarnessDefinition>>;

    #[method(name = "harness.get", with_extensions)]
    async fn get_harness(&self, id: String) -> RpcResult<HarnessDefinition>;

    #[method(name = "harness.import", with_extensions)]
    async fn import_harness(
        &self,
        content: String,
        format: Option<String>,
    ) -> RpcResult<HarnessDefinition>;

    #[method(name = "harness.select", with_extensions)]
    async fn select_harness(&self, harness_id: String, project_id: Option<String>)
        -> RpcResult<()>;

    #[method(name = "harness.delete", with_extensions)]
    async fn delete_harness(&self, id: String) -> RpcResult<()>;

    // Wave 2 — skills.
    //
    // `skills.list` is the catalog the owner manages: every installed
    // [`SkillDefinition`], bundled and imported, enabled or not. (It answered the
    // `/review`-style [`SlashCommand`] list before the table existed; the agent loop's
    // own command registry is served in-process by `skill_catalog()` and is unchanged,
    // so the browser catalog and the runnable commands are now different things on
    // purpose — the owner manages the first, the agent executes the second.)
    // `skills.import` reads either a JSON row or a markdown skill with `---` front
    // matter; a URL is refused rather than fetched, because a daemon that pulls
    // arbitrary code over the network at an owner's click is the thing this project
    // promises not to be. `skills.toggle` *sets* the flag the caller names (the store's
    // `toggle_skill` flips, which cannot honour an explicit `enabled`).
    #[method(name = "skills.import", with_extensions)]
    async fn import_skill(
        &self,
        url_or_content: String,
        name: Option<String>,
    ) -> RpcResult<SkillDefinition>;

    #[method(name = "skills.toggle", with_extensions)]
    async fn toggle_skill(&self, id: String, enabled: bool) -> RpcResult<SkillDefinition>;

    #[method(name = "skills.delete", with_extensions)]
    async fn delete_skill(&self, id: String) -> RpcResult<()>;

    // Wave 2 — plugins (MCP extension packs).
    //
    // A plugin row carries its transport, its command line and its environment
    // *references*; `plugins.configure` is where a value that looks like a secret is
    // taken out of the row and filed in the OS keychain under
    // `plugin:{id}:{KEY}`, leaving `${secrets:plugin:{id}:{KEY}}` in its place — the
    // same shape `providers.add` already uses, so `plugins.list` can be read by a
    // browser without ever carrying a token. `plugins.install` reads a JSON manifest
    // only; a URL is refused for the reason `skills.import` gives.
    #[method(name = "plugins.list", with_extensions)]
    async fn list_plugins(&self) -> RpcResult<Vec<PluginDefinition>>;

    #[method(name = "plugins.install", with_extensions)]
    async fn install_plugin(&self, manifest_json_or_url: String) -> RpcResult<PluginDefinition>;

    #[method(name = "plugins.toggle", with_extensions)]
    async fn toggle_plugin(&self, id: String, enabled: bool) -> RpcResult<PluginDefinition>;

    #[method(name = "plugins.configure", with_extensions)]
    async fn configure_plugin(
        &self,
        id: String,
        env: HashMap<String, String>,
    ) -> RpcResult<PluginDefinition>;

    #[method(name = "plugins.remove", with_extensions)]
    async fn remove_plugin(&self, id: String) -> RpcResult<()>;

    // Wave 2 — custom models.
    //
    // A custom model is one the owner names by hand under a provider the daemon
    // already knows; the row is `(provider, model_id)`, so `models.add` is an upsert
    // and `models.remove` needs both halves. `models.list` filters by provider when
    // one is named, because the settings screen shows one provider's rows at a time.
    #[method(name = "models.list", with_extensions)]
    async fn list_custom_models(
        &self,
        provider: Option<String>,
    ) -> RpcResult<Vec<CustomModelRecord>>;

    #[method(name = "models.add", with_extensions)]
    async fn add_custom_model(
        &self,
        provider: String,
        model_id: String,
        display_name: Option<String>,
        context_window: Option<u32>,
    ) -> RpcResult<CustomModelRecord>;

    #[method(name = "models.remove", with_extensions)]
    async fn remove_custom_model(&self, provider: String, model_id: String) -> RpcResult<()>;

    // Wave 2 — integrations.
    //
    // An integration is one row per service, and its credentials are never in the
    // row: `integrations.connect` takes `IntegrationConfig`, files `token` and
    // `bot_token` in the keychain under `integration:{id}` / `integration:{id}:bot`,
    // and stores the rest. Every answer is an [`IntegrationStatus`], which has no
    // token field by construction. `integrations.test` is the one method under the
    // Spend tier: a check that reached GitHub or Slack would be the daemon spending
    // an owner's quota on their behalf, so today it reports what the daemon can know
    // locally — whether the service is configured and filed — and says so plainly.
    #[method(name = "integrations.list", with_extensions)]
    async fn list_integrations(&self) -> RpcResult<Vec<IntegrationStatus>>;

    #[method(name = "integrations.connect", with_extensions)]
    async fn connect_integration(
        &self,
        id: String,
        config: IntegrationConfig,
    ) -> RpcResult<IntegrationStatus>;

    #[method(name = "integrations.disconnect", with_extensions)]
    async fn disconnect_integration(&self, id: String) -> RpcResult<IntegrationStatus>;

    #[method(name = "integrations.test", with_extensions)]
    async fn test_integration(&self, id: String) -> RpcResult<IntegrationTestResult>;

    // Wave 2 — the project file browser.
    //
    // Both methods are confined to the project on purpose. The root is the project's
    // `repo_path` when it has one and `<data_dir>/files/<project key>` when it does
    // not; the requested path is joined component-by-component, so `..`, a root or a
    // prefix is refused before the filesystem is touched, and the joined path is then
    // canonicalised and required to still sit inside the root — which is what stops a
    // symlink from naming a file outside it. Reads are capped and text-only.
    #[method(name = "files.tree", with_extensions)]
    async fn list_project_files(
        &self,
        project_id: String,
        path: Option<String>,
    ) -> RpcResult<Vec<FileEntry>>;

    #[method(name = "files.read", with_extensions)]
    async fn read_project_file(&self, project_id: String, path: String) -> RpcResult<FileContent>;
}

/// Probed capabilities reported by health.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HealthCapabilities {
    pub daemon: bool,
    pub providers: bool,
    pub keychain: bool,
    /// Whether this daemon can honour the run-ending controls (`gates.changes`,
    /// `gates.reject`, `runs.cancel`) — it is up **and** its store carries the
    /// run-version column the K2 CAS loop needs, which is what makes ending a run safe.
    ///
    /// `#[serde(default)]` keeps the wire additive: a payload written before the field
    /// existed decodes as `false`, so an older daemon and an older client both keep
    /// working, and only a daemon that really supports the controls says `true`.
    #[serde(default)]
    pub run_controls: bool,
}

/// Health response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub uptime_seconds: u64,
    pub capabilities: HealthCapabilities,
}

/// Provider configuration for RPC
///
/// The wire shape the desktop's first-run wizard already sends and reads, so the
/// wizard, its tests and the 112 screenshot baselines stay exactly as they are:
///
/// - `name` is the provider's identity — the keychain account for its key, the
///   key `providers.add`/`test`/`remove` take, and what `providers.list` reports.
///   There is no separate `id`: an owner who can name the provider once should not
///   have to keep two names in step.
/// - `kind` is the adapter tag the wizard's presets use (`open_router`,
///   `deep_seek`, `kimi`, `glm`, `qwen`), which is also what names a default base
///   URL and model in `warsha-providers`.
/// - `api_base` is present only when one is configured; the client declares it
///   optional for the same reason.
/// - There is no `key` field. A provider's secret lives in the OS keychain and is
///   never part of a reply, so no `providers.*` answer can leak it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderRecord {
    pub name: String,
    pub kind: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_base: Option<String>,
}

impl From<StoredProvider> for ProviderRecord {
    fn from(provider: StoredProvider) -> Self {
        Self {
            name: provider.name,
            kind: provider.kind,
            enabled: provider.enabled,
            api_base: provider.api_base,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthStatus {
    Authenticated,
    Unauthenticated,
    Pending {
        user_code: String,
        verification_uri: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AuthStartResponse {
    Pkce {
        url: String,
    },
    Device {
        user_code: String,
        verification_uri: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthCompleteResponse {
    pub message: String,
}

/// The endpoint `provider` is tested against: the owner's own, else its kind's
/// published default. `None` only for a kind with neither.
///
/// `pub(crate)` because [`providers`] builds the adapter for the same row and has to
/// call the same endpoint: two rules about where a provider lives, in two files, are
/// two rules that will disagree.
pub(crate) fn provider_endpoint(provider: &StoredProvider) -> Option<String> {
    provider.api_base.clone().or_else(|| {
        OneClickProvider::from_tag(&provider.kind)
            .and_then(OneClickProvider::default_base_url)
            .map(str::to_string)
    })
}

/// The model `provider` is tested with: its kind's published default, or `""` when
/// the kind has none — which the setup check reports as "Enter the model id."
#[allow(dead_code)]
pub(crate) fn provider_model(provider: &StoredProvider) -> &'static str {
    OneClickProvider::from_tag(&provider.kind)
        .and_then(OneClickProvider::default_model)
        .unwrap_or_default()
}

/// A blank string is no string: the wizard sends `api_base` only when it has one,
/// but a caller that sends `""` means the same thing.
pub(crate) fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Role routing configuration for RPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleRoutingConfig {
    pub role: String,
    pub targets: Vec<RoutingTargetConfig>,
    pub fallback_enabled: bool,
    pub budget_cents_per_run: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingTargetConfig {
    pub provider_id: String,
    pub model_id: String,
    pub weight: u32,
}

/// Budget status for RPC
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetStatus {
    pub project_id: ProjectId,
    pub budget_cents: Option<u64>,
    pub spent_cents: u64,
    pub remaining_cents: Option<u64>,
}

/// One usage aggregate row, as `usage.summary` answers it (A3).
///
/// `dimension` is the whitelisted dimension the aggregate grouped by
/// (`provider_id`/`model_id`/`agent_role`/`project_id`), `key` is the value in that
/// dimension, and the numbers are the sums over the rows in the group. A group with
/// no recorded rows simply does not appear.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageRow {
    pub dimension: String,
    pub key: String,
    pub cost_cents: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub requests: u64,
}

/// One day's or month's usage, as `usage.by_time` answers it (A3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageTimeRow {
    /// `YYYY-MM-DD` for a day, `YYYY-MM` for a month.
    pub period: String,
    pub cost_cents: u64,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub requests: u64,
}

/// A CLI-managed provider's rolling subscription window, as
/// `usage.subscription_window` answers it (A3). Both windows are estimated
/// from the daemon's own cost records; the provider exposes no limit, so
/// none is invented here.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionWindow {
    /// Rolling 5-hour window (the CLI's short subscription bucket).
    pub five_hour: WindowUsage,
    /// Rolling 7-day window (the CLI's weekly bucket).
    pub seven_day: WindowUsage,
}

/// One window's estimated usage (A3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowUsage {
    /// Estimated spend inside the window, in cents.
    pub cost_cents: u64,
    /// Request count inside the window.
    pub requests: u64,
}

/// One provider's quota, as `providers.quota` answers it (A3).
///
/// `estimated` is the local estimate from the daemon's own cost records when the
/// provider exposes no quota endpoint; `checked_at` is when the daemon last asked,
/// so a stale answer can be shown with its age.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderQuotaStatus {
    pub provider: String,
    pub kind: String,
    pub quota: QuotaState,
    /// RFC 3339 timestamp of the last successful check, when there was one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
}

/// The three quota states, in the wire shape the desktop renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum QuotaState {
    /// The provider reported its own usage and limit.
    Reported { used: u64, limit: u64 },
    /// The daemon estimated usage from its own cost records.
    Estimated { usage_percentage: u8 },
    /// The provider exposes no quota and the daemon has no estimate.
    Unknown,
}

/// One gate of one run, as `gates.list` answers it (#25).
///
/// This is the daemon-local wire shape `@warsha/client` declares
/// (`packages/client/src/index.ts:84-87`): a stage and its **flat** state. It exists
/// because `warsha_core::GateState` is adjacent-tagged on the wire
/// (`#[serde(tag = "state", content = "detail")]`, `crates/warsha-core/src/lib.rs:109`,
/// proven by `crates/warshad/tests/security_identity.rs:173-178` reading
/// `approved["detail"]["by"]`) while the client and both apps read
/// `approved["by"]` directly. Converting here is what lets the queue be served without
/// churning the TS types and every gates baseline beside them (DECISIONS.md 2026-11-03).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GateSummary {
    pub stage: Stage,
    pub state: GateSummaryState,
}

/// [`GateState`] flattened onto the wire: the deciding device and instant sit beside
/// `state` instead of under `detail`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum GateSummaryState {
    Pending,
    Approved {
        by: DeviceId,
        at: chrono::DateTime<Utc>,
    },
    Rejected {
        reason: String,
        by: DeviceId,
        at: chrono::DateTime<Utc>,
    },
    ChangesRequested {
        notes: String,
        by: DeviceId,
        at: chrono::DateTime<Utc>,
    },
}

impl From<GateState> for GateSummaryState {
    fn from(state: GateState) -> Self {
        match state {
            GateState::Pending => Self::Pending,
            GateState::Approved { by, at } => Self::Approved { by, at },
            GateState::Rejected { reason, by, at } => Self::Rejected { reason, by, at },
            GateState::ChangesRequested { notes, by, at } => {
                Self::ChangesRequested { notes, by, at }
            }
        }
    }
}

/// The agent loop's own state, as one RPC answer.
///
/// C2's promise is that the conversation survives a restart, and a promise nobody can
/// read is not one: this is what a caller compares after starting a second daemon over
/// the same data directory. A turn also answers its todos, but it cannot answer
/// the approval history without running a turn — and running a turn in Agent mode is
/// spend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    /// The mode the next turn runs in.
    pub mode: AgentMode,
    /// Every switch the loop recorded, oldest first, each naming the device that
    /// approved it. This is the approval history `agent.approve_mode` appends to.
    pub approvals: Vec<ModeTransition>,
    /// What the loop said it would do, one item per turn.
    pub todos: Vec<TodoItem>,
    /// Whether a model call is wired behind an Agent-mode turn. It is the daemon's
    /// routing table that decides whether that call reaches a provider, so a wired
    /// loop with no routing still answers honestly that nothing was reached.
    pub model_wired: bool,
}
