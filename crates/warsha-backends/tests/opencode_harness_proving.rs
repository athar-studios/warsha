#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::unwrap_used,
    unused_crate_dependencies
)]
#![cfg(unix)]

//! Lane A proving test: selecting the catalog OpenCode backend and executing
//! it against a temp git repo writes a real non-empty Rust file that git can
//! see. The executable is a fake `opencode` on a temp PATH. This file is its
//! own test binary so the PATH mutation cannot race other tests.
//!
//! `which` and `Command::new("opencode")` search the process PATH, not
//! `sandbox.env`. The test therefore prepends only the fake bin, asserts
//! `command -v opencode` is that fake, and refuses to execute otherwise.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use warsha_backends::{BackendFactory, CodingTask, FileAction, Sandbox, TaskFile};
use warsha_core::RunId;

const PROOF_REL: &str = "src/lane_a_proof.rs";
const PROOF_MARKER: &str = "lane_a_opencode_proof";

struct PathGuard {
    previous: Option<std::ffi::OsString>,
}

impl PathGuard {
    fn prepend(dir: &Path) -> Self {
        let previous = std::env::var_os("PATH");
        let mut next = std::ffi::OsString::from(dir);
        next.push(":");
        if let Some(existing) = &previous {
            next.push(existing);
        }
        // SAFETY: this integration-test binary has one test. Restored on drop.
        std::env::set_var("PATH", &next);
        Self { previous }
    }
}

impl Drop for PathGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(previous) => std::env::set_var("PATH", previous),
            None => std::env::remove_var("PATH"),
        }
    }
}

fn publish_fake(dir: &Path, name: &str, body: &str) -> PathBuf {
    let staging = dir.join(format!(".{name}.tmp"));
    let final_path = dir.join(name);
    std::fs::write(&staging, format!("#!/bin/sh\n{body}\n")).expect("write fake");
    let mut perms = std::fs::metadata(&staging)
        .expect("staging metadata")
        .permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&staging, perms).expect("chmod fake");
    std::fs::rename(&staging, &final_path).expect("publish fake");
    final_path
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .current_dir(dir)
        .args(args)
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed in {}", dir.display());
}

fn command_v_opencode() -> PathBuf {
    let output = Command::new("sh")
        .args(["-c", "command -v opencode"])
        .output()
        .expect("command -v");
    assert!(
        output.status.success(),
        "opencode is not on PATH; refusing to execute a fallback binary. stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );
    PathBuf::from(String::from_utf8_lossy(&output.stdout).trim())
}

#[tokio::test]
async fn opencode_backend_on_path_writes_nonempty_rs_into_git_diff() {
    let repo = tempfile::tempdir().expect("repo tempdir");
    let bin = tempfile::tempdir().expect("bin tempdir");
    std::fs::write(repo.path().join("README.md"), "lane-a base\n").expect("base file");
    git(repo.path(), &["init", "-q"]);
    git(repo.path(), &["config", "user.email", "lane-a@example.com"]);
    git(repo.path(), &["config", "user.name", "Lane A"]);
    git(repo.path(), &["add", "README.md"]);
    git(repo.path(), &["commit", "-qm", "base"]);

    let proof_body = format!(
        "/// Written by the lane-A fake opencode. Not a model API.\n\
         pub fn {PROOF_MARKER}() -> u32 {{\n    \
         1\n\
         }}\n"
    );
    let script = format!(
        "set -eu\nmkdir -p src\ncat > {PROOF_REL} << 'END_OF_PROOF'\n{proof_body}END_OF_PROOF\ngit add -- {PROOF_REL}\nexit 0"
    );
    let fake = publish_fake(bin.path(), "opencode", &script);
    let fake_canon = fake.canonicalize().expect("canonicalize fake");

    let _guard = PathGuard::prepend(bin.path());
    let resolved = command_v_opencode();
    let resolved_canon = resolved.canonicalize().expect("canonicalize command -v");
    assert_eq!(
        resolved_canon, fake_canon,
        "refusing to execute: command -v opencode is {resolved:?}, not the fake"
    );
    let script_text = std::fs::read_to_string(&fake_canon).expect("read fake");
    assert!(
        !script_text.contains("exec ")
            && !script_text.contains("curl ")
            && !script_text.contains("wget "),
        "fake opencode must not launch another program or the network"
    );

    let backend = BackendFactory::opencode();
    assert_eq!(backend.name(), "opencode");
    assert!(
        backend.is_available(),
        "catalog opencode must resolve through PATH to the fake"
    );

    let sandbox = Sandbox::new(repo.path().to_path_buf());
    let task = CodingTask {
        id: ulid::Ulid::new(),
        run_id: RunId::new(),
        title: "Write the lane A proof".to_string(),
        description: "Add a non-empty Rust source file".to_string(),
        repo_path: repo.path().to_path_buf(),
        worktree_path: Some(repo.path().to_path_buf()),
        branch_name: "warsha/run-lane-a".to_string(),
        base_branch: "HEAD".to_string(),
        files: vec![TaskFile {
            path: PROOF_REL.to_string(),
            content: String::new(),
            action: FileAction::Create,
        }],
        context: std::collections::HashMap::from([(
            "coding_cli_timeout_seconds".to_string(),
            "15".to_string(),
        )]),
    };

    let mut last_err = None;
    let mut result = None;
    for _ in 0..5 {
        match backend.execute(task.clone(), &sandbox).await {
            Ok(res) => {
                result = Some(res);
                break;
            }
            Err(err) => {
                let msg = err.to_string();
                if msg.contains("Text file busy") || msg.contains("os error 26") {
                    last_err = Some(msg);
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    continue;
                }
                panic!("opencode execute failed: {err}");
            }
        }
    }
    let result = result.unwrap_or_else(|| {
        panic!(
            "opencode execute failed after ETXTBSY retries, last: {}",
            last_err.unwrap_or_default()
        )
    });

    assert!(result.success, "fake opencode must exit 0");
    let written = repo.path().join(PROOF_REL);
    let body = std::fs::read_to_string(&written).expect("proof file exists");
    assert!(!body.trim().is_empty(), "proof file must be non-empty");
    assert!(
        body.contains(PROOF_MARKER),
        "proof file must be the fake's source, got: {body}"
    );
    assert!(
        result.files_changed.iter().any(|path| path == PROOF_REL),
        "files_changed must include {PROOF_REL}, got {:?}",
        result.files_changed
    );
    let diff = result
        .diff
        .expect("git diff HEAD must capture the staged file");
    assert!(
        diff.contains(PROOF_REL) && diff.contains(PROOF_MARKER),
        "git diff must show the new source file, got: {diff}"
    );

    let status = Command::new("git")
        .current_dir(repo.path())
        .args(["status", "--porcelain", "-u", "--", PROOF_REL])
        .output()
        .expect("git status");
    assert!(status.status.success(), "git status failed");
    let porcelain = String::from_utf8_lossy(&status.stdout);
    assert!(
        porcelain.contains(PROOF_REL),
        "file must be git-visible, status: {porcelain}"
    );
}
