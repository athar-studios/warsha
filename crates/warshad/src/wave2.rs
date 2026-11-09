//! Wave 2 support — the conversions, seeding, import parsers and file-browser
//! guards the `harness.*`, `skills.*`, `plugins.*`, `models.*`, `integrations.*`
//! and `files.*` RPC methods are built from (PLAN.md Wave 2).
//!
//! Three rules run through this whole module, and they are the reason it exists as
//! a file of its own rather than as more methods in `lib.rs`:
//!
//! - **The store row is the record; the core definition is the wire shape.** A
//!   `StoredHarness` keeps its `HarnessDefinition` as JSON in `data_json` because
//!   the row's flat columns (`id`, `name`, `description`) exist for listing and
//!   searching while the stages and rules belong to the definition. Both halves are
//!   written from the same value, so they cannot drift, and a read that finds a
//!   damaged `data_json` rebuilds the definition from the columns rather than
//!   dropping the row from the catalog.
//! - **A bundled preset is never the copy the owner edited.** Seeding writes the
//!   presets only into a catalog that has nothing in it yet, so an owner who deleted
//!   or edited a bundled row is not overwritten by the next start — and a first run
//!   still gets a picker with content in it.
//! - **Nothing here reaches the network, and nothing here keeps a secret.** Import
//!   takes content, not a URL; a plugin's environment is stored as a *reference*
//!   with the material filed in the OS keychain; an integration's token is written
//!   to the keychain and redacted in the row, so no read can echo it.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::Deserialize;
use warsha_core::{
    CustomModelRecord, FileContent, FileEntry, HarnessDefinition, HarnessRules, HarnessStage,
    IntegrationConfig, IntegrationStatus, PluginDefinition, PluginToolDefinition, Role,
    SkillDefinition,
};
use warsha_store::{
    StoredCustomModel, StoredHarness, StoredIntegration, StoredPlugin, StoredSkill,
};

use crate::{DaemonError, Result, SettingsStore};

/// A refusal the RPC surface turns into a JSON-RPC error.
///
/// It is a sentence addressed to the owner — what went wrong and what to send
/// instead — never a stack trace or a path that could carry a secret.
pub type Refusal = String;

/// The result of a check that can only refuse: `Err` is always owner-addressable.
pub type Checked<T> = std::result::Result<T, Refusal>;

/// The file-extension table behind [`guess_mime`].
///
/// Deliberately short: these are the types the in-app viewer actually renders, and
/// anything else is reported as `text/plain` rather than guessed at by a table that
/// would be wrong the day a new language lands.
const MIME_TYPES: &[(&str, &str)] = &[
    ("md", "text/markdown"),
    ("markdown", "text/markdown"),
    ("txt", "text/plain"),
    ("json", "application/json"),
    ("jsonc", "application/json"),
    ("toml", "text/plain"),
    ("yaml", "text/yaml"),
    ("yml", "text/yaml"),
    ("rs", "text/rust"),
    ("ts", "text/typescript"),
    ("tsx", "text/tsx"),
    ("js", "text/javascript"),
    ("jsx", "text/javascript"),
    ("mjs", "text/javascript"),
    ("css", "text/css"),
    ("html", "text/html"),
    ("htm", "text/html"),
    ("svg", "image/svg+xml"),
    ("py", "text/x-python"),
    ("sh", "text/x-shellscript"),
    ("sql", "text/plain"),
    ("csv", "text/csv"),
];

/// The largest file `files.read` answers with.
///
/// The viewer pane is a text pane; a 400 MB log read into a JSON-RPC reply is a
/// daemon that stalls, and the honest refusal is cheaper than the incident.
const MAX_READ_BYTES: u64 = 1_048_576;

/// The directory under the daemon's data directory that holds a project's browsable
/// files when the project has no repository yet.
pub const PROJECT_FILES_DIR: &str = "files";

// ------------------------------------------------------------------ harness records

/// The store row for one harness definition.
///
/// `data_json` is the whole definition, so a read can rebuild it exactly; the flat
/// columns are what `harness.list` sorts and filters on without parsing.
pub fn harness_row(definition: &HarnessDefinition) -> Checked<StoredHarness> {
    Ok(StoredHarness {
        id: definition.id.clone(),
        version: definition.version.clone(),
        name: definition.name.clone(),
        description: definition.description.clone(),
        data_json: json_string(definition)?,
        is_preset: definition.preset,
        created_at: unix_secs(definition.created_at),
    })
}

/// The definition behind a row.
///
/// A row whose `data_json` does not parse is **not** dropped: the columns still
/// name a harness the owner can see, delete and overwrite by re-importing, so this
/// answers with a definition rebuilt from them and no stages. Losing the row from
/// the catalog would hide the very damage the owner needs to look at.
pub fn harness_definition(row: &StoredHarness) -> HarnessDefinition {
    match serde_json::from_str::<HarnessDefinition>(&row.data_json) {
        Ok(definition) => definition,
        Err(_) => HarnessDefinition {
            id: row.id.clone(),
            version: row.version.clone(),
            name: row.name.clone(),
            description: row.description.clone(),
            stages: Vec::new(),
            rules: default_harness_rules(),
            preset: row.is_preset,
            active: false,
            created_at: definition_time(row.created_at),
        },
    }
}

/// What `harness.import` accepts, in one field-per-line shape.
///
/// Every field but `name` has a default, because the file an owner writes is a
/// sketch of a pipeline — "these roles, in this order" — and a daemon that refuses
/// it for not restating its own schema teaches the owner nothing. `preset` and
/// `created_at` are deliberately *not* modelled here: a `harness.list` answer fed
/// back in still parses (serde ignores what a DTO does not name), and the import is
/// stamped as user-authored and right now regardless of what the document claimed.
#[derive(Debug, Deserialize)]
struct HarnessImport {
    #[serde(default)]
    id: String,
    #[serde(default)]
    version: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    stages: Vec<StageImport>,
    #[serde(default)]
    rules: Option<ImportRules>,
}

/// One stage of an import: the role is the only thing a stage must say.
#[derive(Debug, Deserialize)]
struct StageImport {
    #[serde(default)]
    id: String,
    role: Role,
    #[serde(default)]
    name: String,
    #[serde(default)]
    prompt_template: Option<String>,
    #[serde(default)]
    gate: Option<String>,
    #[serde(default)]
    auto_advance: bool,
}

/// The rules block, with every bound defaulted.
#[derive(Debug, Default, Deserialize)]
struct ImportRules {
    #[serde(default)]
    max_repair_iterations: Option<u32>,
    #[serde(default)]
    budget_cap_cents: Option<u64>,
    #[serde(default)]
    allow_parallel_subagents: Option<bool>,
    #[serde(default)]
    require_verification_receipt: Option<bool>,
}

/// The rules a harness carries when its file named none.
///
/// Three repair iterations is the number the pipeline's own bounded loop uses, and
/// both the budget ceiling and the parallel fan-out are off until the owner asks:
/// an import that silently widened what a run may spend would be a bill, not a
/// convenience.
fn default_harness_rules() -> HarnessRules {
    HarnessRules {
        max_repair_iterations: 3,
        budget_cap_cents: None,
        allow_parallel_subagents: false,
        require_verification_receipt: false,
    }
}

