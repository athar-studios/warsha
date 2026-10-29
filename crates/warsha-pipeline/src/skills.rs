//! Skills System — Load Agent Skills from SKILL.md folders with license compliance

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use thiserror::Error;
use warsha_core::*;

#[derive(Error, Debug)]
pub enum SkillError {
    #[error("Skill not found: {0}")]
    NotFound(String),
    #[error("License not allowed: {0}")]
    LicenseNotAllowed(String),
    #[error("Invalid skill manifest: {0}")]
    InvalidManifest(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Git error: {0}")]
    Git(String),
}

pub type Result<T> = std::result::Result<T, SkillError>;

/// Allowed licenses for bundling
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LicenseClass {
    /// MIT/Apache-2.0/BSD - can be bundled with notices
    Permissive,
    /// GPL/LGPL/AGPL - link-only, fetched at runtime by user choice
    Copyleft,
    /// Custom/Proprietary - link-only, requires explicit acceptance
    Custom,
    /// Unknown - treat as Custom
    Unknown,
}

/// Skill manifest (SKILL.md frontmatter)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub license: String,
    pub license_class: LicenseClass,
    pub repository: String,
    pub commit: String, // Pinned commit hash
    pub dependencies: Vec<SkillDependency>,
    pub provides: Vec<String>, // Capabilities this skill provides
    pub required_permissions: Vec<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillDependency {
    pub skill_id: String,
    pub version_req: String, // semver requirement
    pub optional: bool,
}

/// Loaded skill with content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub manifest: SkillManifest,
    pub content: String, // The SKILL.md markdown content
    pub loaded_at: String,
    pub source_path: PathBuf,
}

/// Skill pack for a role
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolePack {
    pub role: Role,
    pub name: String,
    pub version: String,
    pub skills: Vec<String>, // Skill IDs in load order
    pub created_at: String,
    pub updated_at: String,
}

impl RolePack {
    pub fn new(role: Role, name: String, skills: Vec<String>) -> Self {
        Self {
            role,
            name,
            version: "1.0.0".to_string(),
            skills,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }
}

/// Skill registry
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SkillRegistry {
    pub skills: HashMap<String, Skill>,
    pub packs: HashMap<Role, RolePack>,
    pub index: HashMap<String, Vec<String>>, // tag -> skill IDs
}

impl SkillRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, skill: Skill) -> Result<()> {
        let id = skill.manifest.id.clone();

        // Check license
        if skill.manifest.license_class == LicenseClass::Copyleft {
            return Err(SkillError::LicenseNotAllowed(format!(
                "Copyleft license ({}) not allowed for bundling: {}",
                skill.manifest.license, id
            )));
        }

        // Index by tags
        for tag in &skill.manifest.tags {
            self.index.entry(tag.clone()).or_default().push(id.clone());
        }

        self.skills.insert(id, skill);
        Ok(())
    }

    pub fn get(&self, id: &str) -> Option<&Skill> {
        self.skills.get(id)
    }

    pub fn find_by_tag(&self, tag: &str) -> Vec<&Skill> {
        self.index
            .get(tag)
            .map(|ids| ids.iter().filter_map(|id| self.skills.get(id)).collect())
            .unwrap_or_default()
    }

    pub fn set_pack(&mut self, pack: RolePack) {
        self.packs.insert(pack.role, pack);
    }

    pub fn get_pack(&self, role: Role) -> Option<&RolePack> {
        self.packs.get(&role)
    }

    pub fn list_skills(&self) -> Vec<&Skill> {
        self.skills.values().collect()
    }
}

