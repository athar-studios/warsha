//! Skill/MCP Scout — Discover and propose skills and MCP servers per agent

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use ulid::Ulid;
use warsha_core::*;

#[derive(Error, Debug)]
pub enum ScoutError {
    #[error("Catalog not found: {0}")]
    CatalogNotFound(String),
    #[error("Network error: {0}")]
    Network(String),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("License not compatible: {0}")]
    LicenseNotCompatible(String),
}

pub type Result<T> = std::result::Result<T, ScoutError>;

/// Scout source type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScoutSource {
    /// Local skill directory
    Local,
    /// Git repository (GitHub, GitLab, etc.)
    Git,
    /// MCP Registry (modelcontextprotocol.io/registry)
    McpRegistry,
    /// npm registry
    Npm,
    /// Custom catalog URL
    Custom,
}

/// Proposed item from scout
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoutProposal {
    pub id: String,
    pub source: ScoutSource,
    pub source_url: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub license: String,
    pub license_class: LicenseClass,
    pub target_role: Role,
    pub provides: Vec<String>,
    pub required_permissions: Vec<String>,
    pub dependencies: Vec<ScoutDependency>,
    pub metadata: HashMap<String, serde_json::Value>,
    pub discovered_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoutDependency {
    pub name: String,
    pub version_req: String,
    pub source: ScoutSource,
    pub optional: bool,
}

/// License class (re-exported from [`crate::skills`] so both modules agree)
pub use crate::skills::LicenseClass;

/// Scout configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoutConfig {
    pub enabled_sources: Vec<ScoutSource>,
    pub max_proposals_per_role: usize,
    pub auto_approve_permissive: bool,
    pub require_license_check: bool,
    pub catalog_urls: HashMap<ScoutSource, String>,
}

impl Default for ScoutConfig {
    fn default() -> Self {
        let mut catalog_urls = HashMap::new();
        catalog_urls.insert(
            ScoutSource::McpRegistry,
            "https://registry.modelcontextprotocol.io".to_string(),
        );
        catalog_urls.insert(ScoutSource::Npm, "https://registry.npmjs.org".to_string());

        Self {
            enabled_sources: vec![
                ScoutSource::Local,
                ScoutSource::McpRegistry,
                ScoutSource::Npm,
            ],
            max_proposals_per_role: 10,
            auto_approve_permissive: false,
            require_license_check: true,
            catalog_urls,
        }
    }
}

/// Scout result for a project
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoutResult {
    pub project_id: ProjectId,
    pub run_id: Option<RunId>,
    pub proposals: HashMap<Role, Vec<ScoutProposal>>,
    pub generated_at: String,
    pub config_snapshot: ScoutConfig,
}

/// Scout agent
pub struct Scout {
    config: ScoutConfig,
}

impl Scout {
    pub fn new(config: ScoutConfig) -> Self {
        Self { config }
    }

    /// Run scout for a project/agent
    pub async fn scout_for_role(
        &self,
        project_id: ProjectId,
        role: Role,
        _run_id: Option<RunId>,
    ) -> Result<Vec<ScoutProposal>> {
        let mut proposals = Vec::new();

        // Scout from enabled sources
        for source in &self.config.enabled_sources {
            match source {
                ScoutSource::Local => {
                    proposals.extend(self.scout_local(project_id, role).await?);
                }
                ScoutSource::McpRegistry => {
                    proposals.extend(self.scout_mcp_registry(project_id, role).await?);
                }
                ScoutSource::Npm => {
                    proposals.extend(self.scout_npm(project_id, role).await?);
                }
                ScoutSource::Git => {
                    proposals.extend(self.scout_git(project_id, role).await?);
                }
                ScoutSource::Custom => {
                    proposals.extend(self.scout_custom(project_id, role).await?);
                }
            }
        }

        // Filter by license if required
        if self.config.require_license_check {
            proposals.retain(|p| {
                matches!(
                    p.license_class,
                    LicenseClass::Permissive | LicenseClass::Custom | LicenseClass::Unknown
                )
            });
        }

        // Limit results
        proposals.truncate(self.config.max_proposals_per_role);

        Ok(proposals)
    }

