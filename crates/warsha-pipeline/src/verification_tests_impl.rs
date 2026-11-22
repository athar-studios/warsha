#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::agent_tools::{AgentTool, FilesystemToolExecutor, ToolExecutor};
    use crate::command_policy::CommandPolicy;
    use crate::mcp_approval::McpApprovals;
    use crate::work_protection::{
        classify_command, classify_command_with_workdir, PermissionMode, RiskClass,
        WorkProtectionPolicy,
    };

    #[test]
    fn test_risky_commands() {
        // 1. cmake -E env - Risky
        assert_eq!(
            classify_command("cmake", &["-E".to_string(), "env".to_string()]),
            RiskClass::Risky,
            "cmake -E env should be Risky"
        );
        // cmake --build - Risky
        assert_eq!(
            classify_command("cmake", &["--build".to_string(), ".".to_string()]),
            RiskClass::Risky,
            "cmake --build should be Risky"
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
        // R6-H6: pnpm / yarn ALL invocations Risky
        assert_eq!(
            classify_command("pnpm", &["--version".to_string()]),
            RiskClass::Risky,
            "pnpm --version should be Risky"
        );
        assert_eq!(
            classify_command("pnpm", &["list".to_string()]),
            RiskClass::Risky,
            "pnpm list should be Risky"
        );
        assert_eq!(
            classify_command("yarn", &["--version".to_string()]),
            RiskClass::Risky,
            "yarn --version should be Risky"
        );
        assert_eq!(
            classify_command("yarn", &["why".to_string(), "foo".to_string()]),
            RiskClass::Risky,
            "yarn why should be Risky"
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

    #[test]
    fn h1_node_extensionless_risky() {
        assert_eq!(
            classify_command("node", &["script".to_string()]),
            RiskClass::Risky,
            "node extensionless script should be Risky"
        );
        assert_eq!(
            classify_command("nodejs", &["runner".to_string()]),
            RiskClass::Risky,
            "nodejs extensionless script should be Risky"
        );
        assert_eq!(
            classify_command("node", &["path/to/my_script".to_string()]),
            RiskClass::Risky,
            "node path/to/my_script should be Risky"
        );
    }

    #[test]
    fn h1_node_txt_and_dotfile_risky() {
        assert_eq!(
            classify_command("node", &["evil.txt".to_string()]),
            RiskClass::Risky,
            "node evil.txt should be Risky"
        );
        assert_eq!(
            classify_command("node", &[".evil".to_string()]),
            RiskClass::Risky,
            "node .evil dotfile should be Risky"
        );
        assert_eq!(
            classify_command("nodejs", &["payload.data".to_string()]),
            RiskClass::Risky,
            "nodejs payload.data should be Risky"
        );
    }

    #[test]
    fn h1_node_test_flag_risky() {
        assert_eq!(
            classify_command("node", &["--test".to_string()]),
            RiskClass::Risky,
            "node --test should be Risky"
        );
        assert_eq!(
            classify_command("nodejs", &["--test".to_string()]),
            RiskClass::Risky,
            "nodejs --test should be Risky"
        );
        assert_eq!(
            classify_command("node", &["--test=tests/unit".to_string()]),
            RiskClass::Risky,
            "node --test=path should be Risky"
        );
    }

    #[test]
    fn h1_node_version_safe() {
        assert_eq!(
            classify_command("node", &["--version".to_string()]),
            RiskClass::Safe,
            "node --version should be Safe"
        );
        assert_eq!(
            classify_command("node", &["-v".to_string()]),
            RiskClass::Safe,
            "node -v should be Safe"
        );
        assert_eq!(
            classify_command("node", &["--help".to_string()]),
            RiskClass::Safe,
            "node --help should be Safe"
        );
        assert_eq!(
            classify_command("nodejs", &["--version".to_string()]),
            RiskClass::Safe,
            "nodejs --version should be Safe"
        );
    }

    #[test]
    fn h1_java_source_launch_risky() {
        assert_eq!(
            classify_command("java", &["Evil.java".to_string()]),
            RiskClass::Risky,
            "java Evil.java should be Risky"
        );
        assert_eq!(
            classify_command("java", &["path/to/Main.java".to_string()]),
            RiskClass::Risky,
            "java source-file arg should be Risky"
        );
        assert_eq!(
            classify_command("java", &["Main".to_string()]),
            RiskClass::Risky,
            "java Main application launch should be Risky"
        );
    }

    #[test]
    fn h1_npm_restart_and_stop_risky() {
        assert_eq!(
            classify_command("npm", &["restart".to_string()]),
            RiskClass::Risky,
            "npm restart should be Risky"
        );
        assert_eq!(
            classify_command("npm", &["stop".to_string()]),
            RiskClass::Risky,
            "npm stop should be Risky"
        );
        assert_eq!(
            classify_command("npm", &["run".to_string(), "build".to_string()]),
            RiskClass::Risky,
            "npm run should remain Risky"
        );
        assert_eq!(
            classify_command("npm", &["install".to_string()]),
            RiskClass::Risky,
            "npm install should remain Risky"
        );
        assert_eq!(
            classify_command("npm", &["test".to_string()]),
            RiskClass::Risky,
            "npm test should remain Risky"
        );
    }

    #[test]
    fn h1_git_config_alias_shell_risky() {
        let policy = CommandPolicy::from_config(&["git".to_string()]);
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "alias.foo=!sh".to_string(),
                    "status".to_string()
                ]
            ),
            RiskClass::Risky,
            "git -c alias.*=! form should be Risky"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "--config".to_string(),
                    "alias.x=!cmd".to_string(),
                    "status".to_string()
                ]
            ),
            RiskClass::Risky,
            "git --config alias.x=!cmd should be Risky"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "config".to_string(),
                    "alias.x".to_string(),
                    "!calc".to_string()
                ]
            ),
            RiskClass::Risky,
            "git config alias.x !calc should be Risky"
        );
        assert_eq!(
            classify_command("git", &["config".to_string(), "alias.x=!calc".to_string()]),
            RiskClass::Risky,
            "git config alias.x=!calc should be Risky"
        );

        assert!(
            policy
                .check_command("git -c alias.test=!sh status")
                .is_err(),
            "policy should reject -c alias.test=!sh"
        );
        assert!(
            policy
                .check_command("git --config alias.test=!sh status")
                .is_err(),
            "policy should reject --config alias.test=!sh"
        );
        assert!(
            policy.check_command("git config alias.test !sh").is_err(),
            "policy should reject git config alias.test !sh"
        );
    }

    #[test]
    fn h1_git_config_fsmonitor_risky() {
        let policy = CommandPolicy::from_config(&["git".to_string()]);
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "core.fsmonitor=watchman".to_string(),
                    "status".to_string()
                ]
            ),
            RiskClass::Risky,
            "git -c core.fsmonitor non-empty should be Risky"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "fsmonitor.allowremote=true".to_string(),
                    "status".to_string()
                ]
            ),
            RiskClass::Risky,
            "git -c fsmonitor.allowremote=true should be Risky"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "config".to_string(),
                    "core.fsmonitor".to_string(),
                    "/usr/bin/watchman".to_string()
                ]
            ),
            RiskClass::Risky,
            "git config core.fsmonitor <path> should be Risky"
        );

        assert!(
            policy
                .check_command("git -c core.fsmonitor=/usr/bin/daemon status")
                .is_err(),
            "policy should reject -c core.fsmonitor=/usr/bin/daemon"
        );
        assert!(
            policy
                .check_command("git -c fsmonitor.allowremote=true status")
                .is_err(),
            "policy should reject -c fsmonitor.allowremote=true"
        );
        assert!(
            policy
                .check_command("git config core.fsmonitor /usr/bin/daemon")
                .is_err(),
            "policy should reject git config core.fsmonitor /usr/bin/daemon"
        );
    }

    #[test]
    fn h1_git_config_fsmonitor_empty_safe() {
        let policy = CommandPolicy::from_config(&["git".to_string()]);
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "core.fsmonitor=".to_string(),
                    "status".to_string()
                ]
            ),
            RiskClass::Safe,
            "git -c core.fsmonitor= empty should be Safe"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "core.fsmonitor=\"\"".to_string(),
                    "status".to_string()
                ]
            ),
            RiskClass::Safe,
            "git -c core.fsmonitor=\"\" empty should be Safe"
        );

        assert!(
            policy
                .check_command("git -c core.fsmonitor= diff --no-ext-diff")
                .is_ok(),
            "policy should allow neutralized core.fsmonitor="
        );
    }

    #[test]
    fn h1_git_direct_config_path_write_risky() {
        let policy = CommandPolicy::from_config(&[
            "git".to_string(),
            "echo".to_string(),
            "cat".to_string(),
            "sed".to_string(),
        ]);
        assert_eq!(
            classify_command("cat", &[".git/config".to_string()]),
            RiskClass::Risky,
            "cat .git/config should be Risky"
        );
        assert_eq!(
            classify_command("echo", &["payload".to_string(), ".git/config".to_string()]),
            RiskClass::Risky,
            "echo to .git/config should be Risky"
        );
        assert_eq!(
            classify_command(
                "sed",
                &[
                    "-i".to_string(),
                    "s/a/b/".to_string(),
                    "./.git/config".to_string()
                ]
            ),
            RiskClass::Risky,
            "sed ./.git/config should be Risky"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "config".to_string(),
                    "--file".to_string(),
                    ".git/config".to_string(),
                    "user.name".to_string(),
                    "evil".to_string()
                ]
            ),
            RiskClass::Risky,
            "git config --file .git/config should be Risky"
        );

        assert!(
            policy.check_command("cat .git/config").is_err(),
            "policy should reject arguments referencing .git/config"
        );
        assert!(
            policy.check_command("echo test .git/config").is_err(),
            "policy should reject arguments referencing .git/config"
        );
        assert!(
            policy.check_command("sed -i s/a/b/ ./.git/config").is_err(),
            "policy should reject arguments referencing ./.git/config"
        );
    }

    #[test]
    fn h2_dotnet_test_risky() {
        assert_eq!(
            classify_command("dotnet", &["test".to_string()]),
            RiskClass::Risky,
            "dotnet test should be Risky"
        );
        assert_eq!(
            classify_command("dotnet", &["run".to_string()]),
            RiskClass::Risky,
            "dotnet run should remain Risky"
        );
    }

    #[test]
    fn h2_composer_exec_and_run_script_risky() {
        assert_eq!(
            classify_command("composer", &["exec".to_string(), "whoami".to_string()]),
            RiskClass::Risky,
            "composer exec should be Risky"
        );
        assert_eq!(
            classify_command("composer", &["run-script".to_string(), "test".to_string()]),
            RiskClass::Risky,
            "composer run-script should be Risky"
        );
        assert_eq!(
            classify_command("composer", &["install".to_string()]),
            RiskClass::Risky,
            "composer install should remain Risky"
        );
        assert_eq!(
            classify_command("composer", &["update".to_string()]),
            RiskClass::Risky,
            "composer update should remain Risky"
        );
    }

    #[test]
    fn h2_gradle_build_risky() {
        assert_eq!(
            classify_command("gradle", &["build".to_string()]),
            RiskClass::Risky,
            "gradle build should be Risky"
        );
        assert_eq!(
            classify_command("gradle", &["assemble".to_string()]),
            RiskClass::Risky,
            "gradle assemble should be Risky (blanket-risky)"
        );
    }

    #[test]
    fn h2_cargo_bench_risky() {
        assert_eq!(
            classify_command("cargo", &["bench".to_string()]),
            RiskClass::Risky,
            "cargo bench should be Risky"
        );
        assert_eq!(
            classify_command("cargo", &["test".to_string()]),
            RiskClass::Risky,
            "cargo test should remain Risky"
        );
        assert_eq!(
            classify_command("cargo", &["build".to_string()]),
            RiskClass::Risky,
            "cargo build should remain Risky"
        );
        assert_eq!(
            classify_command("cargo", &["clippy".to_string()]),
            RiskClass::Risky,
            "cargo clippy should remain Risky"
        );
        assert_eq!(
            classify_command("cargo", &["run".to_string()]),
            RiskClass::Risky,
            "cargo run should remain Risky"
        );
    }

    #[tokio::test]
    async fn test_r5_h1_filesystem_tool_refuses_git_dir_and_file() {
        let dir = std::env::temp_dir().join("r5-h1-filesystem-git-guard-test");
        let _ = std::fs::create_dir_all(&dir);
        let executor = FilesystemToolExecutor::new(&dir);

        // 1. Direct write_file attempts to .git directory or files under it
        let check_refused = |path: &str| {
            let res = executor.write_file(path, "malicious payload");
            assert!(
                matches!(res, Ok(r) if !r.success),
                "write to {path} must be refused"
            );
        };

        check_refused(".git");
        check_refused(".git/config");
        check_refused(".git//config");
        check_refused(".git/./config");
        check_refused(".GIT/config");
        check_refused(".Git/config");
        check_refused("sub/.git/hooks/pre-commit");
        check_refused("sub/.git");

        // 2. Through AgentTool::WriteFile execution
        let res = executor
            .execute(&AgentTool::WriteFile {
                path: ".git/config".to_string(),
                content: "malicious".to_string(),
            })
            .await;
        assert!(
            !res.success,
            "AgentTool::WriteFile to .git/config must fail"
        );

        let res2 = executor
            .execute(&AgentTool::WriteFile {
                path: ".git".to_string(),
                content: "malicious".to_string(),
            })
            .await;
        assert!(!res2.success, "AgentTool::WriteFile to .git must fail");

        // 3. Negative controls: innocent files must be writable
        let res_ok = executor.write_file("src/main.rs", "fn main() {}");
        assert!(
            matches!(res_ok, Ok(r) if r.success),
            "ordinary source file must be writable"
        );

        let res_config_txt = executor.write_file("git-config.txt", "notes");
        assert!(
            matches!(res_config_txt, Ok(r) if r.success),
            "git-config.txt must be writable"
        );

        let res_l1 = executor.write_file("fix-.git/config-handling.txt", "notes");
        assert!(
            matches!(res_l1, Ok(r) if r.success),
            "fix-.git/config-handling.txt must be writable (R5-L1 fix)"
        );
    }

    #[test]
    fn test_r5_h1_git_command_policy_and_classification() {
        let policy = CommandPolicy::from_config(&["git".to_string(), "echo".to_string()]);

        // 1. --git-dir with repo-like target
        assert!(
            policy.check_command("git --git-dir=alt status").is_err(),
            "git --git-dir=alt must be refused"
        );
        assert!(
            policy
                .check_command("git --git-dir /tmp/alt status")
                .is_err(),
            "git --git-dir /tmp/alt must be refused"
        );
        assert_eq!(
            classify_command("git", &["--git-dir=alt".to_string(), "status".to_string()]),
            RiskClass::Risky,
            "git --git-dir=alt must be Risky"
        );

        // 2. -C with repo-like target
        assert!(
            policy.check_command("git -C sub status").is_err(),
            "git -C sub must be refused"
        );
        assert!(
            policy.check_command("git -C /tmp status").is_err(),
            "git -C /tmp must be refused"
        );
        assert_eq!(
            classify_command(
                "git",
                &["-C".to_string(), "sub".to_string(), "status".to_string()]
            ),
            RiskClass::Risky,
            "git -C sub must be Risky"
        );

        // 3. git config writes in ANY form
        assert!(
            policy
                .check_command("git config set alias.q '!touch /tmp/pwn'")
                .is_err(),
            "git config set alias.q must be refused"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "config".to_string(),
                    "set".to_string(),
                    "alias.q".to_string(),
                    "!touch /tmp/pwn".to_string(),
                ]
            ),
            RiskClass::Risky,
            "git config set alias.q must be Risky"
        );
        assert!(
            policy
                .check_command("git config alias.q '!touch /tmp/pwn'")
                .is_err(),
            "git config alias.q must be refused"
        );
        assert!(
            policy.check_command("git config user.name Alice").is_err(),
            "git config user.name Alice must be refused"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "config".to_string(),
                    "user.name".to_string(),
                    "Alice".to_string(),
                ]
            ),
            RiskClass::Risky,
            "git config user.name Alice must be Risky"
        );
        assert!(
            policy
                .check_command("git config --add core.editor nano")
                .is_err(),
            "git config --add must be refused"
        );

        // 4. grep -O / --open-files-in-pager
        assert!(
            policy.check_command("git grep -O/bin/sh foo").is_err(),
            "git grep -O must be refused"
        );
        assert!(
            policy
                .check_command("git grep --open-files-in-pager=/bin/sh foo")
                .is_err(),
            "git grep --open-files-in-pager must be refused"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "grep".to_string(),
                    "-O/bin/sh".to_string(),
                    "foo".to_string()
                ]
            ),
            RiskClass::Risky,
            "git grep -O must be Risky"
        );

        // 5. --upload-pack / --receive-pack
        assert!(
            policy
                .check_command("git ls-remote --upload-pack=node origin")
                .is_err(),
            "git ls-remote --upload-pack must be refused"
        );
        assert!(
            policy
                .check_command("git fetch --upload-pack=node origin")
                .is_err(),
            "git fetch --upload-pack must be refused"
        );
        assert!(
            policy
                .check_command("git push --receive-pack=node origin")
                .is_err(),
            "git push --receive-pack must be refused"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "ls-remote".to_string(),
                    "--upload-pack=node".to_string(),
                    "origin".to_string(),
                ]
            ),
            RiskClass::Risky,
            "git ls-remote --upload-pack must be Risky"
        );

        // 6. difftool -x
        assert!(
            policy.check_command("git difftool -x /bin/sh").is_err(),
            "git difftool -x must be refused"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "difftool".to_string(),
                    "-x".to_string(),
                    "/bin/sh".to_string(),
                ]
            ),
            RiskClass::Risky,
            "git difftool -x must be Risky"
        );

        // Negative controls:
        // R5-L1: git commit -m with .git/config in commit message must NOT be refused
        assert!(
            policy
                .check_command("git commit -m \"fix .git/config handling\"")
                .is_ok(),
            "git commit -m with .git/config in message must pass"
        );
        assert!(
            policy
                .check_command("git commit -m fix-.git/config-handling")
                .is_ok(),
            "git commit -m fix-.git/config-handling must pass"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "commit".to_string(),
                    "-m".to_string(),
                    "fix .git/config handling".to_string(),
                ]
            ),
            RiskClass::Safe,
            "git commit -m with .git/config must be Safe"
        );

        // R5-L2: empty fsmonitor value is Safe
        assert!(
            policy
                .check_command("git -c core.fsmonitor= status")
                .is_ok(),
            "empty core.fsmonitor must be allowed"
        );
        assert!(
            policy
                .check_command("git -c core.fsmonitor=\"\" status")
                .is_ok(),
            "empty core.fsmonitor must be allowed"
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "core.fsmonitor=".to_string(),
                    "status".to_string(),
                ]
            ),
            RiskClass::Safe,
            "empty core.fsmonitor must be Safe"
        );

        // R5-L2: user.name=!x is Safe (only program-running keys treat ! as risky)
        assert!(
            policy.check_command("git -c user.name=!x status").is_ok(),
            "git -c user.name=!x must be allowed"
        );

        // Normal git commands
        assert!(
            policy.check_command("git --git-dir=.git status").is_ok(),
            "git --git-dir=.git status must be allowed"
        );
        assert!(
            policy.check_command("git -C . status").is_ok(),
            "git -C . status must be allowed"
        );
        assert!(
            policy.check_command("git -C ./ status").is_ok(),
            "git -C ./ status must be allowed"
        );
        assert!(
            policy.check_command("git status").is_ok(),
            "git status must be allowed"
        );
        assert_eq!(
            classify_command("git", &["status".to_string()]),
            RiskClass::Safe,
            "git status must be Safe"
        );
    }

    #[test]
    fn test_r5_h2_node_classifier_bugs() {
        // bare help treated as script path by node -> Risky
        assert_eq!(
            classify_command("node", &["help".to_string()]),
            RiskClass::Risky,
            "node help must be Risky"
        );
        assert_eq!(
            classify_command("nodejs", &["help".to_string()]),
            RiskClass::Risky,
            "nodejs help must be Risky"
        );

        // attached flags starting with '-' and containing '=' must NOT be skipped
        assert_eq!(
            classify_command("node", &["--run=build".to_string()]),
            RiskClass::Risky,
            "node --run=build must be Risky"
        );
        assert_eq!(
            classify_command("node", &["--import=./imp.mjs".to_string()]),
            RiskClass::Risky,
            "node --import= must be Risky"
        );
        assert_eq!(
            classify_command("node", &["--require=./req.js".to_string()]),
            RiskClass::Risky,
            "node --require= must be Risky"
        );
        assert_eq!(
            classify_command("node", &["--loader=./load.mjs".to_string()]),
            RiskClass::Risky,
            "node --loader= must be Risky"
        );
        assert_eq!(
            classify_command("node", &["--experimental-loader=./exp.mjs".to_string()]),
            RiskClass::Risky,
            "node --experimental-loader= must be Risky"
        );
        assert_eq!(
            classify_command("node", &["--eval=1+1".to_string()]),
            RiskClass::Risky,
            "node --eval= must be Risky"
        );
        assert_eq!(
            classify_command("node", &["--print=1".to_string()]),
            RiskClass::Risky,
            "node --print= must be Risky"
        );

        // Negative controls: safe flags remain Safe
        assert_eq!(
            classify_command("node", &["--version".to_string()]),
            RiskClass::Safe,
            "node --version must be Safe"
        );
        assert_eq!(
            classify_command("node", &["-v".to_string()]),
            RiskClass::Safe,
            "node -v must be Safe"
        );
        assert_eq!(
            classify_command("node", &["--help".to_string()]),
            RiskClass::Safe,
            "node --help must be Safe"
        );
        assert_eq!(
            classify_command("node", &["-h".to_string()]),
            RiskClass::Safe,
            "node -h must be Safe"
        );
    }

    #[test]
    fn test_r5_h3_safe_subcommand_allow_lists() {
        // 1. npm safe reads vs risky operations
        assert_eq!(
            classify_command("npm", &["--version".to_string()]),
            RiskClass::Safe,
            "npm --version must be Safe"
        );
        assert_eq!(
            classify_command("npm", &["-v".to_string()]),
            RiskClass::Safe,
            "npm -v must be Safe"
        );
        assert_eq!(
            classify_command("npm", &["--help".to_string()]),
            RiskClass::Safe,
            "npm --help must be Safe"
        );
        assert_eq!(
            classify_command("npm", &["list".to_string()]),
            RiskClass::Safe,
            "npm list must be Safe"
        );
        assert_eq!(
            classify_command("npm", &["ls".to_string()]),
            RiskClass::Safe,
            "npm ls must be Safe"
        );
        assert_eq!(
            classify_command("npm", &["view".to_string(), "react".to_string()]),
            RiskClass::Safe,
            "npm view must be Safe"
        );
        assert_eq!(
            classify_command("npm", &["info".to_string(), "react".to_string()]),
            RiskClass::Safe,
            "npm info must be Safe"
        );
        assert_eq!(
            classify_command("npm", &["outdated".to_string()]),
            RiskClass::Safe,
            "npm outdated must be Safe"
        );
        assert_eq!(
            classify_command("npm", &["audit".to_string()]),
            RiskClass::Safe,
            "npm audit must be Safe"
        );
        assert_eq!(
            classify_command("npm", &["licenses".to_string()]),
            RiskClass::Safe,
            "npm licenses must be Safe"
        );

        // npm risky commands
        assert_eq!(
            classify_command("npm", &["pack".to_string()]),
            RiskClass::Risky,
            "npm pack must be Risky"
        );
        assert_eq!(
            classify_command("npm", &["version".to_string()]),
            RiskClass::Risky,
            "npm version must be Risky"
        );
        assert_eq!(
            classify_command("npm", &["link".to_string()]),
            RiskClass::Risky,
            "npm link must be Risky"
        );
        assert_eq!(
            classify_command("npm", &["prune".to_string()]),
            RiskClass::Risky,
            "npm prune must be Risky"
        );
        assert_eq!(
            classify_command("npm", &["dedupe".to_string()]),
            RiskClass::Risky,
            "npm dedupe must be Risky"
        );
        assert_eq!(
            classify_command("npm", &["install-test".to_string()]),
            RiskClass::Risky,
            "npm install-test must be Risky"
        );
        assert_eq!(
            classify_command("npm", &[]),
            RiskClass::Risky,
            "bare npm must be Risky"
        );

        // 2. sqlite3 risky arguments
        let policy = CommandPolicy::from_config(&["sqlite3".to_string()]);
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".shell whoami".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".shel id".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".system calc".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".syst ls".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".read evil.sql".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".import data tbl".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &[
                    "-init".to_string(),
                    "evil.sql".to_string(),
                    "db.sqlite".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &[
                    "--init".to_string(),
                    "evil.sql".to_string(),
                    "db.sqlite".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".load ./ext".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "sqlite3",
                &["db.sqlite".to_string(), ".sh whoami".to_string()]
            ),
            RiskClass::Risky
        );
        assert!(policy
            .check_command("sqlite3 db.sqlite \".shell whoami\"")
            .is_err());
        assert!(policy
            .check_command("sqlite3 db.sqlite \".load ./ext\"")
            .is_err());
        assert!(policy
            .check_command("sqlite3 -init evil.sql db.sqlite")
            .is_err());

        // 3. php & deno
        assert_eq!(
            classify_command("php", &["test.php".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(classify_command("php", &[]), RiskClass::Risky);
        assert_eq!(
            classify_command("php", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("php", &["-v".to_string()]),
            RiskClass::Safe
        );

        assert_eq!(
            classify_command("deno", &["run".to_string(), "app.ts".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("deno", &["serve".to_string(), "app.ts".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("deno", &["bench".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("deno", &["install".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("deno", &["x".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("deno", &["app.ts".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("deno", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("deno", &["lint".to_string()]),
            RiskClass::Safe
        );

        // 4. dotnet
        assert_eq!(
            classify_command("dotnet", &["build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("dotnet", &["msbuild".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("dotnet", &["pack".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("dotnet", &["publish".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("dotnet", &["restore".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("dotnet", &["test".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("dotnet", &["run".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("dotnet", &["--version".to_string()]),
            RiskClass::Safe
        );

        // 5. cargo
        assert_eq!(
            classify_command("cargo", &["doc".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["fix".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["rustc".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["package".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["bench".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["--version".to_string()]),
            RiskClass::Safe
        );

        // 6. composer
        assert_eq!(
            classify_command("composer", &["dump-autoload".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("composer", &["run".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("composer", &["run-script".to_string(), "test".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("composer", &["exec".to_string(), "whoami".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("composer", &["--version".to_string()]),
            RiskClass::Safe
        );

        // 7. mvn
        assert_eq!(
            classify_command("mvn", &["compile".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("mvn", &["test".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("mvn", &["package".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("mvn", &["validate".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("mvn", &["--version".to_string()]),
            RiskClass::Safe
        );

        // 8. rails
        assert_eq!(
            classify_command("rails", &["server".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("rails", &["console".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("rails", &["test".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("rails", &["db:migrate".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("rails", &["generate".to_string(), "model".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("rails", &["--version".to_string()]),
            RiskClass::Safe
        );

        // 9. bundle
        assert_eq!(
            classify_command("bundle", &["list".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("bundle", &["check".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("bundle", &["--version".to_string()]),
            RiskClass::Safe
        );

        // 10. go
        assert_eq!(
            classify_command("go", &["build".to_string(), "-toolexec=evil".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("go", &["vet".to_string(), "-vettool=evil".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("go", &["version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("go", &["env".to_string()]),
            RiskClass::Safe
        );

        // 11. vite / next
        assert_eq!(
            classify_command("vite", &["dev".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("vite", &["build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("vite", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("next", &["dev".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("next", &["build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("next", &["--version".to_string()]),
            RiskClass::Safe
        );

        // 12. eslint ANY invocation Risky
        assert_eq!(
            classify_command("eslint", &["src/".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("eslint", &["--version".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(classify_command("eslint", &[]), RiskClass::Risky);

        // 13. cmake
        assert_eq!(
            classify_command(
                "cmake",
                &[
                    "-S".to_string(),
                    ".".to_string(),
                    "-B".to_string(),
                    "build".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["configure".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["--build".to_string(), ".".to_string()]),
            RiskClass::Risky
        );

        // 14. javac & rustc ANY invocation Risky
        assert_eq!(
            classify_command("javac", &["Foo.java".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("javac", &["-version".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("rustc", &["main.rs".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("rustc", &["--version".to_string()]),
            RiskClass::Risky
        );

        // 15. yarn bare Risky, all yarn Risky (R6-H6)
        assert_eq!(classify_command("yarn", &[]), RiskClass::Risky);
        assert_eq!(
            classify_command("yarn", &["--version".to_string()]),
            RiskClass::Risky
        );

        // 16. prettier / pocketbase / bun
        assert_eq!(
            classify_command("prettier", &["--config".to_string(), "evil.js".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("prettier", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("bun", &["run".to_string(), "build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("bun", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("pocketbase", &["serve".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pocketbase", &["--version".to_string()]),
            RiskClass::Safe
        );
    }

    #[tokio::test]
    async fn test_r5_ask_for_risky_routes_to_approval() {
        let dir = std::env::temp_dir().join("r5-ask-for-risky-plumbing-test");
        let _ = std::fs::create_dir_all(&dir);
        let approvals = Arc::new(McpApprovals::new(None));
        let policy = WorkProtectionPolicy {
            mode: PermissionMode::AskForRisky,
            snapshot_before_edit: false,
            worktree_isolation: false,
            read_before_write: false,
        };
        let executor = FilesystemToolExecutor::new(&dir)
            .with_command_policy(CommandPolicy::from_config(&[
                "npm".to_string(),
                "node".to_string(),
                "git".to_string(),
            ]))
            .with_protection(Some(policy))
            .with_mcp_approvals(approvals.clone(), Some("run-r5-plumbing".to_string()));

        // Risky command: npm pack must be queued for approval and refused
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "npm".to_string(),
                args: vec!["pack".to_string()],
            })
            .await;
        assert!(!res.success, "npm pack must be refused under AskForRisky");
        assert_eq!(approvals.pending().len(), 1, "npm pack must queue approval");

        // Risky command: node --run=build must be queued for approval and refused
        let res2 = executor
            .execute(&AgentTool::RunCommand {
                command: "node".to_string(),
                args: vec!["--run=build".to_string()],
            })
            .await;
        assert!(
            !res2.success,
            "node --run=build must be refused under AskForRisky"
        );
        assert_eq!(
            approvals.pending().len(),
            2,
            "node --run=build must queue approval"
        );
    }

    #[test]
    fn test_r6_h1_git_class_shapes() {
        let policy = CommandPolicy::from_config(&["git".to_string()]);

        // 1. --bare anywhere before subcommand is refused and classified Risky
        assert_eq!(
            classify_command("git", &["--bare".to_string(), "status".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-C".to_string(),
                    ".".to_string(),
                    "--bare".to_string(),
                    "log".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert!(policy.check_command("git --bare status").is_err());
        assert!(policy.check_command("git -C . --bare log").is_err());

        // 2. fetch-pack --exec / --exec= is refused and classified Risky
        assert_eq!(
            classify_command(
                "git",
                &[
                    "fetch-pack".to_string(),
                    "--exec=/bin/sh".to_string(),
                    "/path".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "fetch-pack".to_string(),
                    "--exec".to_string(),
                    "/bin/sh".to_string(),
                    "/path".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert!(policy
            .check_command("git fetch-pack --exec=/bin/sh /path")
            .is_err());
        assert!(policy
            .check_command("git fetch-pack --exec /bin/sh /path")
            .is_err());

        // 3. -c include.path / includeIf.* overrides
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "include.path=/evil".to_string(),
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
                    "includeif.gitdir:/foo.path=/evil".to_string(),
                    "status".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert!(policy
            .check_command("git -c include.path=/evil status")
            .is_err());
        assert!(policy
            .check_command("git -c includeif.gitdir:/foo.path=/evil status")
            .is_err());

        // 4. -c protocol.ext.allow=always + ext:: transport target
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "protocol.ext.allow=always".to_string(),
                    "clone".to_string(),
                    "ext::sh%s-c%sevil".to_string(),
                    "dst".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "clone".to_string(),
                    "ext::sh%s-c%sevil".to_string(),
                    "dst".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert!(policy
            .check_command("git -c protocol.ext.allow=always clone ext::sh%s-c%sevil dst")
            .is_err());
        assert!(policy
            .check_command("git clone ext::sh%s-c%sevil dst")
            .is_err());

        // 5. filter-branch subcommand outright refused
        assert_eq!(
            classify_command(
                "git",
                &[
                    "filter-branch".to_string(),
                    "--tree-filter".to_string(),
                    "rm -f file".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert!(policy
            .check_command("git filter-branch --tree-filter 'rm -f file'")
            .is_err());

        // 6. init --template / clone --template refused
        assert_eq!(
            classify_command(
                "git",
                &["init".to_string(), "--template=/evil/tpl".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "init".to_string(),
                    "--template".to_string(),
                    "/evil/tpl".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "clone".to_string(),
                    "--template=/evil/tpl".to_string(),
                    "repo".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert!(policy
            .check_command("git init --template=/evil/tpl")
            .is_err());
        assert!(policy
            .check_command("git init --template /evil/tpl")
            .is_err());
        assert!(policy
            .check_command("git clone --template=/evil/tpl repo")
            .is_err());

        // 7. git safe global options vs unknown flags
        assert_eq!(
            classify_command(
                "git",
                &["-C".to_string(), ".".to_string(), "status".to_string()]
            ),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("git", &["--git-dir=.git".to_string(), "status".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command(
                "git",
                &["--unknown-global-opt".to_string(), "status".to_string()]
            ),
            RiskClass::Risky
        );
    }

    #[test]
    fn test_r6_h2_exec_bit_chain() {
        let policy =
            CommandPolicy::from_config(&["git".to_string(), "npm".to_string(), "node".to_string()]);

        // git apply must be Risky in classify_command AND refused in command_policy
        assert_eq!(
            classify_command("git", &["apply".to_string(), "patch.diff".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "apply".to_string(),
                    "--index".to_string(),
                    "patch.diff".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert!(policy.check_command("git apply patch.diff").is_err());
        assert!(policy
            .check_command("git apply --index patch.diff")
            .is_err());

        // Workspace-relative executable bypass: ./npm, ./git, ./bin/tool, sub/tool must NEVER match bare allow-list
        assert!(policy.check_command("./npm --version").is_err());
        assert!(policy.check_command("./git status").is_err());
        assert!(policy.check_command("./bin/tool").is_err());
        assert!(policy.check_command("sub/tool").is_err());
        assert!(policy.check_command("../evil/tool").is_err());

        assert_eq!(
            classify_command("./npm", &["--version".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(classify_command("./bin/tool", &[]), RiskClass::Risky);
        assert_eq!(classify_command("sub/tool", &[]), RiskClass::Risky);
        assert_eq!(classify_command("../evil/tool", &[]), RiskClass::Risky);
    }

    #[test]
    fn test_r6_h3_node_safe_allow_list() {
        // Safe allow-list: ONLY --version, -v, -V, --help, -h
        assert_eq!(
            classify_command("node", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("node", &["-v".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("node", &["-V".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("node", &["--help".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("node", &["-h".to_string()]),
            RiskClass::Safe
        );

        // Risky: env-file, experimental-config-file, interactive, bare, stdin, script, = flag
        assert_eq!(
            classify_command("node", &["--env-file=.env".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["--env-file-if-exists=.env".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "node",
                &["--experimental-config-file=evil.json".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "node",
                &["--experimental-default-config-file=evil.json".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["-i".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["--interactive".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(classify_command("node", &[]), RiskClass::Risky);
        assert_eq!(
            classify_command("node", &["-".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["script.js".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["--version=evil".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("node", &["--test".to_string()]),
            RiskClass::Risky
        );
    }

    #[test]
    fn test_r6_h4_cmake_allow_list() {
        // Safe read-only introspection
        assert_eq!(
            classify_command("cmake", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["-v".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["-V".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["--help".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["-h".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["--system-information".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["--help-commands".to_string()]),
            RiskClass::Safe
        );
        // Corrected in R7-H6: -L/-LA/-LH configure the cwd and execute CMakeLists.txt (Risky);
        // only -N-bearing combos are inert cache-listing views (Safe).
        assert_eq!(
            classify_command("cmake", &["-L".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-LA".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-LH".to_string()]),
            RiskClass::Risky
        );
        // Under R8-N4, compound letter combinations like -LN are Risky;
        // only exact separate tokens (-N, -L, -LA, -LH, -LAH) with -N are Safe.
        assert_eq!(
            classify_command("cmake", &["-LN".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-N".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["-N".to_string(), "-L".to_string()]),
            RiskClass::Safe
        );

        // Risky configure/build/install/preset/workflow forms
        assert_eq!(
            classify_command("cmake", &[".".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["src".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["--preset".to_string(), "debug".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["--build".to_string(), ".".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "cmake",
                &[
                    "--workflow".to_string(),
                    "--preset".to_string(),
                    "build".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["--install".to_string(), "build".to_string()]),
            RiskClass::Risky
        );
    }

    #[test]
    fn test_r6_h5_all_args_scan() {
        // Cargo: -v removed from safe list (fixes cargo -v doc bypass)
        assert_eq!(
            classify_command("cargo", &["-v".to_string(), "doc".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["-v".to_string(), "fix".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["-v".to_string(), "package".to_string()]),
            RiskClass::Risky
        );
        // Corrected in R7-H7: cargo tree/metadata trigger rustc-wrapper via .cargo/config.toml (Risky)
        assert_eq!(
            classify_command("cargo", &["tree".to_string(), "--version".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["--version".to_string()]),
            RiskClass::Safe
        );

        // All-args scan on npm
        assert_eq!(
            classify_command(
                "npm",
                &[
                    "--version".to_string(),
                    "run".to_string(),
                    "build".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("npm", &["--version".to_string()]),
            RiskClass::Safe
        );

        // All-args scan on deno
        assert_eq!(
            classify_command(
                "deno",
                &[
                    "--version".to_string(),
                    "run".to_string(),
                    "evil.ts".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("deno", &["--version".to_string()]),
            RiskClass::Safe
        );

        // All-args scan on dotnet
        assert_eq!(
            classify_command("dotnet", &["--version".to_string(), "run".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("dotnet", &["--version".to_string()]),
            RiskClass::Safe
        );

        // All-args scan on composer
        assert_eq!(
            classify_command("composer", &["--version".to_string(), "exec".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("composer", &["--version".to_string()]),
            RiskClass::Safe
        );

        // All-args scan on rails
        assert_eq!(
            classify_command("rails", &["--version".to_string(), "server".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("rails", &["--version".to_string()]),
            RiskClass::Safe
        );

        // All-args scan on bundle
        assert_eq!(
            classify_command("bundle", &["--version".to_string(), "exec".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("bundle", &["--version".to_string()]),
            RiskClass::Safe
        );

        // All-args scan on go
        assert_eq!(
            classify_command("go", &["version".to_string(), "build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("go", &["version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("go", &["-toolexec=evil".to_string(), "version".to_string()]),
            RiskClass::Risky
        );

        // All-args scan on vite / next
        assert_eq!(
            classify_command("vite", &["--version".to_string(), "build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("vite", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("next", &["--version".to_string(), "build".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("next", &["--version".to_string()]),
            RiskClass::Safe
        );

        // All-args scan on bun
        assert_eq!(
            classify_command("bun", &["--version".to_string(), "run".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("bun", &["--version".to_string()]),
            RiskClass::Safe
        );

        // All-args scan on pocketbase
        assert_eq!(
            classify_command(
                "pocketbase",
                &["--version".to_string(), "serve".to_string()]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pocketbase", &["--version".to_string()]),
            RiskClass::Safe
        );
    }

    #[test]
    fn test_r6_h6_pnpm_yarn_all_risky() {
        // pnpm: executes .pnpmfile.cjs on every invocation, all Risky
        assert_eq!(
            classify_command("pnpm", &["--version".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pnpm", &["list".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("pnpm", &["why".to_string(), "foo".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(classify_command("pnpm", &[]), RiskClass::Risky);
        assert_eq!(
            classify_command("pnpm", &["run".to_string(), "build".to_string()]),
            RiskClass::Risky
        );

        // yarn: honors yarnPath config, all Risky
        assert_eq!(
            classify_command("yarn", &["--version".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("yarn", &["list".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("yarn", &["why".to_string(), "foo".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(classify_command("yarn", &[]), RiskClass::Risky);
    }

    #[test]
    fn test_r7_h1_git_info_flags_safe() {
        // H-1: info-only git global flags classify Safe
        assert_eq!(
            classify_command("git", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("git", &["-v".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("git", &["-V".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("git", &["--help".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("git", &["-h".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("git", &["--no-pager".to_string(), "--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("git", &["-P".to_string(), "--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command(
                "git",
                &["--literal-pathspecs".to_string(), "--version".to_string()]
            ),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("git", &["-p".to_string(), "--version".to_string()]),
            RiskClass::Safe
        );
    }

    #[test]
    fn test_r7_h2_h3_h4_git_subcommand_and_config_allow_list() {
        let policy = CommandPolicy::from_config(&["git".to_string()]);

        // Repro 1: unknown/arbitrary git subcommand (git zz) in bare repo or workspace
        assert_eq!(
            classify_command("git", &["zz".to_string()]),
            RiskClass::Risky
        );

        // Repro 2: one-command shells via non-allowlisted -c keys
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "man.viewer=zz".to_string(),
                    "-c".to_string(),
                    "man.zz.cmd=sh".to_string(),
                    "help".to_string(),
                    "-m".to_string(),
                    "status".to_string(),
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "remote.origin.url=.".to_string(),
                    "-c".to_string(),
                    "remote.origin.uploadpack=sh".to_string(),
                    "ls-remote".to_string(),
                    "origin".to_string(),
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "difftool.y.cmd=sh".to_string(),
                    "difftool".to_string(),
                    "-y".to_string(),
                    "-t".to_string(),
                    "y".to_string(),
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "web.browser=zz".to_string(),
                    "-c".to_string(),
                    "browser.zz.cmd=sh".to_string(),
                    "web--browse".to_string(),
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "diff.x.command=sh".to_string(),
                    "diff".to_string(),
                ]
            ),
            RiskClass::Risky
        );

        // Repro 3: templateDir hook injection
        assert_eq!(
            classify_command(
                "git",
                &[
                    "-c".to_string(),
                    "init.templateDir=tpl".to_string(),
                    "init".to_string(),
                ]
            ),
            RiskClass::Risky
        );

        // Repro 4: git hook run
        assert_eq!(
            classify_command(
                "git",
                &[
                    "hook".to_string(),
                    "run".to_string(),
                    "pre-commit".to_string(),
                ]
            ),
            RiskClass::Risky
        );

        // Repro 5: git plumbing execution/staging subcommands are all Risky
        assert_eq!(
            classify_command("git", &["am".to_string(), "patch.mbox".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "update-index".to_string(),
                    "--chmod=+x".to_string(),
                    "x/npm".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "checkout-index".to_string(),
                    "-f".to_string(),
                    "x/npm".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "hash-object".to_string(),
                    "-w".to_string(),
                    "payload".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "read-tree".to_string(),
                    "-u".to_string(),
                    "HEAD".to_string()
                ]
            ),
            RiskClass::Risky
        );

        // Stash list-level read-only vs write
        assert_eq!(
            classify_command("git", &["stash".to_string(), "list".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("git", &["stash".to_string(), "show".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("git", &["stash".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("git", &["stash".to_string(), "pop".to_string()]),
            RiskClass::Risky
        );

        // Bisect run vs start
        assert_eq!(
            classify_command(
                "git",
                &[
                    "bisect".to_string(),
                    "run".to_string(),
                    "./test.sh".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("git", &["bisect".to_string(), "start".to_string()]),
            RiskClass::Safe
        );

        // Grep -O vs pure grep
        assert_eq!(
            classify_command(
                "git",
                &[
                    "grep".to_string(),
                    "-O/bin/sh".to_string(),
                    "pattern".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("git", &["grep".to_string(), "pattern".to_string()]),
            RiskClass::Safe
        );

        // CommandPolicy verifies that non-allowlisted -c keys fail closed
        assert!(policy
            .check_command("git -c man.viewer=zz help -m status")
            .is_err());
        assert!(policy
            .check_command("git -c remote.origin.uploadpack=sh ls-remote origin")
            .is_err());
        assert!(policy
            .check_command("git -c difftool.y.cmd=sh difftool -y")
            .is_err());
        assert!(policy
            .check_command("git -c diff.x.command=sh diff")
            .is_err());
        assert!(policy
            .check_command("git -c init.templateDir=tpl init")
            .is_err());

        // Inert allowed -c keys remain admitted
        assert!(policy
            .check_command("git -c user.name=Alice commit")
            .is_ok());
        assert!(policy.check_command("git -c color.ui=always log").is_ok());
        assert!(policy.check_command("git -c core.fsmonitor= diff").is_ok());
        assert!(policy
            .check_command("git -c core.autocrlf=false status")
            .is_ok());
    }

    #[test]
    fn test_r7_h5_absolute_path_workspace_confinement() {
        let temp_dir_res = tempfile::tempdir();
        assert!(temp_dir_res.is_ok());
        let Ok(temp_dir) = temp_dir_res else {
            return;
        };
        let ws_path = temp_dir.path();
        let tool_dir = ws_path.join("x");
        assert!(std::fs::create_dir_all(&tool_dir).is_ok());
        let tool_path = tool_dir.join("npm");
        assert!(std::fs::write(&tool_path, "#!/bin/sh\necho evil\n").is_ok());

        let policy = CommandPolicy::from_config(&["npm".to_string()]);
        let tool_str = tool_path.to_string_lossy().to_string();

        // 1. Absolute path resolving inside workspace must NOT match allow-list "npm" by basename
        let check_res = policy.check_invocation_with_workdir(
            &tool_str,
            &["--version".to_string()],
            Some(ws_path),
        );
        assert!(
            check_res.is_err(),
            "workspace-resolving path `{tool_str}` was admitted by CommandPolicy"
        );

        let risk =
            classify_command_with_workdir(&tool_str, &["--version".to_string()], Some(ws_path));
        assert_eq!(
            risk,
            RiskClass::Risky,
            "workspace-resolving path `{tool_str}` was classified Safe"
        );

        // 2. Absolute path outside workspace: under R8-N3, any path-spelled program outside
        // the workspace that does not resolve to the canonical PATH tool is refused (Err in check)
        // and classifies Risky.
        let other_dir_res = tempfile::tempdir();
        assert!(other_dir_res.is_ok());
        let Ok(other_dir) = other_dir_res else {
            return;
        };
        let external_tool = other_dir.path().join("npm");
        assert!(std::fs::write(&external_tool, "#!/bin/sh\n").is_ok());
        let ext_str = external_tool.to_string_lossy().to_string();

        let check_ext = policy.check_invocation_with_workdir(
            &ext_str,
            &["--version".to_string()],
            Some(ws_path),
        );
        assert!(
            check_ext.is_err(),
            "external tool `{ext_str}` outside workspace not on PATH must be refused (R8-N3)"
        );
        assert_eq!(
            classify_command_with_workdir(&ext_str, &["--version".to_string()], Some(ws_path),),
            RiskClass::Risky,
            "external tool `{ext_str}` outside workspace not on PATH must classify Risky (R8-N3)"
        );

        // 3. Git plumbing exec bit vectors all classify Risky
        assert_eq!(
            classify_command("git", &["am".to_string(), "patch.mbox".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "update-index".to_string(),
                    "--chmod=+x".to_string(),
                    "x/npm".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "checkout-index".to_string(),
                    "-f".to_string(),
                    "x/npm".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "hash-object".to_string(),
                    "-w".to_string(),
                    "payload".to_string()
                ]
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "git",
                &[
                    "read-tree".to_string(),
                    "-u".to_string(),
                    "HEAD".to_string()
                ]
            ),
            RiskClass::Risky
        );
    }

    #[test]
    fn test_r7_h6_cmake_configure_forms_risky() {
        // H-6: cmake configure forms (-L, -LA, -LH, -LAH) without -N are Risky;
        // only -N-bearing forms or inert info flags are Safe.
        assert_eq!(
            classify_command("cmake", &["-L".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-LA".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-LH".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-LAH".to_string()]),
            RiskClass::Risky
        );

        // R8-N4: compound letter combinations like -LN, -HN, -HLN are Risky;
        // only exact separate tokens (-N, -L, -LA, -LH, -LAH) with -N are Safe.
        assert_eq!(
            classify_command("cmake", &["-LN".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-HN".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-HLN".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-HAN".to_string()]),
            RiskClass::Risky
        );

        // Safe -N bearing forms (separate exact tokens)
        assert_eq!(
            classify_command("cmake", &["-N".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["-N".to_string(), "-L".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["-LA".to_string(), "-N".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["-N".to_string(), "-LAH".to_string()]),
            RiskClass::Safe
        );

        // Safe introspection
        assert_eq!(
            classify_command("cmake", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["--help".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["--system-information".to_string()]),
            RiskClass::Safe
        );
    }

    #[test]
    fn test_r7_h7_cargo_tree_metadata_risky() {
        // H-7: cargo tree & cargo metadata invoke rustc/rustc-wrapper and must classify Risky
        assert_eq!(
            classify_command("cargo", &["tree".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cargo", &["metadata".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command(
                "cargo",
                &["metadata".to_string(), "--format-version=1".to_string()]
            ),
            RiskClass::Risky
        );

        // Inert cargo commands remain Safe
        assert_eq!(
            classify_command("cargo", &["--version".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cargo", &["-V".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cargo", &["--help".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cargo", &["verify-project".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cargo", &["locate-project".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cargo", &["read-manifest".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cargo", &["report".to_string()]),
            RiskClass::Safe
        );
    }

    // =========================================================================
    // Round-8 Proving Tests (R8-N1 through R8-N4) driving FilesystemToolExecutor
    // =========================================================================

    #[tokio::test]
    async fn test_r8_n1_bare_shape_fsmonitor_refused_e2e() {
        // N-1: bare-repo-shaped workspace (root has HEAD, objects/, refs/, no .git/)
        // and allow-listed git status runs agent-controlled config (core.fsmonitor).
        // Under R8-N1, bare-repo workspaces classify ANY git invocation as Risky,
        // command policy refuses git, and GIT_CONFIG_NOSYSTEM=1 prevents system config escapes.
        let td_res = tempfile::tempdir();
        assert!(td_res.is_ok());
        let Ok(td) = td_res else {
            return;
        };
        let dir = td.path();

        // Build bare repo layout in workspace root
        assert!(std::fs::write(dir.join("HEAD"), "ref: refs/heads/main\n").is_ok());
        assert!(std::fs::create_dir_all(dir.join("objects")).is_ok());
        assert!(std::fs::create_dir_all(dir.join("refs")).is_ok());
        assert!(
            !dir.join(".git").exists(),
            "workspace must not have .git dir"
        );

        let marker = dir.join("pwned-bare-fsmonitor-status.txt");
        assert!(!marker.exists());

        // Agent writes config with core.fsmonitor pointing to a marker creator
        let config_content = format!(
            "[core]\n\tbare = false\n\tfsmonitor = \"touch {}\"\n",
            marker.to_string_lossy()
        );
        assert!(std::fs::write(dir.join("config"), config_content).is_ok());

        let approvals = Arc::new(McpApprovals::new(None));
        let policy = WorkProtectionPolicy {
            mode: PermissionMode::AskForRisky,
            snapshot_before_edit: false,
            worktree_isolation: false,
            read_before_write: false,
        };
        let executor = FilesystemToolExecutor::new(dir)
            .with_command_policy(CommandPolicy::from_config(&["git".to_string()]))
            .with_protection(Some(policy))
            .with_mcp_approvals(approvals.clone(), Some("run-r8-n1".to_string()));

        // In AskForRisky mode, git status must be classified Risky and refused
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "git".to_string(),
                args: vec!["status".to_string()],
            })
            .await;

        assert!(
            !res.success,
            "git status in bare-repo shape must fail/be refused under AskForRisky"
        );
        assert_eq!(
            approvals.pending().len(),
            1,
            "approval request must be queued for git in bare shape"
        );
        assert!(
            !marker.exists(),
            "marker must NOT be created: fsmonitor must not have executed"
        );

        // Classification and policy checks
        assert_eq!(
            classify_command_with_workdir("git", &["status".to_string()], Some(dir)),
            RiskClass::Risky,
            "git status in bare repo must classify Risky"
        );
        let cmd_policy = CommandPolicy::from_config(&["git".to_string()]);
        assert!(
            cmd_policy
                .check_invocation_with_workdir("git", &["status".to_string()], Some(dir))
                .is_err(),
            "git status in bare repo must be refused by command policy"
        );
    }

    #[tokio::test]
    async fn test_r8_n2_worktree_dotgit_hook_and_config_refused_e2e() {
        // N-2: git --work-tree=.git checkout HEAD -- hooks/pre-commit or config writes
        // into .git/ directory. Under R8-N2, --work-tree pointing at .git (or not matching ws)
        // is classified Risky, refused by policy, and GIT_WORK_TREE env passthrough is refused.
        let td_res = tempfile::tempdir();
        assert!(td_res.is_ok());
        let Ok(td) = td_res else {
            return;
        };
        let dir = td.path();
        let dot_git = dir.join(".git");
        assert!(std::fs::create_dir_all(dot_git.join("hooks")).is_ok());

        let approvals = Arc::new(McpApprovals::new(None));
        let policy = WorkProtectionPolicy {
            mode: PermissionMode::AskForRisky,
            snapshot_before_edit: false,
            worktree_isolation: false,
            read_before_write: false,
        };
        let executor = FilesystemToolExecutor::new(dir)
            .with_command_policy(CommandPolicy::from_config(&["git".to_string()]))
            .with_protection(Some(policy))
            .with_mcp_approvals(approvals.clone(), Some("run-r8-n2".to_string()));

        let hook_file = dot_git.join("hooks").join("pre-commit");
        let marker = dir.join("pwned-worktree-dotgit-pre-commit.txt");

        // Agent writes an agent-controlled hook inside workspace working directory
        let write_res = executor
            .execute(&AgentTool::WriteFile {
                path: "hooks/pre-commit".to_string(),
                content: format!("#!/bin/sh\ntouch {}\nexit 0\n", marker.to_string_lossy()),
            })
            .await;
        assert!(write_res.success, "writing hooks/pre-commit should succeed");

        // Attempt git --work-tree=.git checkout HEAD -- hooks/pre-commit
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "git".to_string(),
                args: vec![
                    "--work-tree=.git".to_string(),
                    "checkout".to_string(),
                    "HEAD".to_string(),
                    "--".to_string(),
                    "hooks/pre-commit".to_string(),
                ],
            })
            .await;

        assert!(
            !res.success,
            "git --work-tree=.git checkout must be refused"
        );
        assert_eq!(
            approvals.pending().len(),
            1,
            "approval must be queued for --work-tree=.git"
        );
        assert!(
            !hook_file.exists(),
            ".git/hooks/pre-commit must NOT have been written via checkout"
        );
        assert!(!marker.exists(), "marker must NOT be created");

        // Also verify --git-dir and GIT_WORK_TREE env forms classify Risky
        assert_eq!(
            classify_command_with_workdir(
                "git",
                &[
                    "--work-tree=.git".to_string(),
                    "checkout".to_string(),
                    "HEAD".to_string(),
                    "--".to_string(),
                    "hooks/pre-commit".to_string()
                ],
                Some(dir)
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command_with_workdir(
                "git",
                &[
                    "--work-tree=.git".to_string(),
                    "checkout".to_string(),
                    "HEAD:cfg".to_string(),
                    "--".to_string(),
                    "config".to_string()
                ],
                Some(dir)
            ),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command_with_workdir(
                "git",
                &[
                    "checkout".to_string(),
                    "HEAD".to_string(),
                    "--".to_string(),
                    ".git/config".to_string()
                ],
                Some(dir)
            ),
            RiskClass::Risky
        );
    }

    #[tokio::test]
    async fn test_r8_n3_outside_workspace_writes_and_exec_refused_e2e() {
        // N-3: outside workspace writes via --work-tree=/outside or --output=/outside
        // and execution of path-spelled programs outside the workspace not on PATH.
        let td_ws_res = tempfile::tempdir();
        assert!(td_ws_res.is_ok());
        let Ok(td_ws) = td_ws_res else {
            return;
        };
        let ws_dir = td_ws.path();
        let td_out_res = tempfile::tempdir();
        assert!(td_out_res.is_ok());
        let Ok(td_out) = td_out_res else {
            return;
        };
        let outside_dir = td_out.path();

        let approvals = Arc::new(McpApprovals::new(None));
        let policy = WorkProtectionPolicy {
            mode: PermissionMode::AskForRisky,
            snapshot_before_edit: false,
            worktree_isolation: false,
            read_before_write: false,
        };
        let executor = FilesystemToolExecutor::new(ws_dir)
            .with_command_policy(CommandPolicy::from_config(&[
                "git".to_string(),
                "npm".to_string(),
            ]))
            .with_protection(Some(policy))
            .with_mcp_approvals(approvals.clone(), Some("run-r8-n3".to_string()));

        // 1. Outside --work-tree checkout is refused
        let outside_work_tree = format!("--work-tree={}", outside_dir.display());
        let res_wt = executor
            .execute(&AgentTool::RunCommand {
                command: "git".to_string(),
                args: vec![
                    outside_work_tree,
                    "checkout".to_string(),
                    "HEAD".to_string(),
                    "--".to_string(),
                    "npm".to_string(),
                ],
            })
            .await;
        assert!(!res_wt.success, "git --work-tree=/outside must be refused");

        // 2. Outside --output write is refused
        let outside_output_file = outside_dir.join("outside_log.txt");
        let res_out = executor
            .execute(&AgentTool::RunCommand {
                command: "git".to_string(),
                args: vec![
                    "log".to_string(),
                    format!("--output={}", outside_output_file.display()),
                ],
            })
            .await;
        assert!(
            !res_out.success,
            "git log --output=/outside must be refused"
        );
        assert!(
            !outside_output_file.exists(),
            "outside log file must not be written"
        );

        // 3. Execution of outside non-canonical executable is refused
        let outside_binary = outside_dir.join("npm");
        let marker = outside_dir.join("pwned-outside-npm.txt");
        assert!(std::fs::write(
            &outside_binary,
            format!("#!/bin/sh\ntouch {}\nexit 0\n", marker.display()),
        )
        .is_ok());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = std::fs::metadata(&outside_binary) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                assert!(std::fs::set_permissions(&outside_binary, perms).is_ok());
            }
        }

        let res_exec = executor
            .execute(&AgentTool::RunCommand {
                command: outside_binary.to_string_lossy().to_string(),
                args: vec!["--version".to_string()],
            })
            .await;
        assert!(
            !res_exec.success,
            "running outside non-canonical program must be refused"
        );
        assert!(!marker.exists(), "outside binary must NOT have executed");
    }

    #[tokio::test]
    async fn test_r8_n4_cmake_hn_configure_refused_e2e() {
        // N-4: cmake -HN legacy source dir configuration was treated as Safe view flag.
        // Under R8-N4, letter-combination rule is replaced by exact tokens (-N, -L, -LA, -LH, -LAH)
        // requiring at least one separate exact -N flag. -HN is Risky and refused in AskForRisky.
        let td_res = tempfile::tempdir();
        assert!(td_res.is_ok());
        let Ok(td) = td_res else {
            return;
        };
        let dir = td.path();

        let approvals = Arc::new(McpApprovals::new(None));
        let policy = WorkProtectionPolicy {
            mode: PermissionMode::AskForRisky,
            snapshot_before_edit: false,
            worktree_isolation: false,
            read_before_write: false,
        };
        let executor = FilesystemToolExecutor::new(dir)
            .with_command_policy(CommandPolicy::from_config(&["cmake".to_string()]))
            .with_protection(Some(policy))
            .with_mcp_approvals(approvals.clone(), Some("run-r8-n4".to_string()));

        let marker = dir.join("pwned-cmake-HN.txt");
        // Create N/CMakeLists.txt that executes a process to create the marker
        let n_dir = dir.join("N");
        assert!(std::fs::create_dir_all(&n_dir).is_ok());
        let cmakelists = format!(
            "cmake_minimum_required(VERSION 3.10)\nproject(Pwned)\nexecute_process(COMMAND touch \"{}\")\n",
            marker.to_string_lossy()
        );
        assert!(std::fs::write(n_dir.join("CMakeLists.txt"), cmakelists).is_ok());

        // Drive cmake -HN through executor
        let res = executor
            .execute(&AgentTool::RunCommand {
                command: "cmake".to_string(),
                args: vec!["-HN".to_string()],
            })
            .await;

        assert!(
            !res.success,
            "cmake -HN must be refused under AskForRisky mode"
        );
        assert_eq!(
            approvals.pending().len(),
            1,
            "approval must be queued for cmake -HN"
        );
        assert!(
            !marker.exists(),
            "marker must NOT be created: cmake -HN must not configure/execute"
        );

        // Verify classification of compound vs separate exact tokens
        assert_eq!(
            classify_command("cmake", &["-HN".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-HAN".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-L".to_string(), "-HLN".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-N".to_string(), "-HN".to_string()]),
            RiskClass::Risky
        );
        assert_eq!(
            classify_command("cmake", &["-N".to_string()]),
            RiskClass::Safe
        );
        assert_eq!(
            classify_command("cmake", &["-N".to_string(), "-L".to_string()]),
            RiskClass::Safe
        );
    }
}
