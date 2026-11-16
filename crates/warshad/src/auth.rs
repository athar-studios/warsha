//! Who is calling, what they may do, and how often (security audit H-01, H-03, H-04).
//!
//! The daemon used to hold one secret — a bearer token — and answer "yes" to anyone
//! who presented it. That is enough to keep a stranger off the socket and not enough
//! to answer the questions an RPC actually raises: *which device* approved this gate
//! (H-03), whether this caller may change a provider's key or a project's budget at
//! all (H-04), and whether one process may spawn arbitrary programs (H-05). This
//! module is the policy those questions are asked against, and it is deliberately
//! separate from the RPC surface so the table can be read, tested and reviewed as one
//! thing.
//!
//! The rules, in short:
//!
//! - A caller is an [`Actor`], derived from the credential that reached the daemon:
//!   the daemon's own token is the **owner** (the local desktop workflow), and a
//!   pairing secret is a **paired device**. Nothing a request body says about who the
//!   caller is ever overrides that.
//! - Every method names what it asks of its caller ([`Policy`]) and which ceiling it
//!   is measured against ([`Tier`]). Pairing, authentication and paid work get the
//!   strictest ceilings, as the audit requires.
//! - Child processes and MCP transports are held to a command policy that comes from
//!   the daemon's configuration and its own data directory, and fails closed.

use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};
use thiserror::Error;
use warsha_core::DeviceId;
use warsha_pipeline::{PhonePairing, SHELL_COMMANDS};
use warsha_remote::constant_time_eq;
use warsha_remote::rate_limit::{Quota, RateLimiter, RefusalMeter};

use super::SettingsError;

/// What a caller is allowed to ask for.
///
/// Two roles, because the daemon has two real kinds of caller: the machine the
/// desktop runs on, which owns the daemon and everything under it, and a phone the
/// owner paired, which may look and may decide a gate but does not hold the owner's
/// authority over providers, budgets, pairings or processes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ActorRole {
    /// A paired device: it proved it holds a pairing secret.
    Paired,
    /// The daemon's owner: it proved it holds the daemon's own token.
    Owner,
}

impl ActorRole {
    /// Whether this role carries everything `required` carries.
    pub fn covers(self, required: ActorRole) -> bool {
        self >= required
    }
}

/// The verified caller behind one request.
///
/// Built only from a credential the daemon checked, which is the whole point: an
/// `Actor` is what the transport says the caller proved, and there is no path from a
/// request body to one.
#[derive(Debug, Clone)]
pub struct Actor {
    /// The device this session speaks as. `None` when the pairing names something
    /// that is not a device id: a decision that has to record an approver then
    /// refuses rather than inventing one.
    device_id: Option<DeviceId>,
    /// The pairing's own name for the caller, for a log line and an error message.
    /// Never a secret.
    label: String,
    /// The pairing's `device_id` exactly as the record carried it, including an id
    /// that is not a UUID. The live pairing check compares this string, so a session
    /// that is valid for reads is not refused just because its id is not a uuid.
    pairing_device_id: Option<String>,
    role: ActorRole,
}

impl Actor {
    /// The daemon's owner: the local desktop, holding the daemon's own token.
    pub fn owner(local_device: DeviceId) -> Self {
        Self {
            device_id: Some(local_device),
            label: "owner".to_string(),
            pairing_device_id: None,
            role: ActorRole::Owner,
        }
    }

    /// A device that presented a pairing secret.
    pub fn paired(pairing: &PhonePairing) -> Self {
        Self {
            device_id: uuid::Uuid::parse_str(pairing.device_id.trim())
                .ok()
                .map(DeviceId),
            label: format!("device:{}", pairing.device_id.trim()),
            pairing_device_id: Some(pairing.device_id.trim().to_string()),
            role: ActorRole::Paired,
        }
    }

    /// This actor's role.
    pub fn role(&self) -> ActorRole {
        self.role
    }

    /// True for the daemon's own token.
    pub fn is_owner(&self) -> bool {
        self.role == ActorRole::Owner
    }

    /// The rate-limit key for this caller: an authenticated identity, never a peer
    /// address, because the address of a loopback daemon is the same for every app
    /// on the machine.
    pub fn key(&self) -> &str {
        &self.label
    }

    /// The device id to record an action against.
    ///
    /// A paired device whose id is not a device id has no answer here, and an
    /// approver cannot be a blank or a made-up uuid: the caller is told to pair with
    /// a real device id instead of being logged as somebody.
    pub fn device_id(&self) -> Option<DeviceId> {
        self.device_id
    }

    /// The identifier the pairing itself carried, verbatim.
    ///
    /// Unlike [`Actor::device_id`], this keeps an id that is not a UUID: the live
    /// pairing check compares the record's own string, not a parsed identity.
    pub fn pairing_device_id(&self) -> Option<&str> {
        self.pairing_device_id.as_deref()
    }

    /// The caller's name for itself, for logs and errors.
    pub fn label(&self) -> &str {
        &self.label
    }
}

/// The sessions the daemon recognises.
///
/// A token is not an identity until something maps it to one, which is exactly what
/// audit H-04 says was missing: one equality check, and every privileged mutation
/// behind it.
#[derive(Debug, Clone)]
pub struct Sessions {
    /// The daemon's own bearer token: the owner credential.
    owner_token: String,
    /// The device that token speaks as — the daemon's local identity, so a gate the
    /// desktop approves is recorded against the machine that owns the run.
    local_device: DeviceId,
}

impl Sessions {
    /// Sessions from the daemon's configuration and its local device identity.
    pub fn new(owner_token: impl Into<String>, local_device: DeviceId) -> Self {
        Self {
            owner_token: owner_token.into(),
            local_device,
        }
    }

    /// The owner credential, for the transport that has to check it on the way in.
    pub fn owner_token(&self) -> &str {
        &self.owner_token
    }

    /// The daemon's own device id.
    pub fn local_device(&self) -> DeviceId {
        self.local_device
    }

    /// Whether `presented` is the owner's token.
    pub fn is_owner_token(&self, presented: &str) -> bool {
        // A constant-time comparison of a shared secret: an RPC that answers faster
        // for a near miss is a probe an attacker can average.
        !self.owner_token.is_empty()
            && constant_time_eq(self.owner_token.as_bytes(), presented.as_bytes())
    }

    /// The actor a bearer token authenticates, checked against the owner token and
    /// then against the live pairing store.
    ///
    /// `pairings` is what the daemon holds at the moment of the call, so revoking a
    /// phone takes effect on its next request rather than on the next restart. An
    /// empty token, an unknown token, a revoked device and a pairing past the
    /// deadline its offer was minted with all answer `None`: the daemon does not
    /// explain which one a caller guessed (audit H1).
    pub fn resolve(&self, presented: &str, pairings: &[PhonePairing]) -> Option<Actor> {
        self.resolve_at(presented, pairings, crate::now_epoch_secs())
    }

    /// [`Sessions::resolve`] judged at `now` (Unix seconds).
    ///
    /// Time is a parameter so the expiry is tested at an exact instant rather than
    /// by sleeping; `resolve` is the only caller in production.
    pub(crate) fn resolve_at(
        &self,
        presented: &str,
        pairings: &[PhonePairing],
        now: u64,
    ) -> Option<Actor> {
        let presented = presented.trim();
        if presented.is_empty() {
            return None;
        }
        if self.is_owner_token(presented) {
            return Some(Actor::owner(self.local_device));
        }
        pairings
            .iter()
            .filter(|pairing| pairing.is_active_at(now))
            .find(|pairing| constant_time_eq(pairing.secret.as_bytes(), presented.as_bytes()))
            .map(Actor::paired)
    }
}

