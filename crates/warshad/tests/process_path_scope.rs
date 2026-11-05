//! The daemon's in-scope path boundary, measured from outside the crate.
//!
//! `ProcessPolicy::check_command` decides whether a requested program is *inside the
//! daemon's own data directory* before it consults the allow-list, and that decision is
//! the one a path-traversal attempt has to be stopped at. The first real CI run
//! (run 41752421903, `Rust (windows-latest)`) measured the predicate disagreeing with
//! itself across platforms, so the rules are pinned here through the same public API the
//! RPC handlers reach, against real directories, on the host that is running them.
//!
//! Two properties, and they are not in tension:
//!
//! - **A path the daemon owns is in scope under every spelling the operating system
//!   accepts for it** — resolved or not yet built, verbatim or joined, in either case and
//!   in either separator. Refusing these is the defect CI caught.
//! - **A path it does not own is refused under every spelling** — a sibling whose name
//!   merely begins with the data directory's, a `..` climb, a link out of the tree, a
//!   drive-relative or relative path. This is the property that must never be traded for
//!   the first one, and `check_command` keeps it by failing closed: anything the boundary
//!   does not positively recognise goes on to the allow-list, which the caller cannot
//!   widen from the wire.

use std::path::{Path, PathBuf};
use tempfile::TempDir;
use warshad::ProcessPolicy;