impl From<ImportRules> for HarnessRules {
    fn from(rules: ImportRules) -> Self {
        let defaults = default_harness_rules();
        HarnessRules {
            max_repair_iterations: rules
                .max_repair_iterations
                .unwrap_or(defaults.max_repair_iterations),
            budget_cap_cents: rules.budget_cap_cents.or(defaults.budget_cap_cents),
            allow_parallel_subagents: rules
                .allow_parallel_subagents
                .unwrap_or(defaults.allow_parallel_subagents),
            require_verification_receipt: rules
                .require_verification_receipt
                .unwrap_or(defaults.require_verification_receipt),
        }
    }
}

/// Parse an imported harness document.
///
/// `format` is the caller's claim about what `content` is. Only JSON is read today;
/// any other name is refused by name rather than guessed at, because a parser that
/// tried YAML after being told TOML is a parser that answers with a wrong pipeline.
pub fn parse_harness_import(content: &str, format: Option<&str>) -> Checked<HarnessDefinition> {
    if let Some(claimed) = format.map(str::trim).filter(|claimed| !claimed.is_empty()) {
        if !claimed.eq_ignore_ascii_case("json") {
            return Err(format!(
                "harness.import reads a JSON document; the format `{claimed}` is not one it can parse"
            ));
        }
    }
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("harness.import needs a document: the content was empty".to_string());
    }
    let imported: HarnessImport = serde_json::from_str(trimmed)
        .map_err(|error| format!("harness.import could not read the JSON document: {error}"))?;

    let name = imported.name.trim();
    if name.is_empty() {
        return Err("harness.import needs a harness with a name".to_string());
    }
    if imported.stages.is_empty() {
        return Err(format!(
            "the harness `{name}` has no stages, so a run built from it would have nothing to advance through"
        ));
    }

    let id = first_non_empty(&[&imported.id, &slug(name)])
        .ok_or_else(|| "harness.import could not name the harness it read".to_string())?;
    let stages = imported
        .stages
        .into_iter()
        .enumerate()
        .map(|(index, stage)| {
            let stage_name = first_non_empty(&[&stage.name, &role_label(stage.role)])
                .unwrap_or_else(|| format!("stage {}", index + 1));
            HarnessStage {
                id: first_non_empty(&[&stage.id]).unwrap_or_else(|| format!("stage-{}", index + 1)),
                role: stage.role,
                name: stage_name,
                prompt_template: stage
                    .prompt_template
                    .map(|template| template.trim().to_string())
                    .filter(|template| !template.is_empty()),
                gate: stage
                    .gate
                    .map(|gate| gate.trim().to_string())
                    .filter(|gate| !gate.is_empty()),
                auto_advance: stage.auto_advance,
            }
        })
        .collect();

    Ok(HarnessDefinition {
        id,
        version: if imported.version.trim().is_empty() {
            "1.0.0".to_string()
        } else {
            imported.version
        },
        name: name.to_string(),
        description: imported.description,
        stages,
        rules: imported
            .rules
            .map(HarnessRules::from)
            .unwrap_or_else(default_harness_rules),
        // An import is user-authored *because* it was imported: a document that
        // claimed to be a preset does not become one.
        preset: false,
        active: false,
        created_at: Utc::now(),
    })
}

// --------------------------------------------------------------------- skill records

/// The store row for one skill.
pub fn skill_row(definition: &SkillDefinition) -> Checked<StoredSkill> {
    Ok(StoredSkill {
        id: definition.id.clone(),
        name: definition.name.clone(),
        description: definition.description.clone(),
        source: definition.source.clone(),
        license: definition.license.clone(),
        content: definition.content.clone(),
        enabled: definition.enabled,
        tags_json: json_string(&definition.tags)?,
    })
}

/// The definition behind a row.
///
/// Returns an error naming the row if `tags_json` cannot be parsed.
pub fn skill_definition(row: &StoredSkill) -> Checked<SkillDefinition> {
    let tags = serde_json::from_str(&row.tags_json)
        .map_err(|e| format!("corrupt skill row `{}`: invalid tags_json: {e}", row.id))?;
    Ok(SkillDefinition {
        id: row.id.clone(),
        name: row.name.clone(),
        description: row.description.clone(),
        source: row.source.clone(),
        license: row.license.clone(),
        content: row.content.clone(),
        enabled: row.enabled,
        tags,
    })
}

/// What `skills.import` reads out of a markdown pack's front matter.
#[derive(Debug, Deserialize)]
struct SkillFrontMatter {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    license: String,
    #[serde(default)]
    tags: Vec<String>,
}

/// Parse an imported skill.
///
/// Two documents are read, and they are the two a skill actually ships as: a JSON
/// row (so a catalog export can be re-imported) and a markdown pack, whose optional
/// `---` front matter carries the metadata and whose body is the prompt. A
/// `name` from the caller wins over either, because the owner typed it now.
///
/// A URL is refused. `skills.import` has no outbound seam and a daemon that quietly
/// answered after fetching nothing would be reporting an install it did not perform.
pub fn parse_skill_import(url_or_content: &str, name: Option<&str>) -> Checked<SkillDefinition> {
    let trimmed = url_or_content.trim();
    if trimmed.is_empty() {
        return Err("skills.import needs a skill: the content was empty".to_string());
    }
    if is_url(trimmed) {
        return Err(
            "skills.import reads the skill's markdown or JSON; a URL is not fetched by this daemon"
                .to_string(),
        );
    }

    let (mut definition, body) = if trimmed.starts_with('{') {
        let row: SkillImport = serde_json::from_str(trimmed)
            .map_err(|error| format!("skills.import could not read the JSON skill: {error}"))?;
        (row.into_definition(), String::new())
    } else {
        let (front, body) = split_front_matter(trimmed);
        let meta: SkillFrontMatter = match front {
            Some(text) => parse_simple_front_matter(&text).map_err(|error| {
                format!("skills.import could not read the skill's front matter: {error}")
            })?,
            None => SkillFrontMatter {
                id: String::new(),
                name: String::new(),
                description: String::new(),
                source: String::new(),
                license: String::new(),
                tags: Vec::new(),
            },
        };
        let heading = first_heading(&body);
        let derived_name =
            first_non_empty(&[&meta.name, &heading.unwrap_or_default(), &first_line(&body)])
                .unwrap_or_else(|| "imported-skill".to_string());
        let definition = SkillDefinition {
            id: first_non_empty(&[&meta.id, &slug(&derived_name)])
                .unwrap_or_else(|| slug(&derived_name)),
            name: derived_name,
            description: if meta.description.trim().is_empty() {
                first_paragraph(&body)
            } else {
                meta.description
            },
            source: meta.source,
            license: if meta.license.trim().is_empty() {
                "MIT".to_string()
            } else {
                meta.license
            },
            content: body.trim().to_string(),
            enabled: true,
            tags: meta.tags.iter().map(|tag| tag.trim().to_string()).collect(),
        };
        (definition, body)
    };

    if let Some(name) = name.map(str::trim).filter(|value| !value.is_empty()) {
        definition.name = name.to_string();
        definition.id = slug(name);
    }
    if definition.content.trim().is_empty() && !body.trim().is_empty() {
        definition.content = body.trim().to_string();
    }
    if definition.content.trim().is_empty() {
        return Err(format!(
            "the skill `{}` has no prompt body, so nothing would ever be loaded into a turn",
            definition.name
        ));
    }
    Ok(definition)
}

