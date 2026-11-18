//! B2: the permission mapping table (A16.5).
//!
//! ONE table keyed by backend name that maps a run's effective permissions
//! (confinement × approval mode) to the launch arguments the backend needs.
//! N2 later moves this table into catalog data; the shape stays.
//!
//! Facts verified against claude 2.1.322 (`claude --help`):
//! - `--permission-mode <MODE>` with choices `acceptEdits`, `auto`,
//!   `bypassPermissions`, `manual`, `dontAsk`, `plan`.
//! - `--permission-prompts <TARGET>` with choices `host`, `none` (default
//!   `host`) — who answers permission prompts under `--print`. The plan's
//!   `--permission-prompt-tool` does NOT exist in 2.1.322.
//! - `--mcp-config <configs...>` loads MCP servers from JSON files or strings.
//! - `--allowedTools` / `--disallowedTools` restrict tools.
//! - `--dangerously-skip-permissions` bypasses all checks.
//!
//! codex is NOT installed in this environment, so its mapping is documented
//! from vendor docs only (tier C, labelled unverified in the report): codex
//! exec takes `--sandbox read-only|workspace-write|danger-full-access` and
//! cannot ask.

use std::collections::HashMap;

use warsha_core::{ApprovalMode, Confinement};

/// The launch-argument plan for one (backend, confinement, approval) cell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendPermissionPlan {
    /// Extra argv inserted before the prompt.
    pub args: Vec<String>,
    /// Human-readable summary shown on the run surface (honest copy).
    pub header: String,
    /// True when the backend can ask the owner through the bridge.
    pub can_ask: bool,
}

/// Returns true if the backend has an explicit permission mapping table entry.
pub fn has_permission_mapping(backend: &str) -> bool {
    matches!(backend, "claude-code" | "codex-cli")
}

/// Map (backend name, confinement, approval mode) to launch arguments.
///
/// Unknown backends get the "own defaults" plan: no permission flags, and the
/// header says the backend runs under its own defaults.
pub fn permission_plan(
    backend: &str,
    confinement: Confinement,
    approval: ApprovalMode,
) -> BackendPermissionPlan {
    match backend {
        "claude-code" => claude_plan(confinement, approval),
        "codex-cli" => codex_plan(confinement),
        _ => BackendPermissionPlan {
            args: Vec::new(),
            header: "this backend runs under its own defaults".to_string(),
            can_ask: false,
        },
    }
}

/// claude-code mapping (verified flags, claude 2.1.322).
fn claude_plan(confinement: Confinement, approval: ApprovalMode) -> BackendPermissionPlan {
    match (confinement, approval) {
        // read-only × any → read tools only allow-list.
        (Confinement::ReadOnly, _) => BackendPermissionPlan {
            args: vec![
                "--disallowedTools".to_string(),
                "Edit,Write,MultiEdit,NotebookEdit,Bash".to_string(),
            ],
            header: "read-only: write and shell tools are disallowed for this run".to_string(),
            can_ask: false,
        },
        // workspace-write × ask-always → default mode + bridge (everything asks).
        (Confinement::WorkspaceWrite, ApprovalMode::AskAlways) => BackendPermissionPlan {
            args: bridge_args(),
            header: "every tool use asks through Warsha".to_string(),
            can_ask: true,
        },
        // workspace-write × ask-for-risky → accept-edits + bridge.
        (Confinement::WorkspaceWrite, ApprovalMode::AskForRisky) => BackendPermissionPlan {
            args: ["--permission-mode".to_string(), "acceptEdits".to_string()]
                .into_iter()
                .chain(bridge_args())
                .collect(),
            header: "edits are accepted; risky commands ask through Warsha".to_string(),
            can_ask: true,
        },
        // workspace-write × never-ask → accept-edits + policy-only bridge.
        (Confinement::WorkspaceWrite, ApprovalMode::NeverAsk) => BackendPermissionPlan {
            args: [
                "--permission-mode".to_string(),
                "acceptEdits".to_string(),
                "--permission-prompts".to_string(),
                "none".to_string(),
            ]
            .to_vec(),
            header: "edits are accepted; anything that would prompt is denied".to_string(),
            can_ask: false,
        },
        // full-access × ask-always/ask-for-risky → default mode + bridge.
        (Confinement::FullAccess, ApprovalMode::AskAlways)
        | (Confinement::FullAccess, ApprovalMode::AskForRisky) => BackendPermissionPlan {
            args: bridge_args(),
            header: "full access; risky actions ask through Warsha".to_string(),
            can_ask: true,
        },
        // full-access × never-ask → bypass-permissions (explicit confirmation +
        // standing warning chip in the B1 UI).
        (Confinement::FullAccess, ApprovalMode::NeverAsk) => BackendPermissionPlan {
            args: vec!["--dangerously-skip-permissions".to_string()],
            header:
                "full access without prompts; Warsha tools and the CLI run without their sandboxes"
                    .to_string(),
            can_ask: false,
        },
    }
}

