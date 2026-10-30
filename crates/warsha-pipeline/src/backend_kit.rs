//! Backend kit — the ready open-source backend a generated project points at
//! (PLAN.md M19, LingCode-inspired ideas only).
//!
//! This module is the *definition layer* of the backend milestone. It records
//! what the owner picked and what the agent built on top of it, and it can turn
//! that record into a standard SQL dump:
//!
//! - [`BackendKind`] — PocketBase (MIT, self-hosted simplicity, the PLAN's
//!   preference) or Supabase, the Postgres + RLS alternative.
//! - [`BackendConfig`] — the backend, its URL, the project name and the services
//!   the owner turned on ([`BackendFeature`]: auth, Postgres RLS, storage, push,
//!   functions).
//! - [`BackendKit`] — the schema the agent created: [`TableDef`]s,
//!   [`RlsPolicy`]s, storage buckets and functions.
//! - [`BackendKit::export`] — the standard export: one SQL dump (every
//!   `CREATE TABLE`, then the RLS statements) plus the path the storage archive
//!   must be written to, so the owner keeps their data.
//! - [`PaymentsGate`] — payments are **never** auto-enabled. The gate stays shut
//!   until a named owner approves it with a timestamp.
//!
//! What is deliberately not here: no backend client and no MCP transport. The
//! agent drives the backend through the backend's own MCP server (PLAN.md M19),
//! and this module is the state that server's calls are recorded against, so a
//! later `warshad` RPC has one place to read the schema from. Nothing in this
//! file opens a socket, and [`BackendKit::export`] writes nothing to disk — it
//! returns the bundle for the caller to store.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Errors raised by the backend kit.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BackendKitError {
    /// A table, column, bucket, function or policy name is not a safe identifier.
    #[error("invalid identifier: {0}")]
    InvalidIdentifier(String),
    /// A column type is not a plain SQL type.
    #[error("invalid column type: {0}")]
    InvalidColumnType(String),
    /// A table needs at least one column.
    #[error("table `{0}` has no columns")]
    EmptyTable(String),
    /// A table with that name is already defined.
    #[error("table `{0}` already exists")]
    DuplicateTable(String),
    /// A column name repeats inside one table.
    #[error("column `{column}` is defined twice on table `{table}`")]
    DuplicateColumn {
        /// The table the column belongs to.
        table: String,
        /// The column name that repeats.
        column: String,
    },
    /// No table with that name is defined.
    #[error("table `{0}` is not defined")]
    UnknownTable(String),
    /// A policy for that table already carries that name.
    #[error("policy `{policy_name}` already exists on table `{table}`")]
    DuplicatePolicy {
        /// The table the policy applies to.
        table: String,
        /// The repeated policy name.
        policy_name: String,
    },
    /// The policy expression cannot be used as SQL.
    #[error("invalid policy expression for `{0}`: {1}")]
    InvalidPolicyExpression(String, String),
    /// A storage bucket with that name is already defined.
    #[error("storage bucket `{0}` already exists")]
    DuplicateBucket(String),
    /// A function with that name is already defined.
    #[error("function `{0}` already exists")]
    DuplicateFunction(String),
    /// Payments cannot be enabled without a named owner.
    #[error("payments need an explicit owner approval")]
    ApprovalRequired,
    /// The approval record itself is unusable.
    #[error("invalid payment approval: {0}")]
    InvalidApproval(String),
    /// Payments were already enabled by an owner.
    #[error("payments are already enabled")]
    PaymentsAlreadyEnabled,
}

/// The open-source backend a generated project points at.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackendKind {
    /// PocketBase — one MIT binary, SQLite on disk, admin UI included.
    #[default]
    PocketBase,
    /// Supabase — Postgres, RLS, storage and functions as separate services.
    Supabase,
}

impl BackendKind {
    /// Every kind the kit knows, PocketBase first (the PLAN's preference).
    pub fn all() -> [BackendKind; 2] {
        [BackendKind::PocketBase, BackendKind::Supabase]
    }

    /// The wire name, matching the serde `snake_case` form.
    pub fn as_str(&self) -> &'static str {
        match self {
            BackendKind::PocketBase => "pocket_base",
            BackendKind::Supabase => "supabase",
        }
    }

    /// The human name used in the UI and the export header.
    pub fn display_name(&self) -> &'static str {
        match self {
            BackendKind::PocketBase => "PocketBase",
            BackendKind::Supabase => "Supabase",
        }
    }
}

/// A backend service the owner can turn on for the project.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BackendFeature {
    /// Accounts, sessions and sign-in.
    Auth,
    /// Postgres row-level security.
    PostgresRls,
    /// File storage in buckets.
    Storage,
    /// Push notifications.
    Push,
    /// Serverless functions.
    Functions,
}

impl BackendFeature {
    /// Every feature, in the order the UI lists them.
    pub fn all() -> [BackendFeature; 5] {
        [
            BackendFeature::Auth,
            BackendFeature::PostgresRls,
            BackendFeature::Storage,
            BackendFeature::Push,
            BackendFeature::Functions,
        ]
    }