/// The JSON shape `skills.import` accepts — every field optional.
#[derive(Debug, Default, Deserialize)]
struct SkillImport {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    license: String,
    #[serde(default)]
    content: String,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    tags: Vec<String>,
}

impl SkillImport {
    fn into_definition(self) -> SkillDefinition {
        let name = first_non_empty(&[&self.name, &self.id])
            .unwrap_or_else(|| "imported-skill".to_string());
        SkillDefinition {
            id: first_non_empty(&[&self.id, &slug(&name)]).unwrap_or_else(|| slug(&name)),
            name,
            description: self.description,
            source: self.source,
            license: if self.license.trim().is_empty() {
                "MIT".to_string()
            } else {
                self.license
            },
            content: self.content.trim().to_string(),
            enabled: self.enabled,
            tags: self.tags,
        }
    }
}

/// The front matter, if the pack has it.
///
/// Returns the metadata block and the body. A document that opens with `---` but
/// never closes it is read as a pack with no front matter — the alternative is
/// throwing away the prompt an owner can still see.
fn split_front_matter(document: &str) -> (Option<String>, String) {
    let mut lines = document.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, document.to_string());
    }
    let mut block = Vec::new();
    let mut closed = false;
    for line in lines.by_ref() {
        if line.trim() == "---" {
            closed = true;
            break;
        }
        block.push(line.to_string());
    }
    if !closed {
        return (None, document.to_string());
    }
    let body = lines.collect::<Vec<_>>().join("\n");
    (Some(block.join("\n")), body)
}

/// The tiny `key: value` reader the front matter needs.
///
/// A full YAML parser is not a dependency of this crate and the front matter of a
/// skill pack is a flat list of scalars, so this reads exactly that: a colon splits
/// the key from the value, a value in brackets is a comma list, quotes are stripped.
/// Anything else about the document is the prompt, not metadata.
fn parse_simple_front_matter(block: &str) -> Checked<SkillFrontMatter> {
    let mut meta = SkillFrontMatter {
        id: String::new(),
        name: String::new(),
        description: String::new(),
        source: String::new(),
        license: String::new(),
        tags: Vec::new(),
    };
    for line in block.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = strip_quotes(value.trim());
        match key.trim() {
            "id" => meta.id = value,
            "name" => meta.name = value,
            "description" => meta.description = value,
            "source" => meta.source = value,
            "license" => meta.license = value,
            "tags" => meta.tags = parse_tag_list(&value),
            _ => {}
        }
    }
    Ok(meta)
}

fn parse_tag_list(value: &str) -> Vec<String> {
    let inner = value
        .trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    inner
        .split(',')
        .map(|tag| strip_quotes(tag.trim()))
        .filter(|tag| !tag.is_empty())
        .collect()
}

