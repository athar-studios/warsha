//! Test-only helpers shared by the `warsha-pipeline` test modules.

#![allow(clippy::panic, clippy::expect_used, clippy::unwrap_used)]

use std::ffi::OsString;
use std::path::PathBuf;
use tempfile::TempDir;

/// Process-wide async mutex serializing every unit test that mutates or depends
/// on process-global environment variables (`WARSHA_LLM_PROVIDER`,
/// `WARSHA_LLM_API_KEY`, `WARSHA_CODING_BACKEND`, etc.).
pub(crate) static ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// RAII guard that captures the prior value of an environment variable and
/// restores (or removes) it when dropped — including across `.await` points and
/// test panics.
pub(crate) struct EnvVarGuard {
    key: &'static str,
    previous: Option<OsString>,
}

impl EnvVarGuard {
    pub(crate) fn set(key: &'static str, value: &str) -> Self {
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, previous }
    }

    pub(crate) fn remove(key: &'static str) -> Self {
        let previous = std::env::var_os(key);
        std::env::remove_var(key);
        Self { key, previous }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match &self.previous {
            Some(prev) => std::env::set_var(self.key, prev),
            None => std::env::remove_var(self.key),
        }
    }
}

/// Composite guard holding `ENV_LOCK` while clearing pipeline LLM/backend
/// environment variables for the duration of a test.
///
/// Field declaration order guarantees every `EnvVarGuard` restores its
/// variable BEFORE `_lock` releases `ENV_LOCK`.
pub(crate) struct CleanEnvGuard {
    _vars: Vec<EnvVarGuard>,
    _lock: tokio::sync::MutexGuard<'static, ()>,
}

/// Acquire `ENV_LOCK` and clear `WARSHA_LLM_*` and `WARSHA_CODING_BACKEND`
/// until the returned guard is dropped.
pub(crate) async fn lock_clean_llm_env() -> CleanEnvGuard {
    let lock = ENV_LOCK.lock().await;
    let vars = vec![
        EnvVarGuard::remove("WARSHA_LLM_PROVIDER"),
        EnvVarGuard::remove("WARSHA_LLM_API_KEY"),
        EnvVarGuard::remove("WARSHA_LLM_BASE_URL"),
        EnvVarGuard::remove("WARSHA_LLM_MODEL"),
        EnvVarGuard::remove("WARSHA_CODING_BACKEND"),
    ];
    CleanEnvGuard {
        _vars: vars,
        _lock: lock,
    }
}

/// A fresh temp directory for one test's workspace.
///
/// Prefers cargo's `CARGO_TARGET_TMPDIR`, then a `tmp` sibling of the test
/// binary's `deps` directory (the target dir is writable wherever the build
/// ran), and only then the system temp dir — which on some Windows machines is
/// protected and rejects even creating a tempdir (`Access is denied`).
pub(crate) fn fresh_tempdir() -> TempDir {
    if let Some(base) = std::env::var_os("CARGO_TARGET_TMPDIR") {
        let base = PathBuf::from(base);
        if std::fs::create_dir_all(&base).is_ok() {
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
    TempDir::new().expect("tempdir for the test workspace")
}

/// Record the run's intake stage as already finished.
///
/// `advance_stage` executes the Idea (intake) stage before it walks to Gate A.
/// A test that only cares about the stages after that gate routes no intake
/// provider, so it seeds this Done row instead — intake is then skipped exactly
/// as it is for a run whose intake already ran.
pub(crate) async fn mark_intake_done(store: &warsha_store::Store, run_id: warsha_core::RunId) {
    let run = store.get_run(run_id).await.expect("the run is readable");
    let session = warsha_core::Session {
        id: warsha_core::SessionId::new(),
        run_id: Some(run_id),
        project_id: run.project_id,
        role: warsha_core::Role::Intake,
        backend: "native".to_string(),
        provider: String::new(),
        model: String::new(),
        status: warsha_core::SessionStatus::Done,
        started_at: chrono::Utc::now(),
        ended_at: Some(chrono::Utc::now()),
        parent_session_id: None,
        cli_session_id: None,
    };
    store
        .create_session(&session)
        .await
        .expect("the intake session is stored");
}
