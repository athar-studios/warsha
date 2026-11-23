use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// Verification tier of a coding CLI engine.
///
/// Tier A: Full adapter (live streaming events + token/usage parsing, e.g. claude-code, codex-cli, opencode).
/// Tier B: Verified against an installed CLI with recorded version and --help evidence.
/// Tier C: Catalogued unverified (docs only, runs to completion with unverified label).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum VerificationTier {
    #[serde(rename = "A")]
    A,
    #[serde(rename = "B")]
    B,
    #[serde(rename = "C")]
    C,
}

impl std::fmt::Display for VerificationTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::A => write!(f, "Tier A (Full Adapter)"),
            Self::B => write!(f, "Tier B (Verified)"),
            Self::C => write!(f, "Tier C (Catalogued, Unverified)"),
        }
    }
}

/// Output format emitted by the CLI tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OutputFormat {
    #[serde(rename = "plain")]
    Plain,
    #[serde(rename = "stream-json")]
    StreamJson,
    #[serde(rename = "jsonl")]
    Jsonl,
}

impl std::fmt::Display for OutputFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Plain => write!(f, "plain"),
            Self::StreamJson => write!(f, "stream-json"),
            Self::Jsonl => write!(f, "jsonl"),
        }
    }
}

/// A catalogued coding engine entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CatalogEntry {
    /// Canonical identifier for the backend (e.g. "claude-code").
    pub name: String,
    /// Human-friendly display label (e.g. "Claude Code").
    pub display_name: String,
    /// Binary executable name on PATH (e.g. "claude").
    pub command: String,
    /// Argument template with a "{prompt}" placeholder.
    pub args_template: Vec<String>,
    /// Expected output format.
    pub output_format: OutputFormat,
    /// Verification tier.
    pub tier: VerificationTier,
    /// Reference to a built-in permission mapping if one exists.
    #[serde(default)]
    pub permission_mapping: Option<String>,
}

/// Diagnostic health result of a coding engine CLI check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CliHealthDiagnostics {
    pub name: String,
    pub command: String,
    pub installed: bool,
    pub ready: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub status: String,
    pub auth_required: bool,
}

/// Check CLI readiness beyond `which()`: runs `<command> --version` with timeout,
/// surfaces version and auth/login status. Fails closed (ready = false) on timeout.
pub async fn check_cli_health(
    name: &str,
    command: &str,
    timeout: std::time::Duration,
) -> CliHealthDiagnostics {
    if which::which(command).is_err() {
        return CliHealthDiagnostics {
            name: name.to_string(),
            command: command.to_string(),
            installed: false,
            ready: false,
            version: None,
            status: "Executable not found in PATH".to_string(),
            auth_required: false,
        };
    }

    let child_future = tokio::process::Command::new(command)
        .arg("--version")
        .kill_on_drop(true)
        .output();

    match tokio::time::timeout(timeout, child_future).await {
        Err(_) => CliHealthDiagnostics {
            name: name.to_string(),
            command: command.to_string(),
            installed: true,
            ready: false,
            version: None,
            status: "Timed out checking CLI readiness".to_string(),
            auth_required: false,
        },
        Ok(Err(err)) => CliHealthDiagnostics {
            name: name.to_string(),
            command: command.to_string(),
            installed: true,
            ready: false,
            version: None,
            status: format!("Failed to execute command: {err}"),
            auth_required: false,
        },
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            let combined = format!("{stdout} {stderr}").to_lowercase();

            let auth_required = combined.contains("login")
                || combined.contains("not logged in")
                || combined.contains("auth")
                || combined.contains("unauthorized")
                || combined.contains("api key")
                || combined.contains("authentication");

            let raw_version = stdout.trim();
            let first_line = raw_version.lines().next().unwrap_or("").trim().to_string();
            let version = if !first_line.is_empty() {
                Some(first_line)
            } else {
                let err_first_line = stderr.lines().next().unwrap_or("").trim().to_string();
                if !err_first_line.is_empty() && output.status.success() {
                    Some(err_first_line)
                } else {
                    None
                }
            };

            if output.status.success() {
                CliHealthDiagnostics {
                    name: name.to_string(),
                    command: command.to_string(),
                    installed: true,
                    ready: !auth_required,
                    version,
                    status: if auth_required {
                        "Authentication required".to_string()
                    } else {
                        "Ready".to_string()
                    },
                    auth_required,
                }
            } else {
                let err_msg = if !stderr.trim().is_empty() {
                    stderr.trim().lines().next().unwrap_or("").to_string()
                } else if !stdout.trim().is_empty() {
                    stdout.trim().lines().next().unwrap_or("").to_string()
                } else {
                    format!("Process exited with status {}", output.status)
                };

                CliHealthDiagnostics {
                    name: name.to_string(),
                    command: command.to_string(),
                    installed: true,
                    ready: false,
                    version,
                    status: if auth_required {
                        "Authentication required".to_string()
                    } else {
                        format!("CLI check failed: {err_msg}")
                    },
                    auth_required,
                }
            }
        }
    }
}