fn strip_quotes(value: &str) -> String {
    let trimmed = value.trim();
    for quote in ['"', '\''] {
        if trimmed.len() >= 2 && trimmed.starts_with(quote) && trimmed.ends_with(quote) {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

fn first_heading(body: &str) -> Option<String> {
    body.lines()
        .map(str::trim)
        .find(|line| line.starts_with("# "))
        .map(|line| line.trim_start_matches('#').trim().to_string())
}

fn first_line(body: &str) -> String {
    body.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn first_paragraph(body: &str) -> String {
    let mut paragraph = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if !paragraph.is_empty() {
                break;
            }
            continue;
        }
        if trimmed.starts_with('#') {
            continue;
        }
        paragraph.push(trimmed);
        if paragraph.join(" ").chars().count() > 200 {
            break;
        }
    }
    paragraph.join(" ")
}

// ------------------------------------------------------------------- plugin records

/// The store row for one plugin pack.
pub fn plugin_row(definition: &PluginDefinition) -> Checked<StoredPlugin> {
    Ok(StoredPlugin {
        id: definition.id.clone(),
        name: definition.name.clone(),
        description: definition.description.clone(),
        transport: definition.transport.clone(),
        command: definition.command.clone(),
        args_json: json_string(&definition.args)?,
        env_json: json_string(&definition.env)?,
        enabled: definition.enabled,
        tools_json: json_string(&definition.tools)?,
        source: definition.source.clone(),
    })
}

/// The definition behind a row.
///
/// The definition behind a plugin row.
///
/// Returns an error naming the row if any JSON column (`args_json`, `env_json`, `tools_json`)
/// cannot be parsed.
pub fn plugin_definition(row: &StoredPlugin) -> Checked<PluginDefinition> {
    let args = serde_json::from_str(&row.args_json)
        .map_err(|e| format!("corrupt plugin row `{}`: invalid args_json: {e}", row.id))?;
    let env = serde_json::from_str(&row.env_json)
        .map_err(|e| format!("corrupt plugin row `{}`: invalid env_json: {e}", row.id))?;
    let tools = serde_json::from_str(&row.tools_json)
        .map_err(|e| format!("corrupt plugin row `{}`: invalid tools_json: {e}", row.id))?;
    Ok(PluginDefinition {
        id: row.id.clone(),
        name: row.name.clone(),
        description: row.description.clone(),
        transport: row.transport.clone(),
        command: row.command.clone(),
        args,
        env,
        enabled: row.enabled,
        tools,
        source: row.source.clone(),
    })
}

/// What `plugins.install` reads, in one manifest per field.
#[derive(Debug, Deserialize)]
struct PluginImport {
    #[serde(default)]
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    transport: String,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    tools: Vec<ToolImport>,
    #[serde(default)]
    source: String,
}

#[derive(Debug, Default, Deserialize)]
struct ToolImport {
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    parameters_json: Option<String>,
}

/// Parse a plugin manifest.
///
/// A JSON manifest is read; a URL is refused for the same reason `skills.import`
/// refuses one. The transport is checked here rather than at first launch because a
/// pack that names neither `stdio` nor `http` can never connect, and an install is
/// the moment the owner is still looking at the file.
pub fn parse_plugin_manifest(manifest_json_or_url: &str) -> Checked<PluginDefinition> {
    let trimmed = manifest_json_or_url.trim();
    if trimmed.is_empty() {
        return Err("plugins.install needs a manifest: the document was empty".to_string());
    }
    if is_url(trimmed) {
        return Err(
            "plugins.install reads a JSON manifest; a URL is not fetched by this daemon"
                .to_string(),
        );
    }
    if !trimmed.starts_with('{') {
        return Err("plugins.install reads a JSON manifest object".to_string());
    }
    let imported: PluginImport = serde_json::from_str(trimmed)
        .map_err(|error| format!("plugins.install could not read the manifest: {error}"))?;

    let name = imported.name.trim();
    if name.is_empty() {
        return Err("plugins.install needs a manifest that names the pack".to_string());
    }
    let transport = if imported.transport.trim().is_empty() {
        "stdio".to_string()
    } else {
        imported.transport.trim().to_lowercase()
    };
    if transport != "stdio" && transport != "http" {
        return Err(format!(
            "the pack `{name}` names the transport `{transport}`; this daemon connects `stdio` and `http` packs"
        ));
    }
    if transport == "stdio" && imported.command.as_deref().unwrap_or("").trim().is_empty() {
        return Err(format!(
            "the pack `{name}` is a stdio pack with no command, so there is nothing to launch"
        ));
    }

    Ok(PluginDefinition {
        id: first_non_empty(&[&imported.id, &slug(name)]).unwrap_or_else(|| slug(name)),
        name: name.to_string(),
        description: imported.description,
        transport,
        command: imported
            .command
            .map(|command| command.trim().to_string())
            .filter(|command| !command.is_empty()),
        args: imported.args,
        env: imported.env,
        enabled: imported.enabled,
        tools: imported
            .tools
            .into_iter()
            .map(|tool| PluginToolDefinition {
                name: tool.name,
                description: tool.description,
                parameters_json: tool
                    .parameters_json
                    .map(|schema| schema.trim().to_string())
                    .filter(|schema| !schema.is_empty()),
            })
            .filter(|tool| !tool.name.trim().is_empty())
            .collect(),
        source: imported.source,
    })
}

/// The keychain account one plugin's environment variable is filed under.
///
/// Namespaced by the pack so two packs that both want `GITHUB_TOKEN` hold two
/// secrets, and the reference the row carries points back at exactly one of them.
pub fn plugin_env_account(id: &str, key: &str) -> String {
    format!("plugin:{id}:{key}")
}

/// The `${secrets:…}` reference that stands for [`plugin_env_account`] in a row.
pub fn plugin_env_reference(id: &str, key: &str) -> String {
    format!("${{secrets:{}}}", plugin_env_account(id, key))
}

/// True for a value that is already a reference rather than material.
pub fn is_secret_reference(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with("${") && trimmed.ends_with('}')
}

/// Split an incoming environment map into what goes in the row and what goes in the
/// keychain.
///
/// A value that is already a reference (`${env:…}`, `${secrets:…}`) is stored as the
/// owner wrote it. Anything else is treated as secret material: it is filed in the
/// keychain and replaced in the row by the reference that names it. That is AGENTS.md
/// applied to this table — the settings database sits beside the project's data and
/// must not become the place a token lives.
pub fn split_plugin_env(
    id: &str,
    env: &HashMap<String, String>,
) -> (HashMap<String, String>, Vec<(String, String)>) {
    let mut stored = HashMap::new();
    let mut secrets = Vec::new();
    for (key, value) in env {
        if key.trim().is_empty() {
            continue;
        }
        if is_secret_reference(value) {
            stored.insert(key.clone(), value.trim().to_string());
        } else {
            let account = plugin_env_account(id, key);
            stored.insert(key.clone(), plugin_env_reference(id, key));
            secrets.push((account, value.clone()));
        }
    }
    (stored, secrets)
}

/// The references this module filed for one pack, so a removal can unfile them.
pub fn filed_secret_accounts(env: &HashMap<String, String>) -> Vec<String> {
    env.values()
        .filter_map(|value| {
            let trimmed = value.trim();
            trimmed
                .strip_prefix("${secrets:")
                .and_then(|rest| rest.strip_suffix('}'))
                .map(str::to_string)
        })
        .collect()
}

// --------------------------------------------------------------- custom model records

/// The store row for one custom model.
pub fn custom_model_row(record: &CustomModelRecord) -> StoredCustomModel {
    StoredCustomModel {
        provider: record.provider.clone(),
        model_id: record.model_id.clone(),
        display_name: record.display_name.clone(),
        context_window: record.context_window,
        enabled: record.enabled,
    }
}

/// The record behind a row.
pub fn custom_model_record(row: &StoredCustomModel) -> CustomModelRecord {
    CustomModelRecord {
        provider: row.provider.clone(),
        model_id: row.model_id.clone(),
        display_name: row.display_name.clone(),
        context_window: row.context_window,
        enabled: row.enabled,
    }
}

// ------------------------------------------------------------------ integration records

/// The keychain account an integration's access token is filed under.
pub fn integration_secret_account(id: &str) -> String {
    format!("integration:{id}")
}

/// The keychain account an integration's bot token is filed under.
pub fn integration_bot_secret_account(id: &str) -> String {
    format!("integration:{id}:bot")
}

/// The config as it is written to the row: the same shape, with both token fields
/// emptied.
///
/// This is the whole reason `IntegrationConfig` and `IntegrationStatus` are separate
/// types. The token rides the write once and is filed in the keychain; what the
/// database holds afterwards is the non-secret half, so a damaged settings file, a
/// backup and a support export all say the same thing a read is allowed to say.
pub fn redact_config(config: &IntegrationConfig) -> IntegrationConfig {
    IntegrationConfig {
        token: None,
        bot_token: None,
        webhook_url: config.webhook_url.clone(),
        channel: config.channel.clone(),
        org: config.org.clone(),
    }
}

/// The row for an integration whose config has already been redacted.
pub fn integration_row(
    id: &str,
    name: &str,
    connected: bool,
    config: &IntegrationConfig,
    configured_at: Option<u64>,
) -> Checked<StoredIntegration> {
    Ok(StoredIntegration {
        id: id.to_string(),
        name: name.to_string(),
        connected,
        config_json: json_string(config)?,
        configured_at,
    })
}

/// The redacted config a row carries.
///
/// Returns an error naming the row if `config_json` cannot be parsed.
pub fn integration_config(row: &StoredIntegration) -> Checked<IntegrationConfig> {
    serde_json::from_str(&row.config_json).map_err(|e| {
        format!(
            "corrupt integration row `{}`: invalid config_json: {e}",
            row.id
        )
    })
}

/// The status line `integrations.list` answers with.
///
/// `details` is the honest summary of what is on file: the workspace and channel the
/// owner named, and whether either credential exists in the keychain. No token value
/// appears here or anywhere else in a reply, and a credential that is *not* on file
/// is reported as absent rather than guessed from the row's `connected` flag.
pub fn integration_status(
    row: &StoredIntegration,
    has_token: bool,
    has_bot_token: bool,
) -> Checked<IntegrationStatus> {
    let config = integration_config(row)?;
    Ok(IntegrationStatus {
        id: row.id.clone(),
        name: row.name.clone(),
        connected: row.connected,
        configured_at: row.configured_at.map(definition_time),
        details: Some(serde_json::json!({
            "org": config.org,
            "channel": config.channel,
            "webhook_url": config.webhook_url,
            "has_token": has_token,
            "has_bot_token": has_bot_token,
        })),
    })
}

/// The default name of a well-known integration, so a first `connect` on an id the
/// daemon has never seen still shows the owner a word rather than a slug.
pub fn integration_name(id: &str) -> String {
    match id {
        "github" => "GitHub".to_string(),
        "slack" => "Slack".to_string(),
        "linear" => "Linear".to_string(),
        "notion" => "Notion".to_string(),
        "jira" => "Jira".to_string(),
        "figma" => "Figma".to_string(),
        other => {
            let mut chars = other.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => "Integration".to_string(),
            }
        }
    }
}

// --------------------------------------------------------------------- file browsing

/// The directory `files.*` browses for one project.
///
/// A project with a repository is browsed at that repository — that is where its
/// files are, and the browser exists to show them. A project with none gets the
/// daemon's own per-project directory, so the screen has a root it can name and a
/// write from the agent's workspace lands somewhere the browser can read back.
///
/// `project_key` is the caller's string used *only* for the fallback, and it is
/// filtered first: a project id is a UUID, and anything that is not id-shaped is not
/// allowed to become a directory name.
pub fn project_files_root(data_dir: &Path, project_id: &str, repo_path: Option<&str>) -> PathBuf {
    if let Some(path) = repo_path.map(str::trim).filter(|path| !path.is_empty()) {
        return PathBuf::from(path);
    }
    data_dir
        .join(PROJECT_FILES_DIR)
        .join(safe_directory_key(project_id))
}

/// A directory name that cannot escape the directory it is joined to.
///
/// Letters, digits, `-`, `_` and `.` survive; anything else becomes `-`, and a key
/// that ends up empty or leading with a dot becomes `project`. So `../../etc`,
/// `C:\\Windows` and `..\\` all name one inert folder under the daemon's own.
pub fn safe_directory_key(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    if cleaned.is_empty() || cleaned.starts_with('.') || cleaned == "-" {
        return "project".to_string();
    }
    cleaned.chars().take(64).collect()
}

/// Join a caller-named path to a root, refusing anything that leaves it.
///
/// Three refusals, each said in the owner's words: a `..` that climbs, an absolute
/// path or drive prefix, and a NUL. A path of `.` or the empty string is the root
/// itself, which is what a file browser dials when it opens at the top.
///
/// This is the lexical half. [`resolve_inside`] is the other half — the one that
/// asks the filesystem, so a symlink that points out of the project is caught even
/// though its name never contained `..`.
pub fn safe_join(root: &Path, relative: &str) -> Checked<PathBuf> {
    if relative.contains('\0') {
        return Err("a file path may not contain a NUL byte".to_string());
    }
    let mut cleaned = PathBuf::new();
    for component in Path::new(relative).components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => cleaned.push(segment),
            Component::ParentDir => {
                return Err(format!("`{relative}` climbs out of the project with `..`"))
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                "`{relative}` is an absolute path; a project file is named from inside the project"
            ))
            }
        }
    }
    Ok(root.join(cleaned))
}

