//! The deterministic fake provider.
//!
//! `FakeProvider` is the zero-network answer Warsha uses to run a whole pipeline
//! end-to-end: it never opens a socket, never reads a key, and never varies
//! between runs. It inspects the incoming [`ChatRequest`], works out which stage
//! role is asking (the role prompt templates all carry a `role:`/`stage:` marker
//! line), and answers with a structured artifact tailored to that stage. A
//! deterministic hash and slug of the *full* prompt ride along, so every stage's
//! artifact is distinct and non-empty even when two ideas are near-identical,
//! while the same request always produces byte-identical output.

use crate::{
    ChatMessage, ChatProvider, ChatRequest, ChatResponse, ChatStreamChunk, HealthCheck,
    MessageRole, ModelInfo, ModelPricing, Result, StreamChoice,
};
use async_trait::async_trait;
use warsha_core::{ProviderKind, TokenUsage};

/// The provider id every [`crate::ProviderRouter`] pre-registers this provider
/// under, so `"fake"` is always available for a deterministic end-to-end run.
pub const FAKE_PROVIDER_ID: &str = "fake";

/// The single model id the fake answers with.
pub const FAKE_MODEL_ID: &str = "warsha-fake-v1";

/// A 64-bit FNV-1a hash of `text`, as 16 lowercase hex digits.
///
/// Deterministic and dependency-free: the same prompt hashes to the same digest on
/// every run and every machine, which is what makes the fake artifacts stable.
fn prompt_hash(text: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in text.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// A short, deterministic excerpt of the prompt usable as a slug: the last
/// non-empty line, lowercased, trimmed to 40 characters with anything that is not
/// alphanumeric collapsed to `-`.
fn prompt_slug(text: &str) -> String {
    let source = text
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("empty prompt");
    let mut slug = String::new();
    for ch in source.to_lowercase().chars() {
        if slug.len() >= 40 {
            break;
        }
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "prompt".to_string()
    } else {
        slug
    }
}

/// The stage key a prompt is asking for, found from the role prompt templates'
/// `role:` marker line; anything unrecognised answers as a follow-up.
fn stage_key_for_prompt(text: &str) -> &'static str {
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(role) = trimmed.strip_prefix("role:") {
            return match role.trim() {
                "researcher" => "research",
                "pm" => "prd_spec",
                "designer" => "design",
                "architect" => "plan_tasks",
                "coder" => "code",
                "reviewer" | "qa" | "security" => "review_qa_security",
                "release" => "release_prep",
                "marketer" => "launch_drafts",
                "feedback" => "feedback",
                "intake" => "intake",
                _ => "followup",
            };
        }
    }
    "followup"
}