/// What a method asks of the caller that reached it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Policy {
    /// Any verified session: the caller proved a credential this daemon issued.
    Session,
    /// The daemon's owner and nobody else.
    Owner,
}

/// Which ceiling a method is measured against.
///
/// The strictest tiers are the ones an attacker aims at rather than the ones a user
/// uses: credentials, pairing, and anything that spends money or starts a process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Tier {
    /// Token checks and gate decisions: the authentication path.
    Auth,
    /// Pairing a device, creating or revoking a pairing.
    Pairing,
    /// A paid model call, a provider probe, or a child process.
    Spend,
    /// Everything else on the RPC surface.
    Standard,
}

/// The policy and ceiling of one RPC method.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MethodPolicy {
    /// The method's name on the wire.
    pub method: &'static str,
    /// What it asks of its caller.
    pub policy: Policy,
    /// Which ceiling it is measured against.
    pub tier: Tier,
}

use MethodPolicy as M;
use Policy::{Owner, Session};
use Tier::{Auth, Pairing, Spend, Standard};

/// Every method the daemon serves, and what it asks for.
///
/// This is the table audit H-04 asks for, in one place, so a reviewer can read the
/// whole authorization surface at once — and so coverage can be asserted against the
/// methods the server actually registers (see `every_registered_method_has_a_policy`).
/// A method missing from this list is a method the daemon refuses rather than one it
/// forgets to check.
pub const METHOD_POLICIES: &[MethodPolicy] = &[
    // Reads. A verified session is required because the data under them is the
    // owner's projects, runs and artifacts; the unauthenticated surface is `/health`
    // on the HTTP server, which is a different listener.
    M {
        method: "health",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "projects.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "projects.create",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "projects.get",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "permissions.defaults.get",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "permissions.defaults.set",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "permissions.project.get",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "permissions.project.set",
        policy: Owner,
        tier: Standard,
    },
    // Mutates a project's repository, like `projects.create`, so it is the owner's.
    M {
        method: "projects.attach",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "runs.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "runs.get",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "runs.events",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "sessions.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "sessions.tail",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "sessions.stop",
        policy: Owner,
        tier: Standard,
    },
    // A run is a paid pipeline: it starts model work and writes files.
    M {
        method: "runs.start",
        policy: Owner,
        tier: Spend,
    },
    // The worktree path is local information, not a credential; a verified session
    // that can read the run may read where its own checkout lives.
    M {
        method: "runs.worktree",
        policy: Session,
        tier: Standard,
    },
    // Gates: audit H-03. A verified session decides, and the approver recorded is
    // that session's device — never a `device_id` in the params.
    M {
        method: "gates.approve",
        policy: Session,
        tier: Auth,
    },
    // Gate C evidence runs one owner-chosen test command in the run's worktree,
    // judged by the same command policy as RunCommand; it is a spend, not a read.
    M {
        method: "gates.evidence",
        policy: Owner,
        tier: Spend,
    },
    M {
        method: "gates.reject",
        policy: Session,
        tier: Auth,
    },
    M {
        method: "gates.changes",
        policy: Session,
        tier: Auth,
    },
    // The gates queue read (#25). Deliberately `Session`/`Standard` — the `runs.list`
    // class, not the `Auth` tier the three decisions above use: a paired phone must be
    // able to read the queue it is asked to decide, and `SimpleMode` polls this path,
    // so an approval-rate ceiling on reads would starve the inbox it feeds (the read
    // backs `Run.gate_states`, so it takes no credential-parsing role either).
    M {
        method: "gates.list",
        policy: Session,
        tier: Standard,
    },
    // Providers: a key in the OS keychain and a bill.
    M {
        method: "providers.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "providers.add",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "providers.remove",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "providers.test",
        policy: Owner,
        tier: Spend,
    },
    M {
        method: "providers.check_models",
        policy: Owner,
        tier: Spend,
    },
    M {
        method: "roles.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "roles.set",
        policy: Owner,
        tier: Standard,
    },
    // Budget: the ceiling on spend is an owner's decision.
    M {
        method: "budget.show",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "budget.set",
        policy: Owner,
        tier: Standard,
    },
    // Devices and pairings: these mint the credentials the daemon later trusts, so
    // they are the strictest ceiling after authentication itself.
    M {
        method: "devices.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "devices.pair",
        policy: Owner,
        tier: Pairing,
    },
    // The method that *mints* a pairing, as opposed to `devices.pair`, which consumes one.
    //
    // `Owner`, and the reason is the whole finding this method exists to close: its result
    // is a fresh credential the daemon will later read as a caller's identity, so a caller
    // that is only a paired device must not be able to hand out a second one — a `Session`
    // tier here would let any phone that was ever paired mint its own pairing and pair
    // further devices through the consume side. `Pairing` is the same ceiling
    // `devices.pair` and `pairing.create` are measured on, which is what keeps the
    // create-then-redeem walk inside one bounded budget rather than two.
    M {
        method: "devices.pair-start",
        policy: Owner,
        tier: Pairing,
    },
    M {
        method: "devices.revoke",
        policy: Owner,
        tier: Pairing,
    },
    // Owner, because the response carries every other device's plaintext secret;
    // a paired device that could read it could impersonate the rest. No legitimate
    // paired consumer exists (`devices.list` is the secret-free view), so this is
    // the smallest fix (PAIR research finding 1).
    M {
        method: "pairing.list",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "pairing.create",
        policy: Owner,
        tier: Pairing,
    },
    M {
        method: "pairing.revoke",
        policy: Owner,
        tier: Pairing,
    },
    // Backend kits and run modes configure what the daemon serves.
    M {
        method: "backend.get",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "backend.set",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "backend.export",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "runmode.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "runmode.set",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "preferences.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "preferences.record",
        policy: Session,
        tier: Standard,
    },
    // Handoff writes files into a working tree.
    M {
        method: "handoff.create",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "handoff.apply",
        policy: Owner,
        tier: Standard,
    },
    // Post-launch reads.
    M {
        method: "postlaunch.crashes",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "postlaunch.reviews",
        policy: Session,
        tier: Standard,
    },
    // The agent: one model call per turn is spend, and its tools touch the disk.
    M {
        method: "skills.list",
        policy: Session,
        tier: Standard,
    },
    M {
        // Retired by OD-E2: the row stays, because `authorize` running first is what
        // makes the retirement answer a migration message instead of a policy error.
        method: "agent.turn",
        policy: Owner,
        tier: Spend,
    },
    // A turn in one run's own loop and workspace: the one turn a daemon runs. Owner,
    // Spend: it is the same authority as the retired agent.turn, bound to a run.
    M {
        method: "agent.turn_run",
        policy: Owner,
        tier: Spend,
    },
    // C2: the switch into Agent mode is the switch that lets a tool edit a file and a
    // turn reach a configured provider, so it is the owner's alone and it is measured on
    // the approval path with the gate decisions. Returning to Plan is the read-only
    // direction and is still the owner's, because a mode the owner set is not a mode a
    // paired screen gets to change. `agent.state` is the read half of the same record —
    // the mode, the approval history and the todos a restart is expected to keep.
    M {
        method: "agent.approve_mode",
        policy: Owner,
        tier: Auth,
    },
    M {
        method: "agent.plan_mode",
        policy: Owner,
        tier: Auth,
    },
    M {
        method: "agent.state",
        policy: Session,
        tier: Standard,
    },
    // Audit H-05: a child process is the daemon's own authority handed to a program.
    M {
        method: "process.spawn",
        policy: Owner,
        tier: Spend,
    },
    M {
        method: "process.stop",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "process.status",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "process.list",
        policy: Session,
        tier: Standard,
    },
    // An MCP server is a process and a protocol peer.
    M {
        method: "mcp.connect",
        policy: Owner,
        tier: Spend,
    },
    M {
        method: "mcp.disconnect",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "mcp.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "mcp.send",
        policy: Owner,
        tier: Spend,
    },
    M {
        method: "mcp.call",
        policy: Owner,
        tier: Spend,
    },
    // The permission table is the daemon's own security setting, so only the owner
    // reads or writes it; a paired device must not be able to grant itself a tool.
    M {
        method: "mcp.permissions.list",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "mcp.permissions.set",
        policy: Owner,
        tier: Spend,
    },
    // A one-shot grant is a permission write with a shorter life, so it gets the
    // same gate the table gets: Owner, and Spend for the write. A paired phone
    // cannot approve its own tool.
    M {
        method: "mcp.approvals.list",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "mcp.approvals.allow_once",
        policy: Owner,
        tier: Spend,
    },
    // A preview is a dev server the daemon starts.
    M {
        method: "preview.start",
        policy: Owner,
        tier: Spend,
    },
    M {
        method: "preview.stop",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "preview.status",
        policy: Session,
        tier: Standard,
    },
    // Routines run on a schedule: starting one is an owner's act, reading one is not.
    M {
        method: "routines.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "routines.get",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "routines.run_now",
        policy: Owner,
        tier: Spend,
    },
    M {
        method: "routines.pause",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "routines.resume",
        policy: Owner,
        tier: Standard,
    },
    // The sequenced event stream. Every method here is a `Session`/`Standard` read or a
    // pipeline write measured on the ordinary ceiling: a paired phone must be able to
    // subscribe to and drive the runs it can already see and decide, and none of them
    // spends a paid model call of its own (`runs.advance` runs pipeline stages, but the
    // spend is metered inside the provider router, not here).
    M {
        method: "runs.subscribe",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "runs.advance",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "runs.cancel",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "runs.resume",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "runs.followup",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "runs.artifacts",
        policy: Session,
        tier: Standard,
    },
    // Wave 2 — the six catalogs a browser manages.
    //
    // The rule is the one audit H-04 set and every row above follows: reading what is
    // installed is a session's work (a paired phone that can see the Run screen should
    // see which harness runs it), and changing what is installed is an owner's. A
    // paired device is never an owner, so a phone cannot import a pipeline, install a
    // plugin pack, register a model or connect a service — and the one method that
    // could spend an owner's quota at a third party is put under the Spend ceiling as
    // well as under Owner, so it stops at the budget even for the owner.
    M {
        method: "harness.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "harness.get",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "harness.import",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "harness.select",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "harness.delete",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "skills.import",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "skills.toggle",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "skills.delete",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "plugins.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "plugins.install",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "plugins.toggle",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "plugins.configure",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "plugins.remove",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "models.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "models.add",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "models.remove",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "integrations.list",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "integrations.connect",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "integrations.disconnect",
        policy: Owner,
        tier: Standard,
    },
    M {
        method: "integrations.test",
        policy: Owner,
        tier: Spend,
    },
    M {
        method: "files.tree",
        policy: Session,
        tier: Standard,
    },
    M {
        method: "files.read",
        policy: Session,
        tier: Standard,
    },
];

