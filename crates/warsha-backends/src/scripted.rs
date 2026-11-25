//! A coding backend that writes the files a task describes.
//!
//! This is not the materialize fixture. It does not read
//! [`crate::CODING_BACKEND_FIXTURE_ENV`], and it does not pick a body from a
//! table keyed by path. The task title selects the contract; the task's declared
//! file list only says where that contract is written. A task whose title names
//! no known contract writes nothing and returns `success: false`, so a wrong
//! task cannot land a file by accident.
//!
//! The title is the lane's own text. The swarm runner copies the shared code
//! prompt into every subtask description, so a selector that scanned the whole
//! description would see every contract word on every lane. The description is
//! read only for the `Declared files:` line.
//!
//! The four contracts are `docs/proof-project/SPEC.md` §4.1–§4.4. Each body has
//! a `//! clean1:{path}` marker and no `use` line.

use crate::{BackendError, CodingBackend, CodingResult, CodingTask, Result, Sandbox};
use async_trait::async_trait;
use std::sync::atomic::{AtomicUsize, Ordering};

/// How long one execute stays in flight so a concurrent poller can observe
/// every disjoint subtask at once. The swarm dispatcher joins the first lane
/// before it can start the fourth, so a store poll of `Dispatched` rows never
/// sees four. Short enough that a four-lane merge still finishes inside a test
/// timeout.
const SCRIPTED_HOLD_MS: u64 = 400;

static SCRIPTED_IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);
static SCRIPTED_PEAK: AtomicUsize = AtomicUsize::new(0);

/// Peak concurrent [`ScriptedBackend`] executes since the last reset.
pub fn scripted_execute_peak() -> usize {
    SCRIPTED_PEAK.load(Ordering::SeqCst)
}

/// Zero the peak and the in-flight count. A test calls this before the walk so
/// an earlier execute in the same process cannot inflate the peak.
pub fn reset_scripted_execute_peak() {
    SCRIPTED_IN_FLIGHT.store(0, Ordering::SeqCst);
    SCRIPTED_PEAK.store(0, Ordering::SeqCst);
}

/// Coding backend that derives each declared file from the task text.
///
/// Registered under the name `scripted`. Production startup does not register
/// it; a test that wants the derivation registers this type itself.
pub struct ScriptedBackend;

impl ScriptedBackend {
    /// The paths the swarm lane already declared, preferring `task.files`.
    ///
    /// `run_subtask_agent` currently leaves `files` empty and writes the same
    /// list onto a `Declared files:` line. Either source is the declaration.
    /// The description is not used to choose the contract.
    fn declared_paths(task: &CodingTask) -> Vec<String> {
        let from_files: Vec<String> = task
            .files
            .iter()
            .map(|file| file.path.trim().to_string())
            .filter(|path| !path.is_empty())
            .collect();
        if !from_files.is_empty() {
            return from_files;
        }
        declared_files_line(&task.description)
    }
}

#[async_trait]
impl CodingBackend for ScriptedBackend {
    fn name(&self) -> &str {
        "scripted"
    }

    fn is_available(&self) -> bool {
        true
    }

    async fn execute(&self, task: CodingTask, sandbox: &Sandbox) -> Result<CodingResult> {
        let started = std::time::Instant::now();
        let in_flight = SCRIPTED_IN_FLIGHT.fetch_add(1, Ordering::SeqCst) + 1;
        SCRIPTED_PEAK.fetch_max(in_flight, Ordering::SeqCst);
        struct InFlightGuard;
        impl Drop for InFlightGuard {
            fn drop(&mut self) {
                SCRIPTED_IN_FLIGHT.fetch_sub(1, Ordering::SeqCst);
            }
        }
        let _guard = InFlightGuard;

        let paths = Self::declared_paths(&task);
        // The title selects the contract. A path never does, and neither does
        // the shared prompt copied into the description. No match means this
        // task must not land a file.
        let Some(kind) = contract_kind_from_task(&task.title) else {
            return Ok(CodingResult {
                task_id: task.id,
                success: false,
                diff: None,
                files_changed: vec![],
                usage: None,
                error: Some("scripted backend found no contract in the task text".to_string()),
                duration_ms: started.elapsed().as_millis() as u64,
            });
        };
        if paths.is_empty() {
            return Ok(CodingResult {
                task_id: task.id,
                success: false,
                diff: None,
                files_changed: vec![],
                usage: None,
                error: Some("scripted backend found no declared files".to_string()),
                duration_ms: started.elapsed().as_millis() as u64,
            });
        }

        let mut files_changed = Vec::new();
        for relative in &paths {
            let dest = safe_scripted_path(&sandbox.work_dir, relative)?;
            if let Some(parent) = dest.parent() {
                tokio::fs::create_dir_all(parent).await.map_err(|err| {
                    BackendError::ExecutionFailed(format!(
                        "scripted backend could not create {}: {err}",
                        parent.display()
                    ))
                })?;
            }
            let body = render_contract(kind, relative);
            tokio::fs::write(&dest, body.as_bytes())
                .await
                .map_err(|err| {
                    BackendError::ExecutionFailed(format!(
                        "scripted backend could not write {}: {err}",
                        dest.display()
                    ))
                })?;
            files_changed.push(relative.clone());
        }
        tokio::time::sleep(std::time::Duration::from_millis(SCRIPTED_HOLD_MS)).await;
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
}

/// A relative path declared by the swarm lane. Absolute paths and `..` are
/// refused, same as the fixture, so a task cannot write outside its worktree.
fn safe_scripted_path(work_dir: &std::path::Path, relative: &str) -> Result<std::path::PathBuf> {
    let relative_path = std::path::Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(BackendError::ExecutionFailed(format!(
            "scripted backend refused a path outside the worktree: {relative}"
        )));
    }
    Ok(work_dir.join(relative_path))
}

