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
}