/// The stage-tailored, structured body. Deterministic in `hash` and `slug` only.
fn artifact_for(stage: &str, hash: &str, slug: &str) -> String {
    let title = match stage {
        "research" => "Fake Research Report",
        "prd_spec" => "Fake PRD & Spec",
        "design" => "Fake Design Spec",
        "plan_tasks" => "Fake Task Plan",
        "code" => "Fake Implementation",
        "review_qa_security" => "Fake Review, QA & Security Report",
        "release_prep" => "Fake Release Preparation",
        "launch_drafts" => "Fake Launch Drafts",
        "feedback" => "Fake Feedback Summary",
        "intake" => "Fake Intake Summary",
        _ => "Fake Follow-up Answer",
    };
    match stage {
        "research" => format!(
            "# {title}\n\n\
             - id: fake-research-{hash}\n\
             - excerpt: {slug}\n\n\
             ## Findings\n\
             - Existing solutions: a stock component covers the core flow.\n\
             - Recommended stack: the platform the brief already names.\n\
             - Key risks: none blocking; each has a documented mitigation.\n\n\
             ## Effort\n\
             - Per component: 1 deterministic unit.\n"
        ),
        "prd_spec" => format!(
            "# {title}\n\n\
             - id: fake-prd-{hash}\n\
             - excerpt: {slug}\n\n\
             ## User stories\n\
             - As the owner I can start a run and get a gated plan.\n\
             - As a reviewer I can approve or reject at each gate.\n\n\
             ## Functional requirements\n\
             - F1: every stage writes exactly one artifact (must).\n\
             - F2: gates block advancement until decided (must).\n\n\
             ## Non-functional requirements\n\
             - N1: deterministic offline runs via the fake provider.\n\n\
             ## Milestones\n\
             - M1: pipeline walk to Feedback.\n"
        ),
        "design" => format!(
            "# {title}\n\n\
             - id: fake-design-{hash}\n\
             - excerpt: {slug}\n\n\
             ## Screens\n\
             - Home: lists runs and their current stage.\n\
             - Run detail: stages, gates, artifacts, events.\n\n\
             ## Components\n\
             - StageBadge, GateDecision, ArtifactView.\n\n\
             ## RTL & accessibility\n\
             - Logical properties throughout; Arabic catalog complete.\n"
        ),
        "plan_tasks" => format!(
            "# {title}\n\n\
             - id: fake-plan-{hash}\n\
             - excerpt: {slug}\n\n\
             ## Tasks\n\
             1. Scaffold the project and workspace.\n\
             2. Implement the domain model and store.\n\
             3. Wire the stage engine and gates.\n\
             4. Add the provider layer and router.\n\n\
             ## Definition of done\n\
             - Every task is test-covered and the walk is green.\n"
        ),
        "code" => format!(
            "# {title}\n\n\
             - id: fake-code-{hash}\n\
             - excerpt: {slug}\n\n\
             --- FILE: src/main.rs ---\n\
             //! Deterministic fake implementation for plan task 1.\n\n\
             fn main() {{\n\
             \x20   println!(\"fake pipeline artifact {hash}\");\n\
             }}\n\n\
             --- FILE: src/lib.rs ---\n\
             /// The greeting the plan named, as a testable function.\n\
             pub fn artifact_id() -> &'static str {{\n\
             \x20   \"{hash}\"\n\
             }}\n"
        ),
        "review_qa_security" => format!(
            "# {title}\n\n\
             - id: fake-review-{hash}\n\
             - excerpt: {slug}\n\n\
             ## Review\n\
             - No blocking findings; the diff matches the plan.\n\n\
             ## QA\n\
             --- FILE: tests/acceptance.rs ---\n\
             #[test]\n\
             fn the_walk_is_deterministic() {{\n\
             \x20   assert!(!\"{hash}\".is_empty());\n\
             }}\n\n\
             ## Security\n\
             - No secrets in artifacts; provider keys stay in the keychain.\n"
        ),
        "release_prep" => format!(
            "# {title}\n\n\
             - id: fake-release-{hash}\n\
             - excerpt: {slug}\n\n\
             ## Checklist\n\
             - Version bumped and changelog written.\n\
             - Migrations reversible; rollback rehearsed.\n\n\
             ## Artifacts\n\
             - Signed draft release notes for gate D.\n"
        ),
        "launch_drafts" => format!(
            "# {title}\n\n\
             - id: fake-launch-{hash}\n\
             - excerpt: {slug}\n\n\
             ## Store copy\n\
             - One-line pitch, long description, keywords.\n\n\
             ## Announcements\n\
             - Launch post draft in English and Arabic.\n"
        ),
        "feedback" => format!(
            "# {title}\n\n\
             - id: fake-feedback-{hash}\n\
             - excerpt: {slug}\n\n\
             ## Signals\n\
             - Rating sampled, crash reports empty, change requests queued.\n\n\
             ## Actions\n\
             - Feed the next run's intake brief.\n"
        ),
        "intake" => format!(
            "# {title}\n\n\
             - id: fake-intake-{hash}\n\
             - excerpt: {slug}\n\n\
             ## Summary\n\
             - The request is understood; clarifying questions are answered.\n\n\
             ## Brief\n\
             - Goal, audience and constraints recorded for gate A.\n"
        ),
        _ => format!(
            "# {title}\n\n\
             - id: fake-followup-{hash}\n\
             - excerpt: {slug}\n\n\
             ## Answer\n\
             - A deterministic reply to the follow-up prompt, with no network call.\n\n\
             ## Next step\n\
             - Ask another follow-up or advance the run.\n"
        ),
    }
}

/// Deterministic, zero-network provider for end-to-end runs.
///
/// Registered as `"fake"` on every [`crate::ProviderRouter`], so a pipeline run is
/// always executable without any configured provider.
#[derive(Debug, Default, Clone, Copy)]
pub struct FakeProvider;

impl FakeProvider {
    /// A new fake provider. Cheap and stateless.
    pub fn new() -> Self {
        Self
    }