const FORBIDDEN_PERMISSION_SKIPPING_SUBSTRINGS: &[&str] = &[
    "dangerously-skip-permissions",
    "bypass-permissions",
    "skip-permissions",
    "no-verify",
];

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CatalogValidationError {
    #[error("catalog entry name cannot be empty")]
    EmptyName,
    #[error("entry `{0}` has missing or empty executable")]
    MissingExecutable(String),
    #[error("entry `{0}` is missing required '{{prompt}}' placeholder in args template")]
    MissingPromptPlaceholder(String),
    #[error("entry `{entry}` has unknown output format: `{format}`")]
    UnknownOutputFormat { entry: String, format: String },
    #[error("entry `{entry}` has unknown verification tier: `{tier}`")]
    UnknownTier { entry: String, tier: String },
    #[error("entry `{entry}` carries forbidden permission-skipping flag: `{flag}`")]
    PermissionSkippingFlagForbidden { entry: String, flag: String },
    #[error("catalog JSON parse error: {0}")]
    JsonError(String),
}

#[derive(Debug, Deserialize)]
struct RawCatalogEntry {
    name: String,
    display_name: String,
    command: String,
    args_template: Vec<String>,
    output_format: String,
    tier: String,
    #[serde(default)]
    permission_mapping: Option<String>,
}

impl CatalogEntry {
    /// Validate that the entry conforms to all catalog invariants.
    pub fn validate(&self) -> Result<(), CatalogValidationError> {
        if self.name.trim().is_empty() {
            return Err(CatalogValidationError::EmptyName);
        }
        if self.command.trim().is_empty() {
            return Err(CatalogValidationError::MissingExecutable(self.name.clone()));
        }
        let has_prompt = self
            .args_template
            .iter()
            .any(|arg| arg.contains("{prompt}"));
        if !has_prompt {
            return Err(CatalogValidationError::MissingPromptPlaceholder(
                self.name.clone(),
            ));
        }
        for arg in &self.args_template {
            for &forbidden in FORBIDDEN_PERMISSION_SKIPPING_SUBSTRINGS {
                if arg.contains(forbidden) {
                    return Err(CatalogValidationError::PermissionSkippingFlagForbidden {
                        entry: self.name.clone(),
                        flag: arg.clone(),
                    });
                }
            }
        }
        Ok(())
    }

    /// Arguments before the `{prompt}` placeholder.
    pub fn args_before_prompt(&self) -> Vec<String> {
        let mut args = Vec::new();
        for arg in &self.args_template {
            if arg == "{prompt}" {
                break;
            }
            args.push(arg.clone());
        }
        args
    }

    /// Check if the executable is installed on the local system PATH.
    pub fn is_installed(&self) -> bool {
        which::which(&self.command).is_ok()
    }

    /// Check CLI health and readiness by running `<command> --version` with a timeout (fail-closed).
    pub async fn check_health(&self, timeout: std::time::Duration) -> CliHealthDiagnostics {
        check_cli_health(&self.name, &self.command, timeout).await
    }

    /// Check if this catalog entry carries a permission-skipping flag.
    pub fn has_permission_skipping_flag(&self) -> bool {
        for arg in &self.args_template {
            for sub in FORBIDDEN_PERMISSION_SKIPPING_SUBSTRINGS {
                if arg.contains(sub) {
                    return true;
                }
            }
        }
        false
    }
}

/// The coding engine catalog loaded from data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EngineCatalog {
    entries: Vec<CatalogEntry>,
}

static BUILTIN_CATALOG: OnceLock<EngineCatalog> = OnceLock::new();

const BUILTIN_CATALOG_JSON: &str = include_str!("../../../data/catalog/engines.json");

