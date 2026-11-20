#[cfg(test)]
mod tests {
    use crate::command_policy::CommandPolicy;
    use crate::work_protection::{classify_command, RiskClass};

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
        // node script.js - Safe
        assert_eq!(
            classify_command("node", &["script.js".to_string()]),
            RiskClass::Safe,
            "node script.js should be Safe"
        );

        // nodejs parity
        assert_eq!(
            classify_command("nodejs", &["--eval=1+1".to_string()]),
            RiskClass::Risky,
            "nodejs --eval=1+1 should be Risky"
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
}