fn declared_files_line(description: &str) -> Vec<String> {
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
    if raw.is_empty() || raw == "(none declared)" || raw.starts_with("(none") {
        return Vec::new();
    }
    raw.split(',')
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .collect()
}

/// Which proofcalc contract the task title names.
///
/// The match is a whole word in the title, not a path and not a word of the
/// shared prompt. A title that names more than one contract is ambiguous and
/// writes nothing.
#[derive(Clone, Copy)]
enum ContractKind {
    Scaffold,
    Domain,
    Engine,
    Provider,
}

fn contract_kind_from_task(title: &str) -> Option<ContractKind> {
    let mut found: Option<ContractKind> = None;
    for word in task_words(title) {
        let kind = match word.as_ref() {
            "scaffold" => ContractKind::Scaffold,
            "domain" => ContractKind::Domain,
            "engine" => ContractKind::Engine,
            "provider" => ContractKind::Provider,
            _ => continue,
        };
        match found {
            None => found = Some(kind),
            Some(existing) if same_kind(existing, kind) => {}
            Some(_) => return None,
        }
    }
    found
}

fn same_kind(left: ContractKind, right: ContractKind) -> bool {
    matches!(
        (left, right),
        (ContractKind::Scaffold, ContractKind::Scaffold)
            | (ContractKind::Domain, ContractKind::Domain)
            | (ContractKind::Engine, ContractKind::Engine)
            | (ContractKind::Provider, ContractKind::Provider)
    )
}

/// Words of the task title, compared case-insensitively.
///
/// A slash, a dot, or a digit ends the token, so a path cannot select a
/// contract. `Scaffold` and `scaffold` are the same word.
fn task_words(text: &str) -> impl Iterator<Item = std::borrow::Cow<'_, str>> {
    text.split(|ch: char| !ch.is_ascii_alphabetic())
        .filter(|word| !word.is_empty())
        .map(|word| {
            if word.bytes().any(|byte| byte.is_ascii_uppercase()) {
                std::borrow::Cow::Owned(word.to_ascii_lowercase())
            } else {
                std::borrow::Cow::Borrowed(word)
            }
        })
}

fn render_contract(kind: ContractKind, relative: &str) -> String {
    match kind {
        ContractKind::Scaffold => render_scaffold(relative),
        ContractKind::Domain => render_domain(relative),
        ContractKind::Engine => render_engine(relative),
        ContractKind::Provider => render_provider(relative),
    }
}

/// SPEC §4.1. Overflow saturates to `i64::MAX` when `b > 0`, else `i64::MIN`.
fn render_scaffold(relative: &str) -> String {
    format!(
        "//! clean1:{relative}\n\
         pub fn add(a: i64, b: i64) -> i64 {{\n\
         \x20   match i64::checked_add(a, b) {{\n\
         \x20       Some(sum) => sum,\n\
         \x20       None => {{\n\
         \x20           if b > 0 {{\n\
         \x20               i64::MAX\n\
         \x20           }} else {{\n\
         \x20               i64::MIN\n\
         \x20           }}\n\
         \x20       }}\n\
         \x20   }}\n\
         }}\n"
    )
}

/// SPEC §4.2. `cents` is the only field. Overflow is `None`.
fn render_domain(relative: &str) -> String {
    format!(
        "//! clean1:{relative}\n\
         pub struct Money {{\n\
         \x20   pub cents: i64,\n\
         }}\n\
         \n\
         impl Money {{\n\
         \x20   pub fn checked_add(self, other: Money) -> Option<Money> {{\n\
         \x20       match i64::checked_add(self.cents, other.cents) {{\n\
         \x20           Some(cents) => Some(Money {{ cents }}),\n\
         \x20           None => None,\n\
         \x20       }}\n\
         \x20   }}\n\
         }}\n"
    )
}