    /// The full text of a request's messages — everything the fake can see.
    fn prompt_text(request: &ChatRequest) -> String {
        request
            .messages
            .iter()
            .map(|message| message.content.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// The deterministic response for `request`, as an assistant [`ChatResponse`].
    fn respond(request: &ChatRequest) -> ChatResponse {
        let prompt = Self::prompt_text(request);
        let hash = prompt_hash(&prompt);
        let slug = prompt_slug(&prompt);
        let stage = stage_key_for_prompt(&prompt);
        let content = artifact_for(stage, &hash, &slug);
        let input = (prompt.chars().count() / 4) as u64;
        let output = (content.chars().count() / 4) as u64;
        ChatResponse {
            id: format!("fake-{hash}"),
            model: FAKE_MODEL_ID.to_string(),
            choices: vec![crate::ChatChoice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content,
                },
                finish_reason: Some("stop".to_string()),
            }],
            usage: TokenUsage {
                input,
                output,
                total: input + output,
            },
        }
    }
}

#[async_trait]
impl ChatProvider for FakeProvider {
    fn id(&self) -> &str {
        FAKE_PROVIDER_ID
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::CustomOpenAICompatible
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        Ok(vec![ModelInfo {
            id: FAKE_MODEL_ID.to_string(),
            name: "Warsha Fake v1".to_string(),
            provider: FAKE_PROVIDER_ID.to_string(),
            context_window: 128_000,
            max_output: 4_096,
            pricing: ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
        }])
    }

    async fn health(&self) -> Result<HealthCheck> {
        Ok(HealthCheck {
            healthy: true,
            latency_ms: Some(0),
            error: None,
        })
    }

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse> {
        Ok(Self::respond(&request))
    }

    async fn chat_stream(
        &self,
        request: ChatRequest,
    ) -> Result<Box<dyn futures::Stream<Item = Result<ChatStreamChunk>> + Send + Unpin>> {
        let response = Self::respond(&request);
        let choices = response
            .choices
            .into_iter()
            .map(|choice| StreamChoice {
                index: choice.index,
                delta: crate::ChatMessageDelta {
                    role: Some(choice.message.role),
                    content: Some(choice.message.content),
                },
                finish_reason: choice.finish_reason,
            })
            .collect();
        let stream = futures::stream::iter(vec![Ok(ChatStreamChunk {
            id: response.id,
            model: response.model,
            choices,
        })]);
        Ok(Box::new(stream))
    }

