use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ulid::Ulid;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecretaryConversation {
    pub id: Ulid,
    pub project_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecretaryTurn {
    pub id: Ulid,
    pub conversation_id: Ulid,
    pub role: String,
    pub content: String,
    pub proposal_json: Option<String>,
    pub refs_owner_message: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecretarySummary {
    pub conversation_id: Ulid,
    pub summary: String,
    pub covers_until: String,
}
