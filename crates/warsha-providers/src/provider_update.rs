//! Provider-software auto-update — detect installed coding CLIs/runtimes, check
//! their official release channels and decide what to do about each one.
//!
//! The feature is **off by default** ([`ProviderUpdateMode::Off`]) and every
//! provider is opt-in through [`ProviderUpdatePolicy::providers`]. Nothing here
//! downloads or installs anything: [`ProviderUpdatePlanner`] only produces
//! [`ProviderUpdateAction`]s that the desktop app, the daemon or a routine
//! executes with each vendor's own installer, after showing the changelog.
//!
//! Two hard rules live in this module:
//!
//! * a pinned or skipped version is never replaced, and
//! * nothing is even proposed while a run is active (`run_active == true`).
//!
//! Version comparisons are equality only (with a leading `v` ignored); ordering
//! is left to the release channel, which reports what "latest" means.

use std::collections::HashMap;

use thiserror::Error;

/// What Warsha may do about a provider whose release channel moved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ProviderUpdateMode {
    /// Auto-update is disabled; the planner returns no actions at all.
    #[default]
    Off,
    /// Tell the owner a newer version exists, install nothing.
    NotifyOnly,
    /// Install the newer version after the owner enabled that provider.
    AutoInstall,
}

/// The owner's settings for provider-software updates.
///
/// `providers` is an opt-in map: a provider missing from it counts as disabled,
/// so a fresh policy never updates anything.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ProviderUpdatePolicy {
    /// Global mode, [`ProviderUpdateMode::Off`] by default.
    pub mode: ProviderUpdateMode,
    /// Per-provider toggle; absent means disabled.
    pub providers: HashMap<String, bool>,
    /// Version the owner wants to stay on, if any.
    pub pinned_version: Option<String>,
    /// Versions the owner never wants installed.
    pub skip_versions: Vec<String>,
}

impl ProviderUpdatePolicy {
    /// A policy in `mode` with nothing enabled.
    pub fn new(mode: ProviderUpdateMode) -> Self {
        Self {
            mode,
            ..Self::default()
        }
    }

    /// Enable or disable updates for one provider.
    pub fn with_provider(mut self, provider: &str, enabled: bool) -> Self {
        self.providers.insert(provider.to_string(), enabled);
        self
    }

    /// Pin the policy to one version of the detected provider.
    pub fn with_pinned_version(mut self, version: &str) -> Self {
        self.pinned_version = Some(version.to_string());
        self
    }

    /// Never install `version`.
    pub fn with_skipped_version(mut self, version: &str) -> Self {
        self.skip_versions.push(version.to_string());
        self
    }

    /// Whether the owner opted this provider in.
    pub fn is_provider_enabled(&self, provider: &str) -> bool {
        self.providers.get(provider).copied().unwrap_or(false)
    }
}

/// A provider binary/runtime found on this machine.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DetectedProvider {
    /// Stable provider name, e.g. `claude-code` or `ollama`.
    pub name: String,
    /// Installed version when the CLI reports one.
    pub version: Option<String>,
    /// Absolute path of the executable, when known.
    pub path: Option<String>,
}

impl DetectedProvider {
    /// A detected provider with no version or path yet.
    pub fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
            ..Self::default()
        }
    }

    /// Record the installed version.
    pub fn with_version(mut self, version: &str) -> Self {
        self.version = Some(version.to_string());
        self
    }

    /// Record the executable path.
    pub fn with_path(mut self, path: &str) -> Self {
        self.path = Some(path.to_string());
        self
    }
}

/// Why the planner refused to touch a provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// The policy pins a different version.
    Pinned,
    /// The new version is on the skip list.
    SkippedVersion,
    /// The owner did not enable this provider.
    Disabled,
    /// A pipeline run is active; nothing is proposed while it runs.
    RunActive,
    /// The release channel reported nothing for this provider.
    UnknownVersion,
}

impl SkipReason {
    /// Stable, owner-facing code used in logs and in the Settings list.
    pub fn code(&self) -> &'static str {
        match self {
            SkipReason::Pinned => "pinned",
            SkipReason::SkippedVersion => "skipped",
            SkipReason::Disabled => "disabled",
            SkipReason::RunActive => "run active",
            SkipReason::UnknownVersion => "unknown version",
        }
    }
}

