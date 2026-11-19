#![allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]

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
    let harness = parse_harness_import(document, None).expect("a one-stage harness is a harness");
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
fn a_package_launcher_must_name_a_pinned_release() {
    let args = |values: &[&str]| {
        values
            .iter()
            .map(|value| (*value).to_string())
            .collect::<Vec<_>>()
    };

    require_pinned_launch(
        "npx",
        &args(&["@modelcontextprotocol/server-github@2025.4.8"]),
    )
    .expect("a pinned package runs");
    require_pinned_launch("npx", &args(&["-y", "@scope/pkg@1.2.3"]))
        .expect("flags do not change what is pinned");
    require_pinned_launch("pnpm", &args(&["dlx", "pkg@1.2.3"]))
        .expect("the dlx subcommand is not a package");
    require_pinned_launch("uvx", &args(&["mcp-server-git@2026.11.4"]))
        .expect("a pinned python package runs");
    require_pinned_launch("/usr/local/bin/npx", &args(&["pkg@1.2.3"]))
        .expect("a path to the launcher is still the launcher");
    require_pinned_launch("cargo", &args(&["--version"]))
        .expect("a local toolchain is not a package fetch");

    for (command, children) in [
        ("npx", vec!["@mcp/github"]),
        ("npx", vec!["pkg@latest"]),
        ("npx", vec!["pkg@1.2"]),
        ("yarn", vec!["dlx", "pkg"]),
        ("npx", Vec::new()),
    ] {
        assert!(
            require_pinned_launch(command, &args(&children)).is_err(),
            "`{command} {children:?}` must be refused as unpinned"
        );
    }
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
    let seeded = settings.list_plugins().await.expect("plugins");
    assert!(
        seeded.iter().all(|row| !row.enabled),
        "every seeded pack must arrive disabled: {:?}",
        seeded
            .iter()
            .filter(|row| row.enabled)
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>()
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
    std::fs::write(root.join("src").join("main.rs"), "fn main() {}").expect("a file is written");
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
    std::os::unix::fs::symlink(root.join("real.md"), root.join("link.md")).expect("a link is made");
    #[cfg(windows)]
    std::os::windows::fs::symlink_file(root.join("real.md"), root.join("link.md")).unwrap_or_else(
        |_| std::fs::write(root.join("link.md"), "# real").expect("a file stands in for the link"),
    );

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
