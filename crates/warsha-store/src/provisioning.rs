//! What the Secretary assigned a rostered agent before it may start work.
//!
//! One record is agent → skills → tools → source. The source is a repository
//! or another audited origin, never a secret. Rows live in `agent_provisioning`
//! (migration 019).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Skills and tools assigned to one rostered agent, and where they came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProvisioningRecord {
    pub project_id: Uuid,
    pub agent_id: String,
    /// The existing pipeline role this agent resolves to (EX1: no new role).
    pub role: String,
    pub skills: Vec<String>,
    pub tools: Vec<String>,
    /// Audited origin, for example `github.com/obra/superpowers`. Never a secret.
    pub source: String,
    pub audited: bool,
    pub created_at: DateTime<Utc>,
}