/// The policy of a method, or `None` for one the table does not name.
pub fn policy_of(method: &str) -> Option<&'static MethodPolicy> {
    METHOD_POLICIES.iter().find(|entry| entry.method == method)
}

/// The daemon's ceilings, as configured.
///
/// Every field is the burst *and* the sustained rate over `window_secs` for one
/// authenticated caller. Defaults are set so a working desktop session never sees a
/// 429 — the local daemon is one user's own machine — while a flood from any single
/// identity stops, and the tiers aimed at credentials and spend stop first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RateLimitConfig {
    /// Authentication and gate decisions: the strictest ceiling.
    #[serde(default = "default_auth")]
    pub auth: QuotaConfig,
    /// Pairing, which mints credentials.
    #[serde(default = "default_pairing")]
    pub pairing: QuotaConfig,
    /// Paid model work and process spawns.
    #[serde(default = "default_spend")]
    pub spend: QuotaConfig,
    /// Everything else on the RPC surface.
    #[serde(default = "default_standard")]
    pub standard: QuotaConfig,
    /// Whole-request ceiling per transport, measured before a credential resolves
    /// for a caller that has none.
    #[serde(default = "default_transport")]
    pub transport: QuotaConfig,
}

/// A configured burst and sustained ceiling.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuotaConfig {
    /// Requests allowed at once.
    pub burst: u32,
    /// Requests allowed per `window_secs`.
    pub sustained: u32,
    /// The window `sustained` is measured over.
    pub window_secs: u64,
}

impl QuotaConfig {
    /// The quota this configuration names.
    pub fn quota(&self) -> Quota {
        Quota::new(self.burst, self.sustained, self.window_secs)
    }

    /// A quota of `burst` and `sustained` over a one-minute window.
    const fn per_minute(burst: u32, sustained: u32) -> Self {
        Self {
            burst,
            sustained,
            window_secs: 60,
        }
    }
}

const fn default_auth() -> QuotaConfig {
    QuotaConfig::per_minute(20, 60)
}

const fn default_pairing() -> QuotaConfig {
    QuotaConfig::per_minute(5, 6)
}

const fn default_spend() -> QuotaConfig {
    QuotaConfig::per_minute(20, 60)
}

const fn default_standard() -> QuotaConfig {
    QuotaConfig::per_minute(240, 1_200)
}

const fn default_transport() -> QuotaConfig {
    QuotaConfig::per_minute(600, 6_000)
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            auth: default_auth(),
            pairing: default_pairing(),
            spend: default_spend(),
            standard: default_standard(),
            transport: default_transport(),
        }
    }
}

/// The live limiters behind [`RateLimitConfig`].
#[derive(Debug)]
pub struct RateGovernor {
    auth: RateLimiter<String>,
    pairing: RateLimiter<String>,
    spend: RateLimiter<String>,
    standard: RateLimiter<String>,
    transport: RateLimiter<String>,
    /// The tally behind every refusal the daemon writes (re-audit LOAD-1 finding 2).
    ///
    /// A ceiling can be reached once per request, so one line per refusal is a way for a
    /// caller the limiter is *winning against* to fill the daemon's disk instead: the
    /// measured spike run wrote 1,335,523 `WARN` lines and 161 MB in thirty seconds from
    /// one loopback client. Refusals are counted here and spoken about on a cadence, with
    /// the caller named by a digest rather than by its identity.
    refusals: RefusalMeter,
}

impl RateGovernor {
    /// Limiters for a configured set of ceilings.
    pub fn new(config: &RateLimitConfig) -> Self {
        Self {
            auth: RateLimiter::new(config.auth.quota()),
            pairing: RateLimiter::new(config.pairing.quota()),
            spend: RateLimiter::new(config.spend.quota()),
            standard: RateLimiter::new(config.standard.quota()),
            transport: RateLimiter::new(config.transport.quota()),
            refusals: RefusalMeter::default(),
        }
    }

