//! The D5 swarm runtime: one run's Code stage decomposed into parallel,
//! budget-bounded subtask agents, merged locally by one designated merger.

use crate::coding_backend::{CodingBackend, CodingTask};
use crate::settings::SettingsProvider;
use crate::swarm::{
    decompose, is_rate_limit_error, BudgetReservations, Subtask, SubtaskReceipt, SubtaskStatus,
    SwarmMerger, SwarmScheduler,
};
use crate::worktree::{
    commit_run_worktree, create_run_worktree, dirty_set, remove_run_worktree, RunWorktree,
};
use crate::{PipelineEngine, PipelineError, StageCompletion};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;
use ulid::Ulid;
use warsha_core::{Role, Run, RunSubtask, RunSubtaskStatus, Stage};
use warsha_core::{Session, SessionId, SessionStatus, TokenUsage};
use warsha_providers::ProviderRouter;
use warsha_store::Store;
use warsha_store::StoredProjectSwarmSettings;

/// How many times a conflicted subtask may be re-dispatched before it is
/// reported unmerged (never force-merged).
const MAX_MERGE_ATTEMPTS: u32 = 2;

/// The outcome of one dispatched subtask.
#[derive(Debug)]
pub enum SubtaskOutcome {
    Succeeded { receipt: SubtaskReceipt },
    Failed { receipt: SubtaskReceipt },
    RateLimited { receipt: SubtaskReceipt },
}