/// The path, canonicalised, proven to still be inside `root`.
///
/// `root` itself is canonicalised first because a project path that arrives through
/// a link would otherwise make every child look like an escape.
pub fn resolve_inside(root: &Path, target: &Path) -> Checked<PathBuf> {
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "the project directory is not readable on this machine".to_string())?;
    if target == root {
        return Ok(canonical_root);
    }
    let canonical = target
        .canonicalize()
        .map_err(|_| format!("`{}` is not inside the project", target.display()))?;
    if canonical.starts_with(&canonical_root) {
        Ok(canonical)
    } else {
        Err(format!(
            "`{}` leaves the project directory, so Warsha will not read it",
            target.display()
        ))
    }
}

/// One directory level, as the browser wants it: directories first, each group by
/// name, and paths relative to the root with forward slashes.
///
/// A symlinked entry is skipped rather than followed: it is the one path shape that
/// can name something outside the project without saying `..`, and a browser whose
/// tree silently grows the daemon's own directory is a browser that leaks it.
/// A directory that cannot be opened is an empty listing, not an error — the caller
/// asked what is there, and nothing readable is there.
pub fn list_tree(root: &Path, dir: &Path) -> Checked<Vec<FileEntry>> {
    let read = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "the project directory `{}` could not be opened: {error}",
                dir.display()
            ))
        }
    };
    let mut entries = Vec::new();
    for item in read.flatten() {
        let file_type = match item.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        let is_dir = file_type.is_dir();
        let size_bytes = if is_dir {
            0
        } else {
            item.metadata().map(|meta| meta.len()).unwrap_or_default()
        };
        entries.push(FileEntry {
            name: item.file_name().to_string_lossy().to_string(),
            path: relative_to(root, &item.path()),
            is_dir,
            size_bytes,
        });
    }
    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

/// Read one text file, as the viewer pane wants it.
///
/// Binary is refused, not replaced with replacement characters: the pane shows text,
/// and a reply full of U+FFFD is an answer no one can read. The size ceiling is
/// checked before the read, so a huge file is refused cheaply.
pub fn read_text(root: &Path, file: &Path) -> Checked<FileContent> {
    let metadata = std::fs::metadata(file)
        .map_err(|_| format!("`{}` is not a file in this project", file.display()))?;
    if !metadata.is_file() {
        return Err(format!("`{}` is not a file", file.display()));
    }
    if metadata.len() > MAX_READ_BYTES {
        return Err(format!(
            "`{}` is {} bytes and Warsha reads up to {MAX_READ_BYTES} in a file view",
            file.display(),
            metadata.len()
        ));
    }
    let bytes = std::fs::read(file)
        .map_err(|error| format!("`{}` could not be read: {error}", file.display()))?;
    let content = String::from_utf8(bytes).map_err(|_| {
        format!(
            "`{}` is not a text file, so the viewer will not show it",
            file.display()
        )
    })?;
    Ok(FileContent {
        path: relative_to(root, file),
        content,
        mime_type: guess_mime(file).to_string(),
    })
}

/// The display form of a path inside the root: forward slashes, always, so a tree
/// built on Windows names the same file it does in the browser's URL.
fn relative_to(root: &Path, full: &Path) -> String {
    let canonical_root = root.canonicalize().ok();
    let root_ref = canonical_root.as_deref().unwrap_or(root);
    let relative = full
        .strip_prefix(root_ref)
        .or_else(|_| full.strip_prefix(root))
        .unwrap_or(full);
    let text = relative.to_string_lossy().replace('\\', "/");
    text.trim_matches('/').to_string()
}

/// The MIME type of a file by extension.
pub fn guess_mime(path: &Path) -> &'static str {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .and_then(|ext| {
            MIME_TYPES
                .iter()
                .find(|(known, _)| *known == ext)
                .map(|(_, mime)| *mime)
        })
        .unwrap_or("text/plain")
}

// ------------------------------------------------------------------------ seeding

/// Seed the bundled presets into an empty catalog.
///
/// "Empty" is the condition, not "missing": a catalog the owner trimmed is theirs,
/// and a start that refilled it would undo a delete the owner already made. A first
/// run, though, has to answer `harness.list`, `skills.list` and `plugins.list` with
/// the shipped presets, or the picker the owner opens on their first launch is empty
/// and the product looks broken.
pub async fn seed_bundled_records(settings: &SettingsStore) -> Result<()> {
    if settings.list_harnesses().await?.is_empty() {
        for definition in warsha_core::bundled_harnesses() {
            let row = harness_row(&definition).map_err(DaemonError::Other)?;
            settings.save_harness(&row).await?;
        }
    }
    if settings.list_skills().await?.is_empty() {
        for definition in warsha_core::bundled_skills() {
            let row = skill_row(&definition).map_err(DaemonError::Other)?;
            settings.save_skill(&row).await?;
        }
    }
    if settings.list_plugins().await?.is_empty() {
        for definition in warsha_core::bundled_plugins() {
            let row = plugin_row(&definition).map_err(DaemonError::Other)?;
            settings.save_plugin(&row).await?;
        }
    }
    Ok(())
}

