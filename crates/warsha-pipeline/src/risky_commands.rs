pub struct RiskyCommandDefinition {
    pub program: &'static str,
    pub argument_pattern: &'static str,
    pub reason: &'static str,
    pub check_arguments_only: bool,
}

pub const RISKY_COMMANDS: &[RiskyCommandDefinition] = &[
    RiskyCommandDefinition {
        program: "npx",
        argument_pattern: "-c",
        reason: "Npx",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "dlx",
        argument_pattern: "-c",
        reason: "Dlx",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "exec",
        argument_pattern: "-c",
        reason: "Exec",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "x",
        argument_pattern: "-c",
        reason: "X",
        check_arguments_only: true,
    },
    // Install aliases
    RiskyCommandDefinition {
        program: "npm",
        argument_pattern: "install|i|ci|add|update",
        reason: "Install/Update",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "pnpm",
        argument_pattern: "install|i|ci|add|update",
        reason: "Install/Update",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "yarn",
        argument_pattern: "install|i|ci|add|update",
        reason: "Install/Update",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "bun",
        argument_pattern: "install|i|ci|add|update",
        reason: "Install/Update",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "cargo",
        argument_pattern: "install|i|ci|add|update",
        reason: "Install/Update",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "go",
        argument_pattern: "install|i|ci|add|update",
        reason: "Install/Update",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "composer",
        argument_pattern: "install|i|ci|add|update",
        reason: "Install/Update",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "bundle",
        argument_pattern: "install|i|ci|add|update",
        reason: "Install/Update",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "pip",
        argument_pattern: "install|i|ci|add|update",
        reason: "Install/Update",
        check_arguments_only: true,
    },
    // Scripts/Run
    RiskyCommandDefinition {
        program: "npm",
        argument_pattern: "run|publish",
        reason: "Run script or Publish",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "make",
        argument_pattern: "*",
        reason: "Make",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "just",
        argument_pattern: "*",
        reason: "Just",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "task",
        argument_pattern: "*",
        reason: "Task",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "cargo",
        argument_pattern: "run",
        reason: "Cargo run",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "go",
        argument_pattern: "run|get",
        reason: "Go run/get",
        check_arguments_only: true,
    },
    // Git
    RiskyCommandDefinition {
        program: "git",
        argument_pattern: "push|pull|fetch|clone",
        reason: "Git network",
        check_arguments_only: true,
    },
];