    /// The wire name, matching the serde `snake_case` form.
    pub fn as_str(&self) -> &'static str {
        match self {
            BackendFeature::Auth => "auth",
            BackendFeature::PostgresRls => "postgres_rls",
            BackendFeature::Storage => "storage",
            BackendFeature::Push => "push",
            BackendFeature::Functions => "functions",
        }
    }
}

/// The backend the owner picked: kind, URL, project name and enabled services.
///
/// The `url` and `project_name` travel as the owner typed them — this layer
/// records them, it does not dial them. Validation of a reachable URL is the
/// MCP client's job once it exists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackendConfig {
    /// Which backend this project uses.
    pub kind: BackendKind,
    /// Where the backend answers, e.g. `http://127.0.0.1:8090`.
    pub url: String,
    /// The project's name — also the stem of the export archive path.
    pub project_name: String,
    /// The services the owner turned on.
    #[serde(default)]
    pub enabled_features: Vec<BackendFeature>,
}

impl BackendConfig {
    /// A config with no services enabled.
    pub fn new(kind: BackendKind, url: impl Into<String>, project_name: impl Into<String>) -> Self {
        Self {
            kind,
            url: url.into(),
            project_name: project_name.into(),
            enabled_features: Vec::new(),
        }
    }

    /// Turn one service on, keeping the feature list in [`BackendFeature::all`]
    /// order so the UI and the export header cannot disagree.
    pub fn with_feature(mut self, feature: BackendFeature) -> Self {
        if !self.enabled_features.contains(&feature) {
            self.enabled_features.push(feature);
            self.enabled_features.sort_by_key(sorted_feature_index);
        }
        self
    }

    /// Whether a service is enabled.
    pub fn has_feature(&self, feature: BackendFeature) -> bool {
        self.enabled_features.contains(&feature)
    }

    /// The enabled services as one comma-separated line, for logs and the dump
    /// header. `none` when nothing is enabled.
    pub fn feature_list(&self) -> String {
        if self.enabled_features.is_empty() {
            return "none".to_string();
        }
        self.enabled_features
            .iter()
            .map(BackendFeature::as_str)
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// The position of a feature in [`BackendFeature::all`], used for sorting.
fn sorted_feature_index(feature: &BackendFeature) -> usize {
    BackendFeature::all()
        .iter()
        .position(|known| known == feature)
        .unwrap_or(BackendFeature::all().len())
}

/// One column of a generated table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnDef {
    /// The column name.
    pub name: String,
    /// The SQL type, e.g. `TEXT`, `timestamptz` or `numeric(10,2)`.
    pub col_type: String,
    /// Whether the column accepts `NULL`.
    pub nullable: bool,
}

impl ColumnDef {
    /// A column definition as the agent described it.
    pub fn new(name: impl Into<String>, col_type: impl Into<String>, nullable: bool) -> Self {
        Self {
            name: name.into(),
            col_type: col_type.into(),
            nullable,
        }
    }
}

/// One table the agent created on the backend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TableDef {
    /// The table name.
    pub name: String,
    /// The columns, in the order they were added.
    pub columns: Vec<ColumnDef>,
}

impl TableDef {
    /// A table with the given columns.
    pub fn new(name: impl Into<String>, columns: Vec<ColumnDef>) -> Self {
        Self {
            name: name.into(),
            columns,
        }
    }

    /// Whether a column with that name is defined.
    pub fn has_column(&self, name: &str) -> bool {
        self.columns.iter().any(|column| column.name == name)
    }
}

/// The operation an RLS policy applies to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RlsOperation {
    /// Read access.
    Select,
    /// Row creation.
    Insert,
    /// Row updates.
    Update,
    /// Row deletion.
    Delete,
    /// Every operation.
    All,
}

impl RlsOperation {
    /// The SQL keyword this operation maps to.
    pub fn as_sql(&self) -> &'static str {
        match self {
            RlsOperation::Select => "SELECT",
            RlsOperation::Insert => "INSERT",
            RlsOperation::Update => "UPDATE",
            RlsOperation::Delete => "DELETE",
            RlsOperation::All => "ALL",
        }
    }

    /// The wire name, matching the serde `snake_case` form.
    pub fn as_str(&self) -> &'static str {
        match self {
            RlsOperation::Select => "select",
            RlsOperation::Insert => "insert",
            RlsOperation::Update => "update",
            RlsOperation::Delete => "delete",
            RlsOperation::All => "all",
        }
    }
}

/// One row-level security policy on one table.
///
/// The expression is the policy body as the agent wrote it (`auth.uid() =
/// owner_id`); it is exported verbatim so the reviewer sees exactly what will be
/// applied at Gate C.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RlsPolicy {
    /// The table the policy applies to.
    pub table: String,
    /// The policy name, unique per table.
    pub policy_name: String,
    /// The SQL expression the policy allows.
    pub expression: String,
    /// Which operation the policy covers.
    pub operation: RlsOperation,
}