/// One decision about one detected provider.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderUpdateAction {
    /// Tell the owner that `latest` exists for `provider`.
    Notify {
        /// Provider name.
        provider: String,
        /// Installed version, when known.
        current: Option<String>,
        /// Version the release channel reports.
        latest: String,
    },
    /// Install `version` for `provider` with the vendor's own installer.
    Install {
        /// Provider name.
        provider: String,
        /// Version to install.
        version: String,
    },
    /// Leave the provider alone.
    Skip {
        /// Provider name.
        provider: String,
        /// Why nothing is proposed.
        reason: SkipReason,
    },
}

/// Errors raised by detection, release checks, installation and rollback.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProviderUpdateError {
    /// The provider is not installed, so there is nothing to update.
    #[error("provider not installed: {0}")]
    NotInstalled(String),
    /// The release channel could not be read.
    #[error("could not check {provider} releases: {message}")]
    Check {
        /// Provider whose channel failed.
        provider: String,
        /// Detail from the channel.
        message: String,
    },
    /// The vendor installer or package manager failed.
    #[error("could not install {provider} {version}: {message}")]
    Install {
        /// Provider being updated.
        provider: String,
        /// Version that was attempted.
        version: String,
        /// Detail from the installer.
        message: String,
    },
    /// The post-update health check failed.
    #[error("health check failed for {provider} after updating to {version}")]
    HealthCheck {
        /// Provider that failed its check.
        provider: String,
        /// Version now installed.
        version: String,
    },
    /// Rolling back to the previous version failed.
    #[error("rollback of {provider} failed: {message}")]
    Rollback {
        /// Provider that could not be rolled back.
        provider: String,
        /// Detail from the installer.
        message: String,
    },
}

/// Finds the provider software installed on this machine.
pub trait ProviderDetector {
    /// Every provider this detector recognises.
    fn detect(&self) -> Vec<DetectedProvider>;
}

/// Reads the declared latest version from a provider's official release channel.
pub trait ProviderUpdateChecker {
    /// Latest released version of `provider`, or a [`ProviderUpdateError::Check`].
    fn latest_version(&self, provider: &str) -> Result<String, ProviderUpdateError>;
}

/// Test/desktop double: returns a fixed set of detected providers.
#[derive(Debug, Clone, Default)]
pub struct MockDetector {
    detected: Vec<DetectedProvider>,
}

impl MockDetector {
    /// A detector reporting exactly `detected`.
    pub fn new(detected: Vec<DetectedProvider>) -> Self {
        Self { detected }
    }
}

impl ProviderDetector for MockDetector {
    fn detect(&self) -> Vec<DetectedProvider> {
        self.detected.clone()
    }
}

/// Test double: returns the configured version per provider.
#[derive(Debug, Clone, Default)]
pub struct MockChecker {
    versions: HashMap<String, String>,
}

impl MockChecker {
    /// An empty checker; every lookup reports a failed check.
    pub fn new() -> Self {
        Self::default()
    }

    /// Configure one provider's latest version.
    pub fn with_version(mut self, provider: &str, version: &str) -> Self {
        self.versions
            .insert(provider.to_string(), version.to_string());
        self
    }
}

impl ProviderUpdateChecker for MockChecker {
    fn latest_version(&self, provider: &str) -> Result<String, ProviderUpdateError> {
        self.versions
            .get(provider)
            .cloned()
            .ok_or_else(|| ProviderUpdateError::Check {
                provider: provider.to_string(),
                message: "no release channel configured".to_string(),
            })
    }
}

/// Collect the latest version of every detected provider.
///
/// A failed channel is left out of the map instead of aborting the whole pass,
/// so one unreachable provider cannot block updates for the others; the planner
/// reports those as [`SkipReason::UnknownVersion`].
pub fn latest_versions(
    checker: &dyn ProviderUpdateChecker,
    detected: &[DetectedProvider],
) -> HashMap<String, String> {
    detected
        .iter()
        .filter_map(|provider| {
            checker
                .latest_version(&provider.name)
                .ok()
                .map(|version| (provider.name.clone(), version))
        })
        .collect()
}

/// Turns a policy, the detected providers and their latest versions into the
/// actions the owner sees.
#[derive(Debug, Clone, Copy)]
pub struct ProviderUpdatePlanner;