impl EngineCatalog {
    /// Load and validate a catalog from a JSON string.
    pub fn load_from_str(json: &str) -> Result<Self, CatalogValidationError> {
        let raw_entries: Vec<RawCatalogEntry> = serde_json::from_str(json)
            .map_err(|e| CatalogValidationError::JsonError(e.to_string()))?;

        let mut entries = Vec::with_capacity(raw_entries.len());
        for raw in raw_entries {
            let output_format = match raw.output_format.as_str() {
                "plain" => OutputFormat::Plain,
                "stream-json" => OutputFormat::StreamJson,
                "jsonl" => OutputFormat::Jsonl,
                other => {
                    return Err(CatalogValidationError::UnknownOutputFormat {
                        entry: raw.name.clone(),
                        format: other.to_string(),
                    })
                }
            };
            let tier = match raw.tier.as_str() {
                "A" => VerificationTier::A,
                "B" => VerificationTier::B,
                "C" => VerificationTier::C,
                other => {
                    return Err(CatalogValidationError::UnknownTier {
                        entry: raw.name.clone(),
                        tier: other.to_string(),
                    })
                }
            };
            let entry = CatalogEntry {
                name: raw.name,
                display_name: raw.display_name,
                command: raw.command,
                args_template: raw.args_template,
                output_format,
                tier,
                permission_mapping: raw.permission_mapping,
            };
            entry.validate()?;
            entries.push(entry);
        }

        Ok(Self { entries })
    }

    /// Get the global built-in catalog instance.
    /// Built-in engines.json is validated at build time; fail-fast on corrupt bundle is intended.
    #[allow(clippy::expect_used)]
    pub fn builtin() -> &'static EngineCatalog {
        BUILTIN_CATALOG.get_or_init(|| {
            Self::load_from_str(BUILTIN_CATALOG_JSON)
                .expect("built-in data/catalog/engines.json must be valid")
        })
    }

    /// Return all entries in the catalog.
    pub fn entries(&self) -> &[CatalogEntry] {
        &self.entries
    }

    /// Find an entry by canonical name.
    pub fn get(&self, name: &str) -> Option<&CatalogEntry> {
        self.entries.iter().find(|e| e.name == name)
    }

    /// Returns true if the backend name is catalogued.
    pub fn is_known(&self, name: &str) -> bool {
        self.get(name).is_some()
    }

    /// Return all entries whose executable exists on PATH.
    pub fn installed_entries(&self) -> Vec<&CatalogEntry> {
        self.entries.iter().filter(|e| e.is_installed()).collect()
    }

    /// Probe every catalog entry against a specific `PATH` value (or current `PATH` when `None`).
    /// Returns `(entry, installed)` in catalog order.
    pub fn detect_in_path(
        &self,
        path_env: Option<&std::ffi::OsStr>,
        cwd: &std::path::Path,
    ) -> Vec<(&CatalogEntry, bool)> {
        self.entries
            .iter()
            .map(|entry| {
                let installed = match path_env {
                    Some(p) => which::which_in(&entry.command, Some(p), cwd).is_ok(),
                    None => entry.is_installed(),
                };
                (entry, installed)
            })
            .collect()
    }
}

impl Default for EngineCatalog {
    fn default() -> Self {
        Self::builtin().clone()
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_catalog_loads_and_validates() {
        let catalog = EngineCatalog::builtin();
        assert!(
            catalog.entries().len() >= 35,
            "Expected at least 35 engines, found {}",
            catalog.entries().len()
        );
        for entry in catalog.entries() {
            entry
                .validate()
                .expect("all built-in entries must validate");
        }
    }

    #[test]
    fn test_reject_malformed_entry_unknown_format() {
        let json = r#"[
            {
                "name": "bad-format",
                "display_name": "Bad Format",
                "command": "bad",
                "args_template": ["{prompt}"],
                "output_format": "xml-streams",
                "tier": "C"
            }
        ]"#;
        let err = EngineCatalog::load_from_str(json).unwrap_err();
        assert_eq!(
            err,
            CatalogValidationError::UnknownOutputFormat {
                entry: "bad-format".to_string(),
                format: "xml-streams".to_string()
            }
        );
    }

    #[test]
    fn test_reject_malformed_entry_missing_executable() {
        let entry = CatalogEntry {
            name: "broken-engine".to_string(),
            display_name: "Broken".to_string(),
            command: "  ".to_string(),
            args_template: vec!["{prompt}".to_string()],
            output_format: OutputFormat::Plain,
            tier: VerificationTier::C,
            permission_mapping: None,
        };
        let err = entry.validate().unwrap_err();
        assert_eq!(
            err,
            CatalogValidationError::MissingExecutable("broken-engine".to_string())
        );
    }

    #[test]
    fn test_reject_malformed_entry_missing_prompt() {
        let entry = CatalogEntry {
            name: "broken-prompt".to_string(),
            display_name: "Broken".to_string(),
            command: "exec".to_string(),
            args_template: vec!["--do-something".to_string()],
            output_format: OutputFormat::Plain,
            tier: VerificationTier::C,
            permission_mapping: None,
        };
        let err = entry.validate().unwrap_err();
        assert_eq!(
            err,
            CatalogValidationError::MissingPromptPlaceholder("broken-prompt".to_string())
        );
    }