/// SPEC §4.3. Basis points above 10_000, a product that does not fit in `u128`,
/// or a signed result that does not fit in `i64` are `None`. No floating point.
fn render_engine(relative: &str) -> String {
    format!(
        "//! clean1:{relative}\n\
         pub fn apply_fee(amount: i64, bps: u32) -> Option<i64> {{\n\
         \x20   if bps > 10_000 {{\n\
         \x20       return None;\n\
         \x20   }}\n\
         \x20   if amount == 0 {{\n\
         \x20       return Some(0);\n\
         \x20   }}\n\
         \x20   let product = match (amount.unsigned_abs() as u128).checked_mul(u128::from(bps)) {{\n\
         \x20       Some(product) => product,\n\
         \x20       None => return None,\n\
         \x20   }};\n\
         \x20   let fee = product / 10_000;\n\
         \x20   if fee > i64::MAX as u128 {{\n\
         \x20       return None;\n\
         \x20   }}\n\
         \x20   let fee = fee as i64;\n\
         \x20   if amount > 0 {{\n\
         \x20       amount.checked_add(fee)\n\
         \x20   }} else {{\n\
         \x20       amount.checked_sub(fee)\n\
         \x20   }}\n\
         }}\n"
    )
}

/// SPEC §4.4. One method, no default body, no associated type, no impl.
fn render_provider(relative: &str) -> String {
    format!(
        "//! clean1:{relative}\n\
         pub trait RateSource {{\n\
         \x20   fn rate_bps(&self) -> u32;\n\
         }}\n"
    )
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use ulid::Ulid;
    use warsha_core::RunId;

    fn task(title: &str, description: &str) -> CodingTask {
        CodingTask {
            id: Ulid::new(),
            run_id: RunId::new(),
            title: title.to_string(),
            description: description.to_string(),
            repo_path: PathBuf::from("/tmp"),
            worktree_path: None,
            branch_name: "test".to_string(),
            base_branch: "main".to_string(),
            files: vec![],
            context: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn the_task_text_selects_the_contract_not_the_path() {
        let lanes = [
            (
                "Scaffold the arithmetic helper",
                "src/lane_a.rs",
                "pub fn add",
            ),
            (
                "Implement the domain type",
                "src/lane_b.rs",
                "pub struct Money",
            ),
            (
                "Implement the fee engine",
                "src/lane_c.rs",
                "pub fn apply_fee",
            ),
            (
                "Declare the rate provider",
                "src/lane_d.rs",
                "pub trait RateSource",
            ),
        ];
        for (prose, relative, needle) in lanes {
            let description = format!("Subtask: {prose}\nDeclared files: {relative}");
            let kind = contract_kind_from_task(&format!("Swarm subtask — {prose}"))
                .expect("the title names one contract");
            let _ = description;
            let body = render_contract(kind, relative);
            assert!(
                body.starts_with(&format!("//! clean1:{relative}\n")),
                "{relative} marker is not the declared path:\n{body}"
            );
            assert!(
                body.contains(needle),
                "{relative} missing {needle}:\n{body}"
            );
            assert!(
                !body.lines().any(|line| {
                    let trimmed = line.trim_start();
                    trimmed.starts_with("use ") || trimmed.starts_with("pub use ")
                }),
                "{relative} has a use line:\n{body}"
            );
            // The path words are not a selector. A title that only names the
            // path, with no contract word, writes nothing.
            assert!(
                contract_kind_from_task(&format!("write {relative}")).is_none(),
                "{relative} selected a contract from its path"
            );
        }
    }

    #[test]
    fn a_task_that_names_no_contract_writes_nothing() {
        assert!(contract_kind_from_task("unrelated work").is_none());
        assert!(contract_kind_from_task("Scaffold and domain together").is_none());
        // The shared code prompt names every contract. It is not the title, so
        // it does not select one.
        assert!(contract_kind_from_task("Swarm subtask — unrelated").is_none());
    }

    #[test]
    fn scripted_backend_refuses_paths_outside_the_worktree() {
        let root = PathBuf::from("/tmp/work");
        assert!(safe_scripted_path(&root, "/etc/passwd").is_err());
        assert!(safe_scripted_path(&root, "src/../../etc/passwd").is_err());
        assert!(safe_scripted_path(&root, "src/scaffold.rs").is_ok());
    }

    #[tokio::test]
    async fn a_wrong_task_returns_failure_and_writes_no_file() {
        let backend = ScriptedBackend;
        let dir = tempfile::tempdir().expect("a temp dir");
        let task = task(
            "Swarm subtask — unrelated",
            "Do something else.\n\n---\nSubtask: unrelated\nDeclared files: src/other.rs",
        );
        let sandbox = Sandbox::new(dir.path().to_path_buf());
        let result = backend
            .execute(task, &sandbox)
            .await
            .expect("execute returns");
        assert!(!result.success);
        assert!(result.files_changed.is_empty());
        assert!(!dir.path().join("src/other.rs").exists());
    }
}
