//! Secretary interview engine (R-NEXT D1).
//!
//! Conducts a bounded, schema-checked requirements interview that turns an owner's
//! rough idea into a validated Brief + Direction Card before Gate A runs.
//!
//! Design invariants (plan §D1):
//! - The 7 interview topics (`ALL_TOPICS`) and the 6 Brief slots (`BriefSlots`)
//!   are fixed in code — never model-chosen.
//! - The questioning strategy lives in a bundled in-house skill
//!   (`BUNDLED_QUESTIONING_SKILL`), overridable by an enabled installed skill
//!   with id `secretary-interview` (C2 seam). Works with marketplaces disabled.
//! - Daily spend cap is checked BEFORE any model call by summing today's
//!   `Role::Secretary` rows in `costs` for the project; at/over cap the engine
//!   returns `TurnOutcome::DailyLimitReached` with the exact owner-facing phrase
//!   `"daily limit reached"` and makes ZERO model calls.
//! - Every Secretary model call records a `costs` row carrying `Role::Secretary`
//!   so A3 usage analytics can split Secretary spend from pipeline runs.
//! - State is persisted to `secretary_interviews` on every turn so killing and
//!   restarting the daemon resumes cleanly at the next uncovered topic.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;
use warsha_core::{ProjectId, Role, RunId};
use warsha_pipeline::{DiscoveryAnswer, ProjectBrief};
use warsha_providers::{ChatMessage, ChatRequest, MessageRole, ProviderError, ProviderRouter};
use warsha_store::Store;

use crate::settings::SettingsStore;

/// Default daily spend cap for the Secretary role, in cents.
/// Matches the smallest existing per-run default cap (`solo-bench`: 100 cents).
pub const DEFAULT_SECRETARY_DAILY_CAP_CENTS: u64 = 100;

/// Exact owner-facing message returned when the Secretary daily spend cap is reached.
pub const DAILY_LIMIT_REACHED_MESSAGE: &str = "daily limit reached";

/// Skill identifier used when an installed skill replaces the bundled questioning strategy (C2).
pub const SECRETARY_QUESTIONING_SKILL_ID: &str = "secretary-interview";

/// Bundled in-house questioning strategy (never copied from AGPL sources).
pub const BUNDLED_QUESTIONING_SKILL: &str = include_str!("secretary_skill.md");

/// The interview strategy appended under the fixed system prompt. An installed
/// skill may replace this note; it cannot replace the fixed prompt.
pub fn interview_strategy_note() -> &'static str {
    BUNDLED_QUESTIONING_SKILL
}

/// Errors produced by the Secretary interview engine.
#[derive(Debug, Error)]
pub enum SecretaryError {
    #[error("store error: {0}")]
    Store(#[from] warsha_store::StoreError),
    #[error("provider error: {0}")]
    Provider(#[from] ProviderError),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("brief validation failed: {0}")]
    InvalidBrief(String),
}

/// The fixed set of interview topics, in deterministic coverage order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Topic {
    Audience,
    Problem,
    StatusQuoAlternative,
    DirectionAndScope,
    Constraints,
    SuccessCriteria,
    NonGoals,
}

/// Fixed topic coverage list — enforced in code, never model-chosen.
pub const ALL_TOPICS: &[Topic] = &[
    Topic::Audience,
    Topic::Problem,
    Topic::StatusQuoAlternative,
    Topic::DirectionAndScope,
    Topic::Constraints,
    Topic::SuccessCriteria,
    Topic::NonGoals,
];

impl Topic {
    /// Stable snake_case identifier for wire and storage keys.
    pub const fn as_str(self) -> &'static str {
        match self {
            Topic::Audience => "audience",
            Topic::Problem => "problem",
            Topic::StatusQuoAlternative => "status_quo_alternative",
            Topic::DirectionAndScope => "direction_and_scope",
            Topic::Constraints => "constraints",
            Topic::SuccessCriteria => "success_criteria",
            Topic::NonGoals => "non_goals",
        }
    }

    /// Deterministic fallback single question when the model does not supply one.
    pub fn default_question(self, language: &str) -> &'static str {
        if language == "ar" {
            match self {
                Topic::Audience => "من هم المستخدمون المستهدفون لهذا المشروع؟",
                Topic::Problem => "ما المشكلة الأساسية التي يحلها هذا المشروع؟",
                Topic::StatusQuoAlternative => {
                    "كيف يتعامل المستخدمون مع هذه المشكلة اليوم، وما أوجه القصور في البديل الحالي؟"
                }
                Topic::DirectionAndScope => "ما أهم الميزات المطلوبة في الإصدار الأول وحدود نطاقه؟",
                Topic::Constraints => {
                    "هل توجد قيود تقنية أو منصات محددة أو متطلبات ميزانية ووقت يجب الالتزام بها؟"
                }
                Topic::SuccessCriteria => "كيف سنقيس نجاح الإصدار الأول بعد إطلاقه؟",
                Topic::NonGoals => "ما الأشياء التي يجب استبعادها صراحةً من هذا الإصدار؟",
            }
        } else {
            match self {
                Topic::Audience => "Who are the target users for this project?",
                Topic::Problem => "What core problem does this project solve?",
                Topic::StatusQuoAlternative => {
                    "How do target users handle this today, and where does the current alternative fall short?"
                }
                Topic::DirectionAndScope => {
                    "What are the must-have features and scope for the first version?"
                }
                Topic::Constraints => {
                    "What technical, platform, timeline, or budget constraints should we respect?"
                }
                Topic::SuccessCriteria => {
                    "How will you measure whether the first version succeeded?"
                }
                Topic::NonGoals => "What is explicitly out of scope (non-goals) for this version?",
            }
        }
    }

    /// System-chosen default recorded on the Direction Card when the owner finishes early.
    pub fn system_default(self, language: &str) -> &'static str {
        if language == "ar" {
            match self {
                Topic::Audience => "المستخدمون العامون للمنتج (اختيار تلقائي)",
                Topic::Problem => "حل المشكلة المذكورة في فكرة المشروع الأساسية (اختيار تلقائي)",
                Topic::StatusQuoAlternative => {
                    "سير عمل يدوي أو أدوات متفرقة غير مخصصة (اختيار تلقائي)"
                }
                Topic::DirectionAndScope => {
                    "إصدار أولي مركّز يغطي سير العمل الأساسي فقط (اختيار تلقائي)"
                }
                Topic::Constraints => "معمارية قياسية خفيفة دون قيود منصة خاصة (اختيار تلقائي)",
                Topic::SuccessCriteria => {
                    "إتمام سير العمل الأساسي بنجاح من البداية للنهاية (اختيار تلقائي)"
                }
                Topic::NonGoals => {
                    "استبعاد التكاملات المتقدمة والميزات الثانوية في الإصدار الأول (اختيار تلقائي)"
                }
            }
        } else {
            match self {
                Topic::Audience => "General target users of the product (system default)",
                Topic::Problem => {
                    "Address the core problem described in the project seed (system default)"
                }
                Topic::StatusQuoAlternative => {
                    "Manual workflows or ad-hoc general tools (system default)"
                }
                Topic::DirectionAndScope => {
                    "Focused first release covering the primary workflow (system default)"
                }
                Topic::Constraints => {
                    "Standard lightweight stack with no special compliance constraints (system default)"
                }
                Topic::SuccessCriteria => {
                    "Users complete the core workflow reliably end-to-end (system default)"
                }
                Topic::NonGoals => {
                    "Advanced integrations and secondary features deferred beyond v1 (system default)"
                }
            }
        }
    }
}

