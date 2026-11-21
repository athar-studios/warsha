#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::agent_tools::{AgentTool, FilesystemToolExecutor, ToolExecutor};
    use crate::command_policy::CommandPolicy;
    use crate::mcp_approval::McpApprovals;
    use crate::work_protection::{
        classify_command, PermissionMode, RiskClass, WorkProtectionPolicy,
    };

    #[test]
    fn test_risky_commands() {
        // 1. cmake -E env - Risky
        assert_eq!(
            classify_command("cmake", &["-E".to_string(), "env".to_string()]),
            RiskClass::Risky,
            "cmake -E env should be Risky"
        );
        // cmake --build - Safe
        assert_eq!(
            classify_command("cmake", &["--build".to_string(), ".".to_string()]),
            RiskClass::Safe,
            "cmake --build should be Safe"
        );
        // cmake -P script.cmake - Risky
        assert_eq!(
            classify_command("cmake", &["-P".to_string(), "script.cmake".to_string()]),
            RiskClass::Risky,
            "cmake -P should be Risky"
        );

        // 2. node -p - Risky
        assert_eq!(
            classify_command("node", &["-p".to_string(), "console.log(1)".to_string()]),
            RiskClass::Risky,
            "node -p should be Risky"
        );
        assert_eq!(
            classify_command("node", &["--print".to_string(), "1".to_string()]),
            RiskClass::Risky,
            "node --print should be Risky"
        );
        assert_eq!(
            classify_command("node", &["--eval=1+1".to_string()]),
            RiskClass::Risky,
            "node --eval=1+1 should be Risky"
        );
        assert_eq!(
            classify_command("node", &["--evaluate".to_string(), "1".to_string()]),
            RiskClass::Risky,
            "node --evaluate 1 should be Risky"
        );
        // node script.js - Risky (corrected per round-3: executing agent-written JS files is arbitrary code execution)
        assert_eq!(
            classify_command("node", &["script.js".to_string()]),
            RiskClass::Risky,
            "node script.js should be Risky"
        );
        assert_eq!(
            classify_command("node", &["script.mjs".to_string()]),
            RiskClass::Risky,
            "node script.mjs should be Risky"
        );
        assert_eq!(
            classify_command("node", &["script.cjs".to_string()]),
            RiskClass::Risky,
            "node script.cjs should be Risky"
        );
        assert_eq!(
            classify_command("node", &["--version".to_string()]),
            RiskClass::Safe,
            "node --version should be Safe"
        );

        // nodejs parity
        assert_eq!(
            classify_command("nodejs", &["--eval=1+1".to_string()]),
            RiskClass::Risky,
            "nodejs --eval=1+1 should be Risky"
        );
        assert_eq!(
            classify_command("nodejs", &["script.js".to_string()]),
            RiskClass::Risky,
            "nodejs script.js should be Risky"
        );

        // bundle exec
        assert_eq!(
            classify_command("bundle", &["exec".to_string(), "rspec".to_string()]),
            RiskClass::Risky,
            "bundle exec should be Risky"
        );

        // mvn exec:exec / -Dexec.executable
        assert_eq!(
            classify_command("mvn", &["exec:exec".to_string()]),
            RiskClass::Risky,
            "mvn exec:exec should be Risky"
        );
        assert_eq!(
            classify_command("mvn", &["-Dexec.executable=bash".to_string()]),
            RiskClass::Risky,
            "mvn -Dexec.executable should be Risky"
        );

        // rails r
        assert_eq!(
            classify_command("rails", &["r".to_string(), "script.rb".to_string()]),
            RiskClass::Risky,
            "rails r should be Risky"
        );
        assert_eq!(
            classify_command("rails", &["runner".to_string(), "script.rb".to_string()]),
            RiskClass::Risky,
            "rails runner should be Risky"
        );

        // npm t / rebuild
        assert_eq!(
            classify_command("npm", &["t".to_string()]),
            RiskClass::Risky,
            "npm t should be Risky"
        );
        assert_eq!(
            classify_command("npm", &["rebuild".to_string()]),
            RiskClass::Risky,
            "npm rebuild should be Risky"
        );

        // cargo test / t / check / clippy
        assert_eq!(
            classify_command("cargo", &["test".to_string()]),
            RiskClass::Risky,
            "cargo test should be Risky"
        );
        assert_eq!(
            classify_command("cargo", &["t".to_string()]),
            RiskClass::Risky,
            "cargo t should be Risky"
        );
        assert_eq!(
            classify_command("cargo", &["check".to_string()]),
            RiskClass::Risky,
            "cargo check should be Risky"
        );
        assert_eq!(
            classify_command("cargo", &["clippy".to_string()]),
            RiskClass::Risky,
            "cargo clippy should be Risky"
        );

        // bun test / bun x.ts
        assert_eq!(
            classify_command("bun", &["test".to_string()]),
            RiskClass::Risky,
            "bun test should be Risky"
        );
        assert_eq!(
            classify_command("bun", &["x.ts".to_string()]),
            RiskClass::Risky,
            "bun x.ts should be Risky"
        );

        // deno test
        assert_eq!(
            classify_command("deno", &["test".to_string()]),
            RiskClass::Risky,
            "deno test should be Risky"
        );

        // go test
        assert_eq!(
            classify_command("go", &["test".to_string()]),
            RiskClass::Risky,
            "go test should be Risky"
        );

        // Plain pnpm <script> / yarn <script> (unknown subcommand fallback = Risky)
        assert_eq!(
            classify_command("pnpm", &["build".to_string()]),
            RiskClass::Risky,
            "plain pnpm build should be Risky"
        );
        assert_eq!(
            classify_command("pnpm", &["test".to_string()]),
            RiskClass::Risky,
            "plain pnpm test should be Risky"
        );
        assert_eq!(
            classify_command("yarn", &["build".to_string()]),
            RiskClass::Risky,
            "plain yarn build should be Risky"
        );
        assert_eq!(
            classify_command("yarn", &["test".to_string()]),
            RiskClass::Risky,
            "plain yarn test should be Risky"
        );
        // known-safe pnpm / yarn subcommands
        assert_eq!(
            classify_command("pnpm", &["--version".to_string()]),
            RiskClass::Safe,
            "pnpm --version should be Safe"
        );
        assert_eq!(
            classify_command("pnpm", &["list".to_string()]),
            RiskClass::Safe,
            "pnpm list should be Safe"
        );
        assert_eq!(
            classify_command("yarn", &["--version".to_string()]),
            RiskClass::Safe,
            "yarn --version should be Safe"
        );
        assert_eq!(
            classify_command("yarn", &["why".to_string(), "foo".to_string()]),
            RiskClass::Safe,
            "yarn why should be Safe"
        );

        // sqlite3 dot-commands
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".shell whoami".to_string()]
            ),
            RiskClass::Risky,
            "sqlite3 .shell should be Risky"
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".system whoami".to_string()]
            ),
            RiskClass::Risky,
            "sqlite3 .system should be Risky"
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".output |cat".to_string()]
            ),
            RiskClass::Risky,
            "sqlite3 .output | should be Risky"
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".once |sh".to_string()]
            ),
            RiskClass::Risky,
            "sqlite3 .once | should be Risky"
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), "SELECT 1;".to_string()]
            ),
            RiskClass::Safe,
            "sqlite3 SELECT 1 should be Safe"
        );

        // git bisect run vs start
        assert_eq!(
            classify_command(
                "git",
                &[
                    "bisect".to_string(),
                    "run".to_string(),
                    "./test.sh".to_string()
                ]
            ),
            RiskClass::Risky,
            "git bisect run should be Risky"
        );
        assert_eq!(
            classify_command("git", &["bisect".to_string(), "start".to_string()]),
            RiskClass::Safe,
            "git bisect start should be Safe"
        );
    }

    #[test]
    fn test_git_commands() {
        let policy = CommandPolicy::from_config(&["git".to_string()]);

        // 3. git rebase -x
        assert!(
            policy.check_command("git rebase -x 'echo pwn'").is_err(),
            "git rebase -x should be refused"
        );
        assert!(
            policy
                .check_command("git rebase --exec 'echo pwn'")
                .is_err(),
            "git rebase --exec should be refused"
        );

        // 3b. Git bypass tests
        assert!(
            policy
                .check_command("git -C . rebase -x 'echo pwn'")
                .is_err(),
            "git -C . rebase -x should be refused"
        );
        assert!(
            policy
                .check_command("git -c foo=bar submodule foreach 'echo pwn'")
                .is_err(),
            "git -c foo=bar submodule foreach should be refused"
        );

        // 4. git submodule foreach
        assert!(
            policy
                .check_command("git submodule foreach 'echo pwn'")
                .is_err(),
            "git submodule foreach should be refused"
        );

        // git bisect run
        assert!(
            policy.check_command("git bisect run './test.sh'").is_err(),
            "git bisect run should be refused"
        );
        assert!(
            policy
                .check_command("git -C . bisect run './test.sh'")
                .is_err(),
            "git -C . bisect run should be refused"
        );
        assert!(
            policy.check_command("git bisect start").is_ok(),
            "git bisect start should be allowed"
        );

        // Normal git command
        assert!(
            policy.check_command("git status").is_ok(),
            "git status should be allowed"
        );
        assert!(
            policy.check_command("git -C . status").is_ok(),
            "git -C . status should be allowed"
        );
    }

    #[test]
    fn test_sqlite3_command_policy() {
        let policy = CommandPolicy::from_config(&["sqlite3".to_string()]);

        assert!(
            policy
                .check_command("sqlite3 test.db \".shell whoami\"")
                .is_err(),
            "sqlite3 .shell should be refused"
        );
        assert!(
            policy
                .check_command("sqlite3 test.db \".system whoami\"")
                .is_err(),
            "sqlite3 .system should be refused"
        );
        assert!(
            policy
                .check_command("sqlite3 test.db \".output |cat\"")
                .is_err(),
            "sqlite3 .output | should be refused"
        );
        assert!(
            policy
                .check_command("sqlite3 test.db \".once |sh\"")
                .is_err(),
            "sqlite3 .once | should be refused"
        );
        assert!(
            policy
                .check_command("sqlite3 test.db \"SELECT 1;\"")
                .is_ok(),
            "sqlite3 SELECT should be allowed"
        );
        assert!(
            policy.check_command("sqlite3 test.db \".schema\"").is_ok(),
            "sqlite3 .schema should be allowed"
        );
        assert!(
            policy
                .check_command("sqlite3 test.db \".output out.txt\"")
                .is_ok(),
            "sqlite3 .output file should be allowed"
        );
    }

    #[tokio::test]
    async fn test_git_bisect_run_ask_for_risky_e2e() {
        let dir = std::env::temp_dir().join("git-bisect-run-ask-risky-test");
        let _ = std::fs::create_dir_all(&dir);
        let approvals = Arc::new(McpApprovals::new(None));
        let policy = WorkProtectionPolicy {
            mode: PermissionMode::AskForRisky,
            snapshot_before_edit: false,
            worktree_isolation: false,
            read_before_write: false,
        };
        let executor = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&["git".to_string()]))
            .with_protection(Some(policy))
            .with_mcp_approvals(approvals.clone(), Some("run-bisect-1".to_string()));

        // git bisect run should be classified as Risky and refused/asked in AskForRisky mode
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "git".to_string(),
                args: vec![
                    "bisect".to_string(),
                    "run".to_string(),
                    "./test.sh".to_string(),
                ],
            })
            .await;
        assert!(
            !res.success,
            "git bisect run must be refused/asked under AskForRisky"
        );
        assert_eq!(
            approvals.pending().len(),
            1,
            "git bisect run must queue approval request"
        );

        // git bisect start is Safe and should not queue an approval request
        let approvals2 = Arc::new(McpApprovals::new(None));
        let executor2 = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&["git".to_string()]))
            .with_protection(Some(policy))
            .with_mcp_approvals(approvals2.clone(), Some("run-bisect-2".to_string()));

        let _res2 = executor2
            .execute(&AgentTool::RunCommand {
                command: "git".to_string(),
                args: vec!["bisect".to_string(), "start".to_string()],
            })
            .await;
        assert_eq!(
            approvals2.pending().len(),
            0,
            "git bisect start should not queue approval request"
        );
    }

    #[test]
    fn test_h1_sibling_program_name_normalization() {
        // Case variants
        assert_eq!(
            classify_command("GIT", &["push".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("Node", &["-e".to_string(), "console.log(1)".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("Python3", &["-c".to_string(), "print(1)".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("SH", &["-c".to_string(), "id".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("Bash", &["script.sh".to_string()]),
            RiskClass::Risky
        );

        // .exe / .cmd / .bat suffixes
        assert_eq!(
            classify_command("git.exe", &["push".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node.exe", &["-e".to_string(), "1".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("python3.exe", &["script.py".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmd.exe", &["/c".to_string(), "dir".to_string()]),
            RiskClass::Risky
        );

        // Absolute / relative paths
        assert_eq!(
            classify_command("/usr/bin/git", &["push".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("/bin/sh", &["-c".to_string(), "whoami".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("./git", &["push".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "C:\\Program Files\\Git\\bin\\git.exe",
                &["push".to_string()]
            ),
            RiskClass::Risky
        );

        // CommandPolicy allowlist respects normalized program names
        let policy = CommandPolicy::from_config(&["git".to_string()]);
        assert!(policy.check_command("/usr/bin/git status").is_ok());
        assert!(policy.check_command("git.exe status").is_ok());
        assert!(policy.check_command("GIT status").is_ok());
        // But rejects risky subcommands through the normalized path
        assert!(policy
            .check_command("/usr/bin/git rebase -x 'calc'")
            .is_err());
        assert!(policy
            .check_command("git.exe submodule foreach 'calc'")
            .is_err());
    }

    #[test]
    fn test_h1_sibling_wrapper_and_shim_commands() {
        // Multi-call shims and privilege escalators
        assert_eq!(
            classify_command("busybox", &["sh".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("toybox", &["sh".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("sudo", &["sh".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(classify_command("su", &["-".to_string()]), RiskClass::Risky);
        assert_eq!(
            classify_command("doas", &["bash".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("runas", &["/user:admin".to_string(), "cmd.exe".to_string()]),
            RiskClass::Risky
        );

        // Environment and toolchain execution wrappers
        assert_eq!(
            classify_command("env", &["sh".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("env", &["python3".to_string(), "script.py".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("xargs", &["sh".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("watch", &["ls".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "find",
                &[
                    ".".to_string(),
                    "-exec".to_string(),
                    "rm".to_string(),
                    "{}".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "find",
                &[
                    ".".to_string(),
                    "-execdir".to_string(),
                    "sh".to_string(),
                    "{}".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "find",
                &[
                    ".".to_string(),
                    "-ok".to_string(),
                    "rm".to_string(),
                    "{}".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "find",
                &[
                    ".".to_string(),
                    "-okdir".to_string(),
                    "sh".to_string(),
                    "{}".to_string()
                ]
            ),
            RiskClass::Risky
        );
        // Safe find (no -exec/-ok)
        assert_eq!(
            classify_command(
                "find",
                &[".".to_string(), "-name".to_string(), "*.rs".to_string()]
            ),
            RiskClass::Safe
        );

        // Policy checks: wrappers cannot bypass policy or invoke shells
        let policy_with_wrappers = CommandPolicy::from_config(&[
            "env".to_string(),
            "find".to_string(),
            "xargs".to_string(),
            "git".to_string(),
        ]);
        assert!(policy_with_wrappers.check_command("env sh").is_err());
        assert!(policy_with_wrappers
            .check_command("env FOO=1 bash")
            .is_err());
        assert!(policy_with_wrappers
            .check_command("env cargo test")
            .is_err()); // cargo not allowed in this policy
        assert!(policy_with_wrappers.check_command("env git status").is_ok()); // git is allowed

        assert!(policy_with_wrappers
            .check_command("find . -exec rm {} +")
            .is_err());
        assert!(policy_with_wrappers
            .check_command("find . -exec sh {} +")
            .is_err());
        assert!(policy_with_wrappers
            .check_command("find . -name '*.rs'")
            .is_ok());

        assert!(policy_with_wrappers.check_command("xargs sh").is_err());
        assert!(policy_with_wrappers
            .check_command("xargs -n1 bash")
            .is_err());
        assert!(policy_with_wrappers.check_command("xargs rm").is_err()); // rm not in policy
        assert!(policy_with_wrappers
            .check_command("xargs git status")
            .is_ok());
        // git in policy
    }

    #[test]
    fn test_h1_git_prefixes_and_config_overrides() {
        let policy = CommandPolicy::from_config(&["git".to_string()]);

        // Prefixes with dangerous subcommands
        let dangerous_prefixed = [
            "git -C /tmp rebase -x 'calc'",
            "git -Cdir rebase --exec 'calc'",
            "git --git-dir=/repo/.git submodule foreach 'ls'",
            "git --git-dir /repo/.git submodule foreach 'ls'",
            "git --work-tree=. bisect run './test.sh'",
            "git --work-tree . bisect run './test.sh'",
            "git -C dir archive --exec 'sh'",
            "git --namespace=foo rebase -x 'sh'",
            "git --super-prefix=bar submodule foreach 'sh'",
        ];
        for cmd in dangerous_prefixed {
            assert!(
                policy.check_command(cmd).is_err(),
                "should refuse prefixed dangerous command: {cmd}"
            );
        }

        // Dangerous git config overrides
        let dangerous_configs = [
            "git -c alias.x=!sh status",
            "git -c alias.ci=!python3 commit",
            "git --config alias.foo=!bash log",
            "git --config-env alias.bar=FOO status",
            "git -c core.pager=sh log",
            "git -c core.editor=vim commit",
            "git -c sequence.editor=sh rebase -i",
            "git -c credential.helper='!sh' push",
            "git -c filter.clean.clean=sh add .",
            "git -c diff.external=sh diff",
            "git -c hooks.pre-commit=sh commit",
            "git -c hook.pre-commit=sh commit",
            "git -c pager.log=sh log",
            "git -c core.sshcommand=sh fetch",
            "git -c core.askpass=sh fetch",
            "git -c gpg.program=sh tag -s",
            "git -c gpg.ssh.program=sh tag -s",
            "git -c browser.path=sh help --web",
            "git --exec-path=/tmp status",
            "git --exec-path status",
        ];
        for cmd in dangerous_configs {
            assert!(
                policy.check_command(cmd).is_err(),
                "should refuse dangerous git config override: {cmd}"
            );
        }

        // Safe git invocations with flags
        let safe_git_commands = [
            "git -C . status",
            "git -C. diff",
            "git --git-dir=.git log",
            "git --work-tree=. status",
            "git -c user.name=Alice commit",
            "git -c core.fsmonitor= status",
            "git -c color.ui=always status",
        ];
        for cmd in safe_git_commands {
            assert!(
                policy.check_command(cmd).is_ok(),
                "should allow safe git command: {cmd}"
            );
        }

        // Parity in classify_command
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-C".to_string(),
                    ".".to_string(),
                    "rebase".to_string(),
                    "-x".to_string(),
                    "sh".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "alias.x=!sh".to_string(),
                    "status".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "core.pager=sh".to_string(),
                    "log".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &["--exec-path=/tmp".to_string(), "status".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &["-C".to_string(), ".".to_string(), "status".to_string()]
            ),
            RiskClass::Safe
        );
    }

    #[test]
    fn test_h1_node_eval_and_script_variants() {
        // Node / Nodejs eval forms
        let risky_node_args: Vec<Vec<String>> = vec![
            vec!["-e".to_string(), "1+1".to_string()],
            vec!["-e=1+1".to_string()],
            vec!["--eval".to_string(), "1+1".to_string()],
            vec!["--eval=1+1".to_string()],
            vec!["--evaluate".to_string(), "1+1".to_string()],
            vec!["--evaluate=1+1".to_string()],
            vec!["-p".to_string(), "1+1".to_string()],
            vec!["-p=1+1".to_string()],
            vec!["--print".to_string(), "1+1".to_string()],
            vec!["--print=1+1".to_string()],
            vec!["-pe".to_string(), "1+1".to_string()],
            vec!["-pe=1+1".to_string()],
            vec!["script.js".to_string()],
            vec!["script.mjs".to_string()],
            vec!["script.cjs".to_string()],
            vec!["script.ts".to_string()],
            vec![], // interactive REPL
        ];
        for args in risky_node_args {
            assert_eq!(
                classify_command("node", &args),
                RiskClass::Risky,
                "node {args:?} should be Risky"
            );
            assert_eq!(
                classify_command("nodejs", &args),
                RiskClass::Risky,
                "nodejs {args:?} should be Risky"
            );
        }

        // Safe node forms
        assert_eq!(
            classify_command("node", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("node", &["-v".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("node", &["--help".to_string()]),
            RiskClass::Safe
        );
    }

    #[test]
    fn test_h2_missing_risky_rows_classification() {
        // Python / Python3
        assert_eq!(
            classify_command("python", &["-c".to_string(), "print(1)".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("python", &["script.py".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("python", &[]),
            RiskClass::Risky // REPL
        );
        assert_eq!(
            classify_command("python", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("python3", &["-c".to_string(), "print(1)".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("python3", &["script.py".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("python3", &[]),
            RiskClass::Risky // REPL
        );
        assert_eq!(
            classify_command("python3", &["--version".to_string()]),
            RiskClass::Safe
        );

        // Pip3 / Poetry / Uv / Pipx
        assert_eq!(
            classify_command("pip3", &["install".to_string(), "requests".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("poetry", &["run".to_string(), "pytest".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("uv", &["run".to_string(), "pytest".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pipx", &["run".to_string(), "black".to_string()]),
            RiskClass::Risky
        );

        // Ruby / Gem
        assert_eq!(
            classify_command("ruby", &["-e".to_string(), "puts 1".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("ruby", &["script.rb".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("ruby", &[]),
            RiskClass::Risky // REPL
        );
        assert_eq!(
            classify_command("ruby", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("gem", &["install".to_string(), "bundler".to_string()]),
            RiskClass::Risky
        );

        // Privilege escalation / Multi-call
        assert_eq!(
            classify_command("sudo", &["whoami".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("su", &["root".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("doas", &["whoami".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("runas", &["/user:admin".to_string(), "cmd".to_string()]),
            RiskClass::Risky
        );

        // Containers & Orchestration
        assert_eq!(
            classify_command("docker", &["run".to_string(), "ubuntu".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("podman", &["run".to_string(), "ubuntu".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "kubectl",
                &[
                    "apply".to_string(),
                    "-f".to_string(),
                    "deploy.yaml".to_string()
                ]
            ),
            RiskClass::Risky
        );

        // Infrastructure as Code
        assert_eq!(
            classify_command("terraform", &["apply".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "ansible",
                &["all".to_string(), "-m".to_string(), "ping".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("ansible-playbook", &["site.yml".to_string()]),
            RiskClass::Risky
        );

        // Toolchain / CLI
        assert_eq!(
            classify_command(
                "rustup",
                &[
                    "run".to_string(),
                    "nightly".to_string(),
                    "cargo".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("gh", &["repo".to_string(), "clone".to_string()]),
            RiskClass::Risky
        );

        // Network transfer & sockets
        assert_eq!(
            classify_command("ftp", &["example.com".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("sftp", &["example.com".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "rsync",
                &["-av".to_string(), "src/".to_string(), "dest/".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("socat", &["TCP-LISTEN:8080".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("nc", &["-l".to_string(), "8080".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("ncat", &["-l".to_string(), "8080".to_string()]),
            RiskClass::Risky
        );

        // System tools & permissions
        assert_eq!(
            classify_command("chmod", &["+x".to_string(), "script.sh".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("chown", &["user:group".to_string(), "file".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("java", &["-jar".to_string(), "app.jar".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("gradle", &["build".to_string()]),
            RiskClass::Risky
        );

        // Shells are blanket Risky
        for shell in [
            "ash",
            "csh",
            "tcsh",
            "fish",
            "ksh",
            "sh",
            "bash",
            "zsh",
            "dash",
            "cmd",
            "powershell",
            "pwsh",
        ] {
            assert_eq!(
                classify_command(shell, &["-c".to_string(), "echo 1".to_string()]),
                RiskClass::Risky,
                "shell {shell} should be Risky"
            );
        }
    }

    #[tokio::test]
    async fn test_h1_h2_e2e_ask_for_risky_approval_queueing() {
        let dir = std::env::temp_dir().join("approval-h1-h2-e2e-test");
        let _ = std::fs::create_dir_all(&dir);

        let allowed_commands = vec![
            "git".to_string(),
            "env".to_string(),
            "python3".to_string(),
            "chmod".to_string(),
        ];
        let approvals = Arc::new(McpApprovals::new(None));
        let policy = WorkProtectionPolicy {
            mode: PermissionMode::AskForRisky,
            snapshot_before_edit: false,
            worktree_isolation: false,
            read_before_write: false,
        };
        let executor = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&allowed_commands))
            .with_protection(Some(policy))
            .with_mcp_approvals(approvals.clone(), Some("run-approval-e2e".to_string()));

        // 1. git with dangerous config override -> queues approval
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "git".to_string(),
                args: vec![
                    "-c".to_string(),
                    "alias.x=!sh".to_string(),
                    "status".to_string(),
                ],
            })
            .await;
        assert!(
            !res.success,
            "git alias override should be paused for approval"
        );
        assert_eq!(approvals.pending().len(), 1);

        // 2. python3 execution -> queues approval
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "python3".to_string(),
                args: vec!["-c".to_string(), "print(1)".to_string()],
            })
            .await;
        assert!(!res.success, "python3 -c should be paused for approval");
        assert_eq!(approvals.pending().len(), 2);

        // 3. chmod modification -> queues approval
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "chmod".to_string(),
                args: vec!["+x".to_string(), "test.sh".to_string()],
            })
            .await;
        assert!(!res.success, "chmod should be paused for approval");
        assert_eq!(approvals.pending().len(), 3);

        // 4. Safe command: git -C . status -> passes without approval queueing
        let approvals_safe = Arc::new(McpApprovals::new(None));
        let executor_safe = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&allowed_commands))
            .with_protection(Some(policy))
            .with_mcp_approvals(approvals_safe.clone(), Some("run-safe".to_string()));
        let res = executor_safe
            .execute(&AgentTool::RunCommand {
                command: "git".to_string(),
                args: vec!["-C".to_string(), ".".to_string(), "status".to_string()],
            })
            .await;
        assert_eq!(approvals_safe.pending().len(), 0);
        assert!(!res.output.contains("Approval requested"));
    }
}