    /// The limiter for one tier.
    fn tier(&self, tier: Tier) -> &RateLimiter<String> {
        match tier {
            Tier::Auth => &self.auth,
            Tier::Pairing => &self.pairing,
            Tier::Spend => &self.spend,
            Tier::Standard => &self.standard,
        }
    }

    /// The whole-request transport ceiling, measured before a credential resolves.
    pub fn transport(&self) -> &RateLimiter<String> {
        &self.transport
    }

    /// The refusal tallies: what the daemon counts instead of writing per refusal.
    pub fn refusals(&self) -> &RefusalMeter {
        &self.refusals
    }

    /// Spend one token of `tier` for `key`.
    pub fn check(&self, tier: Tier, key: &str) -> warsha_remote::rate_limit::Decision {
        self.tier(tier).check(&key.to_string())
    }
}

impl Default for RateGovernor {
    /// Limiters for the default ceilings — what a caller gets when it is building a
    /// daemon state by hand and has no configuration to read.
    fn default() -> Self {
        Self::new(&RateLimitConfig::default())
    }
}

/// The programs the daemon will start, and the environment it will start them with
/// (audit H-05).
///
/// The list comes from the daemon's configuration; nothing on the RPC can add to it,
/// and there is no "allow anything" entry. A command is accepted when it names an
/// allowed program exactly, or its program name does, or it resolves — after both
/// sides are canonicalized — to a path inside the daemon's own data directory.
///
/// **This is defense-in-depth, not a sandbox.** The real boundary is the role:
/// `process.spawn`, `mcp.connect` and `preview.start` are [`Policy::Owner`], so a
/// caller that reaches this policy already holds the owner's credential, and an
/// owner-level caller is not confined by a list of program *names* — the default list
/// carries `node`, `cargo`, `npm` and friends, any of which executes code the caller
/// chose without ever naming a second program. Args are not inspected here. A reviewer
/// should read the list as "the daemon refuses the obvious things and records what it
/// started", which is what it is, and read [`Policy::Owner`] as the check that matters.
///
/// Shells and `-c` interpreters are deliberately absent from the default list: an
/// allow-list that admits `sh` admits whatever `sh` is told to run, which is not a
/// restriction but a rename. An owner who wants one adds it by name, and that is a
/// visible change to a configuration file rather than a property of the RPC.
///
/// Absence from the list is not the only guard: [`ProcessPolicy::check_command`]
/// refuses a [`SHELL_COMMANDS`] program **as a shell**, after the allow-list check,
/// which is the order `warsha_pipeline::CommandPolicy` uses. The refusal names the
/// shell rule instead of reading like a missing list entry, so an edit that widens
/// `allowed_commands` has to be read as "admits a shell" rather than "admits one
/// more tool" (KEEL checkpoint finding L12; the parity between the two policies is
/// pinned by `process_policy_and_pipeline_policy_refuse_and_admit_the_same_programs`).
#[derive(Debug, Clone)]
pub struct ProcessPolicy {
    allowed: Vec<String>,
    data_dir: PathBuf,
}

/// The default programs a Warsha daemon may start: the toolchains a generated project
/// builds and runs with, and nothing that takes a command line as an argument.
pub const DEFAULT_ALLOWED_COMMANDS: &[&str] = &[
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "bun",
    "node",
    "deno",
    "cargo",
    "rustc",
    "git",
    "make",
    "cmake",
    "go",
    "dotnet",
    "java",
    "javac",
    "mvn",
    "gradle",
    "php",
    "composer",
    "bundle",
    "rails",
    "vite",
    "next",
    "tsc",
    "eslint",
    "prettier",
    "sqlite3",
    "pocketbase",
    "task",
    "just",
];

/// Environment names a spawn must not be handed: each one is a route into the
/// program's execution that has nothing to do with what it was asked to build.
const DENIED_ENV_KEYS: &[&str] = &[
    "PATH",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "NODE_OPTIONS",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "PERL5OPT",
    "RUBYOPT",
    "GEM_PATH",
    "CARGO",
    "RUSTC_WRAPPER",
    "RUSTC_WORKSPACE_WRAPPER",
    "SHELL",
    "BASH_ENV",
    "ENV",
];

/// Shell metacharacters that have no business being in a program name. A spawn here
/// takes no shell, so these are not a working injection — they are a caller that
/// should not be near a process table.
const COMMAND_METACHARACTERS: &[char] = &[';', '|', '&', '`', '$', '\n', '\r', '>'];

impl ProcessPolicy {
    /// A policy from the daemon's configuration: its allow-list (or the default when
    /// it named none) and its data directory.
    pub fn from_config(allowed: &[String], data_dir: &Path) -> Self {
        let allowed = if allowed.is_empty() {
            DEFAULT_ALLOWED_COMMANDS
                .iter()
                .map(|name| (*name).to_string())
                .collect()
        } else {
            allowed
                .iter()
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
                .collect()
        };
        Self {
            allowed,
            data_dir: data_dir.to_path_buf(),
        }
    }

    /// The programs this policy admits.
    pub fn allowed(&self) -> &[String] {
        &self.allowed
    }

    /// Whether `command` may be started, and why not.
    pub fn check_command(&self, command: &str) -> Result<(), String> {
        let command = command.trim();
        if command.is_empty() {
            return Err("a process needs a command".to_string());
        }
        if command.chars().any(|c| COMMAND_METACHARACTERS.contains(&c)) {
            return Err(format!(
                "`{command}` names shell syntax rather than a program; the daemon starts a program, not a command line"
            ));
        }

        // A path inside the daemon's own data directory is the daemon's own scope:
        // the agent workspace, the binaries the daemon bundled under it, and anything
        // it built there. This exemption is the daemon's own and has no counterpart in
        // `warsha_pipeline::CommandPolicy` — a rooted path is in scope here because the
        // daemon itself put the program there, not because the pipeline policy agrees
        // — so the parity test below feeds both policies non-rooted inputs only.
        //
        // The test is made on *resolved* paths, and a `..` is refused before it is ever
        // compared (audit N-2). `std::path::Path::starts_with` walks the components as
        // written, and `Component::ParentDir` is one of them, so the unresolved form of
        // `<data_dir>/../../<program>` "starts with" the data directory while pointing
        // outside it; a symlink inside the data directory is the same hole with the
        // traversal hidden in the filesystem. Canonicalizing both sides closes both, and a
        // `..` anywhere in the command is refused rather than reasoned about — the daemon's
        // scope is a directory the caller names, not a path expression it gets to resolve.
        let path = Path::new(command);
        if path.components().any(|c| c == Component::ParentDir) {
            return Err(format!(
                "`{command}` climbs with `..`; a program inside the daemon's scope is named by a path that stays in it"
            ));
        }
        if is_rooted(path) && resolves_inside(path, &self.data_dir) {
            return Ok(());
        }

        let program = program_name(command);
        let allowed = self
            .allowed
            .iter()
            .any(|entry| entry == command || program_name(entry) == program);
        if allowed {
            return Ok(());
        }
        // The shell branch the pipeline policy has and this one did not (KEEL
        // checkpoint finding L12): a shell that is not allow-listed is refused for
        // being a shell, not for being an unexplained name. The order is
        // `CommandPolicy`'s — the allow-list is consulted first, so an owner who
        // names a shell still gets it — and `SHELL_COMMANDS` is imported from the
        // pipeline crate rather than copied, so the two policies cannot drift on
        // which programs count as shells.
        if SHELL_COMMANDS.contains(&program.as_str()) {
            return Err(format!(
                "shell `{program}` is refused: a process allow-list that admits a shell admits whatever the shell is told to run; the owner can name one in `allowed_commands` if they want it"
            ));
        }
        Err(format!(
            "`{program}` is not in the daemon's allowed commands; add it to `allowed_commands` in the daemon configuration if the owner wants it run"
        ))
    }