/// Fixed Brief schema matching `intake.md` and plan §D1.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BriefSlots {
    pub problem_statement: String,
    pub target_users: String,
    pub key_features: Vec<String>,
    pub technical_constraints: String,
    pub success_criteria: Vec<String>,
    pub language: String,
}

impl BriefSlots {
    /// Validate that every required slot is populated and language is `ar` or `en`.
    pub fn validate(&self) -> Result<(), String> {
        if self.problem_statement.trim().is_empty() {
            return Err("problem_statement must not be empty".to_string());
        }
        if self.target_users.trim().is_empty() {
            return Err("target_users must not be empty".to_string());
        }
        if self.key_features.is_empty() || self.key_features.iter().all(|f| f.trim().is_empty()) {
            return Err("key_features must contain at least one item".to_string());
        }
        if self.technical_constraints.trim().is_empty() {
            return Err("technical_constraints must not be empty".to_string());
        }
        if self.success_criteria.is_empty()
            || self.success_criteria.iter().all(|c| c.trim().is_empty())
        {
            return Err("success_criteria must contain at least one item".to_string());
        }
        if !matches!(self.language.as_str(), "ar" | "en") {
            return Err(format!(
                "language must be 'ar' or 'en', got '{}'",
                self.language
            ));
        }
        Ok(())
    }

    /// Project the validated Brief + Direction Card into the pipeline's `ProjectBrief`
    /// structure so Gate A consumes it without any schema changes.
    pub fn to_project_brief(
        &self,
        project_id: ProjectId,
        run_id: RunId,
        direction_card: &DirectionCard,
    ) -> ProjectBrief {
        let mut brief = ProjectBrief::new(project_id, run_id);
        let now = Utc::now().to_rfc3339();
        let pairs: Vec<(&str, serde_json::Value)> = vec![
            (
                "problem_statement",
                serde_json::Value::String(self.problem_statement.clone()),
            ),
            (
                "target_users",
                serde_json::Value::String(self.target_users.clone()),
            ),
            (
                "key_features",
                serde_json::Value::Array(
                    self.key_features
                        .iter()
                        .cloned()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            ),
            (
                "technical_constraints",
                serde_json::Value::String(self.technical_constraints.clone()),
            ),
            (
                "success_criteria",
                serde_json::Value::Array(
                    self.success_criteria
                        .iter()
                        .cloned()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            ),
            ("language", serde_json::Value::String(self.language.clone())),
        ];
        for (key, value) in pairs {
            brief.set_answer(DiscoveryAnswer {
                question_id: key.to_string(),
                value,
                answered_at: now.clone(),
            });
        }
        for entry in &direction_card.topics {
            brief.set_answer(DiscoveryAnswer {
                question_id: format!("topic.{}", entry.topic.as_str()),
                value: serde_json::json!({
                    "status": entry.status,
                    "value": entry.value,
                }),
                answered_at: now.clone(),
            });
        }
        brief
    }

    /// Format the Brief + Direction Card into an idea string suitable for `runs.start`
    /// so it enters Gate A identically to today's direct-idea path.
    pub fn to_idea_text(&self, direction_card: &DirectionCard) -> String {
        let features = self
            .key_features
            .iter()
            .map(|f| format!("- {f}"))
            .collect::<Vec<_>>()
            .join("\n");
        let criteria = self
            .success_criteria
            .iter()
            .map(|c| format!("- {c}"))
            .collect::<Vec<_>>()
            .join("\n");
        let topic_lines = direction_card
            .topics
            .iter()
            .map(|t| {
                let tag = match t.status {
                    TopicStatus::Covered => "covered",
                    TopicStatus::SystemChosen => "system_chosen",
                };
                format!("- {} [{}]: {}", t.topic.as_str(), tag, t.value)
            })
            .collect::<Vec<_>>()
            .join("\n");
        format!(
            "Problem: {}\nTarget Users: {}\nKey Features:\n{}\nTechnical Constraints: {}\nSuccess Criteria:\n{}\nLanguage: {}\nDirection Card:\n{}",
            self.problem_statement,
            self.target_users,
            features,
            self.technical_constraints,
            criteria,
            self.language,
            topic_lines,
        )
    }
}

/// Whether a topic on the Direction Card came from the owner or a system default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TopicStatus {
    Covered,
    SystemChosen,
}

/// One topic entry on the finalized Direction Card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirectionTopicEntry {
    pub topic: Topic,
    pub status: TopicStatus,
    pub value: String,
}

/// Summary artifact produced alongside the Brief: records every topic's answer
/// and visibly marks open topics filled with system-chosen defaults.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirectionCard {
    pub project_id: ProjectId,
    pub language: String,
    pub topics: Vec<DirectionTopicEntry>,
    pub open_topics_count: usize,
}

