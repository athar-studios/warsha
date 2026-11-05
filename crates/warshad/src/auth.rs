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
use warsha_core::DeviceId;
use warsha_pipeline::PhonePairing;
use warsha_remote::constant_time_eq;
use warsha_remote::rate_limit::{Quota, RateLimiter, RefusalMeter};

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
    role: ActorRole,
}

impl Actor {
    /// The daemon's owner: the local desktop, holding the daemon's own token.
    pub fn owner(local_device: DeviceId) -> Self {
        Self {
            device_id: Some(local_device),
            label: "owner".to_string(),
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
    /// empty token, an unknown token and a revoked device all answer `None`: the
    /// daemon does not explain which one a caller guessed.
    pub fn resolve(&self, presented: &str, pairings: &[PhonePairing]) -> Option<Actor> {
        let presented = presented.trim();
        if presented.is_empty() {
            return None;
        }
        if self.is_owner_token(presented) {
            return Some(Actor::owner(self.local_device));
        }
        pairings
            .iter()
            .filter(|pairing| pairing.is_active())
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
    // A run is a paid pipeline: it starts model work and writes files.
    M {
        method: "runs.start",
        policy: Owner,
        tier: Spend,
    },
    // Gates: audit H-03. A verified session decides, and the approver recorded is
    // that session's device — never a `device_id` in the params.
    M {
        method: "gates.approve",
        policy: Session,
        tier: Auth,
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
        policy: Session,
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
    M {
        method: "pairing.list",
        policy: Session,
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
        method: "agent.turn",
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
        // the agent workspace and anything it built there.
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
        let host = host.split(':').next().unwrap_or_default();
        if host == "localhost" || host.starts_with("127.") || host.starts_with("[::1") {
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    /// A pairing the daemon holds.
    fn pairing(device_id: &str, secret: &str) -> PhonePairing {
        PhonePairing::new(device_id, secret, 1_700_000_000)
    }

    /// A device id string a paired phone can be named by.
    fn uuid() -> String {
        DeviceId::new().to_string()
    }

    fn sessions() -> Sessions {
        Sessions::new("owner-token", DeviceId::new())
    }

    #[test]
    fn the_owner_token_authenticates_the_owner_and_nothing_else_does() {
        let sessions = sessions();
        let local = sessions.local_device();

        let owner = sessions
            .resolve("owner-token", &[])
            .expect("the daemon's own token is the owner");
        assert_eq!(owner.role(), ActorRole::Owner);
        assert_eq!(owner.device_id(), Some(local));

        assert!(sessions.resolve("wrong", &[]).is_none());
        assert!(sessions.resolve("", &[]).is_none());
        assert!(sessions.resolve("   ", &[]).is_none());
        // A near miss is refused, and refused the same way as a stranger.
        assert!(sessions.resolve("owner-toke", &[]).is_none());
    }

    #[test]
    fn a_pairing_secret_authenticates_its_device_and_a_revoked_one_does_not() {
        let phone = uuid();
        let sessions = sessions();
        let pairings = vec![pairing(&phone, "s3cr3t")];

        let actor = sessions
            .resolve("s3cr3t", &pairings)
            .expect("the pairing's secret authenticates");
        assert_eq!(actor.role(), ActorRole::Paired);
        assert_eq!(
            actor.device_id().map(|id| id.to_string()),
            Some(phone.clone()),
            "the device id bound the actor is the pairing's, not a caller's"
        );

        let mut revoked = pairing(&phone, "s3cr3t");
        revoked.revoked = true;
        assert!(
            sessions.resolve("s3cr3t", &[revoked]).is_none(),
            "a revoked pairing still opened a session"
        );
        assert!(sessions.resolve("nope", &pairings).is_none());
    }

    #[test]
    fn the_owner_credential_wins_over_a_pairing_holding_the_same_secret() {
        // A pairing created with the daemon's own token must not downgrade the owner
        // to a phone: the owner check comes first and is the higher authority.
        let sessions = Sessions::new("shared", DeviceId::new());
        let pairings = vec![pairing(&uuid(), "shared")];
        let actor = sessions.resolve("shared", &pairings).expect("a session");
        assert_eq!(actor.role(), ActorRole::Owner);
    }

    #[test]
    fn a_paired_device_with_a_non_device_id_has_no_approver_to_record() {
        let actor = Actor::paired(&pairing("not-a-uuid", "secret"));
        assert_eq!(actor.role(), ActorRole::Paired);
        assert_eq!(
            actor.device_id(),
            None,
            "a pairing id that is not a device id was treated as one"
        );
    }

    #[test]
    fn a_role_covers_only_what_it_carries() {
        assert!(ActorRole::Owner.covers(ActorRole::Owner));
        assert!(ActorRole::Owner.covers(ActorRole::Paired));
        assert!(ActorRole::Paired.covers(ActorRole::Paired));
        assert!(
            !ActorRole::Paired.covers(ActorRole::Owner),
            "a paired device could claim the owner's authority"
        );
    }

    #[test]
    fn every_privileged_mutation_names_the_owner_and_a_session_does_not_reach_it() {
        // The audit's H-04 list, read straight off the table.
        for method in [
            "providers.add",
            "providers.remove",
            "budget.set",
            "devices.pair-start",
            "devices.revoke",
            "pairing.create",
            "pairing.revoke",
            "runmode.set",
            "backend.set",
            "roles.set",
            "process.spawn",
            "mcp.connect",
            "mcp.call",
            "preview.start",
            "routines.run_now",
            "handoff.apply",
        ] {
            let entry = policy_of(method).unwrap_or_else(|| panic!("{method} has no policy"));
            assert_eq!(entry.policy, Owner, "{method} is not owner-gated");
        }

        // A gate decision needs a verified session and is measured in the strictest
        // tier after pairing: it is how a phone acts, and it records who acted.
        for method in ["gates.approve", "gates.reject", "gates.changes"] {
            let entry = policy_of(method).expect("a gate policy");
            assert_eq!(entry.policy, Session);
            assert_eq!(entry.tier, Auth);
        }

        // The gates queue read (#25) goes both ways on the same table: a paired
        // device and the owner may both read the queue a phone is asked to decide
        // (`Session` is the role that covers both), and an unauthenticated caller
        // reaches nothing because `authorize` refuses before any role is compared
        // (asserted as behaviour in the daemon's tests). It is deliberately not on
        // the `Auth` tier the three decisions above spend — `SimpleMode` polls this
        // path, and a credential-path ceiling would starve the inbox it feeds.
        let queue = policy_of("gates.list").expect("the gates queue read has a policy");
        assert_eq!(queue.policy, Session);
        assert_eq!(queue.tier, Standard);
        assert_ne!(
            queue.tier,
            policy_of("gates.approve").expect("a gate policy").tier,
            "the queue read was pulled onto the decision path's ceiling"
        );

        // Pairing and spend are the strictest ceilings, as the audit requires.
        assert_eq!(policy_of("pairing.create").expect("policy").tier, Pairing);
        assert_eq!(policy_of("devices.pair").expect("policy").tier, Pairing);
        assert_eq!(policy_of("devices.pair").expect("policy").policy, Session);
        // The minting half of the pairing path is measured on the same ceiling as the
        // redeeming half — and the brief's own hazard, a paired phone creating its own
        // credential, is what the `Owner` policy above (asserted in the list walk) refuses.
        assert_eq!(
            policy_of("devices.pair-start")
                .expect("the pairing minter has a policy")
                .tier,
            Pairing
        );
        assert_eq!(policy_of("agent.turn").expect("policy").tier, Spend);
        assert_eq!(policy_of("runs.start").expect("policy").tier, Spend);
        assert_eq!(policy_of("process.spawn").expect("policy").tier, Spend);
        assert!(
            policy_of("nowhere").is_none(),
            "an unknown method was policy'd"
        );
    }

    #[test]
    fn the_strictest_ceilings_are_on_credentials_and_spend() {
        let config = RateLimitConfig::default();
        let auth = config.auth.quota();
        let pairing = config.pairing.quota();
        let spend = config.spend.quota();
        let standard = config.standard.quota();

        // Per authenticated caller, the strictest limits sit on pairing, then spend
        // and authentication, and only then on ordinary traffic.
        assert!(
            pairing.sustained < auth.sustained,
            "pairing is not the strictest"
        );
        assert!(
            auth.sustained < standard.sustained,
            "auth is looser than standard"
        );
        assert!(
            spend.sustained < standard.sustained,
            "spend is looser than standard"
        );
        assert!(pairing.burst < standard.burst);
        assert!(auth.burst < standard.burst);
    }

    #[test]
    fn a_caller_past_a_ceiling_is_measured_per_identity_and_per_tier() {
        let config = RateLimitConfig {
            pairing: QuotaConfig::per_minute(2, 2),
            ..RateLimitConfig::default()
        };
        let governor = RateGovernor::new(&config);
        let phone = uuid();

        assert!(governor.check(Tier::Pairing, &phone).is_allowed());
        assert!(governor.check(Tier::Pairing, &phone).is_allowed());
        let refused = governor.check(Tier::Pairing, &phone);
        assert!(
            !refused.is_allowed(),
            "a device past its pairing ceiling was served"
        );
        assert!(refused.retry_after_secs() >= 1);

        // Another device is not refused for this one's attempts, and the same device
        // is not refused in another tier for this tier's traffic.
        assert!(governor.check(Tier::Pairing, &uuid()).is_allowed());
        assert!(governor.check(Tier::Standard, &phone).is_allowed());
    }

    #[test]
    fn the_transport_ceiling_is_the_widest_and_is_measured_before_a_credential() {
        let config = RateLimitConfig::default();
        let governor = RateGovernor::new(&config);
        assert!(config.transport.sustained > config.standard.sustained);
        assert!(governor
            .transport()
            .check(&"anonymous".to_string())
            .is_allowed());
    }

    #[test]
    fn a_command_is_allowed_only_by_the_policy_and_no_shell_syntax_passes() {
        let policy = ProcessPolicy::from_config(&[], Path::new("/var/lib/warsha"));

        // The default list admits build tools and refuses the shells that would make
        // the list a formality.
        assert!(policy.check_command("npm").is_ok());
        assert!(policy.check_command("./npm").is_ok());
        assert!(
            policy.check_command("NPM.CMD").is_ok(),
            "a case-insensitive program name was not matched"
        );
        assert!(
            policy.check_command("sh").is_err(),
            "a shell was admitted by default"
        );
        assert!(
            policy.check_command("cmd").is_err(),
            "a shell was admitted by default"
        );
        assert!(policy.check_command("bash").is_err());
        assert!(policy.check_command("rm").is_err());
        assert!(policy.check_command("").is_err());
        assert!(policy.check_command("   ").is_err());

        // Shell syntax in a program name is refused whatever the list says.
        let with_shell =
            ProcessPolicy::from_config(&["sh".to_string()], Path::new("/var/lib/warsha"));
        assert!(
            with_shell.check_command("sh").is_ok(),
            "an owner-added command was not honoured"
        );
        assert!(
            with_shell.check_command("sh; rm -rf /").is_err(),
            "shell syntax passed as a program"
        );
        assert!(with_shell.check_command("sh|whoami").is_err());
        assert!(with_shell.check_command("`sh`").is_err());

        // Nothing on the wire can widen the list: only the configuration names it.
        let narrow =
            ProcessPolicy::from_config(&["cargo".to_string()], Path::new("/var/lib/warsha"));
        assert!(narrow.check_command("cargo").is_ok());
        assert!(
            narrow.check_command("npm").is_err(),
            "the default list leaked into a configured one"
        );
    }

    #[test]
    fn a_path_inside_the_daemon_s_own_data_dir_is_in_scope() {
        let policy = ProcessPolicy::from_config(&["npm".to_string()], Path::new("/var/lib/warsha"));

        assert!(policy
            .check_command("/var/lib/warsha/workspace/tools/migrate")
            .is_ok());
        assert!(
            policy.check_command("/usr/local/bin/migrate").is_err(),
            "an arbitrary absolute path was read as project scope"
        );
        assert!(policy.check_command("../../../usr/bin/migrate").is_err());
    }

    /// Audit N-2: the scope test is made on resolved paths, so neither a `..` nor a
    /// symlink inside the data directory can hand a program outside it the exemption.
    ///
    /// Everything here runs against a real, existing directory tree: the finding's case
    /// is the one where the *written* path still starts with the data directory, and an
    /// `expect` that only passes because the filesystem was never consulted would not
    /// have caught it.
    #[test]
    fn an_absolute_path_that_climbs_out_of_the_data_dir_is_not_in_scope() {
        let dir = crate::test_util::fresh_tempdir();
        let data_dir = dir.path().join("warsha");
        std::fs::create_dir_all(data_dir.join("workspace")).expect("the data directory is made");
        let inside = data_dir.join("workspace").join("migrate");
        std::fs::write(&inside, b"tool").expect("the tool is written");

        let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);

        // The exemption the finding does not change: a program the daemon built in its
        // own workspace, named by an absolute path, is still in scope.
        assert!(policy.check_command(&inside.to_string_lossy()).is_ok());

        // The regression itself, spelled exactly as the re-audit spells it:
        // `<data_dir>/../../program` starts with `<data_dir>` component for component
        // and lands two directories up.
        let escaped = format!("{}/../../program", data_dir.display());
        let error = policy
            .check_command(&escaped)
            .expect_err("a traversal path was read as project scope");
        assert!(
            error.contains("`..`"),
            "the traversal was refused for some other reason: {error}"
        );

        // One level is enough to leave, and it is refused for the same reason rather
        // than by luck: `<data_dir>/../<sibling>/tool` is not the daemon's.
        let sibling = format!("{}/../sibling/tool", data_dir.display());
        assert!(policy.check_command(&sibling).is_err());

        // A `..` that stays inside after collapsing is still a traversal, and is
        // refused rather than reasoned about: the daemon's scope is a directory the
        // caller names, not a path expression it gets to resolve.
        let round_trip = format!("{}/workspace/../workspace/migrate", data_dir.display());
        assert!(policy.check_command(&round_trip).is_err());

        // Relative forms climb too, and are refused on the same rule rather than by the
        // accident of a program name: `../npm` is a path out of the workspace, and the
        // list admitting `npm` is not a licence to reach it from anywhere.
        assert!(policy.check_command("../npm").is_err());
        assert!(policy
            .check_command("node_modules/.bin/../evilmock")
            .is_err());

        // An absolute path to a program the *list* admits is admitted by the list, not
        // by the scope test — which is the difference between the two checks, and the
        // reason a caller outside the data directory still cannot name an unlisted
        // program.
        let elsewhere = data_dir.parent().expect("the parent exists").join("npm");
        assert!(
            policy.check_command(&elsewhere.to_string_lossy()).is_ok(),
            "an allowed program named by an absolute path outside the data directory was refused by the list"
        );
        let elsewhere_unlisted = data_dir
            .parent()
            .expect("the parent exists")
            .join("migrate");
        assert!(policy
            .check_command(&elsewhere_unlisted.to_string_lossy())
            .is_err());
    }

    /// A symlink placed inside the data directory is what its target is, not what its
    /// name says — so the target's location decides, and a target outside is out of
    /// scope (audit N-2, the same hole reached without writing `..`).
    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_the_data_dir_reaches_only_what_is_inside_it() {
        use std::os::unix::fs::symlink;

        let dir = crate::test_util::fresh_tempdir();
        let data_dir = dir.path().join("warsha");
        let outside = dir.path().join("elsewhere");
        std::fs::create_dir_all(&data_dir).expect("the data directory is made");
        std::fs::create_dir_all(&outside).expect("the other directory is made");

        let outside_tool = outside.join("evil");
        std::fs::write(&outside_tool, b"tool").expect("the outside tool is written");
        symlink(&outside_tool, data_dir.join("link")).expect("the symlink is made");

        let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);
        let through_link = data_dir.join("link");
        let error = policy
            .check_command(&through_link.to_string_lossy())
            .expect_err("a symlink out of the data directory was read as project scope");
        assert!(
            error.contains("link"),
            "the refusal did not name the program: {error}"
        );

        // And the honest case still works: a link to something the daemon really does
        // own inside its data directory is in scope.
        let inside_tool = data_dir.join("migrate");
        std::fs::write(&inside_tool, b"tool").expect("the inside tool is written");
        let inside_link = data_dir.join("good-link");
        symlink(&inside_tool, &inside_link).expect("the inside symlink is made");
        assert!(policy.check_command(&inside_link.to_string_lossy()).is_ok());
    }

    /// The scope test is a comparison of directories, not of strings: a sibling whose
    /// name happens to begin with the data directory's name is a different directory.
    ///
    /// Pinned at the key level because this is the rule a future refactor to
    /// `str::starts_with` would break silently on every platform at once, and the
    /// version of it that was measured on Windows (CI run 41752421903) was the *other*
    /// failure: a path spelled without a drive prefix never reached the comparison at
    /// all.
    #[test]
    fn the_scope_test_compares_components_and_never_a_string_prefix() {
        let data_dir = Path::new("/var/lib/warsha");

        // In scope: the directory itself, anything under it at any depth, and the
        // spellings of those that differ only in separators the parser collapses.
        for candidate in [
            "/var/lib/warsha",
            "/var/lib/warsha/",
            "/var/lib/warsha/workspace/tools/migrate",
            "/var/lib/warsha//workspace//migrate",
            "/var/lib/warsha/./workspace/migrate",
        ] {
            assert!(
                scope_contains(data_dir, Path::new(candidate)),
                "`{candidate}` is inside the data directory"
            );
        }

        // Out of scope: a sibling that shares the name's prefix, a shorter path, a
        // different root, and a component that merely begins with the same letters.
        for candidate in [
            "/var/lib/warsha-evil/tool",
            "/var/lib/warsh/tool",
            "/var/lib",
            "/usr/local/bin/migrate",
            "warsha/workspace/migrate",
        ] {
            assert!(
                !scope_contains(data_dir, Path::new(candidate)),
                "`{candidate}` was read as inside the data directory"
            );
        }
    }

    /// A program the daemon built in its own workspace is in scope whether or not the
    /// file exists yet, and a sibling directory of the data directory never is — the
    /// same rules as above, run against a real tree so the resolved branch of
    /// [`resolves_inside`] is the one under test.
    #[test]
    fn a_sibling_of_the_data_dir_is_out_of_scope_in_a_real_tree() {
        let dir = crate::test_util::fresh_tempdir();
        let data_dir = dir.path().join("warsha");
        std::fs::create_dir_all(data_dir.join("workspace")).expect("the workspace is made");

        let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);
        let spelled = |path: &str| format!("{}/{}", data_dir.display(), path);

        // The data directory itself, and a nested path that does not exist yet: a run
        // that has not built its tool still owns the place it would build it in.
        assert!(policy.check_command(&data_dir.to_string_lossy()).is_ok());
        assert!(policy
            .check_command(&spelled("workspace/tools/build-not-built-yet"))
            .is_ok());
        assert!(
            policy
                .check_command(&format!("{}/", data_dir.display()))
                .is_ok(),
            "a trailing separator moved the boundary"
        );

        // The sibling a string prefix admits: `<data_dir>-evil/tool`.
        let sibling = format!("{}-evil/tool", data_dir.display());
        let error = policy
            .check_command(&sibling)
            .expect_err("a sibling of the data directory was read as project scope");
        assert!(
            error.contains("tool"),
            "the refusal did not name the program: {error}"
        );

        // And a `..` traversal, refused before the comparison rather than resolved by it.
        let escaped = format!("{}/../sibling/tool", data_dir.display());
        assert!(policy.check_command(&escaped).is_err());
    }

    /// A data directory that names no root grants no scope at all.
    ///
    /// Reduced to components, `""` is a prefix of every path on the machine, and a
    /// relative one is a prefix of whatever the current directory happens to be: reading
    /// either as the daemon's scope would make the whole filesystem in scope. The
    /// daemon's own data directory is always rooted, so this is a misconfiguration, and
    /// a misconfiguration is refused rather than honoured.
    #[test]
    fn an_unrooted_data_dir_grants_no_scope() {
        for data_dir in ["", "warsha", "target/debug", "."] {
            let policy = ProcessPolicy::from_config(&["npm".to_string()], Path::new(data_dir));
            assert!(
                policy.check_command("/usr/local/bin/migrate").is_err(),
                "a data directory spelled `{data_dir}` let an absolute path outside it into scope"
            );
            assert!(
                policy.check_command("npm").is_ok(),
                "the allow-list stopped working for a data directory spelled `{data_dir}`"
            );
        }
    }

    /// The two Windows spellings that would otherwise answer "outside" about a directory
    /// the daemon does own are folded onto one key: the `\\?\` verbatim marker
    /// `std::fs::canonicalize` returns, and ASCII case.
    ///
    /// Run on every host, from UTF-16 units, so the arithmetic that only Windows calls
    /// is still measured here rather than trusted.
    #[test]
    fn the_windows_spelling_of_a_component_reduces_to_the_plain_form() {
        fn a_component(text: &str) -> Component<'_> {
            Component::Normal(std::ffi::OsStr::new(text))
        }
        fn fold(component: Component<'_>, text: &str) -> String {
            let wide: Vec<u16> = text.encode_utf16().collect();
            String::from_utf16(&fold_verbatim_and_case(component, &wide))
                .expect("the fold keeps valid UTF-16")
        }

        // The text a prefix component carries, in each of the two forms the same drive
        // or share is spelled in.
        assert_eq!(fold(a_component(r"\\?\C:"), r"\\?\C:"), "c:");
        assert_eq!(fold(a_component("C:"), "C:"), "c:");
        assert_eq!(
            fold(
                a_component(r"\\?\UNC\SERVER\share"),
                r"\\?\UNC\SERVER\share"
            ),
            r"\\server\share"
        );
        assert_eq!(
            fold(a_component(r"\\SERVER\share"), r"\\SERVER\share"),
            r"\\server\share"
        );

        // Only ASCII case, and only the verbatim marker: nothing else is invented,
        // because a comparison wider than the filesystem is the error this cannot make.
        assert_eq!(fold(a_component("PROGRA~1"), "PROGRA~1"), "progra~1");
        assert_eq!(fold(a_component("DATA-evil"), "DATA-evil"), "data-evil");
        assert_eq!(fold(a_component("warsha."), "warsha."), "warsha.");
        assert_ne!(
            fold(a_component("ÄÖÜ"), "ÄÖÜ"),
            fold(a_component("äöü"), "äöü"),
            "non-ASCII case was folded"
        );

        // The root is one key whichever separator typed it, and a name that merely
        // begins with a separator is still a name and not a root.
        assert_eq!(fold(Component::RootDir, r"\"), r"\");
        assert_eq!(fold(Component::RootDir, "/"), r"\");
        assert_ne!(
            fold(a_component(r"\warsha"), r"\warsha"),
            fold(a_component("warsha"), "warsha")
        );
    }

    /// Off Windows, the case of a component is part of the directory's name, and a `\`
    /// is an ordinary character rather than a separator. Case only decides anything at
    /// the boundary and above it: what a path descends *into* below the data directory
    /// is the daemon's scope whatever it is spelled like, because the boundary component
    /// is still the data directory.
    #[cfg(not(windows))]
    #[test]
    fn case_is_part_of_a_directory_name_off_windows() {
        let dir = crate::test_util::fresh_tempdir();
        let data_dir = dir.path().join("warsha");
        std::fs::create_dir_all(data_dir.join("workspace")).expect("the workspace is made");
        let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);

        assert!(policy
            .check_command(&format!("{}/workspace/migrate", data_dir.display()))
            .is_ok());
        assert!(
            policy
                .check_command(&format!("{}/WORKSPACE/MIGRATE", data_dir.display()))
                .is_ok(),
            "a name below the boundary was treated as a different directory"
        );

        // The boundary component itself, spelled another way, is another directory: the
        // sibling `/tmp/x/WARSHA/workspace/migrate` is not `/tmp/x/warsha`.
        assert!(policy
            .check_command(&format!(
                "{}/WARSHA/workspace/migrate",
                dir.path().display()
            ))
            .is_err());
        // A `\` is an ordinary character in a Unix name, never a separator.
        assert!(policy
            .check_command(&format!(r"{}\workspace", data_dir.display()))
            .is_err());
    }

    /// On Windows, the boundary component is read case-insensitively, and both
    /// separators mean the same thing: the same directory is one directory however the
    /// caller spells it, and a sibling is still a sibling in every spelling.
    #[cfg(windows)]
    #[test]
    fn case_is_not_part_of_a_directory_name_on_windows() {
        let dir = crate::test_util::fresh_tempdir();
        let data_dir = dir.path().join("warsha");
        std::fs::create_dir_all(data_dir.join("workspace")).expect("the workspace is made");
        let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);
        let parent = dir.path().display().to_string();

        assert!(
            policy
                .check_command(&format!(r"{}\WARSHA\workspace\migrate", parent))
                .is_ok(),
            "the same directory, shouted, was read as another one"
        );
        assert!(
            policy
                .check_command(&format!(
                    r"{}/warsha/tools/not-built-yet",
                    parent.replace('\\', "/")
                ))
                .is_ok(),
            "a `/`-rooted spelling of an unbuilt tool was read as another directory"
        );
        // A sibling that differs by more than case stays outside.
        assert!(policy
            .check_command(&format!(r"{}\WARSHA-EVIL\workspace\migrate", parent))
            .is_err());
    }

    /// On Windows, the scope test is reached by the spellings `is_absolute` used to
    /// refuse: a rooted path with no drive prefix, in either separator, in either case,
    /// and in the verbatim form a resolved path arrives in.
    #[cfg(windows)]
    #[test]
    fn a_rooted_path_without_a_drive_prefix_is_in_scope_on_windows() {
        // The exact shape CI run 41752421903 measured: a POSIX-spelled data directory
        // and a program under it. `Path::is_absolute` calls it relative — no drive
        // prefix — and the exemption used to stop there.
        let policy = ProcessPolicy::from_config(&["npm".to_string()], Path::new("/var/lib/warsha"));
        assert!(
            policy
                .check_command("/var/lib/warsha/workspace/tools/migrate")
                .is_ok(),
            "a rooted path with no drive prefix was refused the scope exemption"
        );
        assert!(policy.check_command("/var/lib/warsha-evil/tool").is_err());

        let backslash =
            ProcessPolicy::from_config(&["npm".to_string()], Path::new(r"\warsha-scope-boundary"));
        assert!(backslash
            .check_command(r"\warsha-scope-boundary\workspace\migrate")
            .is_ok());
        assert!(backslash
            .check_command(r"\warsha-scope-boundary-evil\migrate")
            .is_err());

        // A drive-relative path (`C:foo`) is rooted nowhere: it names a directory under
        // the current directory on drive C, so it is not the daemon's scope and only the
        // allow-list decides it.
        assert!(backslash
            .check_command(r"C:warsha-scope-boundary\migrate")
            .is_err());
        // A relative path is refused the exemption for the same reason.
        assert!(backslash
            .check_command(r"warsha-scope-boundary\migrate")
            .is_err());
    }

    /// On Windows, the boundary is the same directory under every spelling the OS
    /// accepts for it — and still refuses the sibling under all of them.
    #[cfg(windows)]
    #[test]
    fn a_verbatim_or_mixed_case_form_of_the_data_dir_is_in_scope_on_windows() {
        let dir = crate::test_util::fresh_tempdir();
        let data_dir = dir.path().join("warsha");
        std::fs::create_dir_all(data_dir.join("workspace")).expect("the workspace is made");
        let inside = data_dir.join("workspace").join("migrate");
        std::fs::write(&inside, b"tool").expect("the tool is written");
        let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);
        let plain = inside.to_string_lossy().into_owned();

        for (shape, candidate) in [
            // What std::fs::canonicalize hands back for this very file.
            ("verbatim", format!(r"\\?\{plain}")),
            // NTFS names are case-insensitive: the same directory, shouted.
            ("shouted", plain.to_uppercase()),
            // `/` is a separator for the Windows parser too.
            ("forward", plain.replace('\\', "/")),
            // Both at once, the way a path copied out of a build log looks.
            ("mixed", plain.replace('\\', "/").to_uppercase()),
            // The same tool named by a directory that does not exist yet: the branch
            // that never reaches the filesystem, so it never gets a resolved case or a
            // resolved prefix to lean on either.
            (
                "unbuilt",
                format!(r"{}\TOOLS\NOT-BUILT-YET", data_dir.display()).to_uppercase(),
            ),
        ] {
            assert!(
                policy.check_command(&candidate).is_ok(),
                "a {shape} spelling of a program inside the data directory was refused: {candidate}"
            );
        }

        for (shape, candidate) in [
            (
                "verbatim sibling",
                format!(r"\\?\{}-evil\tool", data_dir.display()),
            ),
            (
                "shouted sibling",
                format!(r"{}-EVIL\tool", data_dir.display()),
            ),
            (
                "forward sibling",
                format!(
                    r"{}/tool",
                    format!(r"{}-evil", data_dir.display()).replace('\\', "/")
                ),
            ),
            // A sibling that shares only the beginning of a component's letters.
            (
                "shorter-name sibling",
                format!(r"{}sh/tool", data_dir.display()),
            ),
        ] {
            assert!(
                policy.check_command(&candidate).is_err(),
                "a {shape} of a path outside the data directory was read as in scope: {candidate}"
            );
        }
    }

    #[test]
    fn an_environment_variable_that_hijacks_execution_is_refused() {
        let policy = ProcessPolicy::from_config(&[], Path::new("/var/lib/warsha"));

        for key in [
            "PATH",
            "LD_PRELOAD",
            "DYLD_INSERT_LIBRARIES",
            "NODE_OPTIONS",
            "RUSTC_WRAPPER",
            "path",
        ] {
            assert!(
                policy.check_env(key).is_err(),
                "`{key}` was handed to a child process"
            );
        }
        for key in ["PORT", "NODE_ENV", "WARSHA_PROJECT", "RUST_LOG"] {
            assert!(policy.check_env(key).is_ok(), "`{key}` was refused");
        }
    }

    #[test]
    fn a_transport_is_restricted_to_tls_or_loopback() {
        let policy = ProcessPolicy::from_config(&[], Path::new("/var/lib/warsha"));

        assert!(policy
            .check_transport_url("https://mcp.example/mcp")
            .is_ok());
        assert!(policy.check_transport_url("wss://mcp.example/mcp").is_ok());
        assert!(policy
            .check_transport_url("http://127.0.0.1:9000/mcp")
            .is_ok());
        assert!(policy
            .check_transport_url("http://localhost:9000/mcp")
            .is_ok());
        assert!(policy
            .check_transport_url("ws://localhost:9000/mcp")
            .is_ok());

        assert!(policy
            .check_transport_url("http://169.254.169.254/latest")
            .is_err());
        assert!(policy
            .check_transport_url("http://evil.example/mcp")
            .is_err());
        assert!(policy.check_transport_url("file:///etc/passwd").is_err());
        assert!(policy.check_transport_url("/etc/passwd").is_err());
        // The host that is dialled is what comes after the last `@`, so a URL that
        // puts a loopback address in its credentials is not a loopback endpoint.
        assert!(policy
            .check_transport_url("http://127.0.0.1@evil.example/mcp")
            .is_err());
        assert!(policy
            .check_transport_url("http://user@127.0.0.1:9/mcp")
            .is_ok());
    }

    #[test]
    fn a_program_name_is_the_last_segment_without_an_extension() {
        assert_eq!(program_name("npm"), "npm");
        assert_eq!(program_name("./npm"), "npm");
        assert_eq!(program_name("/usr/local/bin/vite"), "vite");
        assert_eq!(program_name("C:\\Program Files\\nodejs\\npm.cmd"), "npm");
        assert_eq!(program_name("node.EXE"), "node");
        assert_eq!(program_name("  git  "), "git");
    }

    #[test]
    fn an_expired_pairing_is_not_a_session() {
        // The store's own liveness rule is what the session check uses, so a phone the
        // owner revoked stops being an approver on its next request.
        let phone = uuid();
        let mut revoked = pairing(&phone, "secret");
        revoked.revoked = true;
        assert!(!revoked.is_active());
        assert_eq!(revoked.device_id, phone);
        let active = pairing(&phone, "secret");
        assert!(active.is_active());
        assert!(active.created_at <= Utc::now().timestamp() as u64);
    }

    #[test]
    fn the_rpc_refusal_codes_are_distinct_from_the_servers_generic_error() {
        use rpc_codes::*;
        let codes = [
            UNAUTHENTICATED,
            FORBIDDEN,
            IDENTITY_MISMATCH,
            RATE_LIMITED,
            POLICY_REFUSED,
        ];
        for code in codes {
            assert!(
                (-32099..-32000).contains(&code),
                "{code} is not in the JSON-RPC server-error range"
            );
            assert_ne!(code, -32000, "a refusal reused the generic server error");
        }
        assert_eq!(
            codes.iter().collect::<std::collections::HashSet<_>>().len(),
            5
        );
    }
}