    /// Whether an environment variable may be handed to a child, and why not.
    pub fn check_env(&self, key: &str) -> Result<(), String> {
        let upper = key.trim().to_ascii_uppercase();
        if DENIED_ENV_KEYS.contains(&upper.as_str()) || upper.starts_with("DYLD_") {
            return Err(format!(
                "`{key}` is not an environment variable the daemon hands to a child process"
            ));
        }
        Ok(())
    }

    /// Whether a URL is a transport the daemon will record for an MCP server.
    ///
    /// `https`/`wss` are allowed anywhere; a plain `http`/`ws` only on loopback, which
    /// is where a local MCP server lives. Anything else — a file read, a unix socket
    /// path, a host an attacker chose — is refused.
    pub fn check_transport_url(&self, url: &str) -> Result<(), String> {
        let url = url.trim();
        let lowered = url.to_ascii_lowercase();
        if lowered.starts_with("https://") || lowered.starts_with("wss://") {
            return Ok(());
        }
        let rest = lowered
            .strip_prefix("http://")
            .or_else(|| lowered.strip_prefix("ws://"))
            .ok_or_else(|| format!("`{url}` is not an http, https, ws or wss endpoint"))?;
        let host = rest
            .split(['/', '?', '#'])
            .next()
            .unwrap_or_default()
            .split('@')
            .next_back()
            .unwrap_or_default();
        // An IPv6 literal is bracketed; strip the brackets before the port split,
        // otherwise the first `:` inside the address truncates it.
        let host = if let Some(rest) = host.strip_prefix('[') {
            rest.split(']').next().unwrap_or_default()
        } else {
            host.split(':').next().unwrap_or_default()
        };
        // `127.example.com` starts with "127." but is not loopback: parse the host
        // and require a real loopback address (or the literal `localhost`).
        if host == "localhost" {
            return Ok(());
        }
        if host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback())
        {
            return Ok(());
        }
        Err(format!(
            "a plain `{url}` endpoint is only allowed on loopback; use https or wss for a remote MCP server"
        ))
    }
}

/// Whether `path` is named from a root, on either platform.
///
/// `Path::is_absolute` is the wrong question here. On Windows it demands a drive or UNC
/// *prefix* as well as a root, so `\\?\C:\warsha\tool` is absolute while `\warsha\tool`
/// and `/var/lib/warsha/tool` are not — and a data directory configured in the
/// POSIX-shaped spelling (which is what a config file written on a Unix machine, a
/// forwarded path from a phone, and every unit test in this module use) would never be
/// reached by the scope exemption at all. Refusing a program the daemon really does own
/// is the wrong answer, and it is the answer `is_absolute` gave on Windows.
///
/// What the exemption actually needs is that the path is anchored, so that the directory
/// the daemon resolves is the directory the caller named rather than one that depends on
/// a working directory: `Path::has_root` is exactly that, and it is true of
/// `\warsha\tool`, `C:\warsha\tool` and `\\server\share\tool` on Windows and of
/// `/var/lib/warsha/tool` on Unix. It stays false of a relative path (`warsha\tool`) and
/// of a drive-relative one (`C:warsha\tool`), which remain outside the exemption and are
/// decided by the allow-list alone.
fn is_rooted(path: &Path) -> bool {
    path.has_root()
}

/// Whether `candidate` is still inside `dir` once both are resolved (audit N-2).
///
/// Both paths are canonicalized together, or — when either does not exist yet, which is
/// the ordinary case for a binary a run has not built and for a unit test naming a
/// directory the machine has not got — both are collapsed lexically. Resolving one side
/// and not the other would compare a `\\?\C:\`-verbatim Windows path with a plain one,
/// or a symlinked `/var` with a literal one, and answer "outside" for a program the
/// daemon does own; failing to resolve at all answers "not in scope", which sends the
/// command on to the allow-list rather than admitting it. That is the fail-closed
/// direction: this function can only *grant* the scope exemption, so the case it must
/// never get wrong is the one where it says yes.
///
/// The comparison itself is [`scope_contains`], not `Path::starts_with`, because the two
/// platform differences above (verbatim prefixes and case) have to be folded explicitly
/// and `starts_with` folds neither.
fn resolves_inside(candidate: &Path, dir: &Path) -> bool {
    // A data directory that is not itself rooted names nothing: `""` or `target` would
    // be a prefix of every path on the machine once reduced to components, and the
    // exemption would read as "the whole filesystem is the daemon's scope". The daemon's
    // own data directory is always rooted in practice, so this refuses a misconfiguration
    // rather than honouring it.
    if !is_rooted(dir) {
        return false;
    }
    let (candidate, dir) = match (std::fs::canonicalize(candidate), std::fs::canonicalize(dir)) {
        (Ok(resolved_candidate), Ok(resolved_dir)) => (resolved_candidate, resolved_dir),
        _ => {
            let (Some(candidate), Some(dir)) =
                (normalize_lexically(candidate), normalize_lexically(dir))
            else {
                return false;
            };
            (candidate, dir)
        }
    };
    scope_contains(&dir, &candidate)
}

/// Whether `dir` is `candidate` or one of `candidate`'s ancestors.
///
/// The walk is component by component, which is the whole point and is what a string
/// prefix is not: `/var/lib/warsha-evil/tool` begins with `/var/lib/warsha` as a string
/// and is not inside it as a directory. Equal-length keys match only when every
/// component matches, so the data directory is in its own scope, a path nested under it
/// is in its scope, and a sibling whose name merely starts with it is not.
fn scope_contains(dir: &Path, candidate: &Path) -> bool {
    let dir = scope_key(dir);
    let candidate = scope_key(candidate);
    dir.len() <= candidate.len() && dir.iter().zip(candidate.iter()).all(|(a, b)| a == b)
}

/// The components of `path` in the form [`scope_contains`] compares them: no `.`
/// components, and each remaining component reduced by [`component_key`].
fn scope_key(path: &Path) -> Vec<OsString> {
    path.components()
        .filter(|component| !matches!(component, Component::CurDir))
        .map(component_key)
        .collect()
}

/// A Unix component compares as itself: the byte string *is* the name, and two names
/// differing in case are two directories, so nothing is folded.
#[cfg(not(windows))]
fn component_key(component: Component<'_>) -> OsString {
    component.as_os_str().to_os_string()
}