/// One question/answer exchange stored in the interview transcript.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TranscriptEntry {
    pub question: String,
    pub answer: String,
    pub topic: Option<Topic>,
    pub at: DateTime<Utc>,
}

/// Self-contained persistent state of a project's Secretary interview.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterviewState {
    pub project_id: ProjectId,
    pub seed_idea: Option<String>,
    pub brief: BriefSlots,
    pub topic_answers: HashMap<Topic, String>,
    pub covered_topics: Vec<Topic>,
    pub open_topics: Vec<Topic>,
    pub current_topic: Option<Topic>,
    pub next_question: Option<String>,
    pub transcript: Vec<TranscriptEntry>,
    pub is_done: bool,
    pub direction_card: Option<DirectionCard>,
    pub updated_at: DateTime<Utc>,
}

impl InterviewState {
    /// Initialise a fresh interview state with all fixed topics open.
    pub fn new(project_id: ProjectId, seed_idea: Option<String>) -> Self {
        let language = seed_idea
            .as_deref()
            .map(detect_language)
            .unwrap_or_else(|| "en".to_string());
        let first_topic = ALL_TOPICS[0];
        let first_question = first_topic.default_question(&language).to_string();
        Self {
            project_id,
            seed_idea,
            brief: BriefSlots {
                language,
                ..BriefSlots::default()
            },
            topic_answers: HashMap::new(),
            covered_topics: Vec::new(),
            open_topics: ALL_TOPICS.to_vec(),
            current_topic: Some(first_topic),
            next_question: Some(first_question),
            transcript: Vec::new(),
            is_done: false,
            direction_card: None,
            updated_at: Utc::now(),
        }
    }

    fn mark_covered(&mut self, topic: Topic, summary: String) {
        let trimmed = summary.trim();
        if !trimmed.is_empty() {
            self.topic_answers.insert(topic, trimmed.to_string());
        }
        if !self.covered_topics.contains(&topic) {
            self.covered_topics.push(topic);
        }
        self.open_topics.retain(|t| *t != topic);
    }
}

/// Result of one `interview.start` or `interview.turn` step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TurnOutcome {
    NextQuestion {
        question: String,
        topic: Topic,
        state: InterviewState,
    },
    Done {
        brief: BriefSlots,
        direction_card: DirectionCard,
        idea_text: String,
        state: InterviewState,
    },
    DailyLimitReached {
        message: String,
        spent_cents: u64,
        cap_cents: u64,
        state: InterviewState,
    },
}

#[derive(Debug, Default, Deserialize)]
struct PartialBriefUpdates {
    #[serde(default)]
    problem_statement: Option<String>,
    #[serde(default)]
    target_users: Option<String>,
    #[serde(default)]
    key_features: Option<Vec<String>>,
    #[serde(default)]
    technical_constraints: Option<String>,
    #[serde(default)]
    success_criteria: Option<Vec<String>>,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct ModelTurnOutput {
    #[serde(default)]
    updates: PartialBriefUpdates,
    #[serde(default)]
    covered_topics: Vec<Topic>,
    #[serde(default)]
    topic_answers: HashMap<Topic, String>,
    #[serde(default)]
    next_question: Option<String>,
}

/// Secretary interview engine backed by the daemon's store, provider router,
/// and optional settings store (for installed skill overrides).
pub struct SecretaryEngine {
    store: Arc<Store>,
    providers: Arc<RwLock<ProviderRouter>>,
    settings: Option<Arc<SettingsStore>>,
}

impl SecretaryEngine {
    pub fn new(
        store: Arc<Store>,
        providers: Arc<RwLock<ProviderRouter>>,
        settings: Option<Arc<SettingsStore>>,
    ) -> Self {
        Self {
            store,
            providers,
            settings,
        }
    }

    /// The questioning strategy note. An enabled installed `secretary-interview`
    /// skill may refine the note (C2 seam). It never replaces the system prompt
    /// served to the model: that is [`crate::secretary_chat::FIXED_SECRETARY_SYSTEM_PROMPT`].
    pub async fn questioning_skill(&self) -> String {
        if let Some(settings) = &self.settings {
            if let Ok(Some(skill)) = settings.get_skill(SECRETARY_QUESTIONING_SKILL_ID).await {
                if skill.enabled && !skill.content.trim().is_empty() {
                    return skill.content;
                }
            }
        }
        BUNDLED_QUESTIONING_SKILL.to_string()
    }

    /// Load the persisted interview state for a project, if one exists.
    pub async fn status(
        &self,
        project_id: ProjectId,
    ) -> Result<Option<InterviewState>, SecretaryError> {
        let Some(raw) = self.store.load_secretary_interview(project_id).await? else {
            return Ok(None);
        };
        let state: InterviewState = serde_json::from_str(&raw)?;
        Ok(Some(state))
    }

