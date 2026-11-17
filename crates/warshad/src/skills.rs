//! Skill-registry helpers: the built-in composer commands, the installed skills as one
//! registry, the lock that install is verified against, and the catalog one role's pack
//! serves. Moved verbatim out of `lib.rs` (P-H1 A2, pure move).

use std::collections::HashMap;
use std::path::Path;
use tracing::warn;
use warsha_core::{Artifact, Role, Stage};
use warsha_pipeline::{
    LicenseClass, RolePack, Skill, SkillError, SkillManifest, SkillRegistry, SkillsLockfile,
    SlashCommand, SlashCommandRegistry,
};
use warsha_store::StoredSkill;

/// The composer's built-in commands: `/review`, `/refactor`, `/test`, `/fix`,
/// `/explain`, in the order the composer should offer them.
///
/// These are commands the agent loop implements itself, not installed skills, so they
/// sit in the catalog beside the registry's entries and a turn written against
/// `/review` keeps working whether or not a pack is installed. The *skills* the
/// catalog serves are the installed rows, loaded through
/// `warsha_pipeline::SkillRegistry` and verified against [`SKILLS_LOCK_FILE`]
/// (ENGINE P-E6) — no longer a constant list.
const BUILTIN_SKILL_COMMANDS: &[(&str, &str)] = &[
    ("review", "Review the current diff and report problems"),
    (
        "refactor",
        "Restructure the code without changing behaviour",
    ),
    ("test", "Write or run the tests for the current change"),
    ("fix", "Repair the failing check, test or build"),
    ("explain", "Explain what a file or a change does"),
    ("interview", "Conduct the secretary interview to refine the project brief"),
];

/// The lock the daemon verifies its installed skills against: `factory/skills.lock`
/// under the daemon's data directory.
///
/// `PLAN.md` names `factory/skills.lock` for the pinned install. The install is
/// daemon-wide — one settings store holds the rows every project draws from — so the
/// file is rooted at the data directory rather than inside a project's `factory/`,
/// which holds that project's run artifacts.
pub(crate) const SKILLS_LOCK_FILE: &str = "factory/skills.lock";

/// The shipped skills each role's pack names, in the order the role reaches for them.
///
/// The pack is the role's whole scope: [`SkillRegistry::skills_for_role`] returns
/// exactly these ids and errors when one of them is not installed, so a role can never
/// quietly lose a skill. The daemon refuses that role's catalog instead.
fn role_pack_skills(role: Role) -> &'static [&'static str] {
    match role {
        Role::Intake => &["brainstorming", "writing-plans"],
        Role::Researcher => &["brainstorming", "writing-plans", "skill-creator"],
        Role::PM => &["brainstorming", "writing-plans"],
        Role::Designer => &["frontend-design", "brainstorming"],
        Role::Architect => &[
            "writing-plans",
            "dispatching-parallel-agents",
            "mcp-builder",
        ],
        Role::Coder => &[
            "test-driven-development",
            "systematic-debugging",
            "using-git-worktrees",
            "verification-before-completion",
        ],
        Role::Reviewer => &["requesting-code-review", "verification-before-completion"],
        Role::QA => &[
            "webapp-testing",
            "test-driven-development",
            "verification-before-completion",
        ],
        Role::Security => &["requesting-code-review", "systematic-debugging"],
        Role::Release => &["verification-before-completion", "using-git-worktrees"],
        Role::Marketer => &["brainstorming", "frontend-design"],
        Role::Feedback => &["brainstorming", "writing-plans"],
        Role::Secretary => &["brainstorming", "writing-plans"],
    }
}

/// One pack per role, named `<role>-base` the way `warsha-pipeline`'s defaults are.
fn daemon_role_packs() -> Vec<RolePack> {
    Role::all()
        .iter()
        .map(|role| {
            RolePack::new(
                *role,
                format!("{}-base", format!("{role:?}").to_lowercase()),
                role_pack_skills(*role)
                    .iter()
                    .map(|id| (*id).to_string())
                    .collect(),
            )
        })
        .collect()
}

/// The pin one installed pack is locked at: SHA-256 over the row's own bytes.
///
/// A store row keeps the pack's id, name, description, body, source and license but no
/// version or commit column, so the daemon pins what it has. The digest is the
/// pipeline's tested artifact digest (`artifacts_sha256`) over the row as one artifact,
/// with a fixed stage and version as the domain: the pin therefore depends on the row's
/// bytes alone, and an edited body, license, source, description or tag list is a pin
/// [`SkillsLockfile::verify`] refuses.
fn skill_pin(row: &StoredSkill) -> String {
    let artifact = Artifact {
        name: row.id.clone(),
        content: format!(
            "{}\n---\n{}\n---\n{}\n---\n{}\n---\n{}",
            row.name, row.description, row.source, row.license, row.content
        ),
        stage: Stage::Code,
        role: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        version: 1,
    };
    let mut artifacts = HashMap::new();
    artifacts.insert(row.id.clone(), artifact);
    warsha_pipeline::artifacts_sha256(&artifacts)
}

/// The license class a store row's SPDX tag falls in.
///
/// `skills.rs` reads an explicit `license_class` from a `SKILL.md` frontmatter; a store
/// row keeps only the tag, so the class is read off it into the same three buckets: a
/// copyleft id is link-only (`SkillRegistry::register` refuses it), a permissive id may
/// be bundled, and an id this table does not know is `Unknown` rather than assumed.
fn license_class_of(license: &str) -> LicenseClass {
    let license = license.trim().to_lowercase();
    if license.contains("gpl") {
        LicenseClass::Copyleft
    } else if matches!(
        license.as_str(),
        "mit" | "apache-2.0" | "apache2" | "bsd-2-clause" | "bsd-3-clause" | "isc"
    ) {
        LicenseClass::Permissive
    } else {
        LicenseClass::Unknown
    }
}