/// A Windows component, with the differences that would otherwise answer "outside"
/// about a directory the daemon owns folded away:
///
/// - `std::fs::canonicalize` returns a *verbatim* path (`\\?\C:\Users\…`), and the
///   `\\?\` form is a different component from the plain `C:\` form a joined path is
///   built from, so the verbatim marker is dropped (`\\?\C:` → `C:`,
///   `\\?\UNC\server\share` → `\\server\share`) and both spellings of the same drive or
///   share reduce to one key.
/// - NTFS names are case-insensitive and case-preserving, so `C:\WARSHA\TOOL` is a path
///   inside `C:\warsha`; the components are compared ASCII-case-insensitively.
/// - `/` and `\` are the same separator to the Windows parser outside a verbatim path,
///   and a `Component::RootDir` only ever arrives from one of them, so the root is keyed
///   as `\` however the caller spelled it.
///
/// What is deliberately *not* folded: non-ASCII case folding, trailing dots and spaces,
/// and 8.3 short names (`PROGRA~1`). Each of those is only answerable by asking Win32,
/// and this function may only widen the comparison as far as the filesystem itself
/// asserts identity — folding wider than the OS is the one error the exemption is not
/// allowed to make. A path that stays unfolded is a refusal, which sends the command to
/// the allow-list instead of admitting it. Short forms are covered anyway for anything
/// that exists, because canonicalize returns the long name for a path the OS can open —
/// and they are never *expanded* here, so a short form of a sibling name cannot collapse
/// onto the data directory either.
///
/// One exposure this leaves, stated rather than hidden: the ASCII case fold only matters
/// for a path the filesystem could not resolve (see [`resolves_inside`], which canonicalizes
/// first), and a case-sensitive Windows volume — a Dev Drive, or a directory flipped with
/// `fsutil file setCaseSensitiveInfo` — can hold `C:\warsha` and `C:\WARSHA` as two
/// directories. On such a volume a not-yet-built path spelled in the other case is read as
/// in scope. The system volume a user profile lives on is case-insensitive, so this is not
/// the ordinary configuration; the fail-closed alternative is to fold no case at all, which
/// would refuse a wrongly-cased path to a program the daemon really does own and send it to
/// the allow-list.
#[cfg(windows)]
fn component_key(component: Component<'_>) -> OsString {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    let raw: Vec<u16> = component.as_os_str().encode_wide().collect();
    OsString::from_wide(&fold_verbatim_and_case(component, &raw))
}

/// The Windows fold [`component_key`] applies, kept separate and un-gated so that it is
/// compiled and tested on every host rather than only on the platform that calls it.
#[cfg_attr(not(windows), allow(dead_code))]
fn fold_verbatim_and_case(component: Component<'_>, raw: &[u16]) -> Vec<u16> {
    const SEP: u16 = b'\\' as u16;
    const VERBATIM: [u16; 4] = [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
    const UNC: [u16; 4] = [b'U' as u16, b'N' as u16, b'C' as u16, b'\\' as u16];

    if matches!(component, Component::RootDir) {
        return vec![SEP];
    }
    let stripped = raw.strip_prefix(&VERBATIM).unwrap_or(raw);
    let mut key = match stripped.strip_prefix(&UNC) {
        // `UNC\server\share` is the verbatim spelling of `\\server\share`.
        Some(share) => [&[SEP, SEP][..], share].concat(),
        None => stripped.to_vec(),
    };
    // ASCII only: the case-insensitive identity Windows applies to drive letters, share
    // names and the short (8.3) forms of names, none of which needs a wider table.
    let fold = (b'a' - b'A') as u16;
    for unit in &mut key {
        if (u16::from(b'A')..=u16::from(b'Z')).contains(unit) {
            *unit += fold;
        }
    }
    key
}

/// `.` removed and `..` applied to the component before it, without touching the
/// filesystem, or `None` when a `..` climbs past the root of the path.
///
/// This is the shape the prefix test needs from a path that does not exist yet. It is
/// not a general resolver: it does not follow symlinks, and it does not need to, because
/// [`resolves_inside`] canonicalizes whatever the filesystem can resolve and a `..` that
/// survives a lexical collapse has already been refused by the caller.
fn normalize_lexically(path: &Path) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    Some(out)
}

/// The program a command line names: its last path segment, without an extension,
/// lower-cased — `C:\\Program Files\\nodejs\\npm.cmd`, `./node`, and `node` are one
/// program.
fn program_name(command: &str) -> String {
    let trimmed = command.trim().trim_matches('"');
    let name = trimmed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(trimmed)
        .to_ascii_lowercase();
    name.strip_suffix(".exe")
        .or_else(|| name.strip_suffix(".cmd"))
        .or_else(|| name.strip_suffix(".bat"))
        .unwrap_or(&name)
        .to_string()
}

/// The JSON-RPC error codes this module answers with.
///
/// `-32000` is the daemon's long-standing server error and stays that. The codes
/// below are new, so a client can tell a refusal it should show to the owner from a
/// refusal it should retry, and a UI can map `-32004` to the same 429 a transport
/// would have answered with.
pub mod rpc_codes {
    /// The caller has no verified session.
    pub const UNAUTHENTICATED: i32 = -32001;
    /// The caller is verified but not allowed to do this.
    pub const FORBIDDEN: i32 = -32002;
    /// The caller named an identity that is not the one it authenticated as.
    pub const IDENTITY_MISMATCH: i32 = -32003;
    /// The caller passed a ceiling: the RPC form of HTTP 429.
    pub const RATE_LIMITED: i32 = -32004;
    /// A command or transport the daemon will not start.
    pub const POLICY_REFUSED: i32 = -32005;
}

// ================================ the session extensions and the daemon's error type

/// The `&Extensions` a `with_extensions` RPC method is handed by jsonrpsee.
///
/// A verified [`Actor`] travels in it, put there by the transport after it checked
/// the caller's credential.
pub type RpcExtensions = jsonrpsee::server::Extensions;

/// The request extensions a verified session carries, for a caller that drives the
/// RPC surface in-process rather than over the wire.
///
/// Over HTTP and WebSocket an actor is *only* ever produced by the transport, after it
/// has compared the bearer credential to the daemon's token and the live pairings;
/// nothing a client sends can put one in a request. Building the extensions by hand is
/// therefore an act of trust available to in-process code — the daemon's own tests, and
/// an embedded host that already holds the state — and to nobody else.
pub fn session_extensions(actor: Actor) -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(actor);
    ext
}

/// The extensions of the owner session for a daemon whose local device is
/// `local_device` — the same actor the transport produces when the daemon's own token
/// presents itself.
pub fn owner_session(local_device: DeviceId) -> RpcExtensions {
    session_extensions(Actor::owner(local_device))
}

/// The extensions of no session at all: what a request that never authenticated
/// carries, and what every authorized method must refuse.
pub fn anonymous_session() -> RpcExtensions {
    RpcExtensions::new()
}