    /// Start a new interview for `project_id`, or resume the existing one if
    /// already persisted. Optional `seed_idea` seeds initial slot extraction.
    pub async fn start(
        &self,
        project_id: ProjectId,
        seed_idea: Option<String>,
        daily_cap_cents: u64,
    ) -> Result<TurnOutcome, SecretaryError> {
        if let Some(existing) = self.status(project_id).await? {
            if existing.is_done {
                let card = existing
                    .direction_card
                    .clone()
                    .unwrap_or_else(|| build_direction_card(&existing));
                let idea_text = existing.brief.to_idea_text(&card);
                return Ok(TurnOutcome::Done {
                    brief: existing.brief.clone(),
                    direction_card: card,
                    idea_text,
                    state: existing,
                });
            }
            let topic = existing
                .current_topic
                .or_else(|| existing.open_topics.first().copied())
                .unwrap_or(ALL_TOPICS[0]);
            let question = existing
                .next_question
                .clone()
                .unwrap_or_else(|| topic.default_question(&existing.brief.language).to_string());
            return Ok(TurnOutcome::NextQuestion {
                question,
                topic,
                state: existing,
            });
        }

        let clean_seed = seed_idea.and_then(|s| {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });

        let mut state = InterviewState::new(project_id, clean_seed.clone());

        if let Some(seed) = clean_seed {
            // Check daily spend cap BEFORE any model call.
            let spent_today = self
                .store
                .today_role_cost_cents(project_id, Role::Secretary)
                .await?;
            if spent_today >= daily_cap_cents {
                self.persist(&state).await?;
                return Ok(TurnOutcome::DailyLimitReached {
                    message: DAILY_LIMIT_REACHED_MESSAGE.to_string(),
                    spent_cents: spent_today,
                    cap_cents: daily_cap_cents,
                    state,
                });
            }

            let response_text = self.call_secretary_model(&state, Some(&seed), true).await?;
            if let Some(parsed) = parse_model_output(&response_text) {
                apply_model_output(&mut state, parsed);
            } else {
                // Deterministic fallback for mock or non-JSON responses: seed fills Problem.
                if state.brief.problem_statement.trim().is_empty() {
                    state.brief.problem_statement = seed.clone();
                }
                state.mark_covered(Topic::Problem, seed);
            }

            if state.open_topics.is_empty() {
                return self.finalize_and_persist(state).await;
            }

            let next_topic = state.open_topics[0];
            let next_q = state
                .next_question
                .take()
                .filter(|q| !q.trim().is_empty())
                .unwrap_or_else(|| {
                    next_topic
                        .default_question(&state.brief.language)
                        .to_string()
                });
            state.current_topic = Some(next_topic);
            state.next_question = Some(next_q.clone());
            state.updated_at = Utc::now();
            self.persist(&state).await?;
            return Ok(TurnOutcome::NextQuestion {
                question: next_q,
                topic: next_topic,
                state,
            });
        }

        // No seed idea: persist initial state and emit the first fixed-topic question.
        let topic = state.open_topics[0];
        let question = topic.default_question(&state.brief.language).to_string();
        state.current_topic = Some(topic);
        state.next_question = Some(question.clone());
        state.updated_at = Utc::now();
        self.persist(&state).await?;
        Ok(TurnOutcome::NextQuestion {
            question,
            topic,
            state,
        })
    }

    /// Process one owner reply in the interview for `project_id`.
    pub async fn turn(
        &self,
        project_id: ProjectId,
        owner_reply: String,
        daily_cap_cents: u64,
    ) -> Result<TurnOutcome, SecretaryError> {
        let mut state = match self.status(project_id).await? {
            Some(existing) => existing,
            None => InterviewState::new(project_id, None),
        };

        if state.is_done {
            let card = state
                .direction_card
                .clone()
                .unwrap_or_else(|| build_direction_card(&state));
            let idea_text = state.brief.to_idea_text(&card);
            return Ok(TurnOutcome::Done {
                brief: state.brief.clone(),
                direction_card: card,
                idea_text,
                state,
            });
        }

        let reply_trimmed = owner_reply.trim().to_string();
        if contains_arabic(&reply_trimmed) {
            state.brief.language = "ar".to_string();
        }

        let active_topic = state
            .current_topic
            .or_else(|| state.open_topics.first().copied());
        let asked_question = state
            .next_question
            .clone()
            .or_else(|| active_topic.map(|t| t.default_question(&state.brief.language).to_string()))
            .unwrap_or_default();

        state.transcript.push(TranscriptEntry {
            question: asked_question,
            answer: reply_trimmed.clone(),
            topic: active_topic,
            at: Utc::now(),
        });

        // Owner says "enough" / "يكفي" → finalize immediately with open topics marked.
        if is_stop_signal(&reply_trimmed) {
            return self.finalize_and_persist(state).await;
        }

        // Check daily spend cap BEFORE calling the model.
        let spent_today = self
            .store
            .today_role_cost_cents(project_id, Role::Secretary)
            .await?;
        if spent_today >= daily_cap_cents {
            // Do not advance the topic or invoke the model; return cap outcome.
            return Ok(TurnOutcome::DailyLimitReached {
                message: DAILY_LIMIT_REACHED_MESSAGE.to_string(),
                spent_cents: spent_today,
                cap_cents: daily_cap_cents,
                state,
            });
        }

        let response_text = self
            .call_secretary_model(&state, Some(&reply_trimmed), false)
            .await?;

        // Reset pending next_question before applying model output so stale questions
        // are not reused.
        state.next_question = None;

        if let Some(parsed) = parse_model_output(&response_text) {
            let had_covered = !parsed.covered_topics.is_empty();
            apply_model_output(&mut state, parsed);
            // If the model returned JSON updates without listing the active topic in
            // covered_topics, still mark the active topic covered from the owner's reply
            // so the interview always makes bounded forward progress.
            if !had_covered {
                if let Some(topic) = active_topic {
                    if !reply_trimmed.is_empty() {
                        apply_reply_to_topic(&mut state, topic, &reply_trimmed);
                    }
                }
            }
        } else if let Some(topic) = active_topic {
            // Deterministic slot mapping for non-JSON responses (e.g. MockProvider).
            if !reply_trimmed.is_empty() {
                apply_reply_to_topic(&mut state, topic, &reply_trimmed);
            }
        }

        if state.open_topics.is_empty() {
            return self.finalize_and_persist(state).await;
        }

        let next_topic = state.open_topics[0];
        let next_q = state
            .next_question
            .take()
            .filter(|q| !q.trim().is_empty())
            .unwrap_or_else(|| {
                next_topic
                    .default_question(&state.brief.language)
                    .to_string()
            });
        state.current_topic = Some(next_topic);
        state.next_question = Some(next_q.clone());
        state.updated_at = Utc::now();
        self.persist(&state).await?;

        Ok(TurnOutcome::NextQuestion {
            question: next_q,
            topic: next_topic,
            state,
        })
    }

