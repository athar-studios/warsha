//! Orchestrator Agent — Leads the team and conducts discovery interview

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ulid::Ulid;
use warsha_core::*;

/// Orchestrator configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorConfig {
    pub enabled: bool,
    pub max_questions: usize,
    pub require_gate_a_signoff: bool,
}

impl Default for OrchestratorConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_questions: 20,
            require_gate_a_signoff: true,
        }
    }
}

/// Discovery interview question
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryQuestion {
    pub id: String,
    pub category: DiscoveryCategory,
    pub question: String,
    pub question_ar: String,
    pub input_type: InputType,
    pub options: Option<Vec<String>>,
    pub required: bool,
    pub depends_on: Option<String>, // Previous question ID that must be answered first
}

/// Discovery categories
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiscoveryCategory {
    Platforms,
    Audience,
    Languages,
    Monetization,
    Branding,
    Integrations,
    Privacy,
    Budget,
    SuccessMetric,
}

/// Input types for questions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputType {
    Text,
    MultiSelect,
    SingleSelect,
    Boolean,
    Number,
}

/// Discovery answer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryAnswer {
    pub question_id: String,
    pub value: serde_json::Value,
    pub answered_at: String,
}

/// Project brief generated from discovery
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectBrief {
    pub id: Ulid,
    pub project_id: ProjectId,
    pub run_id: RunId,
    pub version: u32,
    pub answers: HashMap<String, DiscoveryAnswer>,
    pub created_at: String,
    pub updated_at: String,
    pub gate_a_signed_off: bool,
    pub signed_off_at: Option<String>,
    pub signed_off_by: Option<DeviceId>,
}

impl ProjectBrief {
    pub fn new(project_id: ProjectId, run_id: RunId) -> Self {
        Self {
            id: Ulid::new(),
            project_id,
            run_id,
            version: 1,
            answers: HashMap::new(),
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
            gate_a_signed_off: false,
            signed_off_at: None,
            signed_off_by: None,
        }
    }

    pub fn set_answer(&mut self, answer: DiscoveryAnswer) {
        self.answers.insert(answer.question_id.clone(), answer);
        self.updated_at = Utc::now().to_rfc3339();
        self.version += 1;
    }

    pub fn sign_off(&mut self, device_id: DeviceId) {
        self.gate_a_signed_off = true;
        self.signed_off_at = Some(Utc::now().to_rfc3339());
        self.signed_off_by = Some(device_id);
        self.updated_at = Utc::now().to_rfc3339();
        self.version += 1;
    }

    pub fn to_markdown(&self) -> String {
        let mut md = String::new();
        md.push_str("# Project Brief\n\n");
        md.push_str(&format!("**Project ID:** {}\n", self.project_id));
        md.push_str(&format!("**Run ID:** {}\n", self.run_id));
        md.push_str(&format!("**Version:** {}\n", self.version));
        md.push_str(&format!("**Created:** {}\n", self.created_at));
        md.push_str(&format!("**Updated:** {}\n", self.updated_at));
        md.push_str(&format!(
            "**Gate A Signed Off:** {}\n\n",
            if self.gate_a_signed_off {
                "✅ Yes"
            } else {
                "❌ No"
            }
        ));

        if let Some(device) = &self.signed_off_by {
            md.push_str(&format!("**Signed Off By:** {}\n", device));
            if let Some(at) = &self.signed_off_at {
                md.push_str(&format!("**Signed Off At:** {}\n", at));
            }
        }
        md.push_str("\n---\n\n");

        // Group answers by category
        let categories = [
            (DiscoveryCategory::Platforms, "Platforms"),
            (DiscoveryCategory::Audience, "Audience"),
            (DiscoveryCategory::Languages, "Languages"),
            (DiscoveryCategory::Monetization, "Monetization"),
            (DiscoveryCategory::Branding, "Branding"),
            (DiscoveryCategory::Integrations, "Integrations"),
            (DiscoveryCategory::Privacy, "Privacy"),
            (DiscoveryCategory::Budget, "Budget"),
            (DiscoveryCategory::SuccessMetric, "Success Metric"),
        ];

        for (cat, label) in categories {
            let cat_answers: Vec<_> = self
                .answers
                .values()
                .filter(|a| get_question_category(&a.question_id) == cat)
                .collect();
            if !cat_answers.is_empty() {
                md.push_str(&format!("## {}\n\n", label));
                for answer in cat_answers {
                    let q = get_question_by_id(&answer.question_id);
                    md.push_str(&format!("**{}**\n", q.question));
                    md.push_str(&format!("> {}\n\n", format_answer_value(&answer.value)));
                }
            }
        }

        md
    }
}