// ------------------------------------------------------------------------ utilities

fn unix_secs(when: DateTime<Utc>) -> u64 {
    when.timestamp().max(0) as u64
}

/// Encode one column's payload, with the serde message kept in the owner's sentence.
fn json_string<T: serde::Serialize>(value: &T) -> Checked<String> {
    serde_json::to_string(value).map_err(|error| format!("the record could not be stored: {error}"))
}

fn definition_time(secs: u64) -> DateTime<Utc> {
    DateTime::from_timestamp(secs as i64, 0).unwrap_or_default()
}

fn default_true() -> bool {
    true
}

fn first_non_empty(values: &[&String]) -> Option<String> {
    values
        .iter()
        .map(|value| value.trim().to_string())
        .find(|value| !value.is_empty())
}

/// `Role` as an owner reads it, for a stage that named itself nothing.
fn role_label(role: Role) -> String {
    match role {
        Role::Intake => "Intake",
        Role::Researcher => "Research",
        Role::PM => "Product",
        Role::Designer => "Design",
        Role::Architect => "Architecture",
        Role::Coder => "Implementation",
        Role::Reviewer => "Review",
        Role::QA => "Quality",
        Role::Security => "Security",
        Role::Release => "Release",
        Role::Marketer => "Marketing",
        Role::Feedback => "Feedback",
    }
    .to_string()
}

/// A slug from a human name: lower case, runs of non-alphanumerics folded to one
/// `-`, leading and trailing `-` dropped.
///
/// This is what makes an import without an `id` still addressable: `harness.get`
/// and `harness.select` take a string, so the id has to be something the owner can
/// type after reading the name — and `complex-workbench` is the form the bundled
/// presets already use.
fn slug(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut pending_dash = false;
    for c in value.chars() {
        if c.is_ascii_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            pending_dash = false;
            out.push(c.to_ascii_lowercase());
        } else if !out.is_empty() {
            pending_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "imported".to_string()
    } else {
        out
    }
}