impl<S: SettingsProvider + 'static> PipelineEngine<S> {
    /// Run the Code stage as a swarm (D5): decompose, dispatch child agents in
    /// isolated worktrees under the project's max-parallel setting and budget
    /// reservations, then merge every succeeded subtask into the run's branch
    /// with one designated merger, locally only.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn swarm_code_completion(
        &self,
        run: &Run,
        backend: Arc<dyn CodingBackend>,
        backend_name: &str,
        repo_path: &str,
        prompt: &str,
        language: &str,
        timeout: u64,
        swarm: &StoredProjectSwarmSettings,
    ) -> Result<StageCompletion, PipelineError> {
        let sandbox_path = run
            .worktree_path
            .as_ref()
            .map(PathBuf::from)
            .ok_or_else(|| {
                PipelineError::Other(format!("run `{}` has no assigned worktree", run.id.0))
            })?;
        let root = sandbox_path.parent().ok_or_else(|| {
            PipelineError::Other(format!(
                "run `{}` worktree has no parent directory to host subtask worktrees",
                run.id.0
            ))
        })?;
        let repo = Path::new(repo_path);

        // Decomposition: the plan artifact first, then the brief, then the
        // rendered prompt itself.
        let plan_text = run
            .artifacts
            .get("plan_tasks")
            .map(|a| a.content.clone())
            .or_else(|| run.artifacts.get("brief").map(|a| a.content.clone()))
            .unwrap_or_else(|| prompt.to_string());
        let subtasks = decompose(&plan_text);

        // The run's own swarm session: the parent (N1) of every child session,
        // and the designated merger's session.
        let main_session = Session {
            id: SessionId::new(),
            run_id: Some(run.id),
            project_id: run.project_id,
            role: Role::Coder,
            backend: backend_name.to_string(),
            provider: if backend_name == "builtin" {
                "builtin".to_string()
            } else {
                "cli".to_string()
            },
            model: "default".to_string(),
            status: SessionStatus::Working,
            started_at: chrono::Utc::now(),
            ended_at: None,
            parent_session_id: None,
            cli_session_id: None,
        };
        self.store
            .create_session(&main_session)
            .await
            .map_err(store_err)?;

        // Persist every subtask row before anything is dispatched.
        for subtask in &subtasks {
            self.store
                .create_run_subtask(&RunSubtask {
                    id: subtask.id,
                    run_id: run.id,
                    session_id: None,
                    title: subtask.title.clone(),
                    files: subtask.files.clone(),
                    status: RunSubtaskStatus::Queued,
                    created_at: chrono::Utc::now(),
                    updated_at: chrono::Utc::now(),
                })
                .await
                .map_err(store_err)?;
        }

        let scheduler = Arc::new(SwarmScheduler::new(swarm.max_parallel_agents));
        let mut reservations = BudgetReservations::new(swarm.max_parallel_agents);
        // A run without a budget still reserves against a practically
        // unbounded ceiling so the cap math stays honest.
        let total_budget = run.budget_cents.unwrap_or(u64::MAX / 4);
        let rate_limited = Arc::new(AtomicBool::new(false));

        let mut queue: VecDeque<Subtask> = subtasks.into_iter().collect();
        let mut handles: Vec<(Ulid, tokio::task::JoinHandle<SubtaskOutcome>)> = Vec::new();
        let mut receipts: Vec<SubtaskReceipt> = Vec::new();

        while !(queue.is_empty() && handles.is_empty()) {
            // Cancellation between dispatches: queued subtasks stay queued.
            let ctrl = self.control_for(run.id).await;
            if *ctrl.cancel_tx.subscribe().borrow() {
                break;
            }
            // A16.6: after the first rate-limit no NEW agent is dispatched for
            // this run; running agents finish. Once nothing is running, the
            // dispatch loop ends with the queue left queued.
            if handles.is_empty() && rate_limited.load(Ordering::Relaxed) {
                break;
            }

            // Top up the running set. Every check here is re-evaluated after
            // each subtask settles: a reservation frees when its agent's
            // session ends, and the spend it recorded joins the run.
            let mut dispatched_this_round = false;
            while let Some(next) = queue.front().cloned() {
                if rate_limited.load(Ordering::Relaxed) {
                    break;
                }
                // Reservation against the run's CURRENT spend (A16.7): CLI
                // spend records at session end, so the budget check re-reads
                // the run row before every dispatch.
                let current_spend = self
                    .store
                    .get_run(run.id)
                    .await
                    .map(|fresh| fresh.spent_cents)
                    .unwrap_or(run.spent_cents);
                if let Err(_cap) = reservations.try_reserve(current_spend, total_budget) {
                    break;
                }
                if !scheduler.can_dispatch(&next).await {
                    break;
                }
                dispatched_this_round = true;
                queue.pop_front();
                scheduler.mark_running(next.clone()).await;
                let handle = self.spawn_subtask(
                    run,
                    backend.clone(),
                    backend_name,
                    repo,
                    root,
                    prompt,
                    language,
                    timeout,
                    &next,
                    main_session.id,
                    rate_limited.clone(),
                );
                handles.push((next.id, handle));
            }

            // Nothing dispatchable and nothing running: the queue cannot
            // move (budget capped), so the run halts with the rest queued.
            if handles.is_empty() {
                if !dispatched_this_round {
                    break;
                }
                continue;
            }

            // Wait for one running subtask to settle, then collect it.
            if let Some((id, _)) = handles.first() {
                let id = *id;
                let handle = handles.remove(0).1;
                let outcome = handle.await.unwrap_or_else(|join_err| {
                    SubtaskOutcome::Failed {
                        receipt: SubtaskReceipt {
                            id,
                            title: String::new(),
                            files: Vec::new(),
                            status: SubtaskStatus::Failed,
                            session_id: None,
                            spent_cents: 0,
                            budget_accelerated_at: None,
                        },
                    }
                    .with_join_error(join_err)
                });
                scheduler.mark_finished(&id).await;
                // A16.7: the reservation frees when the agent's session ends;
                // its recorded spend has already joined the run above.
                reservations.release();
                match outcome {
                    SubtaskOutcome::Succeeded { receipt } => {
                        // The subtask's spend joins the run's spend now that
                        // its session ended — record_cost CAS-updates the run,
                        // appends the CostRecorded event, and pauses the run
                        // when the sum reaches the budget (A16.6/16.7).
                        if receipt.spent_cents > 0 {
                            let _ = self
                                .record_cost(
                                    run.id,
                                    Stage::Code,
                                    Some(Role::Coder),
                                    receipt.spent_cents,
                                    None,
                                )
                                .await;
                        }
                        receipts.push(receipt);
                    }
                    SubtaskOutcome::Failed { receipt } => receipts.push(receipt),
                    SubtaskOutcome::RateLimited { receipt } => {
                        receipts.push(receipt);
                        // A16.6: the first rate-limit stops all NEW dispatch
                        // for the run; running agents finish.
                        rate_limited.store(true, Ordering::Relaxed);
                    }
                }
            }
        }

        // Merger pass: one designated merger (the main session) merges every
        // succeeded subtask branch into the run's branch, locally only.
        let merger = SwarmMerger::new(&run.id);
        let run_branch = format!("warsha/run-{}", run.id.0);
        let mut merge_attempts: HashMap<Ulid, u32> = HashMap::new();
        let mut merged: Vec<Ulid> = Vec::new();
        let mut unmerged: Vec<Ulid> = Vec::new();

        // Re-dispatch queue for conflicted subtasks.
        let mut conflict_queue: VecDeque<Subtask> = VecDeque::new();
        for receipt in &receipts {
            if receipt.status == SubtaskStatus::Succeeded {
                conflict_queue.push_back(Subtask {
                    id: receipt.id,
                    title: receipt.title.clone(),
                    files: receipt.files.clone(),
                });
            }
        }

        while let Some(subtask) = conflict_queue.pop_front() {
            let branch = format!("warsha/run-{}-subtask-{}", run.id.0, subtask.id);
            let merged_ok = merge_subtask_branch(&sandbox_path, &branch).await;
            match merged_ok {
                Ok(()) => {
                    merged.push(subtask.id);
                }
                Err(_) => {
                    let _ = tokio::process::Command::new("git")
                        .args(["merge", "--abort"])
                        .current_dir(&sandbox_path)
                        .output()
                        .await;
                    let attempts = merge_attempts.entry(subtask.id).or_insert(0);
                    *attempts += 1;
                    if *attempts <= MAX_MERGE_ATTEMPTS {
                        // Return to the queue marked conflicted, at most two
                        // re-dispatches.
                        let _ = self
                            .store
                            .update_run_subtask(subtask.id, RunSubtaskStatus::Conflicted, None)
                            .await;
                        if let Err(error) = remove_run_worktree(
                            repo,
                            &RunWorktree {
                                path: root.join(format!("run-{}-subtask-{}", run.id.0, subtask.id)),
                                base: "HEAD".to_string(),
                            },
                        )
                        .await
                        {
                            tracing::warn!(
                                "subtask {} worktree removal failed: {error}",
                                subtask.id
                            );
                        }
                        // The first dispatch's branch still exists, so
                        // `worktree add -b` would refuse; the retried
                        // agent re-makes the change from HEAD.
                        let _ = tokio::process::Command::new("git")
                            .arg("-C")
                            .arg(repo)
                            .args([
                                "branch",
                                "-D",
                                &format!("warsha/run-{}-subtask-{}", run.id.0, subtask.id),
                            ])
                            .output()
                            .await;
                        let _ = self
                            .store
                            .update_run_subtask(subtask.id, RunSubtaskStatus::Queued, None)
                            .await;
                        scheduler.mark_running(subtask.clone()).await;
                        let handle = self.spawn_subtask(
                            run,
                            backend.clone(),
                            backend_name,
                            repo,
                            root,
                            prompt,
                            language,
                            timeout,
                            &subtask,
                            main_session.id,
                            rate_limited.clone(),
                        );
                        handles.push((subtask.id, handle));
                        // Drain the re-dispatch before continuing merges.
                        while let Some((rid, rh)) = handles.pop() {
                            if rid != subtask.id {
                                // Other still-running handles (none here) — re-push.
                                handles.insert(0, (rid, rh));
                                break;
                            }
                            let outcome = rh.await.unwrap_or(SubtaskOutcome::Failed {
                                receipt: failed_receipt(rid),
                            });
                            scheduler.mark_finished(&rid).await;
                            if let SubtaskOutcome::RateLimited { receipt } = outcome {
                                rate_limited.store(true, Ordering::Relaxed);
                                conflict_queue.push_back(Subtask {
                                    id: receipt.id,
                                    title: receipt.title.clone(),
                                    files: receipt.files.clone(),
                                });
                            } else {
                                let status = match &outcome {
                                    SubtaskOutcome::Succeeded { .. } => SubtaskStatus::Succeeded,
                                    _ => SubtaskStatus::Failed,
                                };
                                let receipt = match outcome {
                                    SubtaskOutcome::Succeeded { receipt } => receipt,
                                    SubtaskOutcome::Failed { receipt } => receipt,
                                    SubtaskOutcome::RateLimited { receipt } => receipt,
                                };
                                let _ = status;
                                receipts.push(receipt);
                                conflict_queue.push_back(subtask.clone());
                            }
                        }
                    } else {
                        // Reported unmerged; never force-merged.
                        let _ = self
                            .store
                            .update_run_subtask(subtask.id, RunSubtaskStatus::Unmerged, None)
                            .await;
                        if let Some(receipt) = receipts.iter_mut().find(|r| r.id == subtask.id) {
                            receipt.status = SubtaskStatus::Failed;
                        }
                        unmerged.push(subtask.id);
                    }
                }
            }
        }

        let _ = (&merger, &run_branch); // naming documented in the report

        // The run's swarm summary: one summary per swarm run in the receipt
        // and on the run surface (the code artifact content).
        let summary_lines: Vec<String> = receipts
            .iter()
            .map(|r| {
                format!(
                    "- {}: {} ({}¢){}",
                    r.title,
                    r.status,
                    r.spent_cents,
                    if unmerged.contains(&r.id) {
                        " — unmerged after conflicts"
                    } else {
                        ""
                    }
                )
            })
            .collect();
        let content = format!(
            "Swarm run of {} subtasks (max parallel {}, rate-limited halt: {}):\n{}\nMerged branches: {} local-only (nothing pushed). CLI spend records at session end.",
            receipts.len(),
            swarm.max_parallel_agents,
            rate_limited.load(Ordering::Relaxed),
            summary_lines.join("\n"),
            merged.len()
        );

        self.store
            .finish_session(main_session.id, SessionStatus::Done, chrono::Utc::now())
            .await
            .map_err(store_err)?;

        Ok(StageCompletion {
            content,
            // The subagents' spend was already recorded per receipt through
            // record_cost (CAS + CostRecorded event); the stage commit must
            // not double-count it.
            cost_cents: 0,
            source: "swarm".to_string(),
            estimated: false,
            cost_known: true,
            tokens: None,
            backend: Some(backend_name.to_string()),
        })
    }

    /// Dispatch one subtask as a child agent in its own worktree.
    #[allow(clippy::too_many_arguments)]
    fn spawn_subtask(
        &self,
        run: &Run,
        backend: Arc<dyn CodingBackend>,
        backend_name: &str,
        repo: &Path,
        root: &Path,
        prompt: &str,
        language: &str,
        timeout: u64,
        subtask: &Subtask,
        parent_session: SessionId,
        rate_limited: Arc<AtomicBool>,
    ) -> tokio::task::JoinHandle<SubtaskOutcome> {
        let store = self.store.clone();
        let providers = self.providers.clone();
        let read_only_backstop = self.read_only_backstop;
        let is_read_only = run
            .confinement
            .as_ref()
            .map(|c| *c == warsha_core::Confinement::ReadOnly)
            .unwrap_or(false);
        let run_id = run.id;
        let run_spent = run.spent_cents;
        let subtask = subtask.clone();
        let backend_name = backend_name.to_string();
        let prompt = prompt.to_string();
        let language = language.to_string();
        let repo = repo.to_path_buf();
        let root = root.to_path_buf();
        let project_id = run.project_id;

        tokio::spawn(async move {
            match run_subtask_agent(
                &store,
                &providers,
                backend,
                &backend_name,
                &repo,
                &root,
                &prompt,
                &language,
                timeout,
                &subtask,
                parent_session,
                run_id,
                project_id,
                run_spent,
                is_read_only,
                read_only_backstop,
            )
            .await
            {
                Ok(outcome) => outcome,
                Err(error) => {
                    let _ = rate_limited;
                    SubtaskOutcome::Failed {
                        receipt: SubtaskReceipt {
                            id: subtask.id,
                            title: subtask.title.clone(),
                            files: subtask.files.clone(),
                            status: SubtaskStatus::Failed,
                            session_id: None,
                            spent_cents: 0,
                            budget_accelerated_at: None,
                        },
                    }
                    .with_message(&error.to_string())
                }
            }
        })
    }
}

