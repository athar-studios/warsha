//! Test-only coding-backend fixtures (R-F3e).
//!
//! Compiled only under `cfg(test)` or the non-default `test-fixtures` feature, so
//! a production `cargo build -p warshad` carries neither the env switch nor the
//! materialize path. See D-RN-FIXTURE-GATE-1.

use crate::{BackendError, CodingResult, CodingTask, Result, Sandbox};

/// Env switch that makes [`BuiltinBackend`](crate::BuiltinBackend) write the subtask's declared files.
///
/// Unset, or any value other than `materialize`, keeps the historical no-write
/// success. Tests set `materialize` so a swarm Code stage can land real files
/// without a model and without a coding CLI. A real installed CLI is a different
/// backend and never reads this switch.
pub const CODING_BACKEND_FIXTURE_ENV: &str = "WARSHA_CODING_BACKEND_FIXTURE";

const FIXTURE_MATERIALIZE: &str = "materialize";

/// How long a materializing execute stays in flight so a concurrent poller can
/// observe every disjoint subtask at once. Short enough that a four-lane merge
/// still finishes inside a test timeout.
const FIXTURE_HOLD_MS: u64 = 400;

/// In-flight materialize calls and the high-water mark of that count.
///
/// The swarm dispatcher joins the first lane before it can start the fourth, so
/// a store poll of `Dispatched` rows never sees four. These counters are the
/// witness that four executes overlapped inside the backend. Tests read them
/// only while the fixture switch is on.
static FIXTURE_IN_FLIGHT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
static FIXTURE_PEAK: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Peak concurrent `materialize` executes since the last reset. `0` when the
/// fixture switch has never run in this process.
pub fn fixture_materialize_peak() -> usize {
    FIXTURE_PEAK.load(std::sync::atomic::Ordering::SeqCst)
}

/// Zero the peak and the in-flight count. A test calls this before the walk so
/// an earlier materialize in the same process cannot inflate the peak.
pub fn reset_fixture_materialize_peak() {
    FIXTURE_IN_FLIGHT.store(0, std::sync::atomic::Ordering::SeqCst);
    FIXTURE_PEAK.store(0, std::sync::atomic::Ordering::SeqCst);
}

/// `true` only for the explicit fixture value. Anything else, including an
/// empty string, stays on the production no-write path.
pub(crate) fn fixture_materialize() -> bool {
    std::env::var(CODING_BACKEND_FIXTURE_ENV)
        .map(|value| value.trim() == FIXTURE_MATERIALIZE)
        .unwrap_or(false)
}