impl ProviderUpdatePlanner {
    /// Plan one action per detected provider.
    ///
    /// `latest` maps provider name to the version its release channel reports.
    /// Rules, in order: an off policy plans nothing; a run in flight turns every
    /// action into [`SkipReason::RunActive`]; a provider with no known latest
    /// version is skipped; a pinned version that differs from `latest` is
    /// skipped; a skipped `latest` is skipped; then the mode decides between
    /// [`ProviderUpdateAction::Notify`] and [`ProviderUpdateAction::Install`]
    /// (install requires the provider's own toggle).
    pub fn plan(
        policy: &ProviderUpdatePolicy,
        detected: &[DetectedProvider],
        latest: &HashMap<String, String>,
        run_active: bool,
    ) -> Vec<ProviderUpdateAction> {
        if policy.mode == ProviderUpdateMode::Off {
            return Vec::new();
        }

        detected
            .iter()
            .map(|provider| {
                if run_active {
                    skip(provider, SkipReason::RunActive)
                } else {
                    Self::plan_one(policy, provider, latest.get(&provider.name))
                }
            })
            .collect()
    }

    fn plan_one(
        policy: &ProviderUpdatePolicy,
        provider: &DetectedProvider,
        latest: Option<&String>,
    ) -> ProviderUpdateAction {
        let Some(latest) = latest else {
            return skip(provider, SkipReason::UnknownVersion);
        };

        if let Some(pinned) = &policy.pinned_version {
            if !same_version(pinned, latest) {
                return skip(provider, SkipReason::Pinned);
            }
        }

        if policy
            .skip_versions
            .iter()
            .any(|skipped| same_version(skipped, latest))
        {
            return skip(provider, SkipReason::SkippedVersion);
        }

        match policy.mode {
            ProviderUpdateMode::Off => skip(provider, SkipReason::Disabled),
            ProviderUpdateMode::NotifyOnly => ProviderUpdateAction::Notify {
                provider: provider.name.clone(),
                current: provider.version.clone(),
                latest: latest.clone(),
            },
            ProviderUpdateMode::AutoInstall => {
                if policy.is_provider_enabled(&provider.name) {
                    ProviderUpdateAction::Install {
                        provider: provider.name.clone(),
                        version: latest.clone(),
                    }
                } else {
                    skip(provider, SkipReason::Disabled)
                }
            }
        }
    }
}

fn skip(provider: &DetectedProvider, reason: SkipReason) -> ProviderUpdateAction {
    ProviderUpdateAction::Skip {
        provider: provider.name.clone(),
        reason,
    }
}

/// Version equality, ignoring surrounding whitespace and a leading `v`.
fn same_version(left: &str, right: &str) -> bool {
    normalize_version(left) == normalize_version(right)
}