/// Orchestrator state for a run
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchestratorState {
    pub run_id: RunId,
    pub current_question_index: usize,
    pub brief: ProjectBrief,
    pub status: OrchestratorStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrchestratorStatus {
    NotStarted,
    InProgress,
    AwaitingSignOff,
    Completed,
}

/// Orchestrator agent
pub struct Orchestrator {
    config: OrchestratorConfig,
    questions: Vec<DiscoveryQuestion>,
}

impl Orchestrator {
    pub fn new(config: OrchestratorConfig) -> Self {
        let questions = Self::default_questions();
        Self { config, questions }
    }

    /// The discovery questions this orchestrator asks, in order
    pub fn questions(&self) -> &[DiscoveryQuestion] {
        &self.questions
    }

    /// The settings this orchestrator was built with
    pub fn config(&self) -> &OrchestratorConfig {
        &self.config
    }

    /// Get the standard discovery questions
    fn default_questions() -> Vec<DiscoveryQuestion> {
        vec![
            // Platforms
            DiscoveryQuestion {
                id: "platforms".to_string(),
                category: DiscoveryCategory::Platforms,
                question: "Which platforms should this project target?".to_string(),
                question_ar: "أي منصات يجب أن يستهدفها هذا المشروع؟".to_string(),
                input_type: InputType::MultiSelect,
                options: Some(vec![
                    "Web".to_string(),
                    "Mobile (iOS/Android)".to_string(),
                    "Desktop (Windows/macOS/Linux)".to_string(),
                    "Social pages (Landing, Link-in-bio)".to_string(),
                ]),
                required: true,
                depends_on: None,
            },
            // Audience
            DiscoveryQuestion {
                id: "audience".to_string(),
                category: DiscoveryCategory::Audience,
                question: "Who is the target audience?".to_string(),
                question_ar: "من هو الجمهور المستهدف؟".to_string(),
                input_type: InputType::Text,
                options: None,
                required: true,
                depends_on: None,
            },
            // Languages
            DiscoveryQuestion {
                id: "languages".to_string(),
                category: DiscoveryCategory::Languages,
                question: "Which languages should the app support?".to_string(),
                question_ar: "ما هي اللغات التي يجب أن يدعمها التطبيق؟".to_string(),
                input_type: InputType::MultiSelect,
                options: Some(vec![
                    "Arabic (RTL)".to_string(),
                    "English (LTR)".to_string(),
                    "French".to_string(),
                    "Spanish".to_string(),
                    "German".to_string(),
                    "Chinese".to_string(),
                    "Other".to_string(),
                ]),
                required: true,
                depends_on: None,
            },
            // Monetization
            DiscoveryQuestion {
                id: "monetization".to_string(),
                category: DiscoveryCategory::Monetization,
                question: "What is the monetization model?".to_string(),
                question_ar: "ما هو نموذج الربح؟".to_string(),
                input_type: InputType::SingleSelect,
                options: Some(vec![
                    "Free".to_string(),
                    "Freemium".to_string(),
                    "Subscription".to_string(),
                    "One-time purchase".to_string(),
                    "Ads".to_string(),
                    "Enterprise/B2B".to_string(),
                    "Not sure yet".to_string(),
                ]),
                required: true,
                depends_on: None,
            },
            // Branding
            DiscoveryQuestion {
                id: "branding_name".to_string(),
                category: DiscoveryCategory::Branding,
                question: "What is the project name?".to_string(),
                question_ar: "ما هو اسم المشروع؟".to_string(),
                input_type: InputType::Text,
                options: None,
                required: true,
                depends_on: None,
            },
            DiscoveryQuestion {
                id: "branding_colors".to_string(),
                category: DiscoveryCategory::Branding,
                question: "Preferred color scheme?".to_string(),
                question_ar: "نظام الألوان المفضل؟".to_string(),
                input_type: InputType::Text,
                options: None,
                required: false,
                depends_on: Some("branding_name".to_string()),
            },
            DiscoveryQuestion {
                id: "branding_tone".to_string(),
                category: DiscoveryCategory::Branding,
                question: "Brand tone/voice?".to_string(),
                question_ar: "نبرة العلامة التجارية؟".to_string(),
                input_type: InputType::SingleSelect,
                options: Some(vec![
                    "Professional".to_string(),
                    "Friendly".to_string(),
                    "Playful".to_string(),
                    "Minimalist".to_string(),
                    "Bold".to_string(),
                ]),
                required: false,
                depends_on: Some("branding_name".to_string()),
            },
            // Integrations
            DiscoveryQuestion {
                id: "integrations".to_string(),
                category: DiscoveryCategory::Integrations,
                question: "Which integrations are needed?".to_string(),
                question_ar: "ما هي التكاملات المطلوبة؟".to_string(),
                input_type: InputType::MultiSelect,
                options: Some(vec![
                    "Authentication (OAuth, Email, Phone)".to_string(),
                    "Payments (Stripe, PayPal, Apple/Google Pay)".to_string(),
                    "Analytics (GA4, Mixpanel, PostHog)".to_string(),
                    "Email (SendGrid, Resend, Postmark)".to_string(),
                    "Push Notifications (FCM, APNs, Web Push)".to_string(),
                    "Storage (S3, Cloudflare R2, Supabase)".to_string(),
                    "Search (Algolia, Meilisearch, Typesense)".to_string(),
                    "AI/ML (OpenAI, Anthropic, Custom)".to_string(),
                    "None".to_string(),
                ]),
                required: false,
                depends_on: None,
            },
            // Privacy
            DiscoveryQuestion {
                id: "privacy_local_first".to_string(),
                category: DiscoveryCategory::Privacy,
                question: "Is local-first/offline support required?".to_string(),
                question_ar: "هل الدعم المحلي/بدون إنترنت مطلوب؟".to_string(),
                input_type: InputType::Boolean,
                options: None,
                required: true,
                depends_on: None,
            },
            DiscoveryQuestion {
                id: "privacy_gdpr".to_string(),
                category: DiscoveryCategory::Privacy,
                question: "GDPR/Privacy compliance needed?".to_string(),
                question_ar: "هل الامتثال للائحة الخصوصية/ GDPR مطلوب؟".to_string(),
                input_type: InputType::Boolean,
                options: None,
                required: false,
                depends_on: None,
            },
            DiscoveryQuestion {
                id: "privacy_data_collection".to_string(),
                category: DiscoveryCategory::Privacy,
                question: "What user data will be collected?".to_string(),
                question_ar: "ما هي بيانات المستخدم التي سيتم جمعها؟".to_string(),
                input_type: InputType::Text,
                options: None,
                required: false,
                depends_on: None,
            },
            // Budget
            DiscoveryQuestion {
                id: "budget_total".to_string(),
                category: DiscoveryCategory::Budget,
                question: "Total project budget (USD)?".to_string(),
                question_ar: "إجمالي ميزانية المشروع (دولار)؟".to_string(),
                input_type: InputType::Number,
                options: None,
                required: true,
                depends_on: None,
            },
            DiscoveryQuestion {
                id: "budget_per_role".to_string(),
                category: DiscoveryCategory::Budget,
                question: "Per-role budget limits?".to_string(),
                question_ar: "حدود الميزانية لكل دور؟".to_string(),
                input_type: InputType::Text,
                options: None,
                required: false,
                depends_on: Some("budget_total".to_string()),
            },
            // Success Metric
            DiscoveryQuestion {
                id: "success_metric".to_string(),
                category: DiscoveryCategory::SuccessMetric,
                question: "How will you measure success?".to_string(),
                question_ar: "كيف ستقيس النجاح؟".to_string(),
                input_type: InputType::SingleSelect,
                options: Some(vec![
                    "Monthly Active Users (MAU)".to_string(),
                    "Revenue".to_string(),
                    "Conversion Rate".to_string(),
                    "User Retention".to_string(),
                    "NPS / Customer Satisfaction".to_string(),
                    "Time to Value".to_string(),
                    "Custom KPI".to_string(),
                ]),
                required: true,
                depends_on: None,
            },
        ]
    }

    /// Start discovery interview for a new run
    pub fn start_discovery(&self, project_id: ProjectId, run_id: RunId) -> OrchestratorState {
        OrchestratorState {
            run_id,
            current_question_index: 0,
            brief: ProjectBrief::new(project_id, run_id),
            status: OrchestratorStatus::InProgress,
        }
    }

    /// Get the next question to ask
    ///
    /// The locale is accepted for API stability; questions already carry both
    /// the English and Arabic wording.
    pub fn next_question(
        &self,
        state: &OrchestratorState,
        _locale: &str,
    ) -> Option<&DiscoveryQuestion> {
        if state.current_question_index >= self.questions.len() {
            return None;
        }
        let q = &self.questions[state.current_question_index];

        // Check dependencies
        if let Some(dep) = &q.depends_on {
            if !state.brief.answers.contains_key(dep) {
                return None; // Skip for now, will come back
            }
        }

        Some(q)
    }

    /// Record an answer and advance
    pub fn answer_question(
        &self,
        mut state: OrchestratorState,
        question_id: String,
        value: serde_json::Value,
    ) -> OrchestratorState {
        let answer = DiscoveryAnswer {
            question_id: question_id.clone(),
            value,
            answered_at: Utc::now().to_rfc3339(),
        };
        state.brief.set_answer(answer);
        state.current_question_index += 1;

        // Check if all required questions answered
        let all_answered = self
            .questions
            .iter()
            .all(|q| !q.required || state.brief.answers.contains_key(&q.id));

        if all_answered && state.current_question_index >= self.questions.len() {
            state.status = OrchestratorStatus::AwaitingSignOff;
        }

        state
    }

    /// Sign off the brief at Gate A
    pub fn sign_off_brief(
        &self,
        mut state: OrchestratorState,
        device_id: DeviceId,
    ) -> OrchestratorState {
        state.brief.sign_off(device_id);
        state.status = OrchestratorStatus::Completed;
        state
    }

    /// Get the brief as markdown
    pub fn get_brief_markdown(&self, state: &OrchestratorState) -> String {
        state.brief.to_markdown()
    }
}

/// Helper to get question category by ID
fn get_question_category(question_id: &str) -> DiscoveryCategory {
    match question_id {
        "platforms" => DiscoveryCategory::Platforms,
        "audience" => DiscoveryCategory::Audience,
        "languages" => DiscoveryCategory::Languages,
        "monetization" => DiscoveryCategory::Monetization,
        id if id.starts_with("branding_") => DiscoveryCategory::Branding,
        "integrations" => DiscoveryCategory::Integrations,
        id if id.starts_with("privacy_") => DiscoveryCategory::Privacy,
        id if id.starts_with("budget_") => DiscoveryCategory::Budget,
        "success_metric" => DiscoveryCategory::SuccessMetric,
        _ => DiscoveryCategory::Platforms,
    }
}

/// Helper to get question by ID
fn get_question_by_id(question_id: &str) -> DiscoveryQuestion {
    Orchestrator::default_questions()
        .into_iter()
        .find(|q| q.id == question_id)
        .unwrap_or_else(|| DiscoveryQuestion {
            id: question_id.to_string(),
            category: DiscoveryCategory::Platforms,
            question: question_id.to_string(),
            question_ar: question_id.to_string(),
            input_type: InputType::Text,
            options: None,
            required: false,
            depends_on: None,
        })
}

/// Format answer value for display
fn format_answer_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|v| v.as_str())
            .collect::<Vec<_>>()
            .join(", "),
        serde_json::Value::Bool(b) => {
            if *b {
                "Yes".to_string()
            } else {
                "No".to_string()
            }
        }
        serde_json::Value::Number(n) => n.to_string(),
        _ => "N/A".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orchestrator_creation() {
        let orchestrator = Orchestrator::new(OrchestratorConfig::default());
        // Nine discovery categories: platforms, audience, languages, monetization,
        // branding (3), integrations, privacy (3), budget (2), success metric.
        assert_eq!(orchestrator.questions().len(), 14);
        assert!(orchestrator
            .questions()
            .iter()
            .all(|question| !question.question.is_empty() && !question.question_ar.is_empty()));
        assert!(orchestrator.config().enabled);
    }

    #[test]
    fn test_discovery_start() {
        let orchestrator = Orchestrator::new(OrchestratorConfig::default());
        let state = orchestrator.start_discovery(ProjectId::new(), RunId::new());
        assert_eq!(state.current_question_index, 0);
        assert_eq!(state.status, OrchestratorStatus::InProgress);
    }

    #[test]
    fn test_answer_question() {
        let orchestrator = Orchestrator::new(OrchestratorConfig::default());
        let state = orchestrator.start_discovery(ProjectId::new(), RunId::new());

        let state = orchestrator.answer_question(
            state,
            "platforms".to_string(),
            serde_json::json!(["Web", "Mobile"]),
        );

        assert_eq!(state.current_question_index, 1);
        assert!(state.brief.answers.contains_key("platforms"));
    }

    #[test]
    fn test_brief_sign_off() {
        let orchestrator = Orchestrator::new(OrchestratorConfig::default());
        let state = orchestrator.start_discovery(ProjectId::new(), RunId::new());

        // Answer all required questions quickly
        let mut state = state;
        for q in &orchestrator.questions {
            if q.required {
                let value = match q.input_type {
                    InputType::Text => serde_json::json!("test"),
                    InputType::MultiSelect => serde_json::json!(["option1"]),
                    InputType::SingleSelect => serde_json::json!("option1"),
                    InputType::Boolean => serde_json::json!(true),
                    InputType::Number => serde_json::json!(100),
                };
                state = orchestrator.answer_question(state, q.id.clone(), value);
            }
        }

        let device = DeviceId::new();
        let state = orchestrator.sign_off_brief(state, device);

        assert!(state.brief.gate_a_signed_off);
        assert_eq!(state.status, OrchestratorStatus::Completed);
    }

    #[test]
    fn test_brief_to_markdown() {
        let orchestrator = Orchestrator::new(OrchestratorConfig::default());
        let state = orchestrator.start_discovery(ProjectId::new(), RunId::new());

        let mut state = state;
        state = orchestrator.answer_question(
            state,
            "platforms".to_string(),
            serde_json::json!(["Web", "Mobile"]),
        );
        state = orchestrator.answer_question(
            state,
            "audience".to_string(),
            serde_json::json!("Developers"),
        );

        let markdown = orchestrator.get_brief_markdown(&state);
        assert!(markdown.contains("Platforms"));
        assert!(markdown.contains("Web, Mobile"));
        assert!(markdown.contains("Developers"));
    }
}