    async fn call_secretary_model(
        &self,
        state: &InterviewState,
        latest_input: Option<&str>,
        is_seed: bool,
    ) -> Result<String, SecretaryError> {
        let strategy = self.questioning_skill().await;
        let system_prompt = crate::secretary_chat::secretary_model_system_prompt_with(&strategy);
        let user_prompt = build_turn_prompt(state, latest_input, is_seed);

        let request = ChatRequest {
            model: String::new(), // Filled by ProviderRouter::chat_with_fallback
            messages: vec![
                ChatMessage {
                    role: MessageRole::System,
                    content: system_prompt,
                },
                ChatMessage {
                    role: MessageRole::User,
                    content: user_prompt,
                },
            ],
            temperature: Some(0.2),
            max_tokens: Some(1024),
            stream: false,
        };

        // Snapshot router outside any long await lock.
        let router = self.providers.read().await.clone();
        let project_key = state.project_id.0.to_string();
        let response = router
            .chat_with_fallback(Role::Secretary, &project_key, request)
            .await?;

        let provider_id = router
            .routing_targets_for(Role::Secretary)
            .and_then(|targets| {
                targets
                    .iter()
                    .find(|t| t.model_id == response.model)
                    .or_else(|| targets.first())
                    .map(|t| t.provider_id.clone())
            })
            .unwrap_or_else(|| "unknown".to_string());

        let cost_cents = response
            .usage
            .cost_cents
            .or_else(|| router.cost_of(&response.model, &response.usage).ok())
            .unwrap_or(0);

        self.store
            .record_role_cost(
                state.project_id,
                Role::Secretary,
                &provider_id,
                &response.model,
                response.usage.input,
                response.usage.output,
                cost_cents,
                Utc::now(),
            )
            .await?;

        let content = response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .unwrap_or_default();

        Ok(content)
    }

    async fn finalize_and_persist(
        &self,
        mut state: InterviewState,
    ) -> Result<TurnOutcome, SecretaryError> {
        finalize_state(&mut state)?;
        let direction_card = state
            .direction_card
            .clone()
            .unwrap_or_else(|| build_direction_card(&state));
        let idea_text = state.brief.to_idea_text(&direction_card);
        // The roster is presented with the completed brief. There is no later
        // accept handler, so this is the production write of one provisioning
        // row per rostered agent. A proposal stays proposed and starts no work.
        let assessment = crate::staffing::assess_brief(state.project_id.0, &idea_text);
        let proposal = crate::staffing::propose_staffing(&assessment);
        crate::staffing::persist_proposal(&self.store, &proposal).await?;
        self.persist(&state).await?;
        Ok(TurnOutcome::Done {
            brief: state.brief.clone(),
            direction_card,
            idea_text,
            state,
        })
    }

    async fn persist(&self, state: &InterviewState) -> Result<(), SecretaryError> {
        let json = serde_json::to_string(state)?;
        self.store
            .save_secretary_interview(state.project_id, &json)
            .await?;
        Ok(())
    }
}

/// Fill any missing Brief slots from covered topic answers or system defaults,
/// build the Direction Card with open topics visibly marked, validate the Brief,
/// and mark `state.is_done = true`.
pub fn finalize_state(state: &mut InterviewState) -> Result<(), SecretaryError> {
    if !matches!(state.brief.language.as_str(), "ar" | "en") {
        state.brief.language = "en".to_string();
    }
    let lang = state.brief.language.clone();

    if state.brief.target_users.trim().is_empty() {
        state.brief.target_users = state
            .topic_answers
            .get(&Topic::Audience)
            .cloned()
            .unwrap_or_else(|| Topic::Audience.system_default(&lang).to_string());
    }
    if state.brief.problem_statement.trim().is_empty() {
        state.brief.problem_statement = state
            .topic_answers
            .get(&Topic::Problem)
            .cloned()
            .or_else(|| state.seed_idea.clone())
            .unwrap_or_else(|| Topic::Problem.system_default(&lang).to_string());
    }
    if state.brief.key_features.is_empty()
        || state.brief.key_features.iter().all(|f| f.trim().is_empty())
    {
        let fallback = state
            .topic_answers
            .get(&Topic::DirectionAndScope)
            .cloned()
            .unwrap_or_else(|| Topic::DirectionAndScope.system_default(&lang).to_string());
        state.brief.key_features = split_list_items(&fallback);
    }
    if state.brief.technical_constraints.trim().is_empty() {
        state.brief.technical_constraints = state
            .topic_answers
            .get(&Topic::Constraints)
            .cloned()
            .unwrap_or_else(|| Topic::Constraints.system_default(&lang).to_string());
    }
    if state.brief.success_criteria.is_empty()
        || state
            .brief
            .success_criteria
            .iter()
            .all(|c| c.trim().is_empty())
    {
        let fallback = state
            .topic_answers
            .get(&Topic::SuccessCriteria)
            .cloned()
            .unwrap_or_else(|| Topic::SuccessCriteria.system_default(&lang).to_string());
        state.brief.success_criteria = split_list_items(&fallback);
    }

    state
        .brief
        .validate()
        .map_err(SecretaryError::InvalidBrief)?;

    let card = build_direction_card(state);
    state.direction_card = Some(card);
    state.current_topic = None;
    state.next_question = None;
    state.is_done = true;
    state.updated_at = Utc::now();
    Ok(())
}

fn build_direction_card(state: &InterviewState) -> DirectionCard {
    let lang = if matches!(state.brief.language.as_str(), "ar" | "en") {
        state.brief.language.clone()
    } else {
        "en".to_string()
    };
    let mut topics = Vec::with_capacity(ALL_TOPICS.len());
    let mut open_count = 0usize;
    for &topic in ALL_TOPICS {
        if state.covered_topics.contains(&topic) {
            let value = state
                .topic_answers
                .get(&topic)
                .cloned()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| topic.system_default(&lang).to_string());
            topics.push(DirectionTopicEntry {
                topic,
                status: TopicStatus::Covered,
                value,
            });
        } else {
            open_count += 1;
            topics.push(DirectionTopicEntry {
                topic,
                status: TopicStatus::SystemChosen,
                value: topic.system_default(&lang).to_string(),
            });
        }
    }
    DirectionCard {
        project_id: state.project_id,
        language: lang,
        topics,
        open_topics_count: open_count,
    }
}

fn build_turn_prompt(state: &InterviewState, latest_input: Option<&str>, is_seed: bool) -> String {
    let covered: Vec<&str> = state.covered_topics.iter().map(|t| t.as_str()).collect();
    let open: Vec<&str> = state.open_topics.iter().map(|t| t.as_str()).collect();
    let current_brief = serde_json::to_string(&state.brief).unwrap_or_else(|_| "{}".to_string());
    let input_label = if is_seed {
        "Seed idea"
    } else {
        "Latest owner reply"
    };
    let input_body = latest_input.unwrap_or("");
    let active = state.current_topic.map(|t| t.as_str()).unwrap_or("none");
    format!(
        "Current language: {}\nCurrent brief JSON: {}\nCovered topics: {:?}\nOpen topics (fixed order): {:?}\nActive topic: {}\n{}: {}\nReturn strict JSON with keys updates, covered_topics, topic_answers, next_question.",
        state.brief.language, current_brief, covered, open, active, input_label, input_body
    )
}