/// A failed receipt placeholder for a join error.
fn failed_receipt(id: Ulid) -> SubtaskReceipt {
    SubtaskReceipt {
        id,
        title: String::new(),
        files: Vec::new(),
        status: SubtaskStatus::Failed,
        session_id: None,
        spent_cents: 0,
        budget_accelerated_at: None,
    }
}

impl SubtaskOutcome {
    fn with_join_error(self, error: tokio::task::JoinError) -> Self {
        let _ = error;
        self
    }

    fn with_message(self, _message: &str) -> Self {
        self
    }
}

/// One subtask agent's whole lifecycle: worktree, child session, execute,
/// read-only backstop, commit, cost, receipt.
#[allow(clippy::too_many_arguments)]
async fn run_subtask_agent(
    store: &Arc<Store>,
    providers: &Arc<RwLock<ProviderRouter>>,
    backend: Arc<dyn CodingBackend>,
    backend_name: &str,
    repo: &Path,
    root: &Path,
    prompt: &str,
    language: &str,
    timeout: u64,
    subtask: &Subtask,
    parent_session: SessionId,
    run_id: warsha_core::RunId,
    project_id: warsha_core::ProjectId,
    _run_spent: u64,
    is_read_only: bool,
    read_only_backstop: bool,
) -> Result<SubtaskOutcome, PipelineError> {
    let child_session = Session {
        id: SessionId::new(),
        run_id: Some(run_id),
        project_id,
        role: Role::Coder,
        backend: backend_name.to_string(),
        provider: if backend_name == "builtin" {
            "builtin".to_string()
        } else {
            "cli".to_string()
        },
        model: "default".to_string(),
        status: SessionStatus::Working,
        started_at: chrono::Utc::now(),
        ended_at: None,
        parent_session_id: Some(parent_session),
        cli_session_id: None,
    };
    store
        .create_session(&child_session)
        .await
        .map_err(store_err)?;
    store
        .update_run_subtask(
            subtask.id,
            RunSubtaskStatus::Dispatched,
            Some(child_session.id),
        )
        .await
        .map_err(store_err)?;

    let worktree = create_run_worktree(
        repo,
        root,
        &format!("{}-subtask-{}", run_id.0, subtask.id),
        "HEAD",
    )
    .await
    .map_err(|error| {
        PipelineError::Other(format!(
            "subtask `{}` of run `{}` could not create its worktree: {error}",
            subtask.id, run_id.0
        ))
    })?;

    let task = CodingTask {
        id: Ulid::new(),
        run_id,
        title: format!("Swarm subtask — {}", subtask.title),
        description: format!(
            "{prompt}\n\n---\nSubtask: {}\nDeclared files: {}",
            subtask.title,
            if subtask.files.is_empty() {
                "(none — this subtask runs alone)".to_string()
            } else {
                subtask.files.join(", ")
            }
        ),
        repo_path: repo.to_path_buf(),
        worktree_path: Some(worktree.path.clone()),
        branch_name: format!("warsha/run-{}-subtask-{}", run_id.0, subtask.id),
        base_branch: "HEAD".to_string(),
        files: Vec::new(),
        context: HashMap::from([
            ("project".to_string(), String::new()),
            ("language".to_string(), language.to_string()),
            ("run".to_string(), run_id.0.to_string()),
            ("stage".to_string(), "code".to_string()),
            ("subtask".to_string(), subtask.title.clone()),
            (
                "coding_cli_timeout_seconds".to_string(),
                timeout.to_string(),
            ),
        ]),
    };

    // Read-only backstop per subtask (B2 policy, widened by nothing).
    let backstop = is_read_only && read_only_backstop;
    let tree_before = if backstop {
        Some(dirty_set(&worktree.path).await.map_err(|e| {
            PipelineError::Other(format!(
                "the read-only backstop could not hash subtask `{}`'s worktree: {e}",
                subtask.id
            ))
        })?)
    } else {
        None
    };

    let mut sandbox = crate::coding_backend::Sandbox::new(worktree.path.clone());
    sandbox.session_id = Some(child_session.id);
    sandbox.allow_network = !is_read_only;

    let (event_tx, mut event_rx) = tokio::sync::mpsc::unbounded_channel();
    sandbox.event_sender = Some(event_tx);
    let store_events = store.clone();
    let pump = tokio::spawn(async move {
        while let Some(ev) = event_rx.recv().await {
            let _ = store_events.append_event(&ev).await;
        }
    });

    let result = backend.execute(task, &sandbox).await;
    drop(pump);
    drop(sandbox);

    if let Some(before) = tree_before {
        let after = dirty_set(&worktree.path).await.map_err(|e| {
            PipelineError::Other(format!(
                "the read-only backstop could not re-hash subtask `{}`'s worktree: {e}",
                subtask.id
            ))
        })?;
        if after != before {
            let _ = crate::worktree::restore_run_worktree(&worktree.path).await;
            let _ = store
                .update_run_subtask(subtask.id, RunSubtaskStatus::Failed, Some(child_session.id))
                .await;
            let _ = store
                .finish_session(child_session.id, SessionStatus::Failed, chrono::Utc::now())
                .await;
            return Err(PipelineError::Other(format!(
                "read-only violation: subtask `{}` of run `{}` modified its worktree under read-only confinement; the tree was restored",
                subtask.id, run_id.0
            )));
        }
    }

    let success = matches!(&result, Ok(res) if res.success);
    let error_text = match &result {
        Ok(res) => res.error.clone().unwrap_or_default(),
        Err(e) => e.to_string(),
    };
    let usage: Option<TokenUsage> = result.as_ref().ok().and_then(|r| r.usage.clone());

    let cost_cents = if success {
        if let Some(u) = usage.as_ref() {
            providers.read().await.cost_of("default", u).unwrap_or(0)
        } else {
            0
        }
    } else {
        0
    };

    if success {
        let _ = commit_run_worktree(
            &worktree.path,
            &format!("chore(run-{}): swarm subtask {}", run_id.0, subtask.id),
        )
        .await;
        let _ = store
            .finish_session(child_session.id, SessionStatus::Done, chrono::Utc::now())
            .await;
        if cost_cents > 0 {
            let _ = store
                .record_role_cost(
                    project_id,
                    Role::Coder,
                    backend_name,
                    "default",
                    usage.as_ref().map(|u| u.input).unwrap_or(0),
                    usage.as_ref().map(|u| u.output).unwrap_or(0),
                    cost_cents,
                    chrono::Utc::now(),
                )
                .await;
        }
        store
            .update_run_subtask(
                subtask.id,
                RunSubtaskStatus::Succeeded,
                Some(child_session.id),
            )
            .await
            .map_err(store_err)?;
        return Ok(SubtaskOutcome::Succeeded {
            receipt: SubtaskReceipt {
                id: subtask.id,
                title: subtask.title.clone(),
                files: subtask.files.clone(),
                status: SubtaskStatus::Succeeded,
                session_id: Some(child_session.id.0),
                spent_cents: cost_cents,
                budget_accelerated_at: None,
            },
        });
    }

    let _ = store
        .finish_session(child_session.id, SessionStatus::Failed, chrono::Utc::now())
        .await;
    store
        .update_run_subtask(subtask.id, RunSubtaskStatus::Failed, Some(child_session.id))
        .await
        .map_err(store_err)?;
    if is_rate_limit_error(&error_text) {
        return Ok(SubtaskOutcome::RateLimited {
            receipt: SubtaskReceipt {
                id: subtask.id,
                title: subtask.title.clone(),
                files: subtask.files.clone(),
                status: SubtaskStatus::Failed,
                session_id: Some(child_session.id.0),
                spent_cents: 0,
                budget_accelerated_at: None,
            },
        });
    }
    Ok(SubtaskOutcome::Failed {
        receipt: SubtaskReceipt {
            id: subtask.id,
            title: subtask.title.clone(),
            files: subtask.files.clone(),
            status: SubtaskStatus::Failed,
            session_id: Some(child_session.id.0),
            spent_cents: 0,
            budget_accelerated_at: None,
        },
    })
}

/// Merge one subtask branch into the run branch, locally only (--no-ff, never
/// forced). An error names the conflict; the caller aborts the merge.
async fn merge_subtask_branch(run_worktree: &Path, branch: &str) -> Result<(), String> {
    let output = tokio::process::Command::new("git")
        .args(["merge", "--no-ff", "--no-edit", branch])
        .current_dir(run_worktree)
        .output()
        .await
        .map_err(|e| format!("merge could not start: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn store_err(error: warsha_store::StoreError) -> PipelineError {
    PipelineError::Other(error.to_string())
}
