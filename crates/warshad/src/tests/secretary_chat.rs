use crate::auth::policy_of;
use crate::secretary_chat::{
    owner_asked_for_proposal, ProposalAction, SecretaryChat, SecretaryChatError,
};
use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;
use warsha_core::{
    ModelPricing, ProjectId, ProviderKind, ProviderQuota, Role, RoleRouting, RoutingTarget,
    TokenUsage,
};
use warsha_pipeline::mcp_approval::McpApprovals;
use warsha_providers::{
    ChatChoice, ChatMessage, ChatProvider, ChatRequest, ChatResponse, ChatStreamChunk, HealthCheck,
    MessageRole, ModelInfo, ProviderError, ProviderRouter,
};
use warsha_store::Store;

/// A mock ChatProvider that returns canned responses from a queue.
struct TestProvider {
    id: String,
    responses: Mutex<Vec<ChatResponse>>,
}

impl TestProvider {
    fn new(id: &str, responses: Vec<ChatResponse>) -> Self {
        Self {
            id: id.to_string(),
            responses: Mutex::new(responses),
        }
    }
}

#[async_trait]
impl ChatProvider for TestProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::CustomOpenAICompatible
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, ProviderError> {
        Ok(vec![ModelInfo {
            id: "test-model".to_string(),
            name: "Test Model".to_string(),
            provider: self.id.clone(),
            context_window: 16_000,
            max_output: 4_096,
            pricing: ModelPricing {
                input_per_million_cents: 100,
                output_per_million_cents: 200,
            },
        }])
    }

    async fn health(&self) -> Result<HealthCheck, ProviderError> {
        Ok(HealthCheck {
            healthy: true,
            latency_ms: Some(1),
            error: None,
        })
    }

    async fn chat(&self, _request: ChatRequest) -> Result<ChatResponse, ProviderError> {
        let mut lock = self.responses.lock().await;
        if lock.is_empty() {
            Ok(ChatResponse {
                id: "default-resp".to_string(),
                model: "test-model".to_string(),
                choices: vec![ChatChoice {
                    index: 0,
                    message: ChatMessage {
                        role: MessageRole::Assistant,
                        content: "Default response".to_string(),
                    },
                    finish_reason: Some("stop".to_string()),
                }],
                usage: TokenUsage {
                    input: 10,
                    output: 10,
                    total: 20,
                    cost_cents: Some(1),
                },
            })
        } else {
            Ok(lock.remove(0))
        }
    }

    async fn chat_stream(
        &self,
        _request: ChatRequest,
    ) -> Result<
        Box<dyn futures::Stream<Item = Result<ChatStreamChunk, ProviderError>> + Send + Unpin>,
        ProviderError,
    > {
        Err(ProviderError::Other("not implemented for test".to_string()))
    }

    fn cost_of(&self, _model: &str, _usage: &TokenUsage) -> Result<u64, ProviderError> {
        Ok(1)
    }

    async fn get_quota(&self) -> Result<ProviderQuota, ProviderError> {
        Ok(ProviderQuota::Unknown)
    }
}

fn make_chat_response(content: &str, cost_cents: u64) -> ChatResponse {
    ChatResponse {
        id: "resp-id".to_string(),
        model: "test-model".to_string(),
        choices: vec![ChatChoice {
            index: 0,
            message: ChatMessage {
                role: MessageRole::Assistant,
                content: content.to_string(),
            },
            finish_reason: Some("stop".to_string()),
        }],
        usage: TokenUsage {
            input: 50,
            output: 50,
            total: 100,
            cost_cents: Some(cost_cents),
        },
    }
}

