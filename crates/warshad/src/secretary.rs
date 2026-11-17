use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use warsha_core::{ProjectId, Role};
use warsha_pipeline::ProjectBrief;
use warsha_store::ProjectId as StoreProjectId;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterviewState {
    pub project_id: ProjectId,
    pub brief: ProjectBrief,
    pub covered_topics: HashSet<String>,
    pub next_question: Option<String>,
}

pub struct SecretaryEngine {
    // ...
}

impl SecretaryEngine {
    pub fn new() -> Self {
        Self {}
    }
    
    // ...
}