impl RlsPolicy {
    /// A policy for one operation on one table.
    pub fn new(
        table: impl Into<String>,
        policy_name: impl Into<String>,
        expression: impl Into<String>,
        operation: RlsOperation,
    ) -> Self {
        Self {
            table: table.into(),
            policy_name: policy_name.into(),
            expression: expression.into(),
            operation,
        }
    }
}

/// The standard export: the SQL dump plus where the storage archive goes.
///
/// Nothing here writes a file. `sql_dump` is the complete dump as a string, and
/// `storage_archive_path` names the archive the caller must pack — `None` when
/// there is nothing to pack.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportBundle {
    /// Every `CREATE TABLE` and every RLS statement, in dependency order.
    pub sql_dump: String,
    /// Where the storage archive belongs, or `None` when there are no buckets.
    pub storage_archive_path: Option<String>,
}

impl ExportBundle {
    /// Whether the dump contains anything beyond its header comment.
    pub fn has_schema(&self) -> bool {
        self.sql_dump.contains("CREATE TABLE")
    }

    /// Whether a storage archive has to be packed.
    pub fn has_storage(&self) -> bool {
        self.storage_archive_path.is_some()
    }
}

/// Payments on the generated backend.
///
/// The PLAN's rule is absolute: payments are never auto-enabled and a dedicated
/// gate applies. [`PaymentsGate::enable`] is the only path that opens it, and it
/// needs a named owner and a timestamp. [`PaymentsGate::is_enabled`] re-checks
/// the approval record, so flipping the public `enabled` field alone does **not**
/// count as an enabled gate.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PaymentsGate {
    /// Whether the owner turned payments on.
    pub enabled: bool,
    /// Who approved it.
    #[serde(default)]
    pub approved_by: Option<String>,
    /// When they approved it, in seconds since the Unix epoch.
    #[serde(default)]
    pub approved_at: Option<u64>,
}

impl PaymentsGate {
    /// A shut gate.
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether payments are really on: the flag **and** the approval record.
    pub fn is_enabled(&self) -> bool {
        self.enabled && self.approved_by.is_some() && self.approved_at.is_some()
    }

    /// Open the gate with an explicit owner approval.
    ///
    /// A blank approver is [`BackendKitError::ApprovalRequired`] and changes
    /// nothing; a zero timestamp is [`BackendKitError::InvalidApproval`]; a gate
    /// that is already open is [`BackendKitError::PaymentsAlreadyEnabled`].
    pub fn enable(
        &mut self,
        approved_by: impl Into<String>,
        approved_at: u64,
    ) -> Result<(), BackendKitError> {
        let approver = approved_by.into();
        let approver = approver.trim();
        if approver.is_empty() {
            return Err(BackendKitError::ApprovalRequired);
        }
        if approved_at == 0 {
            return Err(BackendKitError::InvalidApproval(
                "approved_at must be a real timestamp".to_string(),
            ));
        }
        if self.is_enabled() {
            return Err(BackendKitError::PaymentsAlreadyEnabled);
        }
        self.enabled = true;
        self.approved_by = Some(approver.to_string());
        self.approved_at = Some(approved_at);
        Ok(())
    }

    /// Close the gate again and drop the approval record.
    pub fn disable(&mut self) {
        self.enabled = false;
        self.approved_by = None;
        self.approved_at = None;
    }

    /// One line for the UI and the export header.
    pub fn summary(&self) -> String {
        match (&self.approved_by, self.approved_at) {
            (Some(by), Some(at)) if self.enabled => format!("enabled by {by} at {at}"),
            _ => "disabled — owner approval required".to_string(),
        }
    }
}

/// The backend kit: the picked backend plus everything the agent created on it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackendKit {
    /// Which backend, where, and which services.
    pub config: BackendConfig,
    /// The tables the agent created, in creation order.
    #[serde(default)]
    pub tables: Vec<TableDef>,
    /// The RLS policies the agent created, in creation order.
    #[serde(default)]
    pub rls_policies: Vec<RlsPolicy>,
    /// The storage buckets the agent created, in creation order.
    #[serde(default)]
    pub storage_buckets: Vec<String>,
    /// The functions the agent created, in creation order.
    #[serde(default)]
    pub functions: Vec<String>,
}

impl BackendKit {
    /// An empty kit for the given backend.
    pub fn new(config: BackendConfig) -> Self {
        Self {
            config,
            tables: Vec::new(),
            rls_policies: Vec::new(),
            storage_buckets: Vec::new(),
            functions: Vec::new(),
        }
    }

    /// The config this kit was built from.
    pub fn config(&self) -> &BackendConfig {
        &self.config
    }

    /// A table by name.
    pub fn table(&self, name: &str) -> Option<&TableDef> {
        self.tables.iter().find(|table| table.name == name)
    }

    /// The enabled services, in `BackendFeature::all` order.
    pub fn features(&self) -> &[BackendFeature] {
        &self.config.enabled_features
    }

    /// Whether any table, policy, bucket or function was created.
    pub fn is_empty(&self) -> bool {
        self.tables.is_empty()
            && self.rls_policies.is_empty()
            && self.storage_buckets.is_empty()
            && self.functions.is_empty()
    }