    /// Full project scout
    pub async fn scout_project(
        &self,
        project_id: ProjectId,
        run_id: Option<RunId>,
        roles: Vec<Role>,
    ) -> Result<ScoutResult> {
        let mut proposals = HashMap::new();

        for role in roles {
            let role_proposals = self.scout_for_role(project_id, role, run_id).await?;
            proposals.insert(role, role_proposals);
        }

        Ok(ScoutResult {
            project_id,
            run_id,
            proposals,
            generated_at: Utc::now().to_rfc3339(),
            config_snapshot: self.config.clone(),
        })
    }

    /// Scout local skill directories
    async fn scout_local(&self, _project_id: ProjectId, role: Role) -> Result<Vec<ScoutProposal>> {
        // In real implementation, scan ~/.config/warsha/skills/ or project/.warsha/skills/
        // For now, return mock proposals based on role
        Ok(vec![ScoutProposal {
            id: Ulid::new().to_string(),
            source: ScoutSource::Local,
            source_url: "local://skills".to_string(),
            name: format!("{:?}-local-skill", role),
            version: "1.0.0".to_string(),
            description: format!("Local skill for {:?}", role),
            license: "MIT".to_string(),
            license_class: LicenseClass::Permissive,
            target_role: role,
            provides: vec![format!("{:?}-capability", role)],
            required_permissions: vec![],
            dependencies: vec![],
            metadata: HashMap::new(),
            discovered_at: Utc::now().to_rfc3339(),
        }])
    }

    /// Scout MCP Registry
    async fn scout_mcp_registry(
        &self,
        _project_id: ProjectId,
        role: Role,
    ) -> Result<Vec<ScoutProposal>> {
        // In real implementation, query https://registry.modelcontextprotocol.io
        // Return mock proposals
        let role_tools = match role {
            Role::Coder => vec!["github", "filesystem", "sqlite", "postgres"],
            Role::Researcher => vec!["web-search", "wikipedia", "arxiv"],
            Role::Designer => vec!["figma", "storybook"],
            Role::Security => vec!["semgrep", "trivy", "owasp-zap"],
            Role::QA => vec!["playwright", "cypress", "postman"],
            Role::Release => vec!["github-actions", "docker", "helm"],
            _ => vec!["filesystem"],
        };

        Ok(role_tools
            .into_iter()
            .map(|tool| ScoutProposal {
                id: Ulid::new().to_string(),
                source: ScoutSource::McpRegistry,
                source_url: format!("https://registry.modelcontextprotocol.io/{}", tool),
                name: format!("mcp-{}", tool),
                version: "latest".to_string(),
                description: format!("MCP server for {}", tool),
                license: "MIT".to_string(),
                license_class: LicenseClass::Permissive,
                target_role: role,
                provides: vec![tool.to_string()],
                required_permissions: vec!["network".to_string(), "filesystem".to_string()],
                dependencies: vec![],
                metadata: HashMap::new(),
                discovered_at: Utc::now().to_rfc3339(),
            })
            .collect())
    }

    /// Scout npm registry for skill packages
    async fn scout_npm(&self, _project_id: ProjectId, role: Role) -> Result<Vec<ScoutProposal>> {
        // In real implementation, query npm registry for @warsha/skill-* packages
        Ok(vec![ScoutProposal {
            id: Ulid::new().to_string(),
            source: ScoutSource::Npm,
            source_url: "https://registry.npmjs.org".to_string(),
            name: format!("@warsha/skill-{:?}-base", role).to_lowercase(),
            version: "1.0.0".to_string(),
            description: format!("Base skill pack for {:?}", role),
            license: "MIT".to_string(),
            license_class: LicenseClass::Permissive,
            target_role: role,
            provides: vec![format!("{:?}-base", role)],
            required_permissions: vec![],
            dependencies: vec![],
            metadata: HashMap::new(),
            discovered_at: Utc::now().to_rfc3339(),
        }])
    }