/// Default role packs
pub fn default_role_packs() -> Vec<RolePack> {
    vec![
        RolePack::new(
            Role::PM,
            "pm-base".to_string(),
            vec![
                "planning".to_string(),
                "task-decomposition".to_string(),
                "stakeholder-communication".to_string(),
            ],
        ),
        RolePack::new(
            Role::Architect,
            "architect-base".to_string(),
            vec![
                "system-design".to_string(),
                "api-design".to_string(),
                "data-modeling".to_string(),
            ],
        ),
        RolePack::new(
            Role::Coder,
            "coder-base".to_string(),
            vec![
                "code-generation".to_string(),
                "refactoring".to_string(),
                "testing".to_string(),
                "debugging".to_string(),
            ],
        ),
        RolePack::new(
            Role::Reviewer,
            "reviewer-base".to_string(),
            vec![
                "code-review".to_string(),
                "security-audit".to_string(),
                "performance-review".to_string(),
            ],
        ),
        RolePack::new(
            Role::QA,
            "qa-base".to_string(),
            vec![
                "test-planning".to_string(),
                "test-automation".to_string(),
                "bug-reporting".to_string(),
            ],
        ),
        RolePack::new(
            Role::Security,
            "security-base".to_string(),
            vec![
                "threat-modeling".to_string(),
                "vulnerability-scanning".to_string(),
                "compliance-check".to_string(),
            ],
        ),
        RolePack::new(
            Role::Designer,
            "designer-base".to_string(),
            vec![
                "ui-design".to_string(),
                "ux-research".to_string(),
                "design-system".to_string(),
            ],
        ),
        RolePack::new(
            Role::Researcher,
            "researcher-base".to_string(),
            vec![
                "market-research".to_string(),
                "competitive-analysis".to_string(),
                "tech-evaluation".to_string(),
            ],
        ),
        RolePack::new(
            Role::Release,
            "release-base".to_string(),
            vec![
                "release-notes".to_string(),
                "changelog-generation".to_string(),
                "deployment-checklist".to_string(),
            ],
        ),
        RolePack::new(
            Role::Marketer,
            "marketer-base".to_string(),
            vec![
                "landing-page-copy".to_string(),
                "launch-strategy".to_string(),
                "seo-optimization".to_string(),
            ],
        ),
        RolePack::new(
            Role::Feedback,
            "feedback-base".to_string(),
            vec![
                "user-interview".to_string(),
                "metrics-analysis".to_string(),
                "iteration-planning".to_string(),
            ],
        ),
        RolePack::new(
            Role::Intake,
            "intake-base".to_string(),
            vec![
                "requirements-gathering".to_string(),
                "scope-definition".to_string(),
            ],
        ),
    ]
}

/// Load a skill from a directory
pub async fn load_skill_from_dir(path: PathBuf) -> Result<Skill> {
    let manifest_path = path.join("SKILL.md");
    let content = std::fs::read_to_string(&manifest_path)?;

    // Parse frontmatter (simplified - in real implementation use a proper parser)
    let manifest = parse_skill_manifest(&content)?;

    Ok(Skill {
        manifest,
        content,
        loaded_at: Utc::now().to_rfc3339(),
        source_path: path,
    })
}

/// Parse skill manifest from markdown frontmatter
///
/// Only the small YAML subset used by `SKILL.md` files is understood:
/// `key: value` lines, quoted scalars and `[a, b]` inline lists. Anything more
/// elaborate is rejected rather than guessed at.
fn parse_skill_manifest(content: &str) -> Result<SkillManifest> {
    let frontmatter = split_frontmatter(content)?;
    let fields = parse_frontmatter_fields(frontmatter);

    let manifest = SkillManifest {
        id: required_field(&fields, "id")?,
        name: required_field(&fields, "name")?,
        version: required_field(&fields, "version")?,
        description: field(&fields, "description"),
        author: field(&fields, "author"),
        license: field(&fields, "license"),
        license_class: parse_license_class(&field(&fields, "license_class")),
        repository: field(&fields, "repository"),
        commit: field(&fields, "commit"),
        dependencies: Vec::new(),
        provides: list_field(&fields, "provides"),
        required_permissions: list_field(&fields, "required_permissions"),
        tags: list_field(&fields, "tags"),
    };

    // Validate required fields
    if manifest.id.is_empty() || manifest.name.is_empty() || manifest.version.is_empty() {
        return Err(SkillError::InvalidManifest(
            "Missing required fields".to_string(),
        ));
    }

    Ok(manifest)
}