#[derive(Error, Debug)]
pub enum DaemonError {
    #[error("Store error: {0}")]
    Store(#[from] warsha_store::StoreError),
    #[error("Settings error: {0}")]
    Settings(#[from] SettingsError),
    #[error("Provider error: {0}")]
    Provider(#[from] warsha_providers::ProviderError),
    #[error("Pipeline error: {0}")]
    Pipeline(#[from] warsha_pipeline::PipelineError),
    #[error("Git error: {0}")]
    Git(#[from] warsha_git::GitError),
    #[error("Remote error: {0}")]
    Remote(#[from] warsha_remote::RemoteError),
    #[error("Config error: {0}")]
    Config(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("TOML decode error: {0}")]
    TomlDecode(#[from] toml::de::Error),
    #[error("TOML encode error: {0}")]
    TomlEncode(#[from] toml::ser::Error),
    #[error("Authentication failed")]
    AuthFailed,
    #[error("Keyring error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("Lock error: {0}")]
    Lock(String),
    #[error("Other: {0}")]
    Other(String),
}

// ============================================ the RPC auth layer (P-H1 step A3)

// Moved out of `lib.rs` unchanged: the tower layer, the origin check it refuses on,
// and the two credential readers the `/events` subprotocol path needs. `lib.rs`
// still names them, so they are `pub(crate)` here and imported at the crate root.

use axum::http::header::AUTHORIZATION;
use jsonrpsee::core::BoxError;
use jsonrpsee::server::{HttpRequest, HttpResponse};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use tower::Layer;
use warsha_remote::rate_limit::rate_key;

use super::state::DaemonState;

/// Tower layer for RPC authentication and the ceiling in front of it.
///
/// Two jobs, in this order (security audit H-01, H-03, H-04):
///
/// - **Bound the transport first**, on the key the transport actually has: the
///   authenticated identity when the credential resolved, and one shared bounded
///   bucket when it did not. Measuring before the credential is judged is the point —
///   a caller spraying tokens is spending its own budget, not the daemon's CPU.
/// - **Say who is calling**, and put that in the request for the RPC methods to read.
///   A method never learns the caller's identity from its own params; that is the
///   whole of H-03 and half of H-04.
///
/// There is no per-peer-address key here: jsonrpsee's HTTP service does not put the
/// accepted socket's address in the request it hands a middleware, and inventing one
/// from a header would be trusting a value the caller writes. The address-keyed
/// ceiling is on the daemon's own HTTP listener, where axum does supply it.
#[derive(Clone)]
pub(crate) struct RpcAuthLayer {
    pub(crate) state: Arc<DaemonState>,
}

impl<S> Layer<S> for RpcAuthLayer {
    type Service = RpcAuthService<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RpcAuthService {
            inner,
            state: self.state.clone(),
        }
    }
}

/// The app's own origins: the desktop webview on Unix and on Windows, and the
/// Android shell's asset host. They are always allowed whatever a `config.toml`
/// lists, because an existing config that predates one of them must not lock its
/// own app out of the daemon.
///
/// The Android entry is the shell's real origin (`OD-UI7`, R-UI-7): `MainActivity`
/// serves the bundled page from `https://appassets.androidplatform.net/` through a
/// framework `shouldInterceptRequest` handler, so the page presents that one fixed
/// string. The alternative — admitting `null` — is what a `file:` document can only
/// present, and any web page can force a browser to send `null` (a sandboxed iframe,
/// a `data:` document), so admitting it would delete the origin check while leaving
/// it in the code. Exact match only: scheme, host and no port, at no trailing slash.
pub(crate) const APP_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://appassets.androidplatform.net",
];

/// Whether a present `Origin` is one the RPC listener accepts.
pub(crate) fn origin_allowed(configured: &[String], origin: &str) -> bool {
    APP_ORIGINS.contains(&origin) || configured.iter().any(|allowed| allowed == origin)
}

/// The origins both CORS layers admit: [`APP_ORIGINS`] first, then the configured list.
///
/// The layers used to read `config.allowed_origins` alone — exactly the list `APP_ORIGINS` exists
/// to outrank. The consequence was measured (R-UI-7 Step 2): the Android shell's page passed the
/// WebSocket origin gate (401, the credential check) and then the browser refused to *read* any
/// answer, because the preflight for its `POST /rpc` came back with no
/// `Access-Control-Allow-Origin`. One union, written here once, so a CORS layer cannot drift from
/// the gate that admits the same strings. A value that is not a valid header is dropped rather than
/// failing the daemon's start — the configured half keeps the behaviour it always had.
pub(crate) fn cors_origins(configured: &[String]) -> Vec<axum::http::HeaderValue> {
    APP_ORIGINS
        .iter()
        .copied()
        .chain(configured.iter().map(String::as_str))
        .filter_map(|origin| origin.parse::<axum::http::HeaderValue>().ok())
        .collect()
}

/// Tower service for RPC authentication.
/// Mirrors the pattern used by jsonrpsee's own `HostFilter` middleware layer.
#[derive(Clone)]
pub(crate) struct RpcAuthService<S> {
    pub(crate) inner: S,
    pub(crate) state: Arc<DaemonState>,
}

/// The bearer token in a request's `Authorization` header, or an empty string.
///
/// An empty string is not a session: [`Sessions::resolve`] refuses it, and no caller
/// that sends no header is answerable for the traffic of one that does.
pub(crate) fn bearer_token(headers: &axum::http::HeaderMap) -> String {
    headers
        .get(AUTHORIZATION)
        .and_then(|header| header.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default()
        .to_string()
}

/// The one route that also reads a credential from the WebSocket subprotocol list.
///
/// A browser — and the desktop's webview — cannot set `Authorization` on a WebSocket
/// handshake: the constructor takes a URL and a subprotocol list and nothing else.
/// `/events` is the only place that has to know this, so it is the only place that does.
pub(crate) const EVENTS_PATH: &str = "/events";

/// The subprotocol prefix a `/events` caller carries its credential in.
///
/// The client's half of this string is `TOKEN_SUBPROTOCOL_PREFIX` in
/// `packages/client/src/index.ts`; the two ends have to agree, and a live-daemon test
/// (`crates/warshad/tests/events_ws_auth.rs`) is what pins that they do.
pub(crate) const TOKEN_SUBPROTOCOL_PREFIX: &str = "warsha.token.";

/// The `/events` data-plane subprotocol, and the only one the daemon ever *selects*.
///
/// It carries no secret, which is the whole reason it exists: RFC 6455 §1.9 has the
/// server answer the handshake with one of the protocols the client offered, and the
/// only other thing the client offers is its credential. Echoing that back would put
/// the token on the response headers of every hop that reads them.
pub(crate) const EVENTS_SUBPROTOCOL: &str = "warsha.events.v1";

/// The credential in a `/events` caller's `Sec-WebSocket-Protocol` list, or an empty
/// string when the list carries none.
///
/// One entry of the list is treated exactly as the `Authorization` header is: its
/// remainder goes to [`Sessions::resolve`] and nothing else happens with it. Every
/// offered protocol is a candidate, not just the first, because a client is free to
/// offer the data-plane name before its credential. Multiple header lines are joined
/// the way the transport joins them (`get_all`), and a value that is not UTF-8 simply
/// carries no credential. An empty result is not a session —
/// [`Sessions::resolve`] refuses it — so a caller that offers `warsha.token.` with
/// nothing after the prefix is refused like a caller that offers nothing.
///
/// Nothing here reads the request URI: a token in the query string is not a credential
/// this daemon will ever accept, because a URL is logged by every proxy, browser history
/// and `Referer` between the caller and this listener.
pub(crate) fn subprotocol_token(headers: &axum::http::HeaderMap) -> String {
    headers
        .get_all(axum::http::header::SEC_WEBSOCKET_PROTOCOL)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .find_map(|offered| offered.trim().strip_prefix(TOKEN_SUBPROTOCOL_PREFIX))
        .unwrap_or_default()
        .to_string()
}

/// A refusal with a status and a body, on jsonrpsee's own response type.
pub(crate) fn rpc_refusal(
    status: axum::http::StatusCode,
    body: serde_json::Value,
    retry_after_secs: Option<u64>,
) -> HttpResponse {
    let mut response = jsonrpsee::server::http::response::ok_response(body.to_string());
    *response.status_mut() = status;
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json"),
    );
    if let Some(secs) = retry_after_secs {
        response
            .headers_mut()
            .insert(axum::http::header::RETRY_AFTER, retry_after_header(secs));
    }
    response
}

/// The `Retry-After` value a bounded caller is answered with.
///
/// A number of seconds is always a representable header value, and a refusal that
/// could not name its wait would be an invitation to retry at once — so the
/// unreachable case says `1` rather than dropping the header.
pub(crate) fn retry_after_header(secs: u64) -> axum::http::HeaderValue {
    axum::http::HeaderValue::from_str(&secs.max(1).to_string())
        .unwrap_or_else(|_| axum::http::HeaderValue::from_static("1"))
}

impl<S, B> tower::Service<HttpRequest<B>> for RpcAuthService<S>
where
    S: tower::Service<HttpRequest<B>, Response = HttpResponse> + Clone + Send + 'static,
    S::Response: 'static,
    S::Future: Send + 'static,
    S::Error: Into<BoxError> + Send + 'static,
    B: Send + 'static,
{
    type Response = S::Response;
    type Error = BoxError;
    type Future = Pin<
        Box<dyn Future<Output = std::result::Result<Self::Response, Self::Error>> + Send + 'static>,
    >;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<std::result::Result<(), Self::Error>> {
        self.inner.poll_ready(cx).map_err(Into::into)
    }

    fn call(&mut self, req: HttpRequest<B>) -> Self::Future {
        let state = self.state.clone();
        let mut inner = self.inner.clone();
        let token = bearer_token(req.headers());

        Box::pin(async move {
            // A browser sends `Origin` on cross-origin requests, including the
            // WebSocket upgrade a CORS layer cannot gate: jsonrpsee would accept the
            // handshake before CORS ever saw it. A present-but-unlisted Origin is
            // refused before the credential is read; an absent Origin (CLI, tests,
            // same-origin) is allowed exactly as before (security audit LOW: no Origin
            // check on the RPC WS).
            if let Some(origin) = req.headers().get(axum::http::header::ORIGIN) {
                let allowed = origin
                    .to_str()
                    .ok()
                    .is_some_and(|value| origin_allowed(&state.config.allowed_origins, value));
                if !allowed {
                    return Ok(rpc_refusal(
                        axum::http::StatusCode::FORBIDDEN,
                        serde_json::json!({ "error": "origin not allowed" }),
                        None,
                    ));
                }
            }

            // The pairing store is read at the moment of the call, so revoking a
            // device takes effect on its next request rather than at the next start.
            let actor = state
                .sessions
                .resolve(&token, &state.active_pairings().await);
            // No peer address is available on this transport, so an unauthenticated
            // caller falls back to one shared bounded bucket rather than to none.
            let key = rate_key(actor.as_ref().map(|actor| actor.key()), None);

            let ceiling = state.rates.transport().check(&key);
            if !ceiling.is_allowed() {
                state.report_refusal("transport", &key);
                return Ok(rpc_refusal(
                    axum::http::StatusCode::TOO_MANY_REQUESTS,
                    serde_json::json!({ "error": "rate limited" }),
                    Some(ceiling.retry_after_secs()),
                ));
            }

            let Some(actor) = actor else {
                let mut response = rpc_refusal(
                    axum::http::StatusCode::UNAUTHORIZED,
                    serde_json::json!({ "error": "unauthorized" }),
                    None,
                );
                response.headers_mut().insert(
                    axum::http::header::WWW_AUTHENTICATE,
                    axum::http::HeaderValue::from_static("Bearer"),
                );
                return Ok(response);
            };

            // The verified caller travels in the request's extensions, which is a
            // value only this service can write: nothing on the wire reaches it.
            let mut req = req;
            req.extensions_mut().insert(actor);
            inner.call(req).await.map_err(Into::into)
        })
    }
}

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;

/// Parity between the daemon's process policy and the pipeline's command policy
/// (KEEL checkpoint finding L12).
///
/// The two lists are two implementations of one rule — which programs the agent's
/// work may start — and the K4 test named
/// `agent_command_execution_obeys_daemon_allowed_commands_policy` exercises the
/// *pipeline* policy, not [`ProcessPolicy`]. Merging them is out of scope, so this
/// feeds the SAME inputs to both and asserts they agree: the daemon cannot start
/// what the agent's own tool layer would refuse, and cannot refuse what the tool
/// layer would run.
#[cfg(test)]
mod policy_parity_tests {
    use super::*;
    use warsha_pipeline::{CommandPolicy, CommandPolicyError};

    #[test]
    fn process_policy_and_pipeline_policy_refuse_and_admit_the_same_programs() {
        let dir = crate::test_util::fresh_tempdir();
        let data_dir = dir.path().join("warsha");
        std::fs::create_dir_all(&data_dir).expect("the data directory is made");
        let daemon = ProcessPolicy::from_config(&[], &data_dir);
        let pipeline = CommandPolicy::from_config(&[]);

        // Shells: refused by both, and the daemon's refusal names the shell rule —
        // that message is the observable the added shell branch exists for.
        for shell in ["sh", "bash", "cmd", "powershell", "pwsh"] {
            let refused = daemon
                .check_command(shell)
                .expect_err("the daemon admitted a shell");
            assert!(
                refused.contains("shell"),
                "the daemon refused `{shell}` as something other than a shell: {refused}"
            );
            assert!(
                matches!(
                    pipeline.check_command(shell),
                    Err(CommandPolicyError::ShellRefused { .. })
                ),
                "the pipeline admitted or mis-classified the shell `{shell}`"
            );
        }

        // An unlisted program: refused by both.
        for unlisted in ["rm", "curl", "wget", "python"] {
            assert!(
                daemon.check_command(unlisted).is_err(),
                "the daemon admitted the unlisted `{unlisted}`"
            );
            assert!(
                matches!(
                    pipeline.check_command(unlisted),
                    Err(CommandPolicyError::NotAllowed { .. })
                ),
                "the pipeline admitted the unlisted `{unlisted}`"
            );
        }

        // A listed program with shell syntax in the program token: refused by both.
        // Every character used here is in both metacharacter sets, so the pair fails
        // on the same rule rather than on one list being narrower.
        for injection in ["npm;id", "cargo|cat", "git&whoami", "`git`", "npm>out"] {
            assert!(
                daemon.check_command(injection).is_err(),
                "the daemon admitted the program token `{injection}`"
            );
            assert!(
                matches!(
                    pipeline.check_command(injection),
                    Err(CommandPolicyError::ShellSyntax { .. })
                ),
                "the pipeline admitted the program token `{injection}`"
            );
        }

        // The allow-listed program both admit — bare, dotted and path-spelled (the
        // basename rule of R-KEEL row 10 lives on both sides).
        for admitted in ["npm", "./npm", "/tmp/whatever/npm"] {
            assert!(
                daemon.check_command(admitted).is_ok(),
                "the daemon refused the allowed `{admitted}`"
            );
            assert!(
                pipeline.check_command(admitted).is_ok(),
                "the pipeline refused the allowed `{admitted}`"
            );
        }

        // And the ordering both share: an owner who names a shell gets it, because
        // the allow-list is consulted before the shell branch.
        let owner_daemon = ProcessPolicy::from_config(&["sh".to_string()], &data_dir);
        let owner_pipeline = CommandPolicy::from_config(&["sh".to_string()]);
        assert!(owner_daemon.check_command("sh").is_ok());
        assert!(owner_pipeline.check_command("sh").is_ok());
    }
}