/// Write one valid file per path the swarm runtime declared.
///
/// Paths come from the `Declared files:` line `run_subtask_agent` already puts
/// in the task description. The four proofcalc lane paths get the contracts in
/// `docs/proof-project/SPEC.md` sections 4.1–4.4. Any other declared path keeps
/// the historical one-function stub. The hold keeps four disjoint subtasks in
/// flight together. No network, no keychain, no model. `src/lib.rs`,
/// `tests/proof.rs`, and `Cargo.toml` are not written here: they name every
/// lane, so they are a sequential follow-up, not a fifth parallel file.
pub(crate) async fn materialize_declared_files(
    task: &CodingTask,
    sandbox: &Sandbox,
) -> Result<CodingResult> {
    let started = std::time::Instant::now();
    let in_flight = FIXTURE_IN_FLIGHT.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    FIXTURE_PEAK.fetch_max(in_flight, std::sync::atomic::Ordering::SeqCst);
    struct InFlightGuard;
    impl Drop for InFlightGuard {
        fn drop(&mut self) {
            FIXTURE_IN_FLIGHT.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let _guard = InFlightGuard;
    let paths = declared_files_from_description(&task.description);
    if paths.is_empty() {
        return Err(BackendError::ExecutionFailed(
            "fixture materialize found no declared files".to_string(),
        ));
    }
    let title = task
        .context
        .get("subtask")
        .map(String::as_str)
        .unwrap_or("subtask");
    let mut files_changed = Vec::new();
    for relative in &paths {
        let dest = safe_worktree_path(&sandbox.work_dir, relative)?;
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|err| {
                BackendError::ExecutionFailed(format!(
                    "fixture could not create {}: {err}",
                    parent.display()
                ))
            })?;
        }
        let body = fixture_file_body(title, relative);
        tokio::fs::write(&dest, body.as_bytes())
            .await
            .map_err(|err| {
                BackendError::ExecutionFailed(format!(
                    "fixture could not write {}: {err}",
                    dest.display()
                ))
            })?;
        files_changed.push(relative.clone());
    }
    tokio::time::sleep(std::time::Duration::from_millis(FIXTURE_HOLD_MS)).await;
    Ok(CodingResult {
        task_id: task.id,
        success: true,
        diff: None,
        files_changed,
        usage: None,
        error: None,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

fn declared_files_from_description(description: &str) -> Vec<String> {
    let Some(line) = description
        .lines()
        .find(|line| line.trim_start().starts_with("Declared files:"))
    else {
        return Vec::new();
    };
    let raw = line
        .split_once(':')
        .map(|(_, rest)| rest)
        .unwrap_or("")
        .trim();
    if raw.is_empty() || raw == "(none declared)" {
        return Vec::new();
    }
    raw.split(',')
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .collect()
}

fn safe_worktree_path(work_dir: &std::path::Path, relative: &str) -> Result<std::path::PathBuf> {
    let relative_path = std::path::Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(BackendError::ExecutionFailed(format!(
            "fixture refused a path outside the worktree: {relative}"
        )));
    }
    Ok(work_dir.join(relative_path))
}

fn fixture_file_body(title: &str, relative: &str) -> String {
    if let Some(contract) = proofcalc_lane_body(relative) {
        return contract;
    }
    let stem = std::path::Path::new(relative)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("fixture");
    let ident = stem
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    format!(
        "//! Fixture file materialized by the builtin coding backend.\n\
         //! Subtask: {title}\n\
         //! Path: {relative}\n\
         \n\
         /// Deterministic marker the merger must keep.\n\
         pub fn {ident}_marker() -> &'static str {{\n\
             \"clean1:{relative}\"\n\
         }}\n"
    )
}

/// The four disjoint lane files from `docs/proof-project/SPEC.md` §4.1–4.4.
///
/// Each body is the contract itself: no `use` line, and no public item beyond
/// the one the spec names. The `clean1:{path}` module doc is the path marker
/// the daemon walk already asserts; it is not a second public item. A path
/// this function does not know is not a proofcalc lane.
fn proofcalc_lane_body(relative: &str) -> Option<String> {
    let source = match relative {
        "src/scaffold.rs" => PROOFCALC_SCAFFOLD,
        "src/domain.rs" => PROOFCALC_DOMAIN,
        "src/engine.rs" => PROOFCALC_ENGINE,
        "src/provider.rs" => PROOFCALC_PROVIDER,
        _ => return None,
    };
    Some(source.to_string())
}

/// SPEC §4.1. Overflow saturates to `i64::MAX` when `b > 0`, else `i64::MIN`.
const PROOFCALC_SCAFFOLD: &str = r#"//! clean1:src/scaffold.rs
pub fn add(a: i64, b: i64) -> i64 {
    match i64::checked_add(a, b) {
        Some(sum) => sum,
        None => {
            if b > 0 {
                i64::MAX
            } else {
                i64::MIN
            }
        }
    }
}
"#;

/// SPEC §4.2. `cents` is the only field. Overflow is `None`.
const PROOFCALC_DOMAIN: &str = r#"//! clean1:src/domain.rs
pub struct Money {
    pub cents: i64,
}

impl Money {
    pub fn checked_add(self, other: Money) -> Option<Money> {
        match i64::checked_add(self.cents, other.cents) {
            Some(cents) => Some(Money { cents }),
            None => None,
        }
    }
}
"#;

/// SPEC §4.3. Basis points above 10_000, a product that does not fit in `u128`,
/// or a signed result that does not fit in `i64` are `None`. No floating point.
const PROOFCALC_ENGINE: &str = r#"//! clean1:src/engine.rs
pub fn apply_fee(amount: i64, bps: u32) -> Option<i64> {
    if bps > 10_000 {
        return None;
    }
    if amount == 0 {
        return Some(0);
    }
    let product = match (amount.unsigned_abs() as u128).checked_mul(u128::from(bps)) {
        Some(product) => product,
        None => return None,
    };
    let fee = product / 10_000;
    if fee > i64::MAX as u128 {
        return None;
    }
    let fee = fee as i64;
    if amount > 0 {
        amount.checked_add(fee)
    } else {
        amount.checked_sub(fee)
    }
}
"#;

/// SPEC §4.4. One method, no default body, no associated type, no impl.
const PROOFCALC_PROVIDER: &str = r#"//! clean1:src/provider.rs
pub trait RateSource {
    fn rate_bps(&self) -> u32;
}
"#;

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn materialize_fixture_writes_the_proofcalc_contracts() {
        let lanes = [
            ("src/scaffold.rs", "pub fn add"),
            ("src/domain.rs", "pub struct Money"),
            ("src/engine.rs", "pub fn apply_fee"),
            ("src/provider.rs", "pub trait RateSource"),
        ];
        for (relative, name) in lanes {
            let body = fixture_file_body("lane", relative);
            assert!(
                body.contains(&format!("clean1:{relative}")),
                "{relative} lost the path marker"
            );
            assert!(body.contains(name), "{relative} missing {name}:\n{body}");
            assert!(
                !body.lines().any(|line| {
                    let trimmed = line.trim_start();
                    trimmed.starts_with("use ") || trimmed.starts_with("pub use ")
                }),
                "{relative} has a use line:\n{body}"
            );
        }
        let other = fixture_file_body("lane", "src/elsewhere.rs");
        assert!(
            other.contains("clean1:src/elsewhere.rs"),
            "a non-lane path must keep the historical stub"
        );
        assert!(
            !other.contains("pub fn add"),
            "a non-lane path must not receive the scaffold contract"
        );
    }

    #[test]
    fn materialize_fixture_refuses_paths_outside_the_worktree() {
        let root = PathBuf::from("/tmp/work");
        assert!(safe_worktree_path(&root, "/etc/passwd").is_err());
        assert!(safe_worktree_path(&root, "src/../../etc/passwd").is_err());
        assert!(safe_worktree_path(&root, "src/scaffold.rs").is_ok());
    }
}
