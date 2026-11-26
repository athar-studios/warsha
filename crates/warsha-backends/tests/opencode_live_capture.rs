#![cfg(unix)]
#![allow(clippy::expect_used, clippy::unwrap_used, unused_crate_dependencies)]

//! Explicit, single-call live proof. Default cargo test never launches OpenCode.
//! Run with WARSHA_LIVE_OPENCODE=1 and WARSHA_E2E_REAL=1, --ignored --nocapture.
//! This is a separate test binary: its temporary PATH cannot affect mock tests.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;
use warsha_backends::{BackendFactory, CodingTask, Sandbox};
use warsha_core::RunId;

fn git(repo: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(repo)
        .args(args)
        .output()
        .expect("git runs");
    assert!(out.status.success(), "git {args:?} failed");
    String::from_utf8(out.stdout).expect("utf8 git output")
}

fn listing(root: &Path, dir: &Path, lines: &mut Vec<String>) {
    for entry in std::fs::read_dir(dir).expect("list scratch repo") {
        let path = entry.expect("entry").path();
        if path == root.join(".git") {
            continue;
        }
        let meta = std::fs::symlink_metadata(&path).expect("metadata");
        lines.push(format!(
            "{:o} {}{}",
            meta.permissions().mode() & 0o7777,
            path.strip_prefix(root).expect("relative").display(),
            if meta.is_dir() { "/" } else { "" }
        ));
        if meta.is_dir() {
            listing(root, &path, lines);
        }
    }
}

#[tokio::test]
#[ignore = "owner-authorized live model call only; requires WARSHA_LIVE_OPENCODE and WARSHA_E2E_REAL"]
async fn real_opencode_unstaged_hello_is_captured_without_noise() {
    if std::env::var("WARSHA_LIVE_OPENCODE").as_deref() != Ok("1")
        || std::env::var("WARSHA_E2E_REAL").as_deref() != Ok("1")
    {
        eprintln!("skipped: live opt-ins are not both set to 1");
        return;
    }
    let Some(binary) = which::which("opencode").ok() else {
        eprintln!("skipped: opencode is absent from PATH");
        return;
    };
    // Preserve scratch evidence even when assertions fail. No credentials/config are read.
    let scratch = tempfile::Builder::new()
        .prefix("warsha-live-capture-")
        .tempdir_in("/tmp")
        .expect("scratch")
        .keep();
    let repo = scratch.join("repo");
    let home = scratch.join("home");
    let bin = scratch.join("bin");
    for dir in [&repo, &home, &bin] {
        std::fs::create_dir(dir).expect("scratch dir");
    }
    std::fs::write(repo.join("README.md"), "capture base\n").expect("base");
    git(&repo, &["init", "-q"]);
    git(&repo, &["add", "README.md"]);
    git(
        &repo,
        &[
            "-c",
            "user.name=Capture Proof",
            "-c",
            "user.email=capture@example.invalid",
            "commit",
            "-qm",
            "base",
        ],
    );
    let head = git(&repo, &["rev-parse", "HEAD"]);
    let mut before = Vec::new();
    listing(&repo, &repo, &mut before);
    before.sort();
    println!(
        "scratch={}\nbefore={before:?}\nstatus_before={:?}\nhead_before={head}",
        scratch.display(),
        git(&repo, &["status", "--porcelain", "-u"])
    );

    // A transparent launcher pins the keyless model and clears inherited credentials.
    // HOME/XDG are private scratch paths, never ~/.config/opencode. The catalog
    // backend still supplies `run`, streaming flags and the actual task prompt.
    let launcher = bin.join("opencode");
    let quote = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    std::fs::write(
        &launcher,
        format!(
            "#!/bin/sh\nexec env -i PATH=/usr/bin:/bin HOME={} XDG_CONFIG_HOME={} XDG_DATA_HOME={} XDG_CACHE_HOME={} {} \"$@\" --model opencode/big-pickle --standalone --auto\n",
            quote(home.to_str().unwrap()),
            quote(home.join("config").to_str().unwrap()),
            quote(home.join("data").to_str().unwrap()),
            quote(home.join("cache").to_str().unwrap()),
            quote(binary.to_str().unwrap()),
        ),
    ).expect("launcher");
    std::fs::set_permissions(&launcher, std::fs::Permissions::from_mode(0o755))
        .expect("executable");
    let previous = std::env::var_os("PATH").expect("PATH");
    let mut paths = vec![bin];
    paths.extend(std::env::split_paths(&previous));
    std::env::set_var("PATH", std::env::join_paths(paths).expect("PATH"));
    let backend = BackendFactory::opencode();
    let result = backend.execute(CodingTask {
        id: ulid::Ulid::new(),
        run_id: RunId::new(),
        title: "Create hello.txt".into(),
        description: "Create a file hello.txt containing the word hi. Make no other changes. Do not stage or commit anything.".into(),
        repo_path: repo.clone(),
        worktree_path: Some(repo.clone()),
        branch_name: "capture-proof".into(),
        base_branch: "HEAD".into(),
        files: vec![],
        context: std::collections::HashMap::from([("coding_cli_timeout_seconds".into(), "180".into())]),
    }, &Sandbox::new(repo.clone())).await;
    std::env::set_var("PATH", previous);
    let result = result.expect("live backend executes");
    let mut after = Vec::new();
    listing(&repo, &repo, &mut after);
    after.sort();
    let status = git(&repo, &["status", "--porcelain", "-u"]);
    let head_after = git(&repo, &["rev-parse", "HEAD"]);
    let diff = result.diff.as_deref().unwrap_or_default();
    let evidence = format!("before={before:?}\nstatus_before=\nhead_before={head}after={after:?}\nstatus_after={status:?}\nhead_after={head_after}success={}\nfiles_changed={:?}\ndiff:\n{diff}", result.success, result.files_changed);
    std::fs::write(scratch.join("capture.txt"), &evidence).expect("save evidence");
    println!("{evidence}");
    assert!(result.success, "OpenCode exit must succeed");
    assert_eq!(
        std::fs::read_to_string(repo.join("hello.txt"))
            .expect("hello")
            .trim(),
        "hi"
    );
    assert_eq!(head_after, head, "OpenCode must not commit");
    assert_eq!(
        status, "?? hello.txt\n",
        "only hello should be untracked, nothing staged"
    );
    assert_eq!(result.files_changed, vec!["hello.txt"]);
    assert!(diff.contains("diff --git a/hello.txt b/hello.txt"));
    assert!(diff.contains("+hi"));
    assert!(!diff.contains(".warsha") && !diff.contains(".opencode"));
}