/// Return the text between the opening and closing `---` fences.
fn split_frontmatter(content: &str) -> Result<&str> {
    if !content.starts_with("---") {
        return Err(SkillError::InvalidManifest(
            "Missing frontmatter".to_string(),
        ));
    }

    let mut parts = content.splitn(3, "---");
    let _opening = parts.next();
    match (parts.next(), parts.next()) {
        (Some(frontmatter), Some(_body)) => Ok(frontmatter),
        _ => Err(SkillError::InvalidManifest(
            "Invalid frontmatter format".to_string(),
        )),
    }
}

/// Collect the `key: value` pairs of a frontmatter block.
fn parse_frontmatter_fields(frontmatter: &str) -> BTreeMap<String, String> {
    let mut fields = BTreeMap::new();
    for line in frontmatter.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        fields.insert(key.to_string(), unquote(value));
    }
    fields
}

/// Strip one layer of matching quotes from a scalar.
fn unquote(value: &str) -> String {
    let trimmed = value.trim();
    let unquoted = trimmed
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .or_else(|| {
            trimmed
                .strip_prefix('\'')
                .and_then(|rest| rest.strip_suffix('\''))
        })
        .unwrap_or(trimmed);
    unquoted.trim().to_string()
}

/// Read an optional scalar field, defaulting to an empty string.
fn field(fields: &BTreeMap<String, String>, key: &str) -> String {
    fields.get(key).cloned().unwrap_or_default()
}

/// Read a required scalar field.
fn required_field(fields: &BTreeMap<String, String>, key: &str) -> Result<String> {
    match fields.get(key) {
        Some(value) if !value.is_empty() => Ok(value.clone()),
        _ => Err(SkillError::InvalidManifest(format!(
            "Missing required field: {key}"
        ))),
    }
}

/// Read an inline `[a, b]` list field.
fn list_field(fields: &BTreeMap<String, String>, key: &str) -> Vec<String> {
    let Some(value) = fields.get(key) else {
        return Vec::new();
    };
    value
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .map(unquote)
        .filter(|item| !item.is_empty())
        .collect()
}

/// Map a `license_class` scalar onto [`LicenseClass`].
fn parse_license_class(value: &str) -> LicenseClass {
    match value.trim().to_lowercase().as_str() {
        "permissive" => LicenseClass::Permissive,
        "copyleft" => LicenseClass::Copyleft,
        "custom" => LicenseClass::Custom,
        _ => LicenseClass::Unknown,
    }
}

/// Skill pack lockfile entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsLockEntry {
    pub skill_id: String,
    pub version: String,
    pub commit: String,
    pub license: String,
    pub license_class: LicenseClass,
    pub resolved_at: String,
    pub source: SkillSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSource {
    Local,
    Git { url: String, commit: String },
    Registry { name: String },
}

/// Skills lockfile
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SkillsLockfile {
    pub version: u32,
    pub entries: HashMap<String, SkillsLockEntry>,
    pub updated_at: String,
}

