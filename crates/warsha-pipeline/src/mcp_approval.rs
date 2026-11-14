//! MCP approvals — the pending questions and the single-use `allow_once` grants.
//!
//! KEEL K6 made the permission table real: a missing row is `Ask`, and `ask`/`deny`
//! never reach the transport. This module is the way out of `Ask` that does not
//! need the owner to hand-write a permission row:
//!
//! - a pending [`PendingApproval`] is what an `Ask` registers, with a summary of the
//!   arguments the owner was shown (built by the daemon's [`ArgumentSummarizer`];
//!   with none wired, [`KeysOnlySummarizer`] prints keys and hides every value);
//! - a [`Grant`] is one `allow_once` answer: bound to run, server, tool, role *and*
//!   the exact arguments, single-use, and short-lived ([`MCP_ONCE_GRANT_TTL`]).
//!
//! The registry is synchronous and shared by the daemon's answer RPC and the run's
//! loop, so an owner can answer while a turn is running without taking the loop's
//! mutex. It is process memory only: a restart leaves nothing behind, which is the
//! same state as a table with no row — `Ask`.
//!
//! Fail closed is the rule everywhere: a poisoned lock recovers with `into_inner`
//! rather than granting, an unknown id is an error, an expired or argument-mismatched
//! grant is spent by being discarded, and the cap refuses a new pending entry rather
//! than growing without bound.

use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::Utc;
use ulid::Ulid;

use crate::mcp_permission::ToolPermission;

/// The role string every agent-initiated MCP call is checked under.
///
/// Re-exported from [`crate::mcp_permission`] so a caller of this module does not
/// have to import two modules to name one call.
pub use crate::mcp_permission::MCP_AGENT_ROLE;

/// How long an unspent `allow_once` grant lives.
///
/// The owner answers after reading the summary; ten minutes is long enough to
/// read and short enough that an unspent grant is not a standing authority.
pub const MCP_ONCE_GRANT_TTL: Duration = Duration::from_secs(600);

/// The most pending approvals one run may have.
///
/// A retrying agent is de-duplicated by the argument key, so this bound is about a
/// genuinely different flood of calls. Past it the call fails closed: the usual
/// approval-required result, no new entry.
pub const MAX_PENDING_PER_RUN: usize = 32;

/// The prefix of every approval question id.
pub const QUESTION_ID_PREFIX: &str = "mcp-approval-";

/// The answer mirrored into the run's `AskUserQueue` when the owner chooses
/// "always allow" or "deny" through `mcp.permissions.set`.
pub const RESOLVED_BY_ROW_ANSWER: &str = "allow";

/// The answer mirrored into the run's `AskUserQueue` when a pending question's
/// server/tool was denied through `mcp.permissions.set`.
pub const RESOLVED_BY_DENY_ANSWER: &str = "deny";

/// Builds the argument summary the owner is shown.
///
/// The pipeline crate cannot see the daemon's scrubber, so this is the seam: the
/// daemon hands in an implementation that redacts, and a loop wired without one
/// gets [`KeysOnlySummarizer`], which shows no value at all.
pub trait ArgumentSummarizer: Send + Sync {
    /// A bounded, redacted rendering of `arguments` for `tool`.
    fn summarize(
        &self,
        tool: &str,
        arguments: &serde_json::Value,
        input_schema: Option<&serde_json::Value>,
    ) -> String;
}

/// The fail-closed summarizer: key names only, every value hidden.
#[derive(Debug, Default, Clone, Copy)]
pub struct KeysOnlySummarizer;

impl ArgumentSummarizer for KeysOnlySummarizer {
    fn summarize(
        &self,
        _tool: &str,
        arguments: &serde_json::Value,
        _input_schema: Option<&serde_json::Value>,
    ) -> String {
        match arguments {
            serde_json::Value::Object(map) if !map.is_empty() => {
                let mut keys: Vec<&String> = map.keys().collect();
                keys.sort();
                let shown: Vec<String> = keys
                    .iter()
                    .take(MAX_SUMMARY_KEYS)
                    .map(|key| format!("{}: [hidden]", printable_key(key)))
                    .collect();
                truncate_summary(&render_keys(shown, keys.len()))
            }
            serde_json::Value::Object(_) => "{}".to_string(),
            _ => "[hidden]".to_string(),
        }
    }
}

/// The most top-level keys a summary names.
pub const MAX_SUMMARY_KEYS: usize = 12;

/// The hard cap on a summary's length, in characters.
pub const MAX_SUMMARY_CHARS: usize = 400;

/// A key name rendered so it cannot forge a question: control characters and
/// non-printable characters are escaped, and the result is capped.
fn printable_key(key: &str) -> String {
    let escaped = serde_json::to_string(key).unwrap_or_default();
    let inner = escaped
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(key);
    cap_chars(inner, MAX_SUMMARY_KEY_CHARS)
}

/// The cap on one rendered key, so one long key cannot eat the whole summary.
const MAX_SUMMARY_KEY_CHARS: usize = 60;