    #[test]
    fn test_reject_permission_skipping_flag() {
        let entry = CatalogEntry {
            name: "skip-engine".to_string(),
            display_name: "Skipper".to_string(),
            command: "skip".to_string(),
            args_template: vec![
                "--dangerously-skip-permissions".to_string(),
                "{prompt}".to_string(),
            ],
            output_format: OutputFormat::Plain,
            tier: VerificationTier::C,
            permission_mapping: None,
        };
        let err = entry.validate().unwrap_err();
        assert_eq!(
            err,
            CatalogValidationError::PermissionSkippingFlagForbidden {
                entry: "skip-engine".to_string(),
                flag: "--dangerously-skip-permissions".to_string()
            }
        );
    }

    #[test]
    fn test_no_shipped_catalog_entry_carries_permission_skipping_flag() {
        let catalog = EngineCatalog::builtin();
        for entry in catalog.entries() {
            for arg in &entry.args_template {
                assert!(
                    !arg.contains("dangerously-skip-permissions")
                        && !arg.contains("bypass-permissions")
                        && !arg.contains("skip-permissions")
                        && !arg.contains("no-verify"),
                    "Shipped catalog entry `{}` carries permission-skipping flag: `{}`",
                    entry.name,
                    arg
                );
            }
        }
    }

    #[test]
    fn test_claude_and_codex_argv_template_matches() {
        let catalog = EngineCatalog::builtin();

        let claude = catalog.get("claude-code").expect("claude-code must exist");
        assert_eq!(claude.command, "claude");
        assert_eq!(claude.args_before_prompt(), vec!["-p".to_string()]);
        assert_eq!(claude.tier, VerificationTier::A);
        assert_eq!(claude.output_format, OutputFormat::StreamJson);

        let codex = catalog.get("codex-cli").expect("codex-cli must exist");
        assert_eq!(codex.command, "codex");
        assert_eq!(
            codex.args_before_prompt(),
            vec!["exec".to_string(), "--json".to_string()]
        );
        assert_eq!(codex.tier, VerificationTier::A);
        assert_eq!(codex.output_format, OutputFormat::Jsonl);
    }

    #[tokio::test]
    async fn test_cli_health_missing_executable() {
        let diag = check_cli_health(
            "phantom",
            "nonexistent-cli-binary-xyz",
            std::time::Duration::from_millis(500),
        )
        .await;
        assert_eq!(diag.name, "phantom");
        assert!(!diag.installed);
        assert!(!diag.ready);
        assert!(diag.version.is_none());
        assert_eq!(diag.status, "Executable not found in PATH");
        assert!(!diag.auth_required);
    }

    #[tokio::test]
    async fn test_cli_health_existing_command_git() {
        let diag = check_cli_health("git", "git", std::time::Duration::from_secs(3)).await;
        assert_eq!(diag.name, "git");
        assert!(diag.installed);
        assert!(diag.ready);
        assert!(diag.version.is_some());
        let ver = diag.version.as_deref().unwrap_or("");
        assert!(
            ver.contains("git version"),
            "expected git version string, got: {ver}"
        );
        assert_eq!(diag.status, "Ready");
        assert!(!diag.auth_required);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn test_cli_health_timeout_fails_closed() {
        // Deterministic: probe a blocking `sh -c 'sleep 30'` shim by absolute path
        // so exec always succeeds and the 200ms timeout must fail closed without
        // mutating the process-wide PATH.
        let temp = tempfile::tempdir().expect("probe dir");
        let shim = temp.path().join("warsha-block-forever");
        let staging = temp.path().join(".warsha-block-forever.tmp");
        {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&staging)
                .expect("staging shim opened");
            file.write_all(b"#!/bin/sh\nexec sleep 30\n")
                .expect("shim written");
            file.sync_all().expect("shim synced");
        }
        std::fs::rename(&staging, &shim).expect("shim published");
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&shim).expect("shim exists").permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&shim, perms).expect("shim executable");
        }
        let diag = check_cli_health(
            "blocker",
            shim.to_str().expect("valid utf8 path"),
            std::time::Duration::from_millis(200),
        )
        .await;
        assert!(diag.installed, "the blocking shim exists");
        assert!(!diag.ready, "timeout must fail closed");
        assert!(diag.version.is_none());
        assert!(diag.status.contains("Timed out"));
    }
}