/// A fresh temp directory for one fixture's data dir.
///
/// Prefers cargo's `CARGO_TARGET_TMPDIR`, then a `tmp` sibling of the test
/// binary's `deps` directory (the target dir is writable wherever the build
/// ran), and only then the system temp dir — which on some Windows machines is
/// protected and rejects even creating a tempdir (`Access is denied`).
fn fresh_tempdir() -> TempDir {
    if let Some(base) = std::env::var_os("CARGO_TARGET_TMPDIR") {
        let base = PathBuf::from(base);
        if base.is_dir() {
            if let Ok(dir) = TempDir::new_in(&base) {
                return dir;
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(deps) = exe.parent() {
            let base = deps.join("tmp");
            if std::fs::create_dir_all(&base).is_ok() {
                if let Ok(dir) = TempDir::new_in(&base) {
                    return dir;
                }
            }
        }
    }
    TempDir::new().expect("tempdir for the fixture data dir")
}

/// A data directory with a workspace under it, and a tool the daemon has built there.
fn fixture() -> (tempfile::TempDir, PathBuf, ProcessPolicy) {
    let dir = fresh_tempdir();
    let data_dir = dir.path().join("warsha");
    std::fs::create_dir_all(data_dir.join("workspace")).expect("the workspace is made");
    let built = data_dir.join("workspace").join("migrate");
    std::fs::write(&built, b"tool").expect("the tool is written");
    let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);
    // The fixture is returned with the temporary directory so it outlives the test, and
    // the policy is built from a directory that really exists: the case the finding is
    // about is the one the filesystem is actually consulted for.
    (dir, built, policy)
}

#[test]
fn a_program_the_daemon_owns_is_in_scope_under_every_spelling() {
    let (dir, built, policy) = fixture();
    let data_dir = dir.path().join("warsha");

    // The built tool, named absolutely.
    assert!(
        policy.check_command(&built.to_string_lossy()).is_ok(),
        "a program the daemon built in its own workspace was refused"
    );
    // The data directory itself, and a path under it no run has built yet.
    assert!(policy.check_command(&data_dir.to_string_lossy()).is_ok());
    assert!(policy
        .check_command(
            &data_dir
                .join("workspace")
                .join("tools")
                .join("not-built")
                .to_string_lossy()
        )
        .is_ok());
    // A trailing separator and a doubled separator are the same directory.
    assert!(policy
        .check_command(&format!("{}/", data_dir.display()))
        .is_ok());
}

#[test]
fn a_sibling_of_the_data_dir_is_out_of_scope_however_it_is_named() {
    let (dir, _built, policy) = fixture();
    let data_dir = dir.path().join("warsha");

    // The trap a string prefix falls into: `/…/warsha-evil/tool` begins with `/…/warsha`.
    for candidate in [
        format!("{}-evil/tool", data_dir.display()),
        format!("{}sh/tool", data_dir.display()),
        format!("{}/../warsha-evil/tool", data_dir.display()),
        format!("{}/../../sibling/tool", data_dir.display()),
    ] {
        assert!(
            policy.check_command(&candidate).is_err(),
            "an out-of-scope path was read as the daemon's own: {candidate}"
        );
    }

    // A relative or drive-relative path names the caller's working directory, not the
    // daemon's, so the boundary never grants it.
    for candidate in ["./workspace/migrate", "workspace/migrate", "warsha/migrate"] {
        assert!(
            policy.check_command(candidate).is_err(),
            "a relative path was read as the daemon's own: {candidate}"
        );
    }
}

#[test]
fn a_data_dir_that_names_no_root_grants_nothing() {
    // Reduced to components, `""` is a prefix of every path there is. Honouring such a
    // configuration would make the whole filesystem the daemon's scope.
    for data_dir in ["", "warsha", "target/debug"] {
        let policy = ProcessPolicy::from_config(&["npm".to_string()], Path::new(data_dir));
        assert!(
            policy.check_command("/usr/local/bin/migrate").is_err(),
            "a data directory spelled `{data_dir}` granted scope over an absolute path"
        );
        assert!(
            policy.check_command("npm").is_ok(),
            "the allow-list stopped working for a data directory spelled `{data_dir}`"
        );
    }
}

/// A symlink inside the data directory is what its target is, so the target decides.
#[cfg(unix)]
#[test]
fn a_link_out_of_the_data_dir_does_not_reach_inside_it() {
    use std::os::unix::fs::symlink;

    let (dir, _built, policy) = fixture();
    let data_dir = dir.path().join("warsha");
    let outside = dir.path().join("elsewhere");
    std::fs::create_dir_all(&outside).expect("the outside directory is made");
    let outside_tool = outside.join("evil");
    std::fs::write(&outside_tool, b"tool").expect("the outside tool is written");

    symlink(&outside_tool, data_dir.join("link")).expect("the symlink is made");
    assert!(
        policy
            .check_command(&data_dir.join("link").to_string_lossy())
            .is_err(),
        "a symlink out of the data directory was read as project scope"
    );

    let inside_tool = data_dir.join("migrate");
    std::fs::write(&inside_tool, b"tool").expect("the inside tool is written");
    symlink(&inside_tool, data_dir.join("good-link")).expect("the inside symlink is made");
    assert!(policy
        .check_command(&data_dir.join("good-link").to_string_lossy())
        .is_ok());
}

/// The shapes that only Windows spells: the verbatim prefix a resolved path arrives in,
/// a name shouted out of a build log, a drive-relative path, and a rooted path with no
/// drive prefix at all — the last one being what the first real CI run tripped over.
#[cfg(windows)]
#[test]
fn a_windows_spelling_of_an_in_scope_path_is_still_in_scope() {
    let (dir, built, policy) = fixture();
    let data_dir = dir.path().join("warsha");
    let plain = built.to_string_lossy().into_owned();

    for candidate in [
        format!(r"\\?\{plain}"),
        plain.to_uppercase(),
        plain.replace('\\', "/"),
        format!(r"{}\TOOLS\NOT-BUILT-YET", data_dir.display()).to_uppercase(),
        // Forward separators *and* an unbuilt leaf: nothing reaches the filesystem here,
        // so the key alone has to say that `/` and `\` root the same directory.
        format!(
            r"{}/tools/not-built-yet",
            data_dir.display().to_string().replace('\\', "/")
        ),
    ] {
        assert!(
            policy.check_command(&candidate).is_ok(),
            "an in-scope path was refused for how it was spelled: {candidate}"
        );
    }

    for candidate in [
        format!(r"\\?\{}-evil\tool", data_dir.display()),
        format!(r"{}-EVIL\tool", data_dir.display()),
    ] {
        assert!(
            policy.check_command(&candidate).is_err(),
            "an out-of-scope path was granted in Windows spelling: {candidate}"
        );
    }

    // Rooted without a drive prefix: the exemption applies (this is the CI failure), and
    // it applies to the sibling refusal too.
    let posix = ProcessPolicy::from_config(&["npm".to_string()], Path::new("/var/lib/warsha"));
    assert!(posix
        .check_command("/var/lib/warsha/workspace/tools/migrate")
        .is_ok());
    assert!(posix.check_command("/var/lib/warsha-evil/tool").is_err());

    // Drive-relative is not rooted: it moves with the current directory, so the boundary
    // keeps its hands off and only the list decides.
    let drive = ProcessPolicy::from_config(&["npm".to_string()], Path::new(r"C:\warsha"));
    assert!(drive.check_command(r"C:warsha\workspace\migrate").is_err());
    assert!(drive.check_command(r"C:\warsha\workspace\migrate").is_ok());
}
