use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ulid::Ulid;
use warsha_core::{ProjectId, Role};
use warsha_pipeline::{DiscoveryAnswer, ProjectBrief};
use chrono::Utc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterviewState {
    pub project_id: ProjectId,
    pub brief: ProjectBrief,
    pub covered_topics: HashSet<String>,
    pub next_question: Option<String>,
    pub is_done: bool,
}

pub struct SecretaryEngine {}

impl SecretaryEngine {
    pub fn new() -> Self {
        Self {}
    }

    pub async fn turn(
        &self,
        state: &mut InterviewState,
        owner_reply: Option<String>,
    ) -> anyhow::Result<(Vec<DiscoveryAnswer>, Option<String>)> {
        // 1. Process reply, apply slot updates, and pick next question
        // 2. If reply is "enough", finalize brief
        // 3. Return (updated_answers, next_question_or_final_brief)
        Ok((vec![], Some("What is the main problem your project solves?".to_string())))
    }

    pub fn finalize(&self, state: &mut InterviewState) -> ProjectBrief {
        state.is_done = true;
        state.brief.clone()
    }
}