    /// Scout Git repositories
    async fn scout_git(&self, _project_id: ProjectId, _role: Role) -> Result<Vec<ScoutProposal>> {
        // In real implementation, search GitHub for skill repos
        Ok(vec![])
    }

    /// Scout custom catalogs
    async fn scout_custom(
        &self,
        _project_id: ProjectId,
        _role: Role,
    ) -> Result<Vec<ScoutProposal>> {
        Ok(vec![])
    }

    /// Install approved proposal (record in skills.lock)
    pub fn install_proposal(
        &self,
        proposal: &ScoutProposal,
        lockfile: &mut crate::skills::SkillsLockfile,
    ) -> Result<()> {
        let entry = crate::skills::SkillsLockEntry {
            skill_id: proposal.id.clone(),
            version: proposal.version.clone(),
            commit: proposal
                .metadata
                .get("commit")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            license: proposal.license.clone(),
            license_class: proposal.license_class,
            resolved_at: Utc::now().to_rfc3339(),
            source: match proposal.source {
                ScoutSource::Local => crate::skills::SkillSource::Local,
                ScoutSource::Git => crate::skills::SkillSource::Git {
                    url: proposal.source_url.clone(),
                    commit: proposal
                        .metadata
                        .get("commit")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                },
                ScoutSource::McpRegistry | ScoutSource::Npm | ScoutSource::Custom => {
                    crate::skills::SkillSource::Registry {
                        name: proposal.source_url.clone(),
                    }
                }
            },
        };
        lockfile.add_entry(entry);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scout_config_default() {
        let config = ScoutConfig::default();
        assert!(config.enabled_sources.contains(&ScoutSource::McpRegistry));
        assert!(config.enabled_sources.contains(&ScoutSource::Npm));
        assert!(config.require_license_check);
    }

    #[test]
    fn test_scout_proposal_creation() {
        let proposal = ScoutProposal {
            id: Ulid::new().to_string(),
            source: ScoutSource::McpRegistry,
            source_url: "https://registry.modelcontextprotocol.io/github".to_string(),
            name: "mcp-github".to_string(),
            version: "1.0.0".to_string(),
            description: "GitHub MCP server".to_string(),
            license: "MIT".to_string(),
            license_class: LicenseClass::Permissive,
            target_role: Role::Coder,
            provides: vec!["github".to_string()],
            required_permissions: vec!["network".to_string()],
            dependencies: vec![],
            metadata: HashMap::new(),
            discovered_at: Utc::now().to_rfc3339(),
        };

        assert_eq!(proposal.target_role, Role::Coder);
        assert_eq!(proposal.license_class, LicenseClass::Permissive);
    }

    #[test]
    fn test_license_filtering() {
        let mut proposals = vec![
            ScoutProposal {
                id: "1".to_string(),
                source: ScoutSource::McpRegistry,
                source_url: "test".to_string(),
                name: "permissive".to_string(),
                version: "1.0.0".to_string(),
                description: "test".to_string(),
                license: "MIT".to_string(),
                license_class: LicenseClass::Permissive,
                target_role: Role::Coder,
                provides: vec![],
                required_permissions: vec![],
                dependencies: vec![],
                metadata: HashMap::new(),
                discovered_at: Utc::now().to_rfc3339(),
            },
            ScoutProposal {
                id: "2".to_string(),
                source: ScoutSource::McpRegistry,
                source_url: "test".to_string(),
                name: "copyleft".to_string(),
                version: "1.0.0".to_string(),
                description: "test".to_string(),
                license: "GPL-3.0".to_string(),
                license_class: LicenseClass::Copyleft,
                target_role: Role::Coder,
                provides: vec![],
                required_permissions: vec![],
                dependencies: vec![],
                metadata: HashMap::new(),
                discovered_at: Utc::now().to_rfc3339(),
            },
        ];

        // Filter out copyleft
        proposals.retain(|p| {
            matches!(
                p.license_class,
                LicenseClass::Permissive | LicenseClass::Custom | LicenseClass::Unknown
            )
        });

        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].name, "permissive");
    }
}