/// `key: value, key: value` plus the "… +N more keys" tail.
fn render_keys(shown: Vec<String>, total: usize) -> String {
    let mut rendered = shown.join(", ");
    if total > MAX_SUMMARY_KEYS {
        let more = total - MAX_SUMMARY_KEYS;
        if !rendered.is_empty() {
            rendered.push_str(", ");
        }
        rendered.push_str(&format!("… +{more} more keys"));
    }
    rendered
}

/// `text` cut to `max` characters on a char boundary, with `…` when it was cut.
pub fn cap_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut capped: String = text.chars().take(max).collect();
    capped.push('…');
    capped
}

/// A summary cut to [`MAX_SUMMARY_CHARS`].
pub fn truncate_summary(text: &str) -> String {
    cap_chars(text, MAX_SUMMARY_CHARS)
}

/// A pending approval: the question an `Ask` registered.
#[derive(Clone)]
pub struct PendingApproval {
    /// The question id, unique per ask.
    pub id: String,
    /// The run that asked.
    pub run_id: String,
    /// The server the call names.
    pub server: String,
    /// The tool the call names.
    pub tool: String,
    /// The role the call is checked under.
    pub role: String,
    /// The arguments the call carries. Held for equality only; never printed.
    pub args: serde_json::Value,
    /// The redacted, bounded rendering shown to the owner.
    pub summary: String,
    /// When the ask was registered, ISO-8601.
    pub requested_at: String,
    /// The wire view, `None` while the owner has not answered.
    resolution: Option<PendingResolution>,
}

/// What became of a pending approval.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingResolution {
    /// `allow`, `deny`, or `allow_once by <device>`.
    pub answer: String,
    /// When the answer landed, on the monotonic clock the sweeps use.
    pub resolved_at: Instant,
}

// Manual `Debug`: keys only, never the argument values.
impl fmt::Debug for PendingApproval {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PendingApproval")
            .field("id", &self.id)
            .field("run_id", &self.run_id)
            .field("server", &self.server)
            .field("tool", &self.tool)
            .field("role", &self.role)
            .field("requested_at", &self.requested_at)
            .field("resolved", &self.resolution.is_some())
            .finish_non_exhaustive()
    }
}

/// The wire view of a pending approval, as `mcp.approvals.list` returns it.
///
/// Deliberately has no `args`: the raw arguments never leave the registry.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PendingApprovalView {
    /// The question id.
    pub id: String,
    /// The run that asked.
    pub run_id: String,
    /// The server the call names.
    pub server: String,
    /// The tool the call names.
    pub tool: String,
    /// The role the call is checked under.
    pub role: String,
    /// The redacted argument summary.
    pub summary: String,
    /// When the ask was registered, ISO-8601.
    pub requested_at: String,
}

impl From<&PendingApproval> for PendingApprovalView {
    fn from(pending: &PendingApproval) -> Self {
        Self {
            id: pending.id.clone(),
            run_id: pending.run_id.clone(),
            server: pending.server.clone(),
            tool: pending.tool.clone(),
            role: pending.role.clone(),
            summary: pending.summary.clone(),
            requested_at: pending.requested_at.clone(),
        }
    }
}

/// One `allow_once` answer: the situation it is bound to and when it lapses.
#[derive(Clone)]
pub struct Grant {
    /// The run the grant was issued for.
    pub run_id: String,
    /// The server the grant admits.
    pub server: String,
    /// The tool the grant admits.
    pub tool: String,
    /// The role the grant admits.
    pub role: String,
    /// The exact arguments the grant admits, in canonical form.
    pub args: serde_json::Value,
    /// The question the grant answers.
    pub question_id: String,
    /// The device that answered.
    pub granted_by: String,
    /// When the grant was issued, ISO-8601 (what a reply reports).
    pub issued_at: String,
    /// The wall-clock deadline, ISO-8601, for the reply and the audit trail.
    pub expires_at_rfc3339: String,
    /// The monotonic deadline, what [`McpApprovals::take`] compares.
    pub expires_at: Instant,
}

// Manual `Debug`: keys only, never the argument values.
impl fmt::Debug for Grant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Grant")
            .field("run_id", &self.run_id)
            .field("server", &self.server)
            .field("tool", &self.tool)
            .field("role", &self.role)
            .field("question_id", &self.question_id)
            .field("granted_by", &self.granted_by)
            .field("issued_at", &self.issued_at)
            .field("expires_at", &self.expires_at_rfc3339)
            .finish_non_exhaustive()
    }
}

/// Why a pending approval could not be registered.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ApprovalError {
    /// The run already has [`MAX_PENDING_PER_RUN`] pending approvals.
    #[error("run {run_id} already has {cap} pending MCP approvals; the call fails closed")]
    TooManyPending {
        /// The run that hit the cap.
        run_id: String,
        /// The cap it hit.
        cap: usize,
    },
    /// No pending approval carries that id.
    #[error("no pending MCP approval has id `{0}`")]
    UnknownPending(String),
}