impl SkillsLockfile {
    pub fn new() -> Self {
        Self {
            version: 1,
            entries: HashMap::new(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    pub fn add_entry(&mut self, entry: SkillsLockEntry) {
        self.entries.insert(entry.skill_id.clone(), entry);
        self.updated_at = Utc::now().to_rfc3339();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_role_packs() {
        let packs = default_role_packs();
        assert_eq!(packs.len(), 12); // All 12 roles

        // Check PM pack exists
        let pm_pack = packs.iter().find(|p| p.role == Role::PM).unwrap();
        assert!(!pm_pack.skills.is_empty());
    }

    #[test]
    fn test_parse_skill_manifest_frontmatter() {
        let content = "---\n\
                       id: \"wave-skill\"\n\
                       name: Wave Skill\n\
                       version: 0.2.0\n\
                       description: Makes waves\n\
                       author: 'Acme'\n\
                       license: MIT\n\
                       license_class: permissive\n\
                       repository: https://github.com/acme/wave\n\
                       commit: abc123\n\
                       tags: [wave, audio]\n\
                       provides: [wave-making]\n\
                       ---\n\
                       \n\
                       # Wave Skill\n";

        let manifest = parse_skill_manifest(content).expect("frontmatter should parse");

        assert_eq!(manifest.id, "wave-skill");
        assert_eq!(manifest.name, "Wave Skill");
        assert_eq!(manifest.version, "0.2.0");
        assert_eq!(manifest.author, "Acme");
        assert_eq!(manifest.license_class, LicenseClass::Permissive);
        assert_eq!(manifest.tags, vec!["wave".to_string(), "audio".to_string()]);
        assert_eq!(manifest.provides, vec!["wave-making".to_string()]);
        assert!(manifest.required_permissions.is_empty());
    }

    #[test]
    fn test_parse_skill_manifest_rejects_bad_frontmatter() {
        assert!(matches!(
            parse_skill_manifest("# no frontmatter here"),
            Err(SkillError::InvalidManifest(_))
        ));
        assert!(matches!(
            parse_skill_manifest("---\nid: only-an-id\n---\nbody"),
            Err(SkillError::InvalidManifest(_))
        ));
        assert!(matches!(
            parse_skill_manifest("---\nid: x\nname: y\nversion: 1.0.0\nlicense_class: GPL\n---\n"),
            Ok(manifest) if manifest.license_class == LicenseClass::Unknown
        ));
    }

    #[test]
    fn test_skill_registry() {
        let mut registry = SkillRegistry::new();

        let skill = Skill {
            manifest: SkillManifest {
                id: "test-skill".to_string(),
                name: "Test Skill".to_string(),
                version: "1.0.0".to_string(),
                description: "A test skill".to_string(),
                author: "Test".to_string(),
                license: "MIT".to_string(),
                license_class: LicenseClass::Permissive,
                repository: "https://github.com/test/skill".to_string(),
                commit: "abc123".to_string(),
                dependencies: vec![],
                provides: vec!["testing".to_string()],
                required_permissions: vec![],
                tags: vec!["test".to_string()],
            },
            content: "# Test Skill\n\nDoes testing.".to_string(),
            loaded_at: Utc::now().to_rfc3339(),
            source_path: PathBuf::from("/tmp/test"),
        };

        registry.register(skill.clone()).unwrap();
        assert!(registry.get("test-skill").is_some());
        assert!(!registry.find_by_tag("test").is_empty());
    }

    #[test]
    fn test_copyleft_rejected() {
        let mut registry = SkillRegistry::new();

        let skill = Skill {
            manifest: SkillManifest {
                id: "gpl-skill".to_string(),
                name: "GPL Skill".to_string(),
                version: "1.0.0".to_string(),
                description: "GPL skill".to_string(),
                author: "Test".to_string(),
                license: "GPL-3.0".to_string(),
                license_class: LicenseClass::Copyleft,
                repository: "https://github.com/test/skill".to_string(),
                commit: "abc123".to_string(),
                dependencies: vec![],
                provides: vec![],
                required_permissions: vec![],
                tags: vec![],
            },
            content: "# GPL Skill".to_string(),
            loaded_at: Utc::now().to_rfc3339(),
            source_path: PathBuf::from("/tmp/test"),
        };

        let result = registry.register(skill);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            SkillError::LicenseNotAllowed(_)
        ));
    }

    #[test]
    fn test_skills_lockfile() {
        let mut lockfile = SkillsLockfile::new();

        let entry = SkillsLockEntry {
            skill_id: "test-skill".to_string(),
            version: "1.0.0".to_string(),
            commit: "abc123".to_string(),
            license: "MIT".to_string(),
            license_class: LicenseClass::Permissive,
            resolved_at: Utc::now().to_rfc3339(),
            source: SkillSource::Local,
        };

        lockfile.add_entry(entry);
        assert!(lockfile.entries.contains_key("test-skill"));
    }
}