/// The two shapes `skills.import` and `plugins.install` are handed that are not
/// content: a scheme-addressed URL.
fn is_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("git://")
        || lower.starts_with("ssh://")
        || lower.starts_with("file://")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_imported_harness_keeps_its_stages_and_becomes_user_authored() {
        let document = r#"{
            "name": "My Pipeline",
            "description": "what it does",
            "stages": [
                { "role": "intake", "name": "Intake", "gate": "approval" },
                { "role": "coder", "auto_advance": true }
            ]
        }"#;
        let harness = parse_harness_import(document, None).expect("the document is read");

        assert_eq!(harness.id, "my-pipeline");
        assert_eq!(harness.name, "My Pipeline");
        assert_eq!(harness.version, "1.0.0");
        assert!(!harness.preset, "an import is never a preset");
        assert_eq!(harness.stages.len(), 2);
        assert_eq!(harness.stages[0].id, "stage-1");
        assert_eq!(harness.stages[0].gate.as_deref(), Some("approval"));
        assert_eq!(harness.stages[1].role, Role::Coder);
        assert_eq!(harness.stages[1].name, "Implementation");
        assert_eq!(harness.rules.max_repair_iterations, 3);
        assert_eq!(harness.rules.budget_cap_cents, None);
    }

    #[test]
    fn an_imported_harness_names_itself_when_the_file_gave_no_id() {
        let document = r#"{"name": "Ticket to PR!!", "stages": [{"role": "pm"}]}"#;
        let harness =
            parse_harness_import(document, None).expect("a one-stage harness is a harness");
        assert_eq!(harness.id, "ticket-to-pr");
    }

    #[test]
    fn a_harness_import_refuses_nothing_at_all_and_a_format_it_cannot_read() {
        parse_harness_import("   ", None).expect_err("empty content is not a harness");
        parse_harness_import(r#"{"name": "x"}"#, None)
            .expect_err("a harness with no stages is nothing");
        let document = r#"{"name": "x", "stages": [{"role": "pm"}]}"#;
        parse_harness_import(document, Some("toml")).expect_err("TOML is not read");
        parse_harness_import(document, Some("")).expect("an empty format is no claim");
    }

    #[test]
    fn a_harness_row_round_trips_and_a_broken_one_reads_from_the_columns() {
        let definition = warsha_core::bundled_harnesses()
            .into_iter()
            .next()
            .expect("the presets are shipped");
        let row = harness_row(&definition).expect("a preset serialises");
        assert_eq!(harness_definition(&row), definition);

        let damaged = StoredHarness {
            data_json: "{ not json".to_string(),
            ..row.clone()
        };
        let rebuilt = harness_definition(&damaged);
        assert_eq!(rebuilt.id, damaged.id);
        assert_eq!(rebuilt.name, damaged.name);
        assert!(rebuilt.stages.is_empty());
    }

    #[test]
    fn a_skill_pack_reads_its_front_matter_and_keeps_its_body() {
        let pack = "---\nname: TDD\ndescription: red green refactor\ntags: [testing, coding]\nlicense: MIT\n---\n# TDD\n\nWrite the failing test first.\n";
        let skill = parse_skill_import(pack, None).expect("a pack is a skill");

        assert_eq!(skill.id, "tdd");
        assert_eq!(skill.name, "TDD");
        assert_eq!(skill.description, "red green refactor");
        assert_eq!(skill.tags, vec!["testing", "coding"]);
        assert!(skill.content.contains("Write the failing test first."));
        assert!(!skill.content.contains("name: TDD"));
    }

    #[test]
    fn a_skill_without_front_matter_is_still_a_skill() {
        let skill =
            parse_skill_import("# Debugging\n\nStop guessing.\n", None).expect("a bare pack reads");
        assert_eq!(skill.name, "Debugging");
        assert_eq!(skill.description, "Stop guessing.");
        assert!(skill.enabled);
    }

    #[test]
    fn a_named_skill_import_adopts_the_name_the_owner_typed() {
        let skill = parse_skill_import("# Debugging\n\nStop guessing.\n", Some("My Debugging"))
            .expect("the caller's name wins");
        assert_eq!(skill.name, "My Debugging");
        assert_eq!(skill.id, "my-debugging");
    }

    #[test]
    fn an_unclosed_front_matter_is_read_as_body_not_lost() {
        let skill =
            parse_skill_import("---\nname: x\n\nstill the body\n", None).expect("nothing is lost");
        assert!(skill.content.contains("still the body"));
    }

    #[test]
    fn a_skill_url_is_refused_and_a_json_row_is_read() {
        parse_skill_import("https://example.test/x.md", None).expect_err("no fetch seam exists");
        let row = r#"{"id":"mine","name":"Mine","content":"do the thing","tags":["a"]}"#;
        let skill = parse_skill_import(row, None).expect("a JSON row is a skill");
        assert_eq!(skill.id, "mine");
        assert_eq!(skill.license, "MIT", "a row that named no license says MIT");
    }

    #[test]
    fn a_plugin_manifest_is_read_and_its_transport_is_checked() {
        let manifest = r#"{"name":"GitHub","transport":"stdio","command":"npx","args":["@mcp/github"],"tools":[{"name":"create_issue","description":"Open an issue"}]}"#;
        let plugin = parse_plugin_manifest(manifest).expect("a manifest is read");
        assert_eq!(plugin.id, "github");
        assert!(
            plugin.enabled,
            "an installed pack is active until told otherwise"
        );
        assert_eq!(plugin.tools.len(), 1);

        parse_plugin_manifest(r#"{"name":"x","transport":"grpc","command":"y"}"#)
            .expect_err("a transport nothing connects is refused at install");
        parse_plugin_manifest(r#"{"name":"x","transport":"stdio"}"#)
            .expect_err("a stdio pack with no command launches nothing");
        parse_plugin_manifest("https://example.test/mcp.json").expect_err("no fetch seam exists");
    }

    #[test]
    fn a_plugin_row_round_trips_through_its_json_columns() {
        let definition = warsha_core::bundled_plugins()
            .into_iter()
            .next()
            .expect("the packs are shipped");
        let row = plugin_row(&definition).expect("a pack serialises");
        assert_eq!(plugin_definition(&row).unwrap(), definition);
    }

    #[test]
    fn a_plain_env_value_becomes_a_keychain_write_and_a_reference_in_the_row() {
        let mut env = HashMap::new();
        env.insert("GITHUB_TOKEN".to_string(), "gh-secret-material".to_string());
        env.insert("NODE_ENV".to_string(), "${env:NODE_ENV}".to_string());

        let (stored, secrets) = split_plugin_env("github-mcp", &env);
        assert_eq!(
            stored.get("GITHUB_TOKEN").map(String::as_str),
            Some("${secrets:plugin:github-mcp:GITHUB_TOKEN}")
        );
        assert_eq!(
            stored.get("NODE_ENV").map(String::as_str),
            Some("${env:NODE_ENV}")
        );
        assert_eq!(secrets.len(), 1);
        assert_eq!(secrets[0].0, "plugin:github-mcp:GITHUB_TOKEN");
        assert_eq!(secrets[0].1, "gh-secret-material");
        assert_eq!(
            filed_secret_accounts(&stored),
            vec!["plugin:github-mcp:GITHUB_TOKEN"]
        );
    }

    #[test]
    fn a_model_record_round_trips() {
        let record = CustomModelRecord {
            provider: "open_router".to_string(),
            model_id: "qwen/qwen3-coder".to_string(),
            display_name: None,
            context_window: Some(262_144),
            enabled: true,
        };
        assert_eq!(custom_model_record(&custom_model_row(&record)), record);
    }

    #[test]
    fn an_integration_row_carries_no_token_and_its_status_says_what_is_on_file() {
        let config = IntegrationConfig {
            token: Some("secret".to_string()),
            bot_token: None,
            webhook_url: Some("https://hooks.example.test".to_string()),
            channel: Some("#releases".to_string()),
            org: Some("warsha".to_string()),
        };
        let redacted = redact_config(&config);
        assert_eq!(redacted.token, None);
        assert_eq!(redacted.org.as_deref(), Some("warsha"));

        let row = integration_row("github", "GitHub", true, &redacted, Some(1_700_000_000))
            .expect("a redacted config is a row");
        assert!(
            !row.config_json.contains("secret"),
            "the row must not hold the token"
        );

        let status = integration_status(&row, true, false).unwrap();
        assert_eq!(status.id, "github");
        assert!(status.connected);
        let details = status.details.expect("a status carries its details");
        assert_eq!(details["org"], "warsha");
        assert_eq!(details["has_token"], true);
        assert_eq!(details["has_bot_token"], false);
        assert!(integration_config(&row).unwrap().token.is_none());
    }

    #[test]
    fn a_corrupt_skill_row_returns_an_error_naming_the_row() {
        let definition = warsha_core::bundled_skills()
            .into_iter()
            .next()
            .expect("skills are shipped");
        let row = skill_row(&definition).expect("a skill serialises");
        assert_eq!(skill_definition(&row).unwrap(), definition);

        let damaged = StoredSkill {
            tags_json: "{ not json".to_string(),
            ..row
        };
        let err = skill_definition(&damaged).expect_err("corrupt tags_json is refused");
        assert!(
            err.contains(&format!("corrupt skill row `{}`", damaged.id)),
            "error should name the corrupt row: {err}"
        );
    }

    #[test]
    fn a_corrupt_plugin_row_returns_an_error_naming_the_row() {
        let definition = warsha_core::bundled_plugins()
            .into_iter()
            .next()
            .expect("the packs are shipped");
        let row = plugin_row(&definition).expect("a pack serialises");

        for (field_name, damaged) in [
            (
                "args",
                StoredPlugin {
                    args_json: "{ not json".to_string(),
                    ..row.clone()
                },
            ),
            (
                "env",
                StoredPlugin {
                    env_json: "{ not json".to_string(),
                    ..row.clone()
                },
            ),
            (
                "tools",
                StoredPlugin {
                    tools_json: "{ not json".to_string(),
                    ..row.clone()
                },
            ),
        ] {
            let err = plugin_definition(&damaged)
                .expect_err(&format!("corrupt {field_name}_json is refused"));
            assert!(
                err.contains(&format!("corrupt plugin row `{}`", damaged.id)),
                "error for {field_name} should name the corrupt row: {err}"
            );
        }
    }

    #[test]
    fn a_corrupt_integration_row_returns_an_error_naming_the_row() {
        let damaged = StoredIntegration {
            id: "slack".to_string(),
            name: "Slack".to_string(),
            connected: true,
            config_json: "{ not json".to_string(),
            configured_at: None,
        };
        let err = integration_config(&damaged).expect_err("corrupt config_json is refused");
        assert!(
            err.contains("corrupt integration row `slack`"),
            "error should name the corrupt row: {err}"
        );

        let status_err = integration_status(&damaged, false, false)
            .expect_err("corrupt config in status is refused");
        assert!(
            status_err.contains("corrupt integration row `slack`"),
            "status error should name the corrupt row: {status_err}"
        );
    }

    #[test]
    fn a_path_that_climbs_or_starts_elsewhere_is_refused() {
        let root = Path::new("/projects/shop");
        assert_eq!(
            safe_join(root, "src/main.rs").expect("a plain relative path"),
            PathBuf::from("/projects/shop/src/main.rs")
        );
        assert_eq!(
            safe_join(root, ".").expect("the root names itself"),
            root.to_path_buf()
        );
        assert_eq!(
            safe_join(root, "./a/./b").expect("a dot inside a path is nothing"),
            PathBuf::from("/projects/shop/a/b")
        );
        safe_join(root, "../secrets").expect_err("`..` climbs out");
        safe_join(root, "a/../../b").expect_err("`..` two levels is still a climb");
        safe_join(root, "/etc/passwd").expect_err("an absolute path is outside the project");
        safe_join(root, "a\0b").expect_err("a NUL is not a path");
    }

    #[test]
    fn a_directory_key_cannot_name_a_parent() {
        assert_eq!(
            safe_directory_key("01ARZ3NDEKTSV4RRFFQ69G5FAV"),
            "01ARZ3NDEKTSV4RRFFQ69G5FAV"
        );
        assert_eq!(safe_directory_key("../../etc"), "project");
        assert_eq!(safe_directory_key(""), "project");
        assert_eq!(safe_directory_key(".."), "project");
        assert_eq!(safe_directory_key("./x"), "project");
        assert!(!safe_directory_key("C:\\Windows").contains('\\'));
    }

    #[test]
    fn the_files_root_is_the_repository_when_there_is_one_and_a_named_folder_when_there_is_not() {
        let data = Path::new("/var/lib/warsha");
        assert_eq!(
            project_files_root(data, "p-1", Some("/repos/shop")),
            PathBuf::from("/repos/shop")
        );
        assert_eq!(
            project_files_root(data, "p-1", Some("   ")),
            data.join("files").join("p-1")
        );
        assert_eq!(
            project_files_root(data, "../../etc", None),
            data.join("files").join("project")
        );
    }

    #[test]
    fn mime_types_come_from_the_extension_and_unknown_is_text() {
        assert_eq!(guess_mime(Path::new("README.md")), "text/markdown");
        assert_eq!(guess_mime(Path::new("app.MD")), "text/markdown");
        assert_eq!(guess_mime(Path::new("daemon.rs")), "text/rust");
        assert_eq!(guess_mime(Path::new("package.json")), "application/json");
        assert_eq!(guess_mime(Path::new("mystery.bin")), "text/plain");
        assert_eq!(guess_mime(Path::new("no-extension")), "text/plain");
    }

    #[test]
    fn a_slug_folds_punctuation_and_never_comes_back_empty() {
        assert_eq!(slug("Complex Workbench"), "complex-workbench");
        assert_eq!(slug("  LOKI + HARD MODE  "), "loki-hard-mode");
        assert_eq!(slug("!!!"), "imported");
    }

    #[tokio::test]
    async fn seeding_fills_an_empty_catalog_and_leaves_an_edited_one_alone() {
        let temp = crate::test_util::fresh_tempdir();
        let settings = SettingsStore::open(&temp.path().join("warsha.db"))
            .await
            .expect("the settings open");

        seed_bundled_records(&settings)
            .await
            .expect("the first seed runs");
        assert_eq!(
            settings.list_harnesses().await.expect("harnesses").len(),
            warsha_core::bundled_harnesses().len()
        );
        assert_eq!(
            settings.list_skills().await.expect("skills").len(),
            warsha_core::bundled_skills().len()
        );
        assert_eq!(
            settings.list_plugins().await.expect("plugins").len(),
            warsha_core::bundled_plugins().len()
        );

        // The owner deleted one of each. A restart must not put them back.
        settings
            .delete_harness("complex-workbench")
            .await
            .expect("a preset deletes");
        settings
            .delete_skill("brainstorming")
            .await
            .expect("a skill deletes");
        settings
            .delete_plugin("github-mcp")
            .await
            .expect("a plugin deletes");
        seed_bundled_records(&settings)
            .await
            .expect("the second seed runs");

        assert_eq!(
            settings.list_harnesses().await.expect("harnesses").len(),
            warsha_core::bundled_harnesses().len() - 1,
            "a seeding that resurrects a delete is a daemon that undoes its owner"
        );
        assert_eq!(
            settings.list_skills().await.expect("skills").len(),
            warsha_core::bundled_skills().len() - 1
        );
        assert_eq!(
            settings.list_plugins().await.expect("plugins").len(),
            warsha_core::bundled_plugins().len() - 1
        );
    }

    #[tokio::test]
    async fn a_directory_lists_and_a_file_reads_with_its_type() {
        let temp = crate::test_util::fresh_tempdir();
        let root = temp.path().join("repo");
        std::fs::create_dir_all(root.join("src")).expect("the directory is made");
        std::fs::write(root.join("README.md"), "# Warsha").expect("a file is written");
        std::fs::write(root.join("src").join("main.rs"), "fn main() {}")
            .expect("a file is written");
        std::fs::write(root.join("blob.bin"), [0u8, 159, 146, 150]).expect("a binary is written");

        let entries = list_tree(&root, &root).expect("the root lists");
        let names: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        // Directories first, then names: the order a browser shows.
        assert_eq!(names, vec!["src", "blob.bin", "README.md"]);
        assert_eq!(entries[0].path, "src");
        assert_eq!(entries[1].size_bytes, 4);
        assert_eq!(entries[2].size_bytes, 8);

        let read = read_text(&root, &root.join("README.md")).expect("the file reads");
        assert_eq!(read.path, "README.md");
        assert_eq!(read.content, "# Warsha");
        assert_eq!(read.mime_type, "text/markdown");

        read_text(&root, &root.join("blob.bin")).expect_err("binary is refused, not garbled");
        read_text(&root, &root.join("missing.md")).expect_err("nothing is invented");
        list_tree(&root, &root.join("nope")).expect("an absent directory is an empty one");
    }

    #[tokio::test]
    async fn a_symlink_in_the_tree_is_not_offered() {
        let temp = crate::test_util::fresh_tempdir();
        let root = temp.path().join("repo");
        std::fs::create_dir_all(&root).expect("the root is made");
        std::fs::write(root.join("real.md"), "# real").expect("a file is written");
        // Windows refuses unprivileged symlink creation, and a daemon must not need
        // one to be testable: wherever the link cannot be made, the ordinary file it
        // would have pointed at is written instead and the assertion below still holds.
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("real.md"), root.join("link.md"))
            .expect("a link is made");
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(root.join("real.md"), root.join("link.md"))
            .unwrap_or_else(|_| {
                std::fs::write(root.join("link.md"), "# real")
                    .expect("a file stands in for the link")
            });

        let entries = list_tree(&root, &root).expect("the root lists");
        // Every row offered must be a real file inside the root: on unix the link is
        // skipped entirely, on either platform nothing escapes is ever named.
        assert!(
            entries.iter().any(|entry| entry.name == "real.md"),
            "the plain file is still a tree row: {entries:?}"
        );
        for entry in &entries {
            let full = root.join(&entry.name);
            assert!(
                resolve_inside(&root, &full).is_ok(),
                "`{}` was offered but does not resolve inside the project",
                entry.name
            );
        }
        #[cfg(unix)]
        assert!(
            !entries.iter().any(|entry| entry.name == "link.md"),
            "a link that names nothing inside the project is not a tree row"
        );
    }

    #[tokio::test]
    async fn resolve_inside_follows_the_filesystem_and_refuses_a_link_that_escapes() {
        let temp = crate::test_util::fresh_tempdir();
        let root = temp.path().join("repo");
        std::fs::create_dir_all(root.join("src")).expect("the directory is made");
        std::fs::write(root.join("src").join("a.rs"), "fn a() {}").expect("a file is written");

        let joined = safe_join(&root, "src/a.rs").expect("a plain path joins");
        let canonical = resolve_inside(&root, &joined).expect("the file is inside the project");
        assert!(canonical.exists());

        // A link out of the project: its *name* is clean, so only the filesystem
        // half of the check can see it.
        #[cfg(unix)]
        if std::os::unix::fs::symlink(temp.path(), root.join("out")).is_ok() {
            let escaped = root.join("out/lib.rs");
            resolve_inside(&root, &escaped)
                .expect_err("a path that resolves outside the project is refused");
        }
    }
}