/// The outcome of taking a grant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TakeOutcome {
    /// A live, argument-equal grant was consumed.
    Consumed,
    /// No grant matched this call.
    Missing,
}

/// The registry of pending approvals and single-use grants.
///
/// Both maps are guarded by their own `Mutex` and every accessor recovers a
/// poisoned lock (`into_inner`) rather than panicking: a panic elsewhere must not
/// turn this into an allow, and it must not turn an answer RPC into a crash. The
/// recovery is safe because the values are plain data and every one of them fails
/// closed when wrong.
pub struct McpApprovals {
    pending: Mutex<HashMap<String, PendingApproval>>,
    grants: Mutex<HashMap<(String, String, String, String), Grant>>,
    summarizer: Box<dyn ArgumentSummarizer>,
}

impl fmt::Debug for McpApprovals {
    /// Counts only: neither map's values may reach a log line.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len();
        let grants = self
            .grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .len();
        f.debug_struct("McpApprovals")
            .field("pending", &pending)
            .field("grants", &grants)
            .finish_non_exhaustive()
    }
}

impl Default for McpApprovals {
    /// The fail-closed default: no summarizer means key names only.
    fn default() -> Self {
        Self::new(None)
    }
}

impl McpApprovals {
    /// A registry whose summaries come from `summarizer`; `None` hides every value.
    pub fn new(summarizer: Option<Box<dyn ArgumentSummarizer>>) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            grants: Mutex::new(HashMap::new()),
            summarizer: summarizer.unwrap_or_else(|| Box::new(KeysOnlySummarizer)),
        }
    }

    /// The summary the owner would see for `arguments`.
    pub fn summarize(
        &self,
        tool: &str,
        arguments: &serde_json::Value,
        input_schema: Option<&serde_json::Value>,
    ) -> String {
        truncate_summary(&self.summarizer.summarize(tool, arguments, input_schema))
    }

    /// The question id a new ask for this call would carry.
    pub fn next_question_id() -> String {
        format!("{QUESTION_ID_PREFIX}{}", Ulid::new())
    }

    /// Register an ask, de-duplicating a retry of the same call.
    ///
    /// A *pending* entry with the same `(run, server, tool, role, args)` is
    /// returned as it stands, so an agent that retries does not spawn one question
    /// per attempt. A resolved entry no longer counts: the retry asks again with a
    /// fresh id. Past [`MAX_PENDING_PER_RUN`] pendings for the run, the ask is
    /// refused and the caller fails closed.
    pub fn register_pending(
        &self,
        run_id: &str,
        server: &str,
        tool: &str,
        role: &str,
        args: &serde_json::Value,
        summary: String,
    ) -> Result<String, ApprovalError> {
        let canonical = canonical_json(args);
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if let Some(existing) = pending.values().find(|entry| {
            entry.resolution.is_none()
                && entry.run_id == run_id
                && entry.server == server
                && entry.tool == tool
                && entry.role == role
                && canonical_json(&entry.args) == canonical
        }) {
            return Ok(existing.id.clone());
        }

        let open = pending
            .values()
            .filter(|entry| entry.run_id == run_id && entry.resolution.is_none())
            .count();
        if open >= MAX_PENDING_PER_RUN {
            return Err(ApprovalError::TooManyPending {
                run_id: run_id.to_string(),
                cap: MAX_PENDING_PER_RUN,
            });
        }

        let id = Self::next_question_id();
        pending.insert(
            id.clone(),
            PendingApproval {
                id: id.clone(),
                run_id: run_id.to_string(),
                server: server.to_string(),
                tool: tool.to_string(),
                role: role.to_string(),
                args: canonical,
                summary: truncate_summary(&summary),
                requested_at: Utc::now().to_rfc3339(),
                resolution: None,
            },
        );
        Ok(id)
    }

    /// Every unresolved pending approval, oldest first, as the list RPC returns it.
    pub fn pending(&self) -> Vec<PendingApprovalView> {
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut views: Vec<PendingApprovalView> = pending
            .values()
            .filter(|entry| entry.resolution.is_none())
            .map(PendingApprovalView::from)
            .collect();
        views.sort_by(|a, b| {
            a.requested_at
                .cmp(&b.requested_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        views
    }

    /// How many approvals are pending, across every run.
    pub fn pending_len(&self) -> usize {
        let pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        pending
            .values()
            .filter(|entry| entry.resolution.is_none())
            .count()
    }

    /// Issue an `allow_once` grant for the pending approval `id`.
    ///
    /// The grant carries the exact arguments that pending entry recorded, so the
    /// answer is bound to what the owner was shown. The pending entry becomes
    /// resolved and leaves the list; its queue mirror is answered at the run's next
    /// `prepare_turn`. An unknown, already-resolved or expired id is an error and
    /// no grant is issued.
    pub fn allow_once(&self, id: &str, granted_by: &str) -> Result<Grant, ApprovalError> {
        self.allow_once_at(id, granted_by, Instant::now())
    }

    /// [`McpApprovals::allow_once`] against an explicit clock, for tests.
    pub fn allow_once_at(
        &self,
        id: &str,
        granted_by: &str,
        now: Instant,
    ) -> Result<Grant, ApprovalError> {
        let entry = {
            let mut pending = self
                .pending
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            sweep_expired_pending(&mut pending, now);
            let entry = pending
                .get_mut(id)
                .filter(|entry| entry.resolution.is_none())
                .ok_or_else(|| ApprovalError::UnknownPending(id.to_string()))?;
            entry.resolution = Some(PendingResolution {
                answer: format!("allow_once by {granted_by}"),
                resolved_at: now,
            });
            entry.clone()
        };

        let grant = Grant {
            run_id: entry.run_id,
            server: entry.server,
            tool: entry.tool,
            role: entry.role,
            args: entry.args,
            question_id: entry.id,
            granted_by: granted_by.to_string(),
            issued_at: Utc::now().to_rfc3339(),
            expires_at_rfc3339: (Utc::now()
                + chrono::Duration::from_std(MCP_ONCE_GRANT_TTL)
                    .unwrap_or_else(|_| chrono::Duration::seconds(600)))
            .to_rfc3339(),
            expires_at: now + MCP_ONCE_GRANT_TTL,
        };
        let mut grants = self
            .grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // One grant per key: a second answer replaces, never stacks.
        grants.insert(grant_key(&grant), grant.clone());
        Ok(grant)
    }

    /// Consume a grant for exactly this call, if one is live.
    pub fn take(
        &self,
        run_id: &str,
        server: &str,
        tool: &str,
        role: &str,
        args: &serde_json::Value,
    ) -> TakeOutcome {
        self.take_at(run_id, server, tool, role, args, Instant::now())
    }

    /// [`McpApprovals::take`] against an explicit clock, for tests.
    pub fn take_at(
        &self,
        run_id: &str,
        server: &str,
        tool: &str,
        role: &str,
        args: &serde_json::Value,
        now: Instant,
    ) -> TakeOutcome {
        let key = (
            run_id.to_string(),
            server.to_string(),
            tool.to_string(),
            role.to_string(),
        );
        let canonical = canonical_json(args);
        let mut grants = self
            .grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        sweep_expired_grants(&mut grants, now);
        match grants.get(&key) {
            Some(grant) if canonical_json(&grant.args) == canonical && grant.expires_at > now => {
                grants.remove(&key);
                TakeOutcome::Consumed
            }
            // A grant for another call is neither spent nor seen.
            _ => TakeOutcome::Missing,
        }
    }

    /// Whether a live grant exists for exactly this call, without consuming it.
    pub fn has_grant(&self, run_id: &str, server: &str, tool: &str, role: &str) -> bool {
        let key = (
            run_id.to_string(),
            server.to_string(),
            tool.to_string(),
            role.to_string(),
        );
        let now = Instant::now();
        let mut grants = self
            .grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        sweep_expired_grants(&mut grants, now);
        grants
            .get(&key)
            .map(|grant| grant.expires_at > now)
            .unwrap_or(false)
    }

    /// Drop every grant for `(server, tool, role)`; `tool = "*"` drops the
    /// server's grants for that role, whatever their tool.
    pub fn purge_grants(&self, server: &str, tool: &str, role: &str) {
        let mut grants = self
            .grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        grants.retain(|_, grant| {
            let same_role = grant.role == role;
            let same_server = grant.server == server;
            let same_tool = tool == "*" || grant.tool == tool;
            !(same_role && same_server && same_tool)
        });
    }

    /// Drop every grant and pending entry of one run.
    pub fn purge_run(&self, run_id: &str) {
        let mut grants = self
            .grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        grants.retain(|_, grant| grant.run_id != run_id);
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        pending.retain(|_, entry| entry.run_id != run_id);
    }

    /// Resolve the pending approvals a new permission row now decides.
    ///
    /// `permission` is the value the owner just set. `deny` resolves every entry
    /// the row decides with `deny`; `allow` and `ask` resolve with `allow` when the
    /// row is an `allow` and with nothing when it is `ask` (an `ask` row resolves
    /// nothing, so its entries stay pending). A `tool` of `"*"` decides every tool
    /// of `server`.
    ///
    /// **Any** set for the key purges the grants for it, whatever the value: even
    /// `ask` means the owner re-decided, so an earlier `allow_once` must not outlive
    /// the decision.
    pub fn resolve_by_row(&self, server: &str, tool: &str, role: &str, permission: ToolPermission) {
        let answer = match permission {
            ToolPermission::Allow => Some(RESOLVED_BY_ROW_ANSWER.to_string()),
            ToolPermission::Deny => Some(RESOLVED_BY_DENY_ANSWER.to_string()),
            ToolPermission::Ask => None,
        };
        if let Some(answer) = answer {
            let mut pending = self
                .pending
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            for entry in pending.values_mut() {
                let decided = entry.role == role
                    && entry.server == server
                    && (tool == "*" || entry.tool == tool);
                if decided && entry.resolution.is_none() {
                    entry.resolution = Some(PendingResolution {
                        answer: answer.clone(),
                        resolved_at: Instant::now(),
                    });
                }
            }
        }
        self.purge_grants(server, tool, role);
    }

    /// Drain the resolved approvals of one run for the queue mirror, oldest first.
    ///
    /// Only entries the owner (or a permission row) actually resolved are drained:
    /// an entry still waiting is left alone, so a caller that drains on every turn
    /// cannot clear a question the owner has not answered.
    pub fn drain_resolved(&self, run_id: &str) -> Vec<ResolvedApproval> {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut drained: Vec<ResolvedApproval> = pending
            .values()
            .filter(|entry| entry.run_id == run_id)
            .filter_map(|entry| {
                entry
                    .resolution
                    .as_ref()
                    .map(|resolution| ResolvedApproval {
                        id: entry.id.clone(),
                        server: entry.server.clone(),
                        tool: entry.tool.clone(),
                        role: entry.role.clone(),
                        requested_at: entry.requested_at.clone(),
                        answer: resolution.answer.clone(),
                    })
            })
            .collect();
        drained.sort_by(|a, b| {
            a.requested_at
                .cmp(&b.requested_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        for entry in &drained {
            pending.remove(&entry.id);
        }
        drained
    }
}

/// A pending approval the owner has answered, waiting for the run's queue mirror.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedApproval {
    /// The question id the loop queued.
    pub id: String,
    /// The server the call named.
    pub server: String,
    /// The tool the call named.
    pub tool: String,
    /// The role the call was checked under.
    pub role: String,
    /// When the ask was registered, ISO-8601.
    pub requested_at: String,
    /// `allow`, `deny`, or `allow_once by <device>`.
    pub answer: String,
}

/// The map key a grant is stored under: the four bound fields, never the args.
fn grant_key(grant: &Grant) -> (String, String, String, String) {
    (
        grant.run_id.clone(),
        grant.server.clone(),
        grant.tool.clone(),
        grant.role.clone(),
    )
}

/// Drop grants whose deadline passed.
fn sweep_expired_grants(
    grants: &mut HashMap<(String, String, String, String), Grant>,
    now: Instant,
) {
    grants.retain(|_, grant| grant.expires_at > now);
}

/// Drop resolved entries that were never drained.
///
/// A pending entry has no TTL while it waits (it is a question, not an authority),
/// but a resolved entry that no turn ever collected is stale bookkeeping: it is
/// swept once it is older than the grant window.
fn sweep_expired_pending(pending: &mut HashMap<String, PendingApproval>, now: Instant) {
    pending.retain(|_, entry| match &entry.resolution {
        None => true,
        Some(resolution) => now.duration_since(resolution.resolved_at) < MCP_ONCE_GRANT_TTL,
    });
}

/// A JSON value with object keys sorted at every depth.
///
/// Two spellings of the same arguments (`{"a":1,"b":2}` and `{"b":2,"a":1}`) must
/// compare equal, or an owner's answer to one call would not admit the identical
/// retry.
pub fn canonical_json(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut sorted = serde_json::Map::new();
            for key in keys {
                if let Some(value) = map.get(key) {
                    sorted.insert(key.clone(), canonical_json(value));
                }
            }
            serde_json::Value::Object(sorted)
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(canonical_json).collect())
        }
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn registry() -> McpApprovals {
        McpApprovals::default()
    }

    fn args() -> serde_json::Value {
        json!({"path": "a.txt", "mode": "write"})
    }

    fn register(registry: &McpApprovals, run: &str, server: &str, tool: &str) -> String {
        registry
            .register_pending(
                run,
                server,
                tool,
                MCP_AGENT_ROLE,
                &args(),
                "path".to_string(),
            )
            .expect("the ask registers")
    }

    #[test]
    fn a_new_registry_has_nothing_pending_and_no_grants() {
        let registry = registry();
        assert!(registry.pending().is_empty());
        assert_eq!(registry.pending_len(), 0);
        assert!(!registry.has_grant("run-1", "files", "write", MCP_AGENT_ROLE));
    }

    #[test]
    fn keys_only_summarizer_shows_keys_and_hides_values() {
        let registry = registry();
        let summary = registry.summarize("write", &args(), None);
        assert!(summary.contains("path: [hidden]"), "unexpected: {summary}");
        assert!(summary.contains("mode: [hidden]"), "unexpected: {summary}");
        assert!(!summary.contains("a.txt"), "a value leaked: {summary}");
    }

    #[test]
    fn a_grant_is_consumed_exactly_once() {
        let registry = registry();
        let id = register(&registry, "run-1", "files", "write");
        registry
            .allow_once(&id, "device-1")
            .expect("the grant issues");

        assert!(registry.has_grant("run-1", "files", "write", MCP_AGENT_ROLE));
        assert_eq!(
            registry.take("run-1", "files", "write", MCP_AGENT_ROLE, &args()),
            TakeOutcome::Consumed
        );
        assert_eq!(
            registry.take("run-1", "files", "write", MCP_AGENT_ROLE, &args()),
            TakeOutcome::Missing
        );
    }

    #[test]
    fn a_grant_is_bound_to_every_field_of_the_call_key() {
        for (run, server, tool, role) in [
            ("run-2", "files", "write", MCP_AGENT_ROLE),
            ("run-1", "other", "write", MCP_AGENT_ROLE),
            ("run-1", "files", "read", MCP_AGENT_ROLE),
            ("run-1", "files", "write", "reviewer"),
        ] {
            let registry = registry();
            let id = register(&registry, "run-1", "files", "write");
            registry
                .allow_once(&id, "device-1")
                .expect("the grant issues");
            assert_eq!(
                registry.take(run, server, tool, role, &args()),
                TakeOutcome::Missing,
                "a grant admitted ({run}, {server}, {tool}, {role})"
            );
            assert!(
                registry.has_grant("run-1", "files", "write", MCP_AGENT_ROLE),
                "a non-matching call spent the grant"
            );
        }
    }

    #[test]
    fn a_grant_is_bound_to_the_exact_arguments() {
        let registry = registry();
        let id = register(&registry, "run-1", "files", "write");
        registry
            .allow_once(&id, "device-1")
            .expect("the grant issues");

        assert_eq!(
            registry.take(
                "run-1",
                "files",
                "write",
                MCP_AGENT_ROLE,
                &json!({"path": "authorized_keys"})
            ),
            TakeOutcome::Missing
        );
        // The same arguments spelled with a different key order are the same call.
        assert_eq!(
            registry.take(
                "run-1",
                "files",
                "write",
                MCP_AGENT_ROLE,
                &json!({"mode": "write", "path": "a.txt"})
            ),
            TakeOutcome::Consumed
        );
    }

    #[test]
    fn a_grant_expires_after_the_ttl() {
        let registry = registry();
        let id = register(&registry, "run-1", "files", "write");
        let now = Instant::now();
        let grant = registry
            .allow_once_at(&id, "device-1", now)
            .expect("the grant issues");

        assert!(grant.expires_at > now);
        assert_eq!(
            registry.take_at(
                "run-1",
                "files",
                "write",
                MCP_AGENT_ROLE,
                &args(),
                now + MCP_ONCE_GRANT_TTL + Duration::from_secs(1)
            ),
            TakeOutcome::Missing
        );
    }

    #[test]
    fn an_unspent_grant_is_not_a_standing_authority() {
        let registry = registry();
        let id = register(&registry, "run-1", "files", "write");
        let now = Instant::now();
        registry
            .allow_once_at(&id, "device-1", now)
            .expect("the grant issues");
        // Sweeping on every call drops the expired grant.
        assert_eq!(
            registry.take_at(
                "run-1",
                "files",
                "write",
                MCP_AGENT_ROLE,
                &args(),
                now + MCP_ONCE_GRANT_TTL + Duration::from_secs(1)
            ),
            TakeOutcome::Missing
        );
        assert!(!registry.has_grant("run-1", "files", "write", MCP_AGENT_ROLE));
    }

    /// T5: the TTL is enforced on `take_at`, the 33rd pending ask is refused with
    /// no entry, and an identical retry reuses one id.
    #[test]
    fn grant_expires_and_pending_is_capped_and_deduped() {
        let registry = registry();
        let id = register(&registry, "run-1", "files", "write");
        let now = Instant::now();
        registry
            .allow_once_at(&id, "device-1", now)
            .expect("the grant issues");
        assert_eq!(
            registry.take_at(
                "run-1",
                "files",
                "write",
                MCP_AGENT_ROLE,
                &args(),
                now + MCP_ONCE_GRANT_TTL
            ),
            TakeOutcome::Missing,
            "a grant outlived its TTL"
        );

        // An identical retry is one question, not one per attempt.
        let first = register(&registry, "run-2", "files", "write");
        let second = register(&registry, "run-2", "files", "write");
        assert_eq!(first, second);

        // The cap counts pending entries per run and refuses past it without adding.
        let capped = McpApprovals::default();
        for index in 0..MAX_PENDING_PER_RUN {
            capped
                .register_pending(
                    "run-3",
                    "files",
                    &format!("tool-{index}"),
                    MCP_AGENT_ROLE,
                    &json!({}),
                    "none".to_string(),
                )
                .expect("an ask under the cap registers");
        }
        let refused = capped.register_pending(
            "run-3",
            "files",
            "one-too-many",
            MCP_AGENT_ROLE,
            &json!({}),
            "none".to_string(),
        );
        assert!(matches!(refused, Err(ApprovalError::TooManyPending { .. })));
        assert_eq!(capped.pending_len(), MAX_PENDING_PER_RUN);
    }

    #[test]
    fn a_retry_of_the_same_ask_reuses_one_pending_id() {
        let registry = registry();
        let first = register(&registry, "run-1", "files", "write");
        let second = register(&registry, "run-1", "files", "write");
        assert_eq!(first, second);
        assert_eq!(registry.pending_len(), 1);
        assert!(first.starts_with(QUESTION_ID_PREFIX));
    }

    #[test]
    fn a_retry_after_the_owner_answered_asks_again_with_a_new_id() {
        let registry = registry();
        let first = register(&registry, "run-1", "files", "write");
        registry
            .allow_once(&first, "device-1")
            .expect("the grant issues");
        let second = register(&registry, "run-1", "files", "write");
        assert_ne!(first, second);
    }

    #[test]
    fn the_thirty_third_pending_ask_is_refused_and_adds_nothing() {
        let registry = registry();
        for index in 0..MAX_PENDING_PER_RUN {
            let tool = format!("tool-{index}");
            registry
                .register_pending(
                    "run-1",
                    "files",
                    &tool,
                    MCP_AGENT_ROLE,
                    &json!({}),
                    "none".to_string(),
                )
                .expect("the ask under the cap registers");
        }
        let refused = registry.register_pending(
            "run-1",
            "files",
            "one-too-many",
            MCP_AGENT_ROLE,
            &json!({}),
            "none".to_string(),
        );
        assert_eq!(
            refused,
            Err(ApprovalError::TooManyPending {
                run_id: "run-1".to_string(),
                cap: MAX_PENDING_PER_RUN
            })
        );
        assert_eq!(registry.pending_len(), MAX_PENDING_PER_RUN);
        // Another run has its own cap.
        assert!(registry
            .register_pending(
                "run-2",
                "files",
                "one-too-many",
                MCP_AGENT_ROLE,
                &json!({}),
                "none".to_string(),
            )
            .is_ok());
    }

    #[test]
    fn resolve_by_row_allow_resolves_pending_and_purges_grants() {
        let registry = registry();
        // One unspent grant for the key the row is about to decide.
        let granted = register(&registry, "run-1", "files", "write");
        registry
            .allow_once(&granted, "device-1")
            .expect("the grant issues");
        // One ask the owner has not answered yet, on the same server.
        let asked = registry
            .register_pending(
                "run-1",
                "files",
                "read",
                MCP_AGENT_ROLE,
                &json!({}),
                "none".to_string(),
            )
            .expect("the ask registers");

        registry.resolve_by_row("files", "*", MCP_AGENT_ROLE, ToolPermission::Allow);
        assert!(registry.pending().is_empty());
        assert!(
            !registry.has_grant("run-1", "files", "write", MCP_AGENT_ROLE),
            "the set did not purge the grant"
        );
        let mut drained = registry.drain_resolved("run-1");
        drained.sort_by(|a, b| a.id.cmp(&b.id));
        let ids: Vec<&str> = drained.iter().map(|view| view.id.as_str()).collect();
        assert!(ids.contains(&granted.as_str()));
        assert!(ids.contains(&asked.as_str()));
        // The entry the owner answered keeps that answer; the unanswered one is
        // resolved by the row itself.
        let asked_view = drained
            .iter()
            .find(|view| view.id == asked)
            .expect("the unanswered ask drains");
        assert_eq!(asked_view.answer, RESOLVED_BY_ROW_ANSWER);
        assert!(registry.drain_resolved("run-1").is_empty());
    }

    #[test]
    fn resolve_by_row_deny_resolves_with_deny() {
        let registry = registry();
        register(&registry, "run-1", "files", "write");
        registry.resolve_by_row("files", "write", MCP_AGENT_ROLE, ToolPermission::Deny);
        let drained = registry.drain_resolved("run-1");
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].answer, RESOLVED_BY_DENY_ANSWER);
    }

    #[test]
    fn resolve_by_row_ask_leaves_pending_alone_but_purges_grants() {
        let registry = registry();
        let id = register(&registry, "run-1", "files", "write");
        registry
            .allow_once(&id, "device-1")
            .expect("the grant issues");
        // A second, unanswered ask on the same key.
        let asked = registry
            .register_pending(
                "run-1",
                "files",
                "write",
                MCP_AGENT_ROLE,
                &json!({"path": "b.txt"}),
                "path".to_string(),
            )
            .expect("the ask registers");

        registry.resolve_by_row("files", "write", MCP_AGENT_ROLE, ToolPermission::Ask);
        // The answered entry drains; the unanswered one stays pending.
        let drained = registry.drain_resolved("run-1");
        assert_eq!(drained.len(), 1);
        assert_eq!(drained[0].id, id);
        let pending = registry.pending();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, asked);
        assert!(
            !registry.has_grant("run-1", "files", "write", MCP_AGENT_ROLE),
            "an `ask` set left a grant standing"
        );
    }

    #[test]
    fn the_wildcard_row_resolves_the_whole_server() {
        let registry = registry();
        let write = register(&registry, "run-1", "files", "write");
        let read = register(&registry, "run-1", "files", "read");
        registry
            .allow_once(&read, "device-2")
            .expect("the grant issues");

        registry.resolve_by_row("files", "*", MCP_AGENT_ROLE, ToolPermission::Allow);
        let drained = registry.drain_resolved("run-1");
        let ids: Vec<&str> = drained.iter().map(|view| view.id.as_str()).collect();
        assert!(ids.contains(&write.as_str()));
        assert!(ids.contains(&read.as_str()));
        assert!(!registry.has_grant("run-1", "files", "read", MCP_AGENT_ROLE));
    }

    #[test]
    fn purge_run_drops_one_runs_grants_and_pending() {
        let registry = registry();
        let first = register(&registry, "run-1", "files", "write");
        let second = register(&registry, "run-2", "files", "write");
        registry
            .allow_once(&first, "device-1")
            .expect("the grant issues");
        registry
            .allow_once(&second, "device-1")
            .expect("the grant issues");
        // An unanswered ask on each run, so both pending maps hold a live entry.
        for run in ["run-1", "run-2"] {
            registry
                .register_pending(
                    run,
                    "files",
                    "read",
                    MCP_AGENT_ROLE,
                    &json!({}),
                    "none".to_string(),
                )
                .expect("the ask registers");
        }

        registry.purge_run("run-1");
        assert_eq!(registry.pending_len(), 1);
        assert!(registry.drain_resolved("run-1").is_empty());
        assert!(!registry.has_grant("run-1", "files", "write", MCP_AGENT_ROLE));
        assert!(registry.has_grant("run-2", "files", "write", MCP_AGENT_ROLE));
        assert_eq!(registry.pending().len(), 1);
        assert_eq!(registry.drain_resolved("run-2").len(), 1);
    }

    #[test]
    fn an_unknown_pending_id_is_refused_and_issues_no_grant() {
        let registry = registry();
        assert_eq!(
            registry.allow_once("mcp-approval-nope", "device-1").err(),
            Some(ApprovalError::UnknownPending(
                "mcp-approval-nope".to_string()
            ))
        );
        assert_eq!(registry.drain_resolved("run-1").len(), 0);
    }

    #[test]
    fn a_second_answer_replaces_rather_than_stacks() {
        let registry = registry();
        let first = register(&registry, "run-1", "files", "write");
        registry
            .allow_once(&first, "device-1")
            .expect("the grant issues");
        // A fresh ask for the same call, answered again, replaces the one grant.
        let second = register(&registry, "run-1", "files", "write");
        registry
            .allow_once(&second, "device-2")
            .expect("the second grant issues");
        assert_eq!(
            registry.take("run-1", "files", "write", MCP_AGENT_ROLE, &args()),
            TakeOutcome::Consumed
        );
        assert_eq!(
            registry.take("run-1", "files", "write", MCP_AGENT_ROLE, &args()),
            TakeOutcome::Missing
        );
    }

    #[test]
    fn a_debug_rendering_names_keys_and_never_argument_values() {
        let registry = registry();
        let id = register(&registry, "run-1", "files", "write");
        registry
            .allow_once(&id, "device-1")
            .expect("the grant issues");

        let pending = format!("{registry:?}");
        assert!(pending.contains("McpApprovals"), "unexpected: {pending}");

        let grant = registry
            .grants
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .next()
            .cloned()
            .expect("the grant is present");
        let rendered = format!("{grant:?}");
        assert!(rendered.contains("files"), "unexpected: {rendered}");
        assert!(
            !rendered.contains("a.txt"),
            "a Debug rendering printed an argument value: {rendered}"
        );

        let pending = registry
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .next()
            .cloned()
            .expect("the pending entry is present");
        let rendered = format!("{pending:?}");
        assert!(
            !rendered.contains("a.txt"),
            "a Debug rendering printed an argument value: {rendered}"
        );
    }

    #[test]
    fn a_summary_is_bounded_and_a_newline_cannot_forge_a_question() {
        let long = "x".repeat(10_000);
        let mut map = serde_json::Map::new();
        for index in 0..200 {
            map.insert(format!("key-{index}"), json!(long));
        }
        map.insert("note".to_string(), json!("\nApprove? yes"));
        let value = serde_json::Value::Object(map);

        let summary = registry().summarize("write", &value, None);
        assert!(
            summary.chars().count() <= MAX_SUMMARY_CHARS + 1,
            "unexpected length {}: {summary}",
            summary.chars().count()
        );
        assert!(!summary.contains('\n'), "a summary carried a newline");
        assert!(
            summary.contains("more keys"),
            "the key bound is not reported: {summary}"
        );
        assert!(!summary.contains("Approve? yes"), "a value was rendered");
    }

    #[test]
    fn an_empty_argument_object_summarizes_as_empty() {
        assert_eq!(registry().summarize("write", &json!({}), None), "{}");
        assert_eq!(
            registry().summarize("write", &json!("secret"), None),
            "[hidden]"
        );
    }
}