    /// Add a table, refusing a bad name, an empty or repeated column, and a
    /// repeated table name.
    pub fn add_table(&mut self, table: TableDef) -> Result<(), BackendKitError> {
        check_identifier(&table.name)?;
        if table.columns.is_empty() {
            return Err(BackendKitError::EmptyTable(table.name));
        }
        for column in &table.columns {
            check_identifier(&column.name)?;
            if !is_safe_column_type(&column.col_type) {
                return Err(BackendKitError::InvalidColumnType(column.col_type.clone()));
            }
        }
        for (index, column) in table.columns.iter().enumerate() {
            if table.columns[index + 1..]
                .iter()
                .any(|other| other.name == column.name)
            {
                return Err(BackendKitError::DuplicateColumn {
                    table: table.name,
                    column: column.name.clone(),
                });
            }
        }
        if self.table(&table.name).is_some() {
            return Err(BackendKitError::DuplicateTable(table.name));
        }
        self.tables.push(table);
        Ok(())
    }

    /// Add an RLS policy, refusing a bad name, a blank or multi-statement
    /// expression, an unknown table and a policy name that already exists on
    /// that table. The table must be added first, so the dump order is also the
    /// creation order.
    pub fn add_rls_policy(&mut self, policy: RlsPolicy) -> Result<(), BackendKitError> {
        check_identifier(&policy.table)?;
        check_identifier(&policy.policy_name)?;
        let expression = policy.expression.trim();
        if expression.is_empty() || expression.contains(';') {
            return Err(BackendKitError::InvalidPolicyExpression(
                policy.policy_name,
                "the expression must be one non-empty SQL expression".to_string(),
            ));
        }
        if self.table(&policy.table).is_none() {
            return Err(BackendKitError::UnknownTable(policy.table));
        }
        let repeated = self
            .rls_policies
            .iter()
            .any(|stored| stored.table == policy.table && stored.policy_name == policy.policy_name);
        if repeated {
            return Err(BackendKitError::DuplicatePolicy {
                table: policy.table,
                policy_name: policy.policy_name,
            });
        }
        self.rls_policies.push(policy);
        Ok(())
    }

    /// Add a storage bucket, refusing a bad or repeated name.
    pub fn add_storage_bucket(&mut self, name: impl Into<String>) -> Result<(), BackendKitError> {
        let name = name.into();
        check_identifier(&name)?;
        if self.storage_buckets.contains(&name) {
            return Err(BackendKitError::DuplicateBucket(name));
        }
        self.storage_buckets.push(name);
        Ok(())
    }

    /// Add a function, refusing a bad or repeated name.
    pub fn add_function(&mut self, name: impl Into<String>) -> Result<(), BackendKitError> {
        let name = name.into();
        check_identifier(&name)?;
        if self.functions.contains(&name) {
            return Err(BackendKitError::DuplicateFunction(name));
        }
        self.functions.push(name);
        Ok(())
    }

    /// The standard export: one SQL dump plus the storage archive path.
    ///
    /// The dump is ordered the way Postgres needs it — every `CREATE TABLE`,
    /// then `ENABLE ROW LEVEL SECURITY` for each table that has a policy, then
    /// the `CREATE POLICY` statements. Buckets and functions cannot be created
    /// by SQL on either backend, so they are listed in the header comment: the
    /// archive is the caller's to pack and the function sources are the
    /// caller's to deploy.
    pub fn export(&self) -> ExportBundle {
        let kind = self.config.kind.display_name();
        let project = comment_safe(&self.config.project_name);
        let url = comment_safe(&self.config.url);
        let features = self.config.feature_list();

        let mut sql = String::new();
        sql.push_str("-- Warsha backend kit export\n");
        sql.push_str(&format!("-- backend: {kind}\n"));
        sql.push_str(&format!("-- project: {project}\n"));
        sql.push_str(&format!("-- url: {url}\n"));
        sql.push_str(&format!("-- features: {features}\n"));
        sql.push_str(&format!("-- tables: {}\n", self.tables.len()));
        sql.push_str(&format!("-- rls policies: {}\n", self.rls_policies.len()));
        sql.push_str(&format!("-- storage buckets: {}\n", self.bucket_list()));
        sql.push_str(&format!("-- functions: {}\n", self.function_list()));
        sql.push_str("-- Review this dump at Gate C before applying it.\n");

        for table in &self.tables {
            sql.push('\n');
            sql.push_str("CREATE TABLE IF NOT EXISTS ");
            sql.push_str(&quote_ident(&table.name));
            sql.push_str(" (\n");
            let mut first = true;
            for column in &table.columns {
                if !first {
                    sql.push_str(",\n");
                }
                first = false;
                sql.push_str("    ");
                sql.push_str(&quote_ident(&column.name));
                sql.push(' ');
                // The type was checked against the plain-SQL character set in
                // `add_table`, so it is emitted as the agent wrote it.
                sql.push_str(column.col_type.trim());
                if !column.nullable {
                    sql.push_str(" NOT NULL");
                }
            }
            sql.push_str("\n);\n");
        }

        for table in &self.tables {
            let has_policy = self
                .rls_policies
                .iter()
                .any(|policy| policy.table == table.name);
            if !has_policy {
                continue;
            }
            sql.push('\n');
            sql.push_str("ALTER TABLE ");
            sql.push_str(&quote_ident(&table.name));
            sql.push_str(" ENABLE ROW LEVEL SECURITY;\n");
        }

        for policy in &self.rls_policies {
            sql.push('\n');
            sql.push_str("CREATE POLICY ");
            sql.push_str(&quote_ident(&policy.policy_name));
            sql.push_str(" ON ");
            sql.push_str(&quote_ident(&policy.table));
            sql.push_str(" FOR ");
            sql.push_str(policy.operation.as_sql());
            sql.push(' ');
            sql.push_str(&policy_clause(policy.operation, policy.expression.trim()));
            sql.push_str(";\n");
        }

        ExportBundle {
            sql_dump: sql,
            storage_archive_path: self.storage_archive_path(),
        }
    }