    fn cost_of(&self, _model: &str, _usage: &TokenUsage) -> Result<u64> {
        // One cent per stage call, whatever the tokens: the fake is free but its
        // spend is still visible to the budget machinery.
        Ok(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MockProvider, ProviderRouter};
    use warsha_core::{Role, RoleRouting, RoutingTarget};

    fn stage_request(role: &str, idea: &str) -> ChatRequest {
        ChatRequest {
            model: "default".to_string(),
            messages: vec![ChatMessage {
                role: MessageRole::System,
                content: format!("---\nrole: {role}\nstage: x\n---\n\n# Agent\n\nIdea: {idea}\n"),
            }],
            temperature: None,
            max_tokens: None,
            stream: false,
        }
    }

    fn general_request(prompt: &str) -> ChatRequest {
        ChatRequest {
            model: "default".to_string(),
            messages: vec![ChatMessage {
                role: MessageRole::User,
                content: prompt.to_string(),
            }],
            temperature: None,
            max_tokens: None,
            stream: false,
        }
    }

    async fn content(provider: &FakeProvider, request: ChatRequest) -> String {
        let response = provider.chat(request).await.expect("fake never fails");
        response
            .choices
            .first()
            .expect("one choice")
            .message
            .content
            .clone()
    }

    #[tokio::test]
    async fn the_same_prompt_answers_identically_twice() {
        let provider = FakeProvider::new();
        let first = content(&provider, stage_request("researcher", "a todo app")).await;
        let second = content(&provider, stage_request("researcher", "a todo app")).await;
        assert_eq!(first, second, "the fake is deterministic");
    }

    #[tokio::test]
    async fn every_stage_prompt_gets_a_distinct_non_empty_artifact() {
        let provider = FakeProvider::new();
        let stages = [
            ("researcher", "research"),
            ("pm", "prd"),
            ("designer", "design"),
            ("architect", "plan"),
            ("coder", "code"),
            ("reviewer", "review"),
            ("release", "ship it"),
        ];
        let mut artifacts = Vec::new();
        let mut titles = Vec::new();
        for (role, _idea) in stages {
            let artifact =
                content(&provider, stage_request(role, "Build a clinic booking app")).await;
            assert!(!artifact.trim().is_empty(), "artifact for {role} is empty");
            assert!(
                artifact.starts_with("# Fake "),
                "artifact for {role} is not structured: {artifact}"
            );
            titles.push(artifact.lines().next().unwrap_or("").to_string());
            artifacts.push(artifact);
        }
        for pair in artifacts.windows(2) {
            assert_ne!(pair[0], pair[1], "two stage artifacts came out identical");
        }
        // Each stage answers with its own heading, not just its own hash.
        assert!(
            titles.iter().any(|t| t.contains("Research")),
            "no research title in {titles:?}"
        );
        assert!(
            titles.iter().any(|t| t.contains("Task Plan")),
            "no plan title in {titles:?}"
        );
    }

    #[tokio::test]
    async fn a_followup_prompt_answers_as_general_and_is_stable() {
        let provider = FakeProvider::new();
        let first = content(&provider, general_request("Add dark mode to the app")).await;
        let second = content(&provider, general_request("Add dark mode to the app")).await;
        assert_eq!(first, second);
        assert!(first.starts_with("# Fake Follow-up Answer"), "{first}");
        // The slug carries an excerpt of the prompt itself.
        assert!(first.contains("add-dark-mode"), "{first}");
    }

    #[tokio::test]
    async fn different_prompts_produce_different_artifacts_for_one_stage() {
        let provider = FakeProvider::new();
        let a = content(&provider, stage_request("coder", "idea alpha")).await;
        let b = content(&provider, stage_request("coder", "idea beta")).await;
        assert_ne!(a, b, "the prompt excerpt must distinguish artifacts");
    }

    #[tokio::test]
    async fn models_health_and_cost_are_the_documented_constants() {
        let provider = FakeProvider::new();
        let models = provider.list_models().await.expect("models list");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, FAKE_MODEL_ID);
        assert_eq!(models[0].provider, FAKE_PROVIDER_ID);

        let health = provider.health().await.expect("health");
        assert!(health.healthy);
        assert_eq!(health.latency_ms, Some(0));
        assert_eq!(health.error, None);

        let usage = warsha_core::TokenUsage {
            input: 999_999,
            output: 999_999,
            total: 1_999_998,
        };
        assert_eq!(provider.cost_of(FAKE_MODEL_ID, &usage).unwrap(), 1);
    }

    #[tokio::test]
    async fn fake_answers_through_a_router_with_no_routing_configured() {
        // `"fake"` is pre-registered on every router, so a run can reach it even
        // though no role routing exists.
        let router = ProviderRouter::new();
        let fake = router
            .get_provider(FAKE_PROVIDER_ID)
            .expect("the fake provider is pre-registered");
        let response = fake
            .chat(general_request("what changed since the last gate?"))
            .await
            .expect("the fake answers");
        assert_eq!(response.model, FAKE_MODEL_ID);

        // And a routed mock still wins on its own role: pre-registration does not
        // hijack explicit routing.
        let mut router = ProviderRouter::new();
        router.register_provider(Box::new(MockProvider::new("mock")));
        router.set_role_routing(RoleRouting {
            role: Role::Coder,
            targets: vec![RoutingTarget {
                provider_id: "mock".to_string(),
                model_id: "mock-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
        let response = router
            .chat_with_fallback(
                Role::Coder,
                "project-1",
                general_request("write the module"),
            )
            .await
            .expect("the routed mock answers");
        assert_eq!(response.choices[0].message.content, "Mock response");
    }

    #[tokio::test]
    async fn streaming_is_the_same_deterministic_answer_in_one_chunk() {
        let provider = FakeProvider::new();
        use futures::StreamExt;
        let mut stream = provider
            .chat_stream(stage_request("pm", "clinic app"))
            .await
            .expect("the fake streams");
        let chunk = stream.next().await.expect("one chunk").expect("ok");
        assert_eq!(
            chunk.choices[0].delta.content.as_deref().unwrap(),
            artifact_for(
                "prd_spec",
                &prompt_hash(&FakeProvider::prompt_text(&stage_request(
                    "pm",
                    "clinic app"
                ))),
                &prompt_slug(&FakeProvider::prompt_text(&stage_request(
                    "pm",
                    "clinic app"
                ))),
            )
        );
    }
}