/// The bridge launch arguments: the stdio MCP bridge is handed to claude via
/// `--mcp-config` and prompts are answered by the bridge host.
fn bridge_args() -> Vec<String> {
    vec![
        "--permission-prompts".to_string(),
        "host".to_string(),
        "--mcp-config".to_string(),
        "warsha-bridge.json".to_string(),
    ]
}

/// codex mapping (tier C — docs only, codex not installed here).
fn codex_plan(confinement: Confinement) -> BackendPermissionPlan {
    let sandbox = match confinement {
        Confinement::ReadOnly => "read-only",
        Confinement::WorkspaceWrite => "workspace-write",
        Confinement::FullAccess => "danger-full-access",
    };
    BackendPermissionPlan {
        args: vec!["--sandbox".to_string(), sandbox.to_string()],
        header: "codex cannot ask; the sandbox flag is the only control".to_string(),
        can_ask: false,
    }
}

/// The argv matrix over every axis pair for the acceptance test.
pub fn argv_matrix(backend: &str) -> HashMap<(Confinement, ApprovalMode), BackendPermissionPlan> {
    use ApprovalMode as A;
    use Confinement as C;
    let mut map = HashMap::new();
    for (c, a) in [
        (C::ReadOnly, A::AskAlways),
        (C::ReadOnly, A::AskForRisky),
        (C::ReadOnly, A::NeverAsk),
        (C::WorkspaceWrite, A::AskAlways),
        (C::WorkspaceWrite, A::AskForRisky),
        (C::WorkspaceWrite, A::NeverAsk),
        (C::FullAccess, A::AskAlways),
        (C::FullAccess, A::AskForRisky),
        (C::FullAccess, A::NeverAsk),
    ] {
        map.insert((c, a), permission_plan(backend, c, a));
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_only_disallows_write_tools_for_claude() {
        let plan = permission_plan("claude-code", Confinement::ReadOnly, ApprovalMode::NeverAsk);
        assert!(plan.args.contains(&"--disallowedTools".to_string()));
        assert!(!plan.can_ask);
        assert!(plan.header.contains("read-only"));
    }

    #[test]
    fn workspace_write_ask_for_risky_uses_accept_edits_plus_bridge() {
        let plan = permission_plan(
            "claude-code",
            Confinement::WorkspaceWrite,
            ApprovalMode::AskForRisky,
        );
        assert_eq!(
            plan.args.iter().position(|a| a == "--permission-mode"),
            Some(0)
        );
        assert!(plan.args.contains(&"acceptEdits".to_string()));
        assert!(plan.args.contains(&"--mcp-config".to_string()));
        assert!(plan.can_ask);
    }

    #[test]
    fn workspace_write_never_ask_uses_prompt_none() {
        let plan = permission_plan(
            "claude-code",
            Confinement::WorkspaceWrite,
            ApprovalMode::NeverAsk,
        );
        assert!(plan.args.contains(&"none".to_string()));
        assert!(!plan.can_ask);
    }

    #[test]
    fn full_access_never_ask_bypasses_permissions() {
        let plan = permission_plan(
            "claude-code",
            Confinement::FullAccess,
            ApprovalMode::NeverAsk,
        );
        assert!(plan
            .args
            .contains(&"--dangerously-skip-permissions".to_string()));
        assert!(!plan.can_ask);
    }

    #[test]
    fn codex_maps_the_sandbox_flag_and_cannot_ask() {
        let plan = permission_plan(
            "codex-cli",
            Confinement::WorkspaceWrite,
            ApprovalMode::AskAlways,
        );
        assert_eq!(
            plan.args,
            vec!["--sandbox".to_string(), "workspace-write".to_string()]
        );
        assert!(!plan.can_ask);
        let ro = permission_plan("codex-cli", Confinement::ReadOnly, ApprovalMode::NeverAsk);
        assert!(ro.args.contains(&"read-only".to_string()));
    }

    #[test]
    fn unknown_backends_run_under_their_own_defaults() {
        let plan = permission_plan(
            "gemini-cli",
            Confinement::WorkspaceWrite,
            ApprovalMode::NeverAsk,
        );
        assert!(plan.args.is_empty());
        assert!(plan.header.contains("own defaults"));
        assert!(!plan.can_ask);
    }

    #[test]
    fn matrix_covers_every_axis_pair() {
        let matrix = argv_matrix("claude-code");
        assert_eq!(matrix.len(), 9);
        let codex = argv_matrix("codex-cli");
        assert_eq!(codex.len(), 9);
    }
}
