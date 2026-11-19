pub struct RiskyCommandDefinition {
    pub program: &'static str,
    pub argument_pattern: &'static str,
    pub reason: &'static str,
    pub check_arguments_only: bool,
}

pub const RISKY_COMMANDS: &[RiskyCommandDefinition] = &[
    RiskyCommandDefinition {
        program: "npx",
        argument_pattern: "*",
        reason: "Npx",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "dlx",
        argument_pattern: "*",
        reason: "Dlx",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "bunx",
        argument_pattern: "*",
        reason: "Bunx",
        check_arguments_only: false,
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
    // Inline code execution
    RiskyCommandDefinition {
        program: "node",
        argument_pattern: "-e|--eval|-pe",
        reason: "Node inline code",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "nodejs",
        argument_pattern: "-e|--eval|-pe",
        reason: "Node inline code",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "deno",
        argument_pattern: "run|eval",
        reason: "Deno run/eval",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "php",
        argument_pattern: "-r",
        reason: "Php inline code",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "cargo",
        argument_pattern: "build",
        reason: "Cargo build",
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
        argument_pattern: "install|i|ci|add|update|dlx",
        reason: "Install/Update/Dlx",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "yarn",
        argument_pattern: "install|i|ci|add|update|dlx",
        reason: "Install/Update/Dlx",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "bun",
        argument_pattern: "install|i|ci|add|update|x|dlx",
        reason: "Install/Update/X",
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
    // Scripts/Run/Publish
    RiskyCommandDefinition {
        program: "npm",
        argument_pattern: "run|publish|exec",
        reason: "Run script, Publish or Exec",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "pnpm",
        argument_pattern: "publish",
        reason: "Publish",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "yarn",
        argument_pattern: "publish",
        reason: "Publish",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "bun",
        argument_pattern: "publish",
        reason: "Publish",
        check_arguments_only: true,
    },
    RiskyCommandDefinition {
        program: "cargo",
        argument_pattern: "publish",
        reason: "Publish",
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
    // Network egress
    RiskyCommandDefinition {
        program: "curl",
        argument_pattern: "*",
        reason: "Network egress",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "wget",
        argument_pattern: "*",
        reason: "Network egress",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "ssh",
        argument_pattern: "*",
        reason: "Network egress",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "scp",
        argument_pattern: "*",
        reason: "Network egress",
        check_arguments_only: false,
    },
    // Shells
    RiskyCommandDefinition {
        program: "sh",
        argument_pattern: "*",
        reason: "Shell",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "bash",
        argument_pattern: "*",
        reason: "Shell",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "zsh",
        argument_pattern: "*",
        reason: "Shell",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "dash",
        argument_pattern: "*",
        reason: "Shell",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "cmd",
        argument_pattern: "*",
        reason: "Shell",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "powershell",
        argument_pattern: "*",
        reason: "Shell",
        check_arguments_only: false,
    },
    RiskyCommandDefinition {
        program: "pwsh",
        argument_pattern: "*",
        reason: "Shell",
        check_arguments_only: false,
    },
];