async fn setup_test_chat(
    responses: Vec<ChatResponse>,
) -> (Arc<Store>, SecretaryChat, tempfile::TempDir) {
    let temp = crate::test_util::fresh_tempdir();
    let store = Arc::new(Store::open_at(temp.path().join("warsha.db")).await.unwrap());

    let mut router = ProviderRouter::new();
    let test_prov = TestProvider::new("test-provider", responses);
    router.register_provider(Box::new(test_prov));
    router.set_role_routing(RoleRouting {
        role: Role::Secretary,
        targets: vec![RoutingTarget {
            provider_id: "test-provider".to_string(),
            model_id: "test-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });
    let providers = Arc::new(RwLock::new(router));
    let mcp_approvals = Arc::new(McpApprovals::new(None));

    let chat = SecretaryChat::new(store.clone(), providers, mcp_approvals);
    (store, chat, temp)
}

#[test]
fn test_proposal_action_serde_wire_roundtrip() {
    let run_uuid = Uuid::new_v4();
    let proj_uuid = Uuid::new_v4();

    // 1. GateApprove
    let approve = ProposalAction::GateApprove {
        run_id: run_uuid.to_string(),
        stage: "gate_b".to_string(),
    };
    let json_approve = serde_json::to_string(&approve).unwrap();
    assert!(json_approve.contains("\"gate_approve\":{"));
    let de_approve: ProposalAction = serde_json::from_str(&json_approve).unwrap();
    assert_eq!(approve, de_approve);

    // 2. GateReject
    let reject = ProposalAction::GateReject {
        run_id: run_uuid.to_string(),
        stage: "gate_b".to_string(),
        reason: "Insufficient coverage".to_string(),
    };
    let json_reject = serde_json::to_string(&reject).unwrap();
    assert!(json_reject.contains("\"gate_reject\":{"));
    let de_reject: ProposalAction = serde_json::from_str(&json_reject).unwrap();
    assert_eq!(reject, de_reject);

    // 3. QueueDecide
    let queue = ProposalAction::QueueDecide {
        question_id: "q-123".to_string(),
        allow: true,
    };
    let json_queue = serde_json::to_string(&queue).unwrap();
    assert!(json_queue.contains("\"queue_decide\":{"));
    let de_queue: ProposalAction = serde_json::from_str(&json_queue).unwrap();
    assert_eq!(queue, de_queue);

    // 4. RunStart
    let start = ProposalAction::RunStart {
        project_id: proj_uuid,
        idea: "Implement OAuth".to_string(),
    };
    let json_start = serde_json::to_string(&start).unwrap();
    assert!(json_start.contains("\"run_start\":{"));
    let de_start: ProposalAction = serde_json::from_str(&json_start).unwrap();
    assert_eq!(start, de_start);

    // 5. RunCancel
    let cancel = ProposalAction::RunCancel {
        run_id: run_uuid.to_string(),
    };
    let json_cancel = serde_json::to_string(&cancel).unwrap();
    assert!(json_cancel.contains("\"run_cancel\":{"));
    let de_cancel: ProposalAction = serde_json::from_str(&json_cancel).unwrap();
    assert_eq!(cancel, de_cancel);
}

#[test]
fn test_owner_asked_for_proposal_en_and_ar() {
    let run_id = "run-12345";

    // GateApprove
    let approve_action = ProposalAction::GateApprove {
        run_id: run_id.to_string(),
        stage: "gate_b".to_string(),
    };
    assert!(owner_asked_for_proposal(
        &approve_action,
        "Please approve gate B for run-12345"
    ));
    assert!(owner_asked_for_proposal(
        &approve_action,
        "وافق على بوابة ب لتشغيل run-12345"
    ));
    assert!(owner_asked_for_proposal(&approve_action, "اعتمد gate_b"));
    // Refuse when wrong stage or no approve intent
    assert!(!owner_asked_for_proposal(&approve_action, "approve gate A"));
    assert!(!owner_asked_for_proposal(
        &approve_action,
        "what is the status of gate B?"
    ));

    // GateReject
    let reject_action = ProposalAction::GateReject {
        run_id: run_id.to_string(),
        stage: "gate_b".to_string(),
        reason: "bad".to_string(),
    };
    assert!(owner_asked_for_proposal(
        &reject_action,
        "reject gate B for run-12345"
    ));
    assert!(owner_asked_for_proposal(&reject_action, "ارفض بوابة ب"));
    assert!(!owner_asked_for_proposal(&reject_action, "approve gate B"));

    // QueueDecide
    let allow_action = ProposalAction::QueueDecide {
        question_id: "q-abc".to_string(),
        allow: true,
    };
    assert!(owner_asked_for_proposal(
        &allow_action,
        "allow tool call q-abc"
    ));
    assert!(owner_asked_for_proposal(
        &allow_action,
        "اسمح بالسؤال q-abc"
    ));
    assert!(!owner_asked_for_proposal(&allow_action, "deny q-abc"));

    let deny_action = ProposalAction::QueueDecide {
        question_id: "q-abc".to_string(),
        allow: false,
    };
    assert!(owner_asked_for_proposal(
        &deny_action,
        "deny question q-abc"
    ));
    assert!(owner_asked_for_proposal(&deny_action, "ارفض طلب q-abc"));
    assert!(!owner_asked_for_proposal(&deny_action, "allow q-abc"));

    // RunStart
    let start_action = ProposalAction::RunStart {
        project_id: Uuid::nil(),
        idea: "test".to_string(),
    };
    assert!(owner_asked_for_proposal(
        &start_action,
        "start a new run with idea"
    ));
    assert!(owner_asked_for_proposal(&start_action, "ابدأ تشغيل"));
    assert!(owner_asked_for_proposal(&start_action, "شغل مهمة جديدة"));

    // RunCancel
    let cancel_action = ProposalAction::RunCancel {
        run_id: run_id.to_string(),
    };
    assert!(owner_asked_for_proposal(&cancel_action, "cancel run-12345"));
    assert!(owner_asked_for_proposal(&cancel_action, "stop run-12345"));
    assert!(owner_asked_for_proposal(&cancel_action, "أوقف run-12345"));
    assert!(!owner_asked_for_proposal(
        &cancel_action,
        "run-12345 looks good"
    ));
}

#[tokio::test]
async fn test_secretary_chat_daily_cap_reached() {
    let (store, chat, _temp) = setup_test_chat(vec![]).await;
    let pid = Uuid::new_v4();

    // Set daily cap to 5 cents
    let cap = 5;

    // Spend 6 cents
    store
        .record_role_cost(
            ProjectId(pid),
            Role::Secretary,
            "test-provider",
            "test-model",
            100,
            100,
            6,
            chrono::Utc::now(),
        )
        .await
        .unwrap();

    let result = chat.turn(Some(pid), None, "hello", cap).await;
    assert!(matches!(
        result,
        Err(SecretaryChatError::DailyLimitReached { .. })
    ));
}

#[tokio::test]
async fn test_secretary_chat_global_thread_cap_and_cost_recording() {
    let resp = make_chat_response("Global response", 12);
    let (store, chat, _temp) = setup_test_chat(vec![resp]).await;

    // Global thread has project_id = None
    let cap = 50;

    let reply = chat
        .turn(None, None, "Global chat message", cap)
        .await
        .unwrap();
    assert_eq!(reply.reply, "Global response");

    // Verify cost was recorded under ProjectId(Uuid::nil())
    let spend = store
        .today_role_cost_cents(ProjectId(Uuid::nil()), Role::Secretary)
        .await
        .unwrap();
    assert_eq!(spend, 12);
}

#[tokio::test]
async fn test_proposal_refusal_on_prompt_injection_or_untrusted_data() {
    let pid = Uuid::new_v4();
    let temp = crate::test_util::fresh_tempdir();
    let store = Arc::new(Store::open_at(temp.path().join("warsha.db")).await.unwrap());

    let conv = store
        .create_secretary_conversation(Some(pid))
        .await
        .unwrap();
    let owner_turn = store
        .add_secretary_turn(
            conv.id,
            "owner",
            "What is the status of the run?",
            None,
            None,
        )
        .await
        .unwrap();

    let resp = make_chat_response(
        &format!(
            "Here is the status.\n```json\n{{\n  \"references_owner_turn\": \"{}\",\n  \"action\": {{\"gate_approve\": {{\"run_id\": \"run-123\", \"stage\": \"gate_b\"}}}}\n}}\n```",
            owner_turn.id
        ),
        2,
    );

    let mut router = ProviderRouter::new();
    let test_prov = TestProvider::new("test-provider", vec![resp]);
    router.register_provider(Box::new(test_prov));
    router.set_role_routing(RoleRouting {
        role: Role::Secretary,
        targets: vec![RoutingTarget {
            provider_id: "test-provider".to_string(),
            model_id: "test-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });
    let providers = Arc::new(RwLock::new(router));
    let mcp_approvals = Arc::new(McpApprovals::new(None));
    let chat = SecretaryChat::new(store.clone(), providers, mcp_approvals);

    // Owner only asks for status, did NOT ask for approval!
    let res = chat
        .turn(
            Some(pid),
            Some(conv.id),
            "What is the status of the run?",
            100,
        )
        .await
        .unwrap();

    // Proposal must be refused because owner message does not request gate approval
    assert!(res.proposal.is_none());
}

#[tokio::test]
async fn test_proposal_refusal_when_unknown_or_empty_ids() {
    let resp1 = make_chat_response(
        "Approving now.\n```json\n{\n  \"references_owner_turn\": \"01ARZ3NDEKTSV4RRFFQ69G5FAV\",\n  \"action\": {\"gate_approve\": {\"run_id\": \"unknown\", \"stage\": \"gate_b\"}}\n}\n```",
        2,
    );
    let resp2 = make_chat_response(
        "Allowing question.\n```json\n{\n  \"references_owner_turn\": \"01ARZ3NDEKTSV4RRFFQ69G5FAV\",\n  \"action\": {\"queue_decide\": {\"question_id\": \"  \", \"allow\": true}}\n}\n```",
        2,
    );
    let (_store, chat, _temp) = setup_test_chat(vec![resp1, resp2]).await;
    let pid = Uuid::new_v4();

    let res = chat
        .turn(Some(pid), None, "Please approve gate_b", 100)
        .await
        .unwrap();
    assert!(res.proposal.is_none());

    let res2 = chat
        .turn(Some(pid), None, "Please allow question", 100)
        .await
        .unwrap();
    assert!(res2.proposal.is_none());
}

#[tokio::test]
async fn test_proposal_accepted_when_owner_requests_action() {
    let temp = crate::test_util::fresh_tempdir();
    let store = Arc::new(Store::open_at(temp.path().join("warsha.db")).await.unwrap());
    let pid = Uuid::new_v4();

    // Start a thread and find owner's turn ID
    let conv = store
        .create_secretary_conversation(Some(pid))
        .await
        .unwrap();

    let owner_turn = store
        .add_secretary_turn(
            conv.id,
            "owner",
            "وافق على gate_b لتشغيل run-999",
            None,
            None,
        )
        .await
        .unwrap();

    let owner_turn_id_str = owner_turn.id.to_string();

    let resp = make_chat_response(
        &format!(
            "حاضر، سأقوم بإنشاء طلب الموافقة.\n```json\n{{\n  \"references_owner_turn\": \"{}\",\n  \"action\": {{\"gate_approve\": {{\"run_id\": \"run-999\", \"stage\": \"gate_b\"}}}}\n}}\n```",
            owner_turn_id_str
        ),
        3,
    );

    let mut router = ProviderRouter::new();
    let test_prov = TestProvider::new("test-provider", vec![resp]);
    router.register_provider(Box::new(test_prov));
    router.set_role_routing(RoleRouting {
        role: Role::Secretary,
        targets: vec![RoutingTarget {
            provider_id: "test-provider".to_string(),
            model_id: "test-model".to_string(),
            weight: 100,
        }],
        fallback_enabled: false,
        budget_cents_per_run: None,
    });
    let providers = Arc::new(RwLock::new(router));
    let mcp_approvals = Arc::new(McpApprovals::new(None));
    let chat = SecretaryChat::new(store.clone(), providers, mcp_approvals);

    let reply = chat
        .turn(
            Some(pid),
            Some(conv.id),
            "وافق على gate_b لتشغيل run-999",
            100,
        )
        .await
        .unwrap();

    assert!(reply.proposal.is_some());
    if let Some(card) = reply.proposal {
        assert_eq!(
            card.action,
            ProposalAction::GateApprove {
                run_id: "run-999".to_string(),
                stage: "gate_b".to_string(),
            }
        );
    }
}

#[tokio::test]
async fn test_summarization_triggered_when_over_40_turns() {
    let resp_summary = make_chat_response(
        "Summary of past 42 messages: The user discussed various tasks.",
        5,
    );
    let resp_turn = make_chat_response("Response to turn 43", 2);

    let (store, chat, _temp) = setup_test_chat(vec![resp_summary, resp_turn]).await;
    let pid = Uuid::new_v4();

    let conv = store
        .create_secretary_conversation(Some(pid))
        .await
        .unwrap();

    // Prepopulate 42 turns
    for i in 0..42 {
        let role = if i % 2 == 0 { "owner" } else { "secretary" };
        store
            .add_secretary_turn(conv.id, role, &format!("Turn message {}", i), None, None)
            .await
            .unwrap();
    }

    let reply = chat
        .turn(Some(pid), Some(conv.id), "New message 43", 100)
        .await
        .unwrap();
    assert_eq!(reply.reply, "Response to turn 43");

    // Check that summary was written to store
    let latest_summary = store.get_secretary_summary(conv.id).await.unwrap();
    assert!(latest_summary.is_some());
    let summary = latest_summary.unwrap();
    assert!(summary.summary.contains("Summary of past 42 messages"));
    assert!(!summary.covers_until.is_empty());

    // Verify costs recorded for summary + turn (5 + 2 = 7 cents)
    let total_cost = store
        .today_role_cost_cents(ProjectId(pid), Role::Secretary)
        .await
        .unwrap();
    assert_eq!(total_cost, 7);
}

#[tokio::test]
async fn test_read_only_snapshot_content() {
    let (_store, chat, _temp) = setup_test_chat(vec![]).await;
    let pid = Uuid::new_v4();

    let snapshot = chat.read_only_snapshot(Some(pid), 100).await.unwrap();
    assert_eq!(snapshot["daily_cap_cents"], 100);
    assert_eq!(snapshot["today_spend_cents"], 0);
    assert_eq!(snapshot["active_runs"], serde_json::json!([]));
    assert_eq!(snapshot["pending_gates"], serde_json::json!([]));
    assert_eq!(snapshot["pending_ask_queue"], serde_json::json!([]));
}

#[test]
fn test_rpc_auth_policies_for_secretary_methods() {
    // Verify policy_of for secretary RPCs
    let list_policy = policy_of("secretary.thread.list").expect("secretary.thread.list exists");
    assert!(matches!(list_policy.policy, crate::auth::Policy::Session));
    assert!(matches!(list_policy.tier, crate::auth::Tier::Standard));

    let turns_policy = policy_of("secretary.thread.turns").expect("secretary.thread.turns exists");
    assert!(matches!(turns_policy.policy, crate::auth::Policy::Session));
    assert!(matches!(turns_policy.tier, crate::auth::Tier::Standard));

    let chat_policy = policy_of("secretary.chat").expect("secretary.chat exists");
    assert!(matches!(chat_policy.policy, crate::auth::Policy::Owner));
    assert!(matches!(chat_policy.tier, crate::auth::Tier::Spend));
}