fn parse_model_output(raw: &str) -> Option<ModelTurnOutput> {
    let trimmed = raw.trim();
    if let Ok(parsed) = serde_json::from_str::<ModelTurnOutput>(trimmed) {
        return Some(parsed);
    }
    // Also accept a fenced ```json ... ``` block from chatty models.
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            if end > start {
                if let Ok(parsed) = serde_json::from_str::<ModelTurnOutput>(&trimmed[start..=end]) {
                    return Some(parsed);
                }
            }
        }
    }
    None
}

fn apply_model_output(state: &mut InterviewState, output: ModelTurnOutput) {
    if let Some(ps) = output.updates.problem_statement {
        if !ps.trim().is_empty() {
            state.brief.problem_statement = ps.trim().to_string();
        }
    }
    if let Some(tu) = output.updates.target_users {
        if !tu.trim().is_empty() {
            state.brief.target_users = tu.trim().to_string();
        }
    }
    if let Some(kf) = output.updates.key_features {
        let cleaned: Vec<String> = kf
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !cleaned.is_empty() {
            state.brief.key_features = cleaned;
        }
    }
    if let Some(tc) = output.updates.technical_constraints {
        if !tc.trim().is_empty() {
            state.brief.technical_constraints = tc.trim().to_string();
        }
    }
    if let Some(sc) = output.updates.success_criteria {
        let cleaned: Vec<String> = sc
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !cleaned.is_empty() {
            state.brief.success_criteria = cleaned;
        }
    }
    if let Some(lang) = output.updates.language {
        if matches!(lang.as_str(), "ar" | "en") {
            state.brief.language = lang;
        }
    }

    for (topic, answer) in output.topic_answers {
        if !answer.trim().is_empty() {
            state.mark_covered(topic, answer);
        }
    }
    for topic in output.covered_topics {
        let summary = state
            .topic_answers
            .get(&topic)
            .cloned()
            .unwrap_or_else(|| slot_summary_for_topic(&state.brief, topic));
        state.mark_covered(topic, summary);
    }

    if let Some(q) = output.next_question {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            state.next_question = Some(trimmed.to_string());
        }
    }
}

fn slot_summary_for_topic(brief: &BriefSlots, topic: Topic) -> String {
    match topic {
        Topic::Audience => brief.target_users.clone(),
        Topic::Problem => brief.problem_statement.clone(),
        Topic::DirectionAndScope => brief.key_features.join(", "),
        Topic::Constraints => brief.technical_constraints.clone(),
        Topic::SuccessCriteria => brief.success_criteria.join(", "),
        Topic::StatusQuoAlternative | Topic::NonGoals => String::new(),
    }
}

fn apply_reply_to_topic(state: &mut InterviewState, topic: Topic, reply: &str) {
    let trimmed = reply.trim();
    if trimmed.is_empty() {
        return;
    }
    match topic {
        Topic::Audience => {
            state.brief.target_users = trimmed.to_string();
        }
        Topic::Problem => {
            state.brief.problem_statement = trimmed.to_string();
        }
        Topic::DirectionAndScope => {
            state.brief.key_features = split_list_items(trimmed);
        }
        Topic::Constraints => {
            state.brief.technical_constraints = trimmed.to_string();
        }
        Topic::SuccessCriteria => {
            state.brief.success_criteria = split_list_items(trimmed);
        }
        Topic::StatusQuoAlternative | Topic::NonGoals => {}
    }
    state.mark_covered(topic, trimmed.to_string());
}