/// One installed row as a registry skill.
fn installed_skill(row: &StoredSkill, data_dir: &Path) -> Skill {
    let pin = skill_pin(row);
    Skill {
        manifest: SkillManifest {
            id: row.id.clone(),
            name: row.name.clone(),
            description: row.description.clone(),
            // The row carries no author, and the upstream is not one: the manifest keeps
            // it empty rather than naming the repository as if it were.
            author: String::new(),
            license: row.license.clone(),
            license_class: license_class_of(&row.license),
            repository: row.source.clone(),
            // The pin is both the version and the commit the lock records: a row has
            // neither, and the bytes that changed are what a lock is about.
            version: pin.clone(),
            commit: pin,
            dependencies: Vec::new(),
            provides: Vec::new(),
            required_permissions: Vec::new(),
            // Tags index the registry; a row whose list cannot be parsed is still a
            // skill the owner installed, so the parse falls back to no tags.
            tags: serde_json::from_str(&row.tags_json).unwrap_or_default(),
        },
        content: row.content.clone(),
        loaded_at: chrono::Utc::now().to_rfc3339(),
        // Where a directory install of this pack would live under the daemon's data
        // directory; the row in the settings store is the record.
        source_path: data_dir.join("skills").join(&row.id).join("SKILL.md"),
    }
}

/// Every installed row as one registry, with a pack per role.
///
/// Registering fails exactly where `SkillRegistry::register` refuses to bundle a
/// copyleft pack, so a GPL pack the owner imported is an error here rather than a skill
/// the catalog quietly ships.
pub(crate) fn installed_skill_registry(
    rows: &[StoredSkill],
    data_dir: &Path,
) -> std::result::Result<SkillRegistry, String> {
    let mut registry = SkillRegistry::new();
    for row in rows {
        registry
            .register(installed_skill(row, data_dir))
            .map_err(|error| {
                format!("the installed skill `{}` cannot be served: {error}", row.id)
            })?;
    }
    for pack in daemon_role_packs() {
        registry.set_pack(pack);
    }
    Ok(registry)
}

/// The installed skills, verified against the install's lock.
///
/// A missing lock is a first start and is written from the registry; if it cannot be
/// written the catalog is served un-pinned and the failure is logged, because the
/// install — not a read-only data directory — is what the gate is about. A lock that is
/// present must agree with the install in every direction `SkillsLockfile::verify`
/// checks: a locked pack that is not loaded, a version or commit that moved, or an
/// installed pack the lock never named. A disagreement is an error, never a shorter
/// catalog — a catalog that silently changes under the owner is the bug this gate
/// exists for.
pub(crate) fn verified_skill_registry(
    data_dir: &Path,
    rows: &[StoredSkill],
) -> std::result::Result<SkillRegistry, String> {
    let registry = installed_skill_registry(rows, data_dir)?;
    let path = data_dir.join(SKILLS_LOCK_FILE);
    let lock = match SkillsLockfile::load(&path) {
        Ok(lock) => lock,
        Err(SkillError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(error) = SkillsLockfile::from_registry(&registry).save(&path) {
                warn!(
                    "the skills lock {} could not be written, so the catalog is served un-pinned: {error}",
                    path.display()
                );
            }
            return Ok(registry);
        }
        Err(error) => {
            return Err(format!(
                "the skills lock {} could not be read: {error}",
                path.display()
            ))
        }
    };
    lock.verify(&registry).map_err(|error| {
        format!(
            "the installed skills no longer match {}: {error}; re-pin the lock when the install changes",
            path.display()
        )
    })?;
    Ok(registry)
}

/// The commands one catalog serves: the built-in composer commands, then the registry's
/// skills the owner left enabled, sorted by id so the picker's order is stable.
///
/// `role` narrows the skills to that role's pack through
/// [`SkillRegistry::skills_for_role`], which fails closed when the pack names a skill
/// that is not installed.
pub(crate) fn catalog_from_registry(
    registry: &SkillRegistry,
    rows: &[StoredSkill],
    role: Option<Role>,
) -> std::result::Result<Vec<SlashCommand>, String> {
    let enabled: HashMap<&str, bool> = rows
        .iter()
        .map(|row| (row.id.as_str(), row.enabled))
        .collect();
    let mut commands = SlashCommandRegistry::new();
    for (name, description) in BUILTIN_SKILL_COMMANDS {
        // The constants above are well formed (no blank name, no whitespace, no
        // duplicate), so a refusal cannot happen and an entry that somehow failed would
        // simply not be listed rather than failing the catalog.
        let _ = commands.register(SlashCommand::new(*name, *description));
    }
    let mut skills = match role {
        Some(role) => registry
            .skills_for_role(role)
            .map_err(|error| error.to_string())?,
        None => registry.list_skills(),
    };
    skills.sort_by(|left, right| left.manifest.id.cmp(&right.manifest.id));
    for skill in skills {
        if !enabled
            .get(skill.manifest.id.as_str())
            .copied()
            .unwrap_or(false)
        {
            continue;
        }
        // A blank description, or a name the built-ins already claim, is not the
        // catalog's to rewrite: `register` refuses it and the skill is left out.
        let _ = commands.register(SlashCommand::new(
            &skill.manifest.id,
            &skill.manifest.description,
        ));
    }
    Ok(commands.skills())
}