fn normalize_version(version: &str) -> &str {
    version.trim().trim_start_matches(['v', 'V'])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detected(names: &[&str]) -> Vec<DetectedProvider> {
        names
            .iter()
            .map(|name| DetectedProvider::new(name).with_version("1.0.0"))
            .collect()
    }

    fn latest(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(name, version)| ((*name).to_string(), (*version).to_string()))
            .collect()
    }

    #[test]
    fn off_mode_plans_nothing() {
        let policy =
            ProviderUpdatePolicy::new(ProviderUpdateMode::Off).with_provider("claude-code", true);
        let actions = ProviderUpdatePlanner::plan(
            &policy,
            &detected(&["claude-code"]),
            &latest(&[("claude-code", "2.0.0")]),
            false,
        );
        assert!(actions.is_empty());
    }

    #[test]
    fn notify_only_reports_the_new_version() {
        let policy = ProviderUpdatePolicy::new(ProviderUpdateMode::NotifyOnly);
        let actions = ProviderUpdatePlanner::plan(
            &policy,
            &detected(&["ollama"]),
            &latest(&[("ollama", "0.6.0")]),
            false,
        );
        assert_eq!(
            actions,
            vec![ProviderUpdateAction::Notify {
                provider: "ollama".to_string(),
                current: Some("1.0.0".to_string()),
                latest: "0.6.0".to_string(),
            }]
        );
    }

    #[test]
    fn auto_install_requires_the_per_provider_toggle() {
        let detected = detected(&["claude-code", "codex-cli"]);
        let latest = latest(&[("claude-code", "2.0.0"), ("codex-cli", "3.0.0")]);

        let enabled = ProviderUpdatePolicy::new(ProviderUpdateMode::AutoInstall)
            .with_provider("claude-code", true);
        assert_eq!(
            ProviderUpdatePlanner::plan(&enabled, &detected, &latest, false),
            vec![
                ProviderUpdateAction::Install {
                    provider: "claude-code".to_string(),
                    version: "2.0.0".to_string(),
                },
                ProviderUpdateAction::Skip {
                    provider: "codex-cli".to_string(),
                    reason: SkipReason::Disabled,
                },
            ]
        );

        // An explicit `false` behaves like a missing entry.
        let disabled = ProviderUpdatePolicy::new(ProviderUpdateMode::AutoInstall)
            .with_provider("claude-code", false);
        let actions = ProviderUpdatePlanner::plan(&disabled, &detected, &latest, false);
        assert!(actions.iter().all(|action| matches!(
            action,
            ProviderUpdateAction::Skip {
                reason: SkipReason::Disabled,
                ..
            }
        )));
    }

    #[test]
    fn a_pinned_version_holds_the_provider() {
        let policy = ProviderUpdatePolicy::new(ProviderUpdateMode::AutoInstall)
            .with_provider("goose", true)
            .with_pinned_version("v1.0.0");

        let actions = ProviderUpdatePlanner::plan(
            &policy,
            &detected(&["goose"]),
            &latest(&[("goose", "1.1.0")]),
            false,
        );
        assert_eq!(
            actions,
            vec![ProviderUpdateAction::Skip {
                provider: "goose".to_string(),
                reason: SkipReason::Pinned,
            }]
        );

        // The same version written with a `v` prefix still matches.
        let actions = ProviderUpdatePlanner::plan(
            &policy,
            &detected(&["goose"]),
            &latest(&[("goose", "1.0.0")]),
            false,
        );
        assert_eq!(
            actions,
            vec![ProviderUpdateAction::Install {
                provider: "goose".to_string(),
                version: "1.0.0".to_string(),
            }]
        );
    }

    #[test]
    fn a_skipped_version_is_never_installed() {
        let policy = ProviderUpdatePolicy::new(ProviderUpdateMode::AutoInstall)
            .with_provider("opencode", true)
            .with_skipped_version("v0.4.2");

        let actions = ProviderUpdatePlanner::plan(
            &policy,
            &detected(&["opencode"]),
            &latest(&[("opencode", "0.4.2")]),
            false,
        );
        assert_eq!(
            actions,
            vec![ProviderUpdateAction::Skip {
                provider: "opencode".to_string(),
                reason: SkipReason::SkippedVersion,
            }]
        );
    }

    #[test]
    fn an_active_run_skips_every_provider() {
        let policy = ProviderUpdatePolicy::new(ProviderUpdateMode::AutoInstall)
            .with_provider("claude-code", true)
            .with_provider("ollama", true);
        let actions = ProviderUpdatePlanner::plan(
            &policy,
            &detected(&["claude-code", "ollama"]),
            &latest(&[("claude-code", "2.0.0"), ("ollama", "0.6.0")]),
            true,
        );

        assert_eq!(actions.len(), 2);
        assert!(actions.iter().all(|action| matches!(
            action,
            ProviderUpdateAction::Skip {
                reason: SkipReason::RunActive,
                ..
            }
        )));
    }

    #[test]
    fn an_unknown_channel_is_skipped() {
        let policy = ProviderUpdatePolicy::new(ProviderUpdateMode::NotifyOnly);
        let actions = ProviderUpdatePlanner::plan(
            &policy,
            &detected(&["cursor-cli"]),
            &HashMap::new(),
            false,
        );
        assert_eq!(
            actions,
            vec![ProviderUpdateAction::Skip {
                provider: "cursor-cli".to_string(),
                reason: SkipReason::UnknownVersion,
            }]
        );
    }

    #[test]
    fn mocks_report_detection_and_channels() {
        let detector = MockDetector::new(vec![
            DetectedProvider::new("ollama")
                .with_version("0.5.0")
                .with_path("/usr/local/bin/ollama"),
            DetectedProvider::new("goose"),
        ]);
        let checker = MockChecker::new()
            .with_version("ollama", "0.6.0")
            .with_version("goose", "1.2.0");

        let detected = detector.detect();
        assert_eq!(detected.len(), 2);
        assert_eq!(detected[0].path.as_deref(), Some("/usr/local/bin/ollama"));

        let versions = latest_versions(&checker, &detected);
        assert_eq!(versions.get("ollama").map(String::as_str), Some("0.6.0"));
        assert_eq!(versions.get("goose").map(String::as_str), Some("1.2.0"));

        // A provider the checker does not know is reported as a failed check,
        // and `latest_versions` leaves it out instead of panicking.
        assert!(matches!(
            checker.latest_version("gemini-cli"),
            Err(ProviderUpdateError::Check { .. })
        ));
        let partial = MockDetector::new(vec![
            DetectedProvider::new("ollama"),
            DetectedProvider::new("gemini-cli"),
        ]);
        let versions = latest_versions(&checker, &partial.detect());
        assert_eq!(versions.len(), 1);
        assert_eq!(versions.get("ollama").map(String::as_str), Some("0.6.0"));
    }
}