    /// The path the storage archive belongs at, or `None` when the project has
    /// no buckets to pack.
    pub fn storage_archive_path(&self) -> Option<String> {
        if self.storage_buckets.is_empty() {
            return None;
        }
        let slug = slugify(&self.config.project_name);
        let slug = if slug.is_empty() {
            "warsha-project".to_string()
        } else {
            slug
        };
        Some(format!("{slug}-storage.tar.gz"))
    }

    /// The buckets as one comma-separated line, for the dump header.
    fn bucket_list(&self) -> String {
        if self.storage_buckets.is_empty() {
            return "none".to_string();
        }
        self.storage_buckets.join(", ")
    }

    /// The functions as one comma-separated line, for the dump header.
    fn function_list(&self) -> String {
        if self.functions.is_empty() {
            return "none".to_string();
        }
        self.functions.join(", ")
    }
}

/// The `USING` / `WITH CHECK` half of a policy statement.
fn policy_clause(operation: RlsOperation, expression: &str) -> String {
    match operation {
        RlsOperation::Insert => format!("WITH CHECK ({expression})"),
        RlsOperation::All => format!("USING ({expression}) WITH CHECK ({expression})"),
        RlsOperation::Select | RlsOperation::Update | RlsOperation::Delete => {
            format!("USING ({expression})")
        }
    }
}

/// Whether a name is a safe SQL identifier: ASCII letters, digits and `_`, not
/// starting with a digit. Table, column, bucket, function and policy names come
/// from an agent, so the kit refuses anything else rather than quoting its way
/// out of an injection.
pub fn is_safe_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Refuse a name that is not a safe identifier.
fn check_identifier(name: &str) -> Result<(), BackendKitError> {
    if is_safe_identifier(name) {
        Ok(())
    } else {
        Err(BackendKitError::InvalidIdentifier(name.to_string()))
    }
}

/// Whether a column type is a plain SQL type: letters, digits, spaces, `_`,
/// `(`, `)`, `,`, `[`, `]` and `.` — enough for `TEXT`, `timestamptz`,
/// `numeric(10,2)` and `text[]`, and nothing that can end the statement.
pub fn is_safe_column_type(col_type: &str) -> bool {
    let trimmed = col_type.trim();
    !trimmed.is_empty()
        && trimmed.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, ' ' | '_' | '(' | ')' | ',' | '[' | ']' | '.')
        })
}

/// Quote an identifier for SQL, doubling any embedded quote. Identifiers are
/// already screened, so this is the belt to [`check_identifier`]'s braces.
fn quote_ident(name: &str) -> String {
    let escaped = name.replace('"', "\"\"");
    format!("\"{escaped}\"")
}

/// Make a value safe to put in a `--` comment: a newline would end the comment
/// and turn the rest of a project name into SQL.
fn comment_safe(value: &str) -> String {
    value
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect()
}

