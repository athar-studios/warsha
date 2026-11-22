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
}