fn split_list_items(raw: &str) -> Vec<String> {
    let parts: Vec<String> = raw
        .split([',', '\n', ';', '،'])
        .map(|s| s.trim().trim_start_matches('-').trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if parts.is_empty() {
        vec![raw.trim().to_string()]
    } else {
        parts
    }
}

/// Detect whether the owner asked to finish the interview early ("enough" / "يكفي").
pub fn is_stop_signal(reply: &str) -> bool {
    let normalized = reply
        .trim()
        .trim_end_matches(['.', '!', '?', '؟', '。'])
        .trim()
        .to_lowercase();
    matches!(normalized.as_str(), "enough" | "يكفي" | "كفاية" | "خلاص")
}

fn contains_arabic(text: &str) -> bool {
    text.chars().any(|c| ('\u{0600}'..='\u{06FF}').contains(&c))
}

fn detect_language(text: &str) -> String {
    if contains_arabic(text) {
        "ar".to_string()
    } else {
        "en".to_string()
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::panic, clippy::unwrap_used)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;
    use warsha_core::{
        ModelPricing, Project, ProviderKind, ProviderQuota, RoleRouting, RoutingTarget, TokenUsage,
    };
    use warsha_providers::{ChatChoice, ChatProvider, ChatResponse, HealthCheck, ModelInfo};

    struct CountingProvider {
        id: String,
        calls: Arc<AtomicUsize>,
        canned_reply: Option<String>,
        cost_cents_per_call: u64,
        /// The system message of the last chat call, when the test asked to keep it.
        seen_system: Option<Arc<std::sync::Mutex<String>>>,
    }

    #[async_trait]
    impl ChatProvider for CountingProvider {
        fn id(&self) -> &str {
            &self.id
        }
        fn kind(&self) -> ProviderKind {
            ProviderKind::CustomOpenAICompatible
        }
        async fn list_models(&self) -> std::result::Result<Vec<ModelInfo>, ProviderError> {
            Ok(vec![ModelInfo {
                id: "secretary-mock".to_string(),
                name: "Secretary Mock".to_string(),
                provider: self.id.clone(),
                context_window: 32_000,
                max_output: 4_096,
                pricing: ModelPricing {
                    input_per_million_cents: 100,
                    output_per_million_cents: 200,
                },
            }])
        }
        async fn health(&self) -> std::result::Result<HealthCheck, ProviderError> {
            Ok(HealthCheck {
                healthy: true,
                latency_ms: Some(0),
                error: None,
            })
        }
        async fn chat(
            &self,
            request: ChatRequest,
        ) -> std::result::Result<ChatResponse, ProviderError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(slot) = &self.seen_system {
                if let Some(system) = request
                    .messages
                    .iter()
                    .find(|message| message.role == MessageRole::System)
                {
                    *slot.lock().expect("seen system") = system.content.clone();
                }
            }
            let content = self
                .canned_reply
                .clone()
                .unwrap_or_else(|| format!("Mock response from {} for {}", self.id, request.model));
            Ok(ChatResponse {
                id: "resp-1".to_string(),
                model: request.model,
                choices: vec![ChatChoice {
                    index: 0,
                    message: ChatMessage {
                        role: MessageRole::Assistant,
                        content,
                    },
                    finish_reason: Some("stop".to_string()),
                }],
                usage: TokenUsage {
                    input: 100,
                    output: 50,
                    total: 150,
                    cost_cents: Some(self.cost_cents_per_call),
                },
            })
        }
        async fn chat_stream(
            &self,
            _request: ChatRequest,
        ) -> std::result::Result<
            Box<
                dyn futures::Stream<
                        Item = std::result::Result<
                            warsha_providers::ChatStreamChunk,
                            ProviderError,
                        >,
                    > + Send
                    + Unpin,
            >,
            ProviderError,
        > {
            Err(ProviderError::Other("streaming unused".to_string()))
        }
        fn cost_of(
            &self,
            _model: &str,
            _usage: &TokenUsage,
        ) -> std::result::Result<u64, ProviderError> {
            Ok(self.cost_cents_per_call)
        }
        async fn get_quota(&self) -> std::result::Result<ProviderQuota, ProviderError> {
            Ok(ProviderQuota::Unknown)
        }
    }

    async fn test_env(
        provider: Box<dyn ChatProvider>,
    ) -> (TempDir, Arc<Store>, Arc<RwLock<ProviderRouter>>, ProjectId) {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(Store::open_at(dir.path().join("warsha.db")).await.unwrap());
        let project = Project {
            id: ProjectId::new(),
            name: "test-proj".to_string(),
            description: "desc".to_string(),
            language: "en".to_string(),
            repo_path: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            ..Default::default()
        };
        store.create_project(&project).await.unwrap();

        let mut router = ProviderRouter::new();
        let pid = provider.id().to_string();
        router.register_provider(provider);
        router.set_role_routing(RoleRouting {
            role: Role::Secretary,
            targets: vec![RoutingTarget {
                provider_id: pid,
                model_id: "secretary-mock".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
        (dir, store, Arc::new(RwLock::new(router)), project.id)
    }

    #[tokio::test]
    async fn interview_turns_terminate_with_a_schema_valid_brief() {
        let (_dir, store, router, project_id) =
            test_env(Box::new(warsha_providers::MockProvider::new("mock"))).await;
        let engine = SecretaryEngine::new(store.clone(), router, None);

        let start = engine
            .start(project_id, None, DEFAULT_SECRETARY_DAILY_CAP_CENTS)
            .await
            .unwrap();
        assert!(matches!(
            start,
            TurnOutcome::NextQuestion {
                topic: Topic::Audience,
                ..
            }
        ));

        let replies = [
            "Independent bakery owners in Riyadh",
            "Daily bread waste from inaccurate order forecasting",
            "Paper notebooks and WhatsApp messages, which lose history",
            "Order dashboard, daily demand summary, WhatsApp export",
            "Offline-first mobile web app, Arabic RTL, under $20/month hosting",
            "Cut unsold bread waste by 25% in 60 days",
            "No POS hardware integration or payroll in v1",
        ];

        let mut final_outcome = None;
        for reply in replies {
            let outcome = engine
                .turn(
                    project_id,
                    reply.to_string(),
                    DEFAULT_SECRETARY_DAILY_CAP_CENTS,
                )
                .await
                .unwrap();
            if matches!(outcome, TurnOutcome::Done { .. }) {
                final_outcome = Some(outcome);
                break;
            }
        }

        let Some(TurnOutcome::Done {
            brief,
            direction_card,
            idea_text,
            state,
        }) = final_outcome
        else {
            panic!("expected interview to terminate with Done after all 7 topics");
        };

        assert!(brief.validate().is_ok());
        assert_eq!(direction_card.topics.len(), ALL_TOPICS.len());
        assert_eq!(direction_card.open_topics_count, 0);
        assert!(direction_card
            .topics
            .iter()
            .all(|t| t.status == TopicStatus::Covered));
        assert_eq!(state.transcript.len(), 7);
        assert!(idea_text.contains("Independent bakery owners"));

        // Verify conversion to pipeline ProjectBrief for Gate A.
        let project_brief = brief.to_project_brief(project_id, RunId::new(), &direction_card);
        assert!(project_brief.answers.contains_key("problem_statement"));
        assert!(project_brief.answers.contains_key("target_users"));
        assert!(project_brief.answers.contains_key("key_features"));
        assert!(project_brief.answers.contains_key("technical_constraints"));
        assert!(project_brief.answers.contains_key("success_criteria"));
        assert!(project_brief.answers.contains_key("language"));

        // Verify Secretary cost records were written with Role::Secretary.
        let by_role = store
            .aggregate_costs_by("agent_role", Some(project_id))
            .await
            .unwrap();
        assert!(by_role.contains_key("\"secretary\""));
    }

    #[tokio::test]
    async fn kill_mid_interview_resumes_at_the_next_uncovered_topic() {
        let (_dir, store, router, project_id) =
            test_env(Box::new(warsha_providers::MockProvider::new("mock"))).await;

        // First engine instance answers 2 topics (Audience, Problem), then "dies".
        {
            let engine1 = SecretaryEngine::new(store.clone(), router.clone(), None);
            engine1
                .start(project_id, None, DEFAULT_SECRETARY_DAILY_CAP_CENTS)
                .await
                .unwrap();
            engine1
                .turn(
                    project_id,
                    "Small clinics".to_string(),
                    DEFAULT_SECRETARY_DAILY_CAP_CENTS,
                )
                .await
                .unwrap();
            let outcome = engine1
                .turn(
                    project_id,
                    "Missed follow-up appointments".to_string(),
                    DEFAULT_SECRETARY_DAILY_CAP_CENTS,
                )
                .await
                .unwrap();
            assert!(matches!(
                outcome,
                TurnOutcome::NextQuestion {
                    topic: Topic::StatusQuoAlternative,
                    ..
                }
            ));
        }

        // Simulate daemon restart: new SecretaryEngine reading the same store.
        let engine2 = SecretaryEngine::new(store.clone(), router, None);
        let status = engine2.status(project_id).await.unwrap().unwrap();
        assert_eq!(status.covered_topics, vec![Topic::Audience, Topic::Problem]);
        assert_eq!(status.current_topic, Some(Topic::StatusQuoAlternative));
        assert_eq!(status.transcript.len(), 2);

        // Resuming via `start` returns the exact pending topic without re-asking earlier ones.
        let resumed = engine2
            .start(project_id, None, DEFAULT_SECRETARY_DAILY_CAP_CENTS)
            .await
            .unwrap();
        assert!(matches!(
            resumed,
            TurnOutcome::NextQuestion {
                topic: Topic::StatusQuoAlternative,
                ..
            }
        ));
    }

    #[tokio::test]
    async fn enough_finalizes_with_open_topics_marked() {
        let (_dir, store, router, project_id) =
            test_env(Box::new(warsha_providers::MockProvider::new("mock"))).await;
        let engine = SecretaryEngine::new(store, router, None);

        engine
            .start(project_id, None, DEFAULT_SECRETARY_DAILY_CAP_CENTS)
            .await
            .unwrap();
        engine
            .turn(
                project_id,
                "Freelance translators".to_string(),
                DEFAULT_SECRETARY_DAILY_CAP_CENTS,
            )
            .await
            .unwrap();

        // Owner stops early with "enough" (also verify Arabic "يكفي" helper).
        assert!(is_stop_signal("يكفي"));
        let outcome = engine
            .turn(
                project_id,
                "enough".to_string(),
                DEFAULT_SECRETARY_DAILY_CAP_CENTS,
            )
            .await
            .unwrap();

        let TurnOutcome::Done {
            brief,
            direction_card,
            ..
        } = outcome
        else {
            panic!("expected Done on 'enough'");
        };

        assert!(brief.validate().is_ok());
        assert_eq!(direction_card.open_topics_count, 6);
        assert_eq!(direction_card.topics[0].status, TopicStatus::Covered);
        assert_eq!(direction_card.topics[0].value, "Freelance translators");
        assert!(direction_card.topics[1..]
            .iter()
            .all(|t| t.status == TopicStatus::SystemChosen));
    }

    #[tokio::test]
    async fn daily_cap_answers_without_a_model_call() {
        let calls = Arc::new(AtomicUsize::new(0));
        let provider = CountingProvider {
            id: "counting".to_string(),
            calls: calls.clone(),
            canned_reply: None,
            cost_cents_per_call: 50,
            seen_system: None,
        };
        let (_dir, store, router, project_id) = test_env(Box::new(provider)).await;

        // Pre-record 100 cents of Secretary spend today so the cap (100) is reached.
        store
            .record_role_cost(
                project_id,
                Role::Secretary,
                "counting",
                "secretary-mock",
                500,
                200,
                100,
                Utc::now(),
            )
            .await
            .unwrap();

        let engine = SecretaryEngine::new(store, router, None);
        engine
            .start(project_id, None, DEFAULT_SECRETARY_DAILY_CAP_CENTS)
            .await
            .unwrap();

        let outcome = engine
            .turn(
                project_id,
                "Small teams".to_string(),
                DEFAULT_SECRETARY_DAILY_CAP_CENTS,
            )
            .await
            .unwrap();

        match outcome {
            TurnOutcome::DailyLimitReached {
                message,
                spent_cents,
                cap_cents,
                ..
            } => {
                assert_eq!(message, "daily limit reached");
                assert_eq!(spent_cents, 100);
                assert_eq!(cap_cents, 100);
            }
            other => panic!("expected DailyLimitReached, got {other:?}"),
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            0,
            "daily spend cap must prevent any model call"
        );
    }

    #[tokio::test]
    async fn works_with_marketplaces_disabled() {
        // SettingsStore exists with ZERO installed skills (marketplaces disabled).
        let (dir, store, router, project_id) =
            test_env(Box::new(warsha_providers::MockProvider::new("mock"))).await;
        let settings = Arc::new(SettingsStore::open_unvalidated(
            &dir.path().join("settings.json"),
        ));
        let engine = SecretaryEngine::new(store, router, Some(settings));

        // Falls back cleanly to bundled in-house questioning skill.
        assert_eq!(engine.questioning_skill().await, BUNDLED_QUESTIONING_SKILL);

        let seeded = engine
            .start(
                project_id,
                Some("A bilingual habit tracker for two roommates".to_string()),
                DEFAULT_SECRETARY_DAILY_CAP_CENTS,
            )
            .await
            .unwrap();
        assert!(matches!(seeded, TurnOutcome::NextQuestion { .. }));
    }

    #[tokio::test]
    async fn interview_serves_the_fixed_system_prompt() {
        let seen = Arc::new(std::sync::Mutex::new(String::new()));
        let provider = CountingProvider {
            id: "mock".to_string(),
            calls: Arc::new(AtomicUsize::new(0)),
            canned_reply: Some("What is the audience?".to_string()),
            cost_cents_per_call: 1,
            seen_system: Some(Arc::clone(&seen)),
        };
        let (_dir, store, router, project_id) = test_env(Box::new(provider)).await;
        let engine = SecretaryEngine::new(store, router, None);
        engine
            .start(
                project_id,
                Some("A bilingual habit tracker".to_string()),
                DEFAULT_SECRETARY_DAILY_CAP_CENTS,
            )
            .await
            .unwrap();
        let served = seen.lock().expect("seen system").clone();
        assert!(
            served.starts_with(crate::secretary_chat::FIXED_SECRETARY_SYSTEM_PROMPT),
            "interview did not serve the fixed prompt"
        );
        assert!(served.contains("You never write code, never merge, and never publish."));
    }
}