/// A file-name-safe stem for the storage archive: lower-case ASCII letters and
/// digits, runs of anything else collapsed to one `-`.
fn slugify(value: &str) -> String {
    let mut slug = String::new();
    let mut pending_dash = false;
    for c in value.chars() {
        if c.is_ascii_alphanumeric() {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            pending_dash = false;
            slug.push(c.to_ascii_lowercase());
        } else {
            pending_dash = true;
        }
    }
    slug
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kit() -> BackendKit {
        BackendKit::new(BackendConfig::new(
            BackendKind::PocketBase,
            "http://127.0.0.1:8090",
            "My App",
        ))
    }

    fn posts() -> TableDef {
        TableDef::new(
            "posts",
            vec![
                ColumnDef::new("id", "TEXT", false),
                ColumnDef::new("title", "TEXT", false),
                ColumnDef::new("body", "TEXT", true),
            ],
        )
    }

    #[test]
    fn config_creation_records_kind_url_and_project() {
        let config = BackendConfig::new(BackendKind::Supabase, "http://localhost:54321", "Shop")
            .with_feature(BackendFeature::Storage)
            .with_feature(BackendFeature::Auth);

        assert_eq!(config.kind, BackendKind::Supabase);
        assert_eq!(config.url, "http://localhost:54321");
        assert_eq!(config.project_name, "Shop");
        // Sorted into `BackendFeature::all` order: auth before storage.
        assert_eq!(
            config.enabled_features,
            vec![BackendFeature::Auth, BackendFeature::Storage]
        );
        assert!(config.has_feature(BackendFeature::Auth));
        assert!(!config.has_feature(BackendFeature::Push));
        // A repeated feature is not stored twice.
        let config = config.with_feature(BackendFeature::Auth);
        assert_eq!(config.enabled_features.len(), 2);
    }

    #[test]
    fn feature_list_is_ordered_and_never_empty() {
        let bare = BackendConfig::new(BackendKind::PocketBase, "http://x", "bare");
        assert_eq!(bare.feature_list(), "none");

        let full = bare
            .clone()
            .with_feature(BackendFeature::Functions)
            .with_feature(BackendFeature::Auth)
            .with_feature(BackendFeature::Push);
        assert_eq!(full.feature_list(), "auth, push, functions");
        assert_eq!(full.enabled_features.len(), 3);
        assert_eq!(BackendFeature::all().len(), 5);
    }

    #[test]
    fn add_table_stores_columns_in_order() {
        let mut kit = kit();
        kit.add_table(posts()).expect("a valid table is accepted");

        let stored = kit.table("posts").expect("the table is stored");
        assert_eq!(stored.columns.len(), 3);
        assert_eq!(stored.columns[0].name, "id");
        assert!(!stored.columns[0].nullable);
        assert!(stored.columns[2].nullable);
        assert!(stored.has_column("body"));
        assert!(!kit.is_empty());
    }

    #[test]
    fn add_table_refuses_bad_input() {
        let mut kit = kit();

        assert_eq!(
            kit.add_table(TableDef::new("posts; DROP TABLE users", vec![])),
            Err(BackendKitError::InvalidIdentifier(
                "posts; DROP TABLE users".to_string()
            ))
        );
        assert_eq!(
            kit.add_table(TableDef::new("posts", vec![])),
            Err(BackendKitError::EmptyTable("posts".to_string()))
        );
        assert_eq!(
            kit.add_table(TableDef::new(
                "posts",
                vec![ColumnDef::new("id", "TEXT; DROP TABLE users", false)],
            )),
            Err(BackendKitError::InvalidColumnType(
                "TEXT; DROP TABLE users".to_string()
            ))
        );
        assert_eq!(
            kit.add_table(TableDef::new(
                "posts",
                vec![
                    ColumnDef::new("id", "TEXT", false),
                    ColumnDef::new("id", "INTEGER", true),
                ],
            )),
            Err(BackendKitError::DuplicateColumn {
                table: "posts".to_string(),
                column: "id".to_string(),
            })
        );

        kit.add_table(posts()).expect("the first table is accepted");
        assert_eq!(
            kit.add_table(posts()),
            Err(BackendKitError::DuplicateTable("posts".to_string()))
        );
        assert_eq!(kit.tables.len(), 1);
    }

    #[test]
    fn add_rls_policy_requires_a_table_and_a_unique_name() {
        let mut kit = kit();
        let policy = RlsPolicy::new(
            "posts",
            "posts_select_own",
            "auth.uid() = owner_id",
            RlsOperation::Select,
        );

        // The table has to exist first, so the dump order is the creation order.
        assert_eq!(
            kit.add_rls_policy(policy.clone()),
            Err(BackendKitError::UnknownTable("posts".to_string()))
        );

        kit.add_table(posts()).expect("table accepted");
        kit.add_rls_policy(policy.clone()).expect("policy accepted");
        assert_eq!(kit.rls_policies.len(), 1);
        assert_eq!(kit.rls_policies[0].operation, RlsOperation::Select);

        assert_eq!(
            kit.add_rls_policy(policy),
            Err(BackendKitError::DuplicatePolicy {
                table: "posts".to_string(),
                policy_name: "posts_select_own".to_string(),
            })
        );
    }

    #[test]
    fn add_rls_policy_refuses_a_blank_or_multi_statement_expression() {
        let mut kit = kit();
        kit.add_table(posts()).expect("table accepted");

        for expression in ["", "   ", "auth.uid() = owner_id; DROP TABLE posts"] {
            let policy = RlsPolicy::new("posts", "posts_guard", expression, RlsOperation::All);
            assert!(matches!(
                kit.add_rls_policy(policy),
                Err(BackendKitError::InvalidPolicyExpression(_, _))
            ));
        }
        assert!(kit.rls_policies.is_empty());

        let bad_name = RlsPolicy::new("posts", "posts guard", "true", RlsOperation::All);
        assert_eq!(
            kit.add_rls_policy(bad_name),
            Err(BackendKitError::InvalidIdentifier(
                "posts guard".to_string()
            ))
        );
    }

    #[test]
    fn add_storage_bucket_stores_names_and_refuses_repeats() {
        let mut kit = kit();
        kit.add_storage_bucket("avatars").expect("bucket accepted");
        kit.add_storage_bucket("attachments")
            .expect("bucket accepted");

        assert_eq!(kit.storage_buckets, vec!["avatars", "attachments"]);
        assert_eq!(
            kit.add_storage_bucket("avatars"),
            Err(BackendKitError::DuplicateBucket("avatars".to_string()))
        );
        assert_eq!(
            kit.add_storage_bucket("avatars/2026"),
            Err(BackendKitError::InvalidIdentifier(
                "avatars/2026".to_string()
            ))
        );
    }

    #[test]
    fn add_function_stores_names_and_refuses_repeats() {
        let mut kit = kit();
        kit.add_function("send_welcome").expect("function accepted");
        assert_eq!(kit.functions, vec!["send_welcome"]);
        assert_eq!(
            kit.add_function("send_welcome"),
            Err(BackendKitError::DuplicateFunction(
                "send_welcome".to_string()
            ))
        );
        assert_eq!(
            kit.add_function(""),
            Err(BackendKitError::InvalidIdentifier(String::new()))
        );
    }

    #[test]
    fn export_generates_create_table_and_rls_statements() {
        let mut kit = kit();
        kit.add_table(posts()).expect("table accepted");
        kit.add_table(TableDef::new(
            "comments",
            vec![
                ColumnDef::new("id", "TEXT", false),
                ColumnDef::new("score", "numeric(10,2)", true),
            ],
        ))
        .expect("table accepted");
        kit.add_rls_policy(RlsPolicy::new(
            "posts",
            "posts_select_published",
            "published = true",
            RlsOperation::Select,
        ))
        .expect("policy accepted");
        kit.add_rls_policy(RlsPolicy::new(
            "posts",
            "posts_insert_own",
            "auth.uid() = owner_id",
            RlsOperation::Insert,
        ))
        .expect("policy accepted");
        kit.add_storage_bucket("avatars").expect("bucket accepted");
        kit.add_function("digest").expect("function accepted");

        let bundle = kit.export();
        let sql = &bundle.sql_dump;

        assert!(bundle.has_schema());
        assert!(sql.contains("-- backend: PocketBase"));
        assert!(sql.contains("-- project: My App"));
        assert!(sql.contains("-- storage buckets: avatars"));
        assert!(sql.contains("-- functions: digest"));

        assert!(sql.contains("CREATE TABLE IF NOT EXISTS \"posts\" (\n    \"id\" TEXT NOT NULL,\n    \"title\" TEXT NOT NULL,\n    \"body\" TEXT\n);"));
        assert!(sql.contains("\"score\" numeric(10,2)"));
        assert!(sql.contains("ALTER TABLE \"posts\" ENABLE ROW LEVEL SECURITY;"));
        assert!(sql.contains("CREATE POLICY \"posts_select_published\" ON \"posts\" FOR SELECT USING (published = true);"));
        assert!(sql.contains("CREATE POLICY \"posts_insert_own\" ON \"posts\" FOR INSERT WITH CHECK (auth.uid() = owner_id);"));

        // Every table comes before the first policy, and the comment tables do
        // not get an RLS statement of their own.
        let first_policy = sql.find("CREATE POLICY").expect("a policy is emitted");
        let last_table = sql.rfind("CREATE TABLE").expect("a table is emitted");
        assert!(last_table < first_policy);
        assert!(!sql.contains("ALTER TABLE \"comments\""));

        assert_eq!(
            bundle.storage_archive_path.as_deref(),
            Some("my-app-storage.tar.gz")
        );
        assert!(bundle.has_storage());
    }

    #[test]
    fn export_of_an_empty_kit_is_a_header_without_storage() {
        let bundle = kit().export();

        assert!(!bundle.has_schema());
        assert!(!bundle.has_storage());
        assert_eq!(bundle.storage_archive_path, None);
        assert!(bundle
            .sql_dump
            .starts_with("-- Warsha backend kit export\n"));
        assert!(bundle.sql_dump.contains("-- tables: 0"));
        assert!(bundle.sql_dump.contains("-- features: none"));
    }

    #[test]
    fn export_never_lets_a_project_name_end_the_comment() {
        let mut kit = BackendKit::new(BackendConfig::new(
            BackendKind::Supabase,
            "http://localhost:54321",
            "shop\nDROP TABLE users;",
        ));
        kit.add_table(posts()).expect("table accepted");

        let sql = kit.export().sql_dump;
        assert!(sql.contains("-- project: shop DROP TABLE users;"));
        assert!(!sql.contains("\nDROP TABLE users;"));
        // No buckets yet, so there is no archive to pack.
        assert!(kit.storage_archive_path().is_none());
        // The archive stem drops everything that is not a letter or a digit.
        kit.add_storage_bucket("files").expect("bucket accepted");
        assert_eq!(
            kit.storage_archive_path().as_deref(),
            Some("shop-drop-table-users-storage.tar.gz")
        );
    }

    #[test]
    fn payments_gate_requires_an_explicit_approval() {
        let gate = PaymentsGate::new();
        assert!(!gate.enabled);
        assert!(!gate.is_enabled());
        assert_eq!(gate.approved_by, None);
        assert_eq!(gate.approved_at, None);
        assert_eq!(gate.summary(), "disabled — owner approval required");

        let mut gate = PaymentsGate::new();
        assert_eq!(
            gate.enable("   ", 1_700_000_000),
            Err(BackendKitError::ApprovalRequired)
        );
        assert_eq!(
            gate.enable("owner", 0),
            Err(BackendKitError::InvalidApproval(
                "approved_at must be a real timestamp".to_string()
            ))
        );
        // A refused approval leaves the gate exactly as it was.
        assert!(!gate.enabled);
        assert!(!gate.is_enabled());

        // Flipping the public flag is not an approval.
        let flipped = PaymentsGate {
            enabled: true,
            approved_by: None,
            approved_at: None,
        };
        assert!(!flipped.is_enabled());
    }

    #[test]
    fn payments_gate_enable_records_the_owner_and_can_be_closed() {
        let mut gate = PaymentsGate::new();
        gate.enable("  owner  ", 1_700_000_000)
            .expect("an explicit approval opens the gate");

        assert!(gate.enabled);
        assert!(gate.is_enabled());
        assert_eq!(gate.approved_by.as_deref(), Some("owner"));
        assert_eq!(gate.approved_at, Some(1_700_000_000));
        assert_eq!(gate.summary(), "enabled by owner at 1700000000");

        assert_eq!(
            gate.enable("owner", 1_700_000_001),
            Err(BackendKitError::PaymentsAlreadyEnabled)
        );

        gate.disable();
        assert!(!gate.is_enabled());
        assert_eq!(gate.approved_by, None);
        assert_eq!(
            gate.summary(),
            "disabled — owner approval required".to_string()
        );
    }

    #[test]
    fn backend_kind_and_feature_serde_use_snake_case() {
        assert_eq!(
            serde_json::to_string(&BackendKind::PocketBase).expect("kind serializes"),
            "\"pocket_base\""
        );
        assert_eq!(
            serde_json::from_str::<BackendKind>("\"supabase\"").expect("kind parses"),
            BackendKind::Supabase
        );
        assert_eq!(
            serde_json::to_string(&BackendFeature::PostgresRls).expect("feature serializes"),
            "\"postgres_rls\""
        );
        assert_eq!(
            serde_json::from_str::<BackendFeature>("\"push\"").expect("feature parses"),
            BackendFeature::Push
        );
        assert_eq!(
            serde_json::to_string(&RlsOperation::All).expect("operation serializes"),
            "\"all\""
        );
        assert_eq!(BackendKind::all().len(), 2);
        assert_eq!(BackendKind::default(), BackendKind::PocketBase);
        assert_eq!(BackendKind::Supabase.as_str(), "supabase");
        assert_eq!(BackendKind::PocketBase.display_name(), "PocketBase");
        assert_eq!(RlsOperation::Delete.as_sql(), "DELETE");
        assert_eq!(RlsOperation::Update.as_str(), "update");
    }

    #[test]
    fn config_and_kit_round_trip_through_serde() {
        let mut kit = kit();
        kit.add_table(posts()).expect("table accepted");
        kit.add_rls_policy(RlsPolicy::new(
            "posts",
            "posts_all_own",
            "auth.uid() = owner_id",
            RlsOperation::All,
        ))
        .expect("policy accepted");
        kit.add_storage_bucket("avatars").expect("bucket accepted");
        kit.add_function("digest").expect("function accepted");

        let json = serde_json::to_string(&kit).expect("the kit serializes");
        let restored: BackendKit = serde_json::from_str(&json).expect("the kit parses");

        assert_eq!(restored, kit);
        assert_eq!(restored.config.kind, BackendKind::PocketBase);
        // `ALL` carries both a USING and a WITH CHECK clause.
        assert!(restored
            .export()
            .sql_dump
            .contains("FOR ALL USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);"));
    }

    #[test]
    fn identifier_and_type_screens_are_one_table() {
        assert!(is_safe_identifier("posts"));
        assert!(is_safe_identifier("_internal"));
        assert!(is_safe_identifier("posts_2026"));
        assert!(!is_safe_identifier(""));
        assert!(!is_safe_identifier("1posts"));
        assert!(!is_safe_identifier("posts users"));
        assert!(!is_safe_identifier("posts;"));

        assert!(is_safe_column_type("TEXT"));
        assert!(is_safe_column_type("timestamptz"));
        assert!(is_safe_column_type("numeric(10,2)"));
        assert!(is_safe_column_type("text[]"));
        assert!(!is_safe_column_type(""));
        assert!(!is_safe_column_type("TEXT;"));
        assert!(!is_safe_column_type("TEXT -- comment"));

        assert_eq!(slugify("My App"), "my-app");
        assert_eq!(slugify("  Shop  "), "shop");
        assert_eq!(slugify("!!!"), "");
        assert_eq!(comment_safe("a\nb\rc"), "a b c");
    }
}
