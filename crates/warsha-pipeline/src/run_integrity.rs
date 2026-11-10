//! Run-state integrity invariants, per-run locks, CAS updates, real cancel, and change-request loop (K2).

#[cfg(test)]
impl<S: crate::settings::SettingsProvider> crate::PipelineEngine<S> {
    fn clone_engine(&self) -> Self {
        Self {
            store: self.store.clone(),
            providers: self.providers.clone(),
            orchestrator: crate::orchestrator::Orchestrator::new(
                crate::orchestrator::OrchestratorConfig::default(),
            ),
            settings: self.settings.clone(),
            run_controls: self.run_controls.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::settings::SettingsStore;
    use crate::PipelineEngine;
    use chrono::Utc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::sync::{Notify, RwLock};
    use warsha_core::{
        DeviceId, EventKind, GateState, ModelPricing, Project, ProjectId, ProviderKind, Role,
        RoleRouting, RoutingTarget, RunStatus, Stage, TokenUsage,
    };
    use warsha_providers::{
        ChatChoice, ChatMessage, ChatProvider, ChatRequest, ChatResponse, ChatStreamChunk,
        HealthCheck, MessageRole, ModelInfo, ProviderError, ProviderRouter,
    };
    use warsha_store::Store;

    /// Provider that counts invocations and can pause mid-flight until signalled.
    struct TestTrackingProvider {
        id: String,
        call_count: Arc<AtomicUsize>,
        in_flight_notify: Option<Arc<Notify>>,
        unblock_notify: Option<Arc<Notify>>,
        last_prompt: Arc<tokio::sync::Mutex<String>>,
        cost_per_call_cents: u64,
    }

    impl TestTrackingProvider {
        fn new(id: &str) -> Self {
            Self {
                id: id.to_string(),
                call_count: Arc::new(AtomicUsize::new(0)),
                in_flight_notify: None,
                unblock_notify: None,
                last_prompt: Arc::new(tokio::sync::Mutex::new(String::new())),
                cost_per_call_cents: 25,
            }
        }

        fn with_notifications(id: &str, in_flight: Arc<Notify>, unblock: Arc<Notify>) -> Self {
            Self {
                id: id.to_string(),
                call_count: Arc::new(AtomicUsize::new(0)),
                in_flight_notify: Some(in_flight),
                unblock_notify: Some(unblock),
                last_prompt: Arc::new(tokio::sync::Mutex::new(String::new())),
                cost_per_call_cents: 25,
            }
        }
    }

    #[async_trait::async_trait]
    impl ChatProvider for TestTrackingProvider {
        fn id(&self) -> &str {
            &self.id
        }

        fn kind(&self) -> ProviderKind {
            ProviderKind::OpenAI
        }

        async fn list_models(&self) -> std::result::Result<Vec<ModelInfo>, ProviderError> {
            Ok(vec![ModelInfo {
                id: "test-model".to_string(),
                name: "Test Model".to_string(),
                provider: self.id.clone(),
                context_window: 8192,
                max_output: 4096,
                pricing: ModelPricing {
                    input_per_million_cents: 100,
                    output_per_million_cents: 200,
                },
            }])
        }

        async fn health(&self) -> std::result::Result<HealthCheck, ProviderError> {
            Ok(HealthCheck {
                healthy: true,
                latency_ms: Some(1),
                error: None,
            })
        }

        async fn chat(
            &self,
            request: ChatRequest,
        ) -> std::result::Result<ChatResponse, ProviderError> {
            self.call_count.fetch_add(1, Ordering::SeqCst);

            if let Some(msg) = request.messages.first() {
                let mut guard = self.last_prompt.lock().await;
                *guard = msg.content.clone();
            }

            if let Some(notify) = &self.in_flight_notify {
                notify.notify_waiters();
            }

            if let Some(unblock) = &self.unblock_notify {
                unblock.notified().await;
            }

            Ok(ChatResponse {
                id: "test-resp".to_string(),
                model: "test-model".to_string(),
                choices: vec![ChatChoice {
                    index: 0,
                    message: ChatMessage {
                        role: MessageRole::Assistant,
                        content: "# Generated Artifact Content\nResult".to_string(),
                    },
                    finish_reason: Some("stop".to_string()),
                }],
                usage: TokenUsage {
                    input: 100_000,
                    output: 100_000,
                    total: 200_000,
                },
            })
        }

        async fn chat_stream(
            &self,
            _request: ChatRequest,
        ) -> std::result::Result<
            Box<
                dyn futures::Stream<Item = std::result::Result<ChatStreamChunk, ProviderError>>
                    + Send
                    + Unpin,
            >,
            ProviderError,
        > {
            Err(ProviderError::Other(
                "streaming not used in test".to_string(),
            ))
        }

        fn cost_of(
            &self,
            _model: &str,
            _usage: &TokenUsage,
        ) -> std::result::Result<u64, ProviderError> {
            Ok(self.cost_per_call_cents)
        }
    }

    async fn test_fixture() -> (
        Arc<Store>,
        PipelineEngine<SettingsStore>,
        ProjectId,
        Arc<RwLock<ProviderRouter>>,
    ) {
        let dir = crate::test_util::fresh_tempdir();
        let path = dir.path().join("run_integrity.db");
        let store = Arc::new(Store::open_at(path).await.expect("store opens"));
        std::mem::forget(dir);

        let project = Project {
            id: ProjectId::new(),
            name: "Run Integrity Project".to_string(),
            description: "Testing K2 run-state integrity".to_string(),
            language: "en".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            repo_path: None,
            repo_url: None,
        };
        store
            .create_project(&project)
            .await
            .expect("project created");

        let router = Arc::new(RwLock::new(ProviderRouter::new()));
        let settings = Arc::new(SettingsStore::new());
        let engine = PipelineEngine::new(store.clone(), router.clone(), settings);

        (store, engine, project.id, router)
    }

    #[tokio::test]
    async fn concurrent_advances_execute_each_stage_only_once() {
        let (store, engine, project_id, router) = test_fixture().await;

        let tracking = TestTrackingProvider::new("track-provider");
        let call_count = tracking.call_count.clone();

        {
            let mut r = router.write().await;
            r.register_provider(Box::new(tracking));
            for role in [Role::Researcher, Role::PM, Role::Designer, Role::Intake] {
                r.set_role_routing(RoleRouting {
                    role,
                    targets: vec![RoutingTarget {
                        provider_id: "track-provider".to_string(),
                        model_id: "test-model".to_string(),
                        weight: 100,
                    }],
                    fallback_enabled: false,
                    budget_cents_per_run: None,
                });
            }
        }

        let run = engine
            .start_run(project_id, "Idea for concurrent test")
            .await
            .unwrap();

        // Advance Idea -> GateA and approve GateA so the walk enters Research.
        let at_gate = engine.advance_stage(run.id).await.unwrap();
        assert_eq!(at_gate.current_stage, Stage::GateA);
        engine
            .approve_gate(run.id, Stage::GateA, DeviceId::new())
            .await
            .unwrap();

        // Spawn two concurrent advance_to_next_gate tasks on the same run.
        let e1 = engine.advance_to_next_gate(run.id);
        let e2 = engine.advance_to_next_gate(run.id);

        let (res1, res2) = tokio::join!(e1, e2);
        let r1 = res1.expect("caller 1 succeeds");
        let r2 = res2.expect("caller 2 succeeds");

        assert_eq!(r1.current_stage, Stage::GateB);
        assert_eq!(r2.current_stage, Stage::GateB);

        // Research + PrdSpec: exactly 2 stage provider calls were made, never 4.
        assert_eq!(
            call_count.load(Ordering::SeqCst),
            2,
            "concurrent advances must serialize and execute each stage exactly once"
        );

        let loaded = store.get_run(run.id).await.unwrap();
        assert_eq!(loaded.current_stage, Stage::GateB);
        assert_eq!(loaded.gate_states[&Stage::GateB], GateState::Pending);
    }

    #[tokio::test]
    async fn cancel_during_stage_aborts_worker_and_leaves_no_artifact() {
        let (store, engine, project_id, router) = test_fixture().await;

        let in_flight = Arc::new(Notify::new());
        let unblock = Arc::new(Notify::new());
        let provider = TestTrackingProvider::with_notifications(
            "blocking-provider",
            in_flight.clone(),
            unblock.clone(),
        );

        {
            let mut r = router.write().await;
            r.register_provider(Box::new(provider));
            r.set_role_routing(RoleRouting {
                role: Role::Researcher,
                targets: vec![RoutingTarget {
                    provider_id: "blocking-provider".to_string(),
                    model_id: "test-model".to_string(),
                    weight: 100,
                }],
                fallback_enabled: false,
                budget_cents_per_run: None,
            });
        }

        let run = engine
            .start_run(project_id, "Idea for cancellation test")
            .await
            .unwrap();
        engine.advance_stage(run.id).await.unwrap(); // -> GateA
        engine
            .approve_gate(run.id, Stage::GateA, DeviceId::new())
            .await
            .unwrap();

        // Launch advance into Research in background task.
        let run_id = run.id;
        let advance_handle = tokio::spawn({
            let engine_ref = engine.clone_engine();
            async move { engine_ref.advance_stage(run_id).await }
        });

        // Wait until worker enters the provider call.
        in_flight.notified().await;

        // Issue real cancellation while the provider is mid-flight.
        let cancelled = engine
            .cancel_run(run_id, Some("user cancelled mid-flight".to_string()))
            .await
            .expect("cancel_run succeeds");
        assert_eq!(cancelled.status, RunStatus::Cancelled);

        // Unblock provider so it finishes if not aborted.
        unblock.notify_waiters();

        // The background advance worker observes cancellation and terminates with error.
        let worker_res = advance_handle.await.unwrap();
        assert!(
            worker_res.is_err(),
            "in-flight worker must abort on cancellation"
        );

        // Stored run status must remain Cancelled.
        let reloaded = store.get_run(run_id).await.unwrap();
        assert_eq!(reloaded.status, RunStatus::Cancelled);

        // Crucial invariant: no research artifact was written to the run.
        assert!(
            !reloaded.artifacts.contains_key("research"),
            "a cancelled stage must not leave an artifact"
        );

        // Check event log has run_cancelled event.
        let events = store.get_events(run_id).await.unwrap();
        assert!(events
            .iter()
            .any(|e| e.kind == EventKind::Error && e.payload["action"] == "run_cancelled"));
    }

    #[tokio::test]
    async fn stale_stage_write_cannot_overwrite_cancelled_status() {
        let (store, engine, project_id, _router) = test_fixture().await;

        let run = engine
            .start_run(project_id, "Stale CAS test")
            .await
            .unwrap();
        let (mut stale_run, old_version) = store.get_run_versioned(run.id).await.unwrap();

        // Cancel the run in store, bumping the version.
        let cancelled = engine.cancel_run(run.id, None).await.unwrap();
        assert_eq!(cancelled.status, RunStatus::Cancelled);

        // Stale worker attempts to write Research stage with stale version.
        stale_run.current_stage = Stage::Research;
        stale_run.status = RunStatus::Running;
        let cas_res = store.update_run_cas(&stale_run, old_version).await;
        assert!(
            cas_res.is_err(),
            "stale write must be rejected by version CAS"
        );

        // Verify stored status is still Cancelled.
        let reloaded = store.get_run(run.id).await.unwrap();
        assert_eq!(reloaded.status, RunStatus::Cancelled);
    }

    #[tokio::test]
    async fn change_request_reopens_gate_and_reruns_stage_with_feedback() {
        let (store, engine, project_id, router) = test_fixture().await;

        let tracking = TestTrackingProvider::new("feedback-provider");
        let last_prompt = tracking.last_prompt.clone();

        {
            let mut r = router.write().await;
            r.register_provider(Box::new(tracking));
            for role in [Role::Intake, Role::Researcher, Role::PM] {
                r.set_role_routing(RoleRouting {
                    role,
                    targets: vec![RoutingTarget {
                        provider_id: "feedback-provider".to_string(),
                        model_id: "test-model".to_string(),
                        weight: 100,
                    }],
                    fallback_enabled: false,
                    budget_cents_per_run: None,
                });
            }
        }

        let run = engine
            .start_run(project_id, "Idea to revise")
            .await
            .unwrap();
        let at_gate = engine.advance_stage(run.id).await.unwrap();
        assert_eq!(at_gate.current_stage, Stage::GateA);

        // Request changes at Gate A with specific instructions.
        let feedback_notes = "Please refine scope to offline Arabic clinic notes";
        let changed = engine
            .request_changes(
                run.id,
                Stage::GateA,
                feedback_notes.to_string(),
                DeviceId::new(),
            )
            .await
            .unwrap();

        assert_eq!(changed.status, RunStatus::Paused);
        assert!(matches!(
            changed.gate_states[&Stage::GateA],
            GateState::ChangesRequested { .. }
        ));

        // Calling advance_stage while paused must fail.
        assert!(engine.advance_stage(run.id).await.is_err());

        // Resume the run: must re-open Gate A to Pending, re-run producing stage with notes.
        let resumed = engine.resume_run(run.id).await.unwrap();
        assert_eq!(resumed.status, RunStatus::Running);
        assert_eq!(resumed.current_stage, Stage::GateA);
        assert_eq!(resumed.gate_states[&Stage::GateA], GateState::Pending);

        // Check that the provider's prompt contained the feedback notes!
        let prompt_text = last_prompt.lock().await.clone();
        assert!(
            prompt_text.contains(feedback_notes),
            "re-run prompt must contain the change request feedback notes: {prompt_text}"
        );

        // Gate A can now be approved normally.
        let device = DeviceId::new();
        let approved = engine
            .approve_gate(run.id, Stage::GateA, device)
            .await
            .unwrap();
        assert!(matches!(
            approved.gate_states[&Stage::GateA],
            GateState::Approved { .. }
        ));

        // Advance to next stage succeeds.
        let next_stage = engine.advance_stage(run.id).await.unwrap();
        assert_eq!(next_stage.current_stage, Stage::Research);

        let reloaded = store.get_run(run.id).await.unwrap();
        assert_eq!(reloaded.current_stage, Stage::Research);
    }

    #[tokio::test]
    async fn budget_exceeded_pauses_and_resumes_after_budget_increase() {
        let (_store, engine, project_id, router) = test_fixture().await;

        let tracking = TestTrackingProvider::new("budget-provider");
        {
            let mut r = router.write().await;
            r.register_provider(Box::new(tracking));
            r.set_role_routing(RoleRouting {
                role: Role::Researcher,
                targets: vec![RoutingTarget {
                    provider_id: "budget-provider".to_string(),
                    model_id: "test-model".to_string(),
                    weight: 100,
                }],
                fallback_enabled: false,
                budget_cents_per_run: None,
            });
        }

        let mut run = engine.start_run(project_id, "Budget test").await.unwrap();
        // Set tight budget of 10 cents; provider charges 25 cents per call.
        run = engine.set_run_budget(run.id, 10).await.unwrap();
        assert_eq!(run.budget_cents, Some(10));

        engine.advance_stage(run.id).await.unwrap(); // -> GateA
        engine
            .approve_gate(run.id, Stage::GateA, DeviceId::new())
            .await
            .unwrap();

        // Advance into Research: provider charges 25 cents, exceeding 10 cents -> Paused.
        let advanced = engine.advance_stage(run.id).await.unwrap();
        assert_eq!(advanced.current_stage, Stage::Research);
        assert_eq!(advanced.status, RunStatus::Paused);

        // Resuming while budget is still 10 cents is refused.
        let resume_err = engine
            .resume_run(run.id)
            .await
            .expect_err("budget still exceeded");
        assert!(resume_err.to_string().contains("Budget exceeded"));

        // Increase budget to 500 cents.
        engine.set_run_budget(run.id, 500).await.unwrap();

        // Resume now succeeds and advances to GateB.
        let resumed = engine.resume_run(run.id).await.unwrap();
        assert_eq!(resumed.status, RunStatus::Running);
        assert_eq!(resumed.current_stage, Stage::GateB);
    }

    #[tokio::test]
    async fn interrupted_run_marked_paused_and_resumable() {
        let (store, engine, project_id, _router) = test_fixture().await;

        let run = engine
            .start_run(project_id, "Interrupted test")
            .await
            .unwrap();
        engine.advance_stage(run.id).await.unwrap(); // -> GateA
        engine
            .approve_gate(run.id, Stage::GateA, DeviceId::new())
            .await
            .unwrap();

        // Simulate a daemon crash by leaving a run in Running state at Research in store.
        let (mut crashed_run, version) = store.get_run_versioned(run.id).await.unwrap();
        crashed_run.current_stage = Stage::Research;
        crashed_run.status = RunStatus::Running;
        store.update_run_cas(&crashed_run, version).await.unwrap();

        // Daemon restart recovery runs.
        let recovered = engine.recover_interrupted_runs().await.unwrap();
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].id, run.id);
        assert_eq!(recovered[0].status, RunStatus::Paused);

        let reloaded = store.get_run(run.id).await.unwrap();
        assert_eq!(reloaded.status, RunStatus::Paused);

        // Verify { action: run_interrupted } event exists.
        let events = store.get_events(run.id).await.unwrap();
        assert!(events
            .iter()
            .any(|e| e.payload["action"] == "run_interrupted"));

        // The interrupted run is resumable via resume_run.
        let resumed = engine.resume_run(run.id).await.unwrap();
        assert_eq!(resumed.status, RunStatus::Running);
        assert_eq!(resumed.current_stage, Stage::GateB);
    }

    #[tokio::test]
    async fn two_different_runs_can_advance_concurrently() {
        let (_store, engine, project_id, _router) = test_fixture().await;

        let run1 = engine.start_run(project_id, "Run 1").await.unwrap();
        let run2 = engine.start_run(project_id, "Run 2").await.unwrap();

        let (r1, r2) = tokio::join!(engine.advance_stage(run1.id), engine.advance_stage(run2.id));

        assert_eq!(r1.unwrap().current_stage, Stage::GateA);
        assert_eq!(r2.unwrap().current_stage, Stage::GateA);
    }
}
