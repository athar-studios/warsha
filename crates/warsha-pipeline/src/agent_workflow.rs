//! Agent workflow and context — Plan/Agent modes, the todo tool, `ask_user`,
//! `send_message`, mentions, slash commands, context compaction and output
//! compression (PLAN.md M18, LingCode-inspired ideas only).
//!
//! This module is the *state and rules* layer an agent loop talks to. It owns no
//! model call, no RPC and no socket:
//!
//! - [`AgentMode`] / [`ModeManager`] — a run starts in **Plan** (read-only) and
//!   only reaches **Agent** (edits allowed) through an explicit owner approval.
//!   Going back to Plan is always allowed, which is the "one-click switch back"
//!   the badge offers.
//! - [`TodoList`] — the todo tool's store: what the agent said it would do.
//! - [`AskUserQueue`] — the `ask_user` tool: a blocking question parks the run
//!   until the owner answers it.
//! - [`MessageBus`] — the `send_message` tool: non-blocking progress notes
//!   between agents, with a read/unread flag so the UI can badge them.
//! - [`MentionParser`] — `@file`, `@folder`, `@codebase`, `@terminal`, `@web`,
//!   `@docs` in a prompt, resolved to [`Mention`] attachments. The parser is a
//!   hand-rolled scan: no regex dependency is added.
//! - [`SlashCommandRegistry`] — skills exposed as `/skill-name`, with the prefix
//!   filter the composer's autocomplete needs.
//! - [`ContextCompactor`] — three stages: recent messages verbatim, older ones
//!   replaced by a summary marker, and the oldest dropped when even that does not
//!   fit the budget.
//! - [`OutputCompressor`] — head/tail truncation for tool output, with the
//!   token savings the cost view reports.
//!
//! Everything here is plain data: the daemon may persist it, the desktop may
//! render it, and the tests drive it without a provider.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// How many characters one token is assumed to cover.
///
/// Token counting happens without a tokenizer: `warsha-pipeline` has no
/// tokenizer dependency and this milestone adds none, so every estimate here is
/// `characters / CHARS_PER_TOKEN`, which is what the cost view labels as an
/// *estimate*.
pub const CHARS_PER_TOKEN: usize = 4;

/// Errors raised by the agent workflow layer.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum AgentWorkflowError {
    /// The manager is already in the requested mode.
    #[error("mode `{mode}` is already active")]
    SameMode {
        /// The mode that is already active.
        mode: &'static str,
    },
    /// Plan → Agent was asked for without an approver.
    #[error("switching to `agent` mode needs the owner's approval")]
    ApprovalRequired,
    /// A todo with that id is already in the list.
    #[error("todo `{0}` already exists")]
    DuplicateTodo(String),
    /// No todo with that id is in the list.
    #[error("todo `{0}` not found")]
    TodoNotFound(String),
    /// The todo cannot be stored as given.
    #[error("invalid todo: {0}")]
    InvalidTodo(String),
    /// A question with that id is already queued.
    #[error("question `{0}` is already queued")]
    DuplicateQuestion(String),
    /// No question with that id is queued.
    #[error("question `{0}` not found")]
    QuestionNotFound(String),
    /// The question already carries an answer.
    #[error("question `{0}` was already answered")]
    AlreadyAnswered(String),
    /// The question cannot be queued as given.
    #[error("invalid question: {0}")]
    InvalidQuestion(String),
    /// A message with that id was already sent.
    #[error("message `{0}` was already sent")]
    DuplicateMessage(String),
    /// No message with that id was sent.
    #[error("message `{0}` not found")]
    MessageNotFound(String),
    /// The message cannot be sent as given.
    #[error("invalid message: {0}")]
    InvalidMessage(String),
    /// A command with that name is already registered.
    #[error("command `{0}` is already registered")]
    DuplicateCommand(String),
    /// The command name is not a slash command.
    #[error("invalid command: {0}")]
    InvalidCommand(String),
}

fn is_blank(value: &str) -> bool {
    value.trim().is_empty()
}

fn now_seconds() -> u64 {
    u64::try_from(Utc::now().timestamp()).unwrap_or(0)
}

/// Which side of the Plan/Agent line a run is on.
///
/// The default is [`AgentMode::Plan`]: a run starts read-only, and only the
/// owner's approval moves it to [`AgentMode::Agent`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AgentMode {
    /// Read-only planning: the agent proposes, it does not edit.
    #[default]
    Plan,
    /// The agent may edit files and run tools.
    Agent,
}

impl AgentMode {
    /// The mode as it appears in serde, in an event payload and in the UI.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Agent => "agent",
        }
    }

    /// Whether files may be edited in this mode.
    pub fn can_edit(&self) -> bool {
        matches!(self, Self::Agent)
    }
}

/// One recorded Plan ↔ Agent switch.
///
/// The record is the audit trail: a switch into Agent mode without a name in
/// [`ModeTransition::approved_by`] never happened (see
/// [`ModeManager::request_transition`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModeTransition {
    /// The mode the run was in.
    pub from: AgentMode,
    /// The mode it moved to.
    pub to: AgentMode,
    /// Who approved the switch — the owner's name or device id.
    pub approved_by: String,
    /// When it happened, in seconds since the Unix epoch.
    pub approved_at: u64,
}

impl ModeTransition {
    /// Whether the switch carries an approver.
    ///
    /// A transition Agent → Plan is allowed without one (switching to the
    /// read-only mode is never dangerous), so an empty field is legal there.
    pub fn is_owner_approved(&self) -> bool {
        !is_blank(&self.approved_by)
    }
}

/// Somewhere for the renderer to point at: a file, a folder, the codebase, the
/// terminal, a URL or the docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MentionKind {
    /// One file.
    File,
    /// One directory.
    Folder,
    /// The whole project, for a question that needs an overview.
    Codebase,
    /// The terminal's scrollback.
    Terminal,
    /// A URL.
    Web,
    /// The documentation set.
    Docs,
}

impl MentionKind {
    /// Every kind, in the order the picker lists them.
    pub const ALL: [Self; 6] = [
        Self::File,
        Self::Folder,
        Self::Codebase,
        Self::Terminal,
        Self::Web,
        Self::Docs,
    ];

    /// The kind as it appears in serde and in the UI.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Folder => "folder",
            Self::Codebase => "codebase",
            Self::Terminal => "terminal",
            Self::Web => "web",
            Self::Docs => "docs",
        }
    }

    /// The typed prefix, including the sign: `@file`.
    pub fn prefix(&self) -> String {
        format!("@{}", self.as_str())
    }

    /// Parse the word after `@`, case-insensitively.
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|kind| kind.as_str().eq_ignore_ascii_case(name.trim()))
    }
}

/// One `@kind target` occurrence in a prompt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mention {
    /// What the target is.
    pub kind: MentionKind,
    /// The resolved target — a path, a URL, or empty for a bare `@codebase`.
    pub target: String,
}

impl Mention {
    /// A mention of `target`.
    pub fn new(kind: MentionKind, target: impl Into<String>) -> Self {
        Self {
            kind,
            target: target.into(),
        }
    }

    /// The mention as the composer writes it: `@file src/main.rs` (a bare
    /// `@codebase` has no trailing space).
    pub fn rendered(&self) -> String {
        if self.target.is_empty() {
            self.kind.prefix()
        } else {
            format!("{} {}", self.kind.prefix(), self.target)
        }
    }
}

/// The mention scanner.
pub struct MentionParser;

impl MentionParser {
    /// Read every `@kind target` in `text`, in the order they appear.
    ///
    /// Rules, all test-covered:
    ///
    /// - the kind is one of [`MentionKind::ALL`], case-insensitive;
    /// - `@file:src/a.rs` and `@file src/a.rs` are the same mention;
    /// - the target is one whitespace-delimited token, so a path with a space in
    ///   it is not supported (quote the path or mention the folder);
    /// - trailing punctuation (`,`, `.`, `)`, a closing backtick, …) is trimmed;
    /// - a bare `@codebase` means the whole codebase and gets an empty target;
    /// - the `@` must start a token, so `dev@example.com` is an address;
    /// - an unknown kind (`@foo`) and a kind with no target (`@file` at the end
    ///   of a line) are ignored rather than treated as errors;
    /// - the same kind and target twice is one attachment, not two.
    pub fn parse(text: &str) -> Vec<Mention> {
        let chars: Vec<char> = text.chars().collect();
        let mut mentions: Vec<Mention> = Vec::new();
        let mut index = 0;

        while index < chars.len() {
            if chars[index] != '@' {
                index += 1;
                continue;
            }

            // `dev@example.com` is an address: a mention's `@` begins a token.
            if index > 0 && chars[index - 1].is_alphanumeric() {
                index += 1;
                continue;
            }

            let word_start = index + 1;
            let mut cursor = word_start;
            while cursor < chars.len() && chars[cursor].is_ascii_alphabetic() {
                cursor += 1;
            }
            let word: String = chars[word_start..cursor].iter().collect();

            let Some(kind) = MentionKind::from_name(&word) else {
                index = cursor;
                continue;
            };

            // `@file:src/a.rs` and `@file src/a.rs`.
            if cursor < chars.len() && chars[cursor] == ':' {
                cursor += 1;
            }
            while cursor < chars.len() && (chars[cursor] == ' ' || chars[cursor] == '\t') {
                cursor += 1;
            }

            let target_start = cursor;
            while cursor < chars.len() && !chars[cursor].is_whitespace() && chars[cursor] != '@' {
                cursor += 1;
            }
            let raw: String = chars[target_start..cursor].iter().collect();
            let target = raw
                .trim_end_matches(|c: char| {
                    matches!(
                        c,
                        '.' | ',' | ';' | ':' | ')' | ']' | '}' | '>' | '"' | '\'' | '`'
                    )
                })
                .to_string();

            if target.is_empty() {
                // `@codebase` on its own is the whole codebase; every other kind
                // needs something to point at.
                if matches!(kind, MentionKind::Codebase) {
                    push_unique(&mut mentions, Mention::new(kind, ""));
                }
            } else {
                push_unique(&mut mentions, Mention::new(kind, target));
            }

            index = cursor;
        }

        mentions
    }
}

fn push_unique(mentions: &mut Vec<Mention>, mention: Mention) {
    let duplicate = mentions
        .iter()
        .any(|known| known.kind == mention.kind && known.target == mention.target);
    if !duplicate {
        mentions.push(mention);
    }
}

/// The Plan ↔ Agent state machine of one run.
///
/// A switch into Agent mode needs an approver; a switch back to Plan does not,
/// because returning to the read-only mode is always safe. Every accepted switch
/// is appended to [`ModeManager::history`], so the run's audit trail can be
/// replayed from the manager alone.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ModeManager {
    /// The mode the run is in now.
    pub current: AgentMode,
    /// Every accepted switch, oldest first.
    pub history: Vec<ModeTransition>,
}

impl ModeManager {
    /// A manager in Plan mode with no history.
    pub fn new() -> Self {
        Self::default()
    }

    /// Ask to move to `to`.
    ///
    /// - Plan → Agent needs a non-blank `approved_by`: the AC's "an explicit
    ///   approval", and the only thing standing between a proposal and an edit.
    /// - Agent → Plan is always allowed, with or without a name.
    /// - Asking for the mode the run is already in is [`AgentWorkflowError::SameMode`],
    ///   so the history stays a record of actual switches.
    pub fn request_transition(
        &mut self,
        to: AgentMode,
        approved_by: impl Into<String>,
    ) -> Result<ModeTransition, AgentWorkflowError> {
        if to == self.current {
            return Err(AgentWorkflowError::SameMode { mode: to.as_str() });
        }

        let approved_by = approved_by.into();
        if matches!(self.current, AgentMode::Plan) && approved_by.trim().is_empty() {
            return Err(AgentWorkflowError::ApprovalRequired);
        }

        let transition = ModeTransition {
            from: self.current,
            to,
            approved_by: approved_by.trim().to_string(),
            approved_at: now_seconds(),
        };

        self.current = to;
        self.history.push(transition.clone());
        Ok(transition)
    }

    /// The most recent switch, if any.
    pub fn last_transition(&self) -> Option<&ModeTransition> {
        self.history.last()
    }

    /// Whether the agent may edit files right now.
    pub fn can_edit(&self) -> bool {
        self.current.can_edit()
    }
}

/// Where a todo is in its own small flow.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    /// Announced, not started.
    #[default]
    Pending,
    /// Being worked on.
    InProgress,
    /// Finished.
    Done,
    /// Dropped on purpose — not the same as [`TodoStatus::Done`].
    Cancelled,
}

impl TodoStatus {
    /// The status as it appears in serde and in the UI.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::InProgress => "in_progress",
            Self::Done => "done",
            Self::Cancelled => "cancelled",
        }
    }

    /// Whether the item still needs work: pending or in progress.
    pub fn is_open(&self) -> bool {
        matches!(self, Self::Pending | Self::InProgress)
    }
}

/// One item of the todo tool.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TodoItem {
    /// Stable identifier within one list.
    pub id: String,
    /// What has to be done, in the agent's words.
    pub description: String,
    /// Where it is in its flow.
    pub status: TodoStatus,
}

impl TodoItem {
    /// A pending todo.
    pub fn new(id: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            description: description.into(),
            status: TodoStatus::Pending,
        }
    }

    /// The same todo in another status.
    pub fn with_status(mut self, status: TodoStatus) -> Self {
        self.status = status;
        self
    }
}

/// The todo tool's store, in the order the agent announced the items.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct TodoList {
    /// The items, oldest first.
    pub items: Vec<TodoItem>,
}

impl TodoList {
    /// An empty list.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add an item, rejecting a blank id or description and a duplicate id.
    pub fn add(&mut self, item: TodoItem) -> Result<(), AgentWorkflowError> {
        if is_blank(&item.id) {
            return Err(AgentWorkflowError::InvalidTodo("empty id".to_string()));
        }
        if is_blank(&item.description) {
            return Err(AgentWorkflowError::InvalidTodo(format!(
                "todo `{}` has no description",
                item.id
            )));
        }
        if self.get(&item.id).is_some() {
            return Err(AgentWorkflowError::DuplicateTodo(item.id));
        }
        self.items.push(item);
        Ok(())
    }

    /// Move an item to `status` and return it.
    pub fn update(
        &mut self,
        id: &str,
        status: TodoStatus,
    ) -> Result<&TodoItem, AgentWorkflowError> {
        let item = self
            .items
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| AgentWorkflowError::TodoNotFound(id.to_string()))?;
        item.status = status;
        Ok(item)
    }

    /// Remove an item and return it.
    pub fn remove(&mut self, id: &str) -> Result<TodoItem, AgentWorkflowError> {
        let index = self
            .items
            .iter()
            .position(|item| item.id == id)
            .ok_or_else(|| AgentWorkflowError::TodoNotFound(id.to_string()))?;
        Ok(self.items.remove(index))
    }

    /// Every item that still needs work, in list order.
    ///
    /// "Pending" is the run's pending work, so an in-progress item counts:
    /// [`TodoStatus::is_open`] is the one rule the UI and this method share.
    pub fn list_pending(&self) -> Vec<&TodoItem> {
        self.items
            .iter()
            .filter(|item| item.status.is_open())
            .collect()
    }

    /// One item by id.
    pub fn get(&self, id: &str) -> Option<&TodoItem> {
        self.items.iter().find(|item| item.id == id)
    }

    /// How many items the list holds.
    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// Whether the list is empty.
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Whether every item is closed (done or cancelled).
    pub fn is_complete(&self) -> bool {
        self.list_pending().is_empty()
    }
}

/// One `ask_user` question.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AskUserRequest {
    /// Stable identifier.
    pub id: String,
    /// What the agent asks the owner.
    pub question: String,
    /// Whether the run waits for the answer. A non-blocking question is a
    /// suggestion the agent can continue without.
    pub blocking: bool,
    /// The owner's answer, once given.
    pub answer: Option<String>,
}

impl AskUserRequest {
    /// An unanswered question.
    pub fn new(id: impl Into<String>, question: impl Into<String>, blocking: bool) -> Self {
        Self {
            id: id.into(),
            question: question.into(),
            blocking,
            answer: None,
        }
    }

    /// Whether the owner answered.
    pub fn is_answered(&self) -> bool {
        self.answer
            .as_deref()
            .map(|answer| !answer.trim().is_empty())
            .unwrap_or(false)
    }
}

/// The `ask_user` queue of one run.
///
/// The queue is the blocking contract: [`AskUserQueue::blocks_run`] is true
/// while any *blocking* question is unanswered, so the agent loop has one
/// question to ask before it continues.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct AskUserQueue {
    questions: Vec<AskUserRequest>,
}

impl AskUserQueue {
    /// An empty queue.
    pub fn new() -> Self {
        Self::default()
    }

    /// Queue a question, rejecting a blank question and a duplicate id.
    pub fn enqueue(&mut self, request: AskUserRequest) -> Result<(), AgentWorkflowError> {
        if is_blank(&request.id) {
            return Err(AgentWorkflowError::InvalidQuestion("empty id".to_string()));
        }
        if is_blank(&request.question) {
            return Err(AgentWorkflowError::InvalidQuestion(format!(
                "question `{}` is empty",
                request.id
            )));
        }
        if self.questions.iter().any(|known| known.id == request.id) {
            return Err(AgentWorkflowError::DuplicateQuestion(request.id));
        }
        self.questions.push(request);
        Ok(())
    }

    /// Answer a question and return it; answering twice is refused.
    pub fn answer(
        &mut self,
        id: &str,
        answer: impl Into<String>,
    ) -> Result<&AskUserRequest, AgentWorkflowError> {
        let answer = answer.into();
        let request = self
            .questions
            .iter_mut()
            .find(|request| request.id == id)
            .ok_or_else(|| AgentWorkflowError::QuestionNotFound(id.to_string()))?;
        if request.is_answered() {
            return Err(AgentWorkflowError::AlreadyAnswered(id.to_string()));
        }
        if is_blank(&answer) {
            return Err(AgentWorkflowError::InvalidQuestion(format!(
                "answer to `{id}` is empty"
            )));
        }
        request.answer = Some(answer);
        Ok(request)
    }

    /// Every unanswered question, in queue order.
    pub fn pending(&self) -> Vec<&AskUserRequest> {
        self.questions
            .iter()
            .filter(|request| !request.is_answered())
            .collect()
    }

    /// The first unanswered question that stops the run.
    pub fn blocking(&self) -> Option<&AskUserRequest> {
        self.pending().into_iter().find(|request| request.blocking)
    }

    /// Whether the run has to wait for the owner before it may continue.
    pub fn blocks_run(&self) -> bool {
        self.blocking().is_some()
    }

    /// How many questions were answered.
    pub fn answered_count(&self) -> usize {
        self.questions
            .iter()
            .filter(|request| request.is_answered())
            .count()
    }

    /// How many questions are queued.
    pub fn len(&self) -> usize {
        self.questions.len()
    }

    /// Whether no question is queued.
    pub fn is_empty(&self) -> bool {
        self.questions.is_empty()
    }
}

/// One `send_message` note: progress, never a blocking request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    /// Stable identifier.
    pub id: String,
    /// The sender — a role name or an agent id.
    pub from: String,
    /// The recipient.
    pub to: String,
    /// What was said.
    pub content: String,
    /// When it was sent, in seconds since the Unix epoch.
    pub sent_at: u64,
    /// Whether the recipient has read it.
    pub read: bool,
}

impl Message {
    /// An unread message sent now.
    pub fn new(
        id: impl Into<String>,
        from: impl Into<String>,
        to: impl Into<String>,
        content: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            from: from.into(),
            to: to.into(),
            content: content.into(),
            sent_at: now_seconds(),
            read: false,
        }
    }

    /// Override the send time, for a replay or a test.
    pub fn sent_at(mut self, sent_at: u64) -> Self {
        self.sent_at = sent_at;
        self
    }
}

/// The `send_message` bus of one run.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct MessageBus {
    messages: Vec<Message>,
}

impl MessageBus {
    /// An empty bus.
    pub fn new() -> Self {
        Self::default()
    }

    /// Send a message, rejecting a blank field and a duplicate id.
    pub fn send(&mut self, message: Message) -> Result<(), AgentWorkflowError> {
        if is_blank(&message.id) {
            return Err(AgentWorkflowError::InvalidMessage("empty id".to_string()));
        }
        if is_blank(&message.from) || is_blank(&message.to) {
            return Err(AgentWorkflowError::InvalidMessage(format!(
                "message `{}` needs a sender and a recipient",
                message.id
            )));
        }
        if is_blank(&message.content) {
            return Err(AgentWorkflowError::InvalidMessage(format!(
                "message `{}` is empty",
                message.id
            )));
        }
        if self.messages.iter().any(|known| known.id == message.id) {
            return Err(AgentWorkflowError::DuplicateMessage(message.id));
        }
        self.messages.push(message);
        Ok(())
    }

    /// Mark a message as read and return it; reading twice is harmless.
    pub fn read(&mut self, id: &str) -> Result<&Message, AgentWorkflowError> {
        let message = self
            .messages
            .iter_mut()
            .find(|message| message.id == id)
            .ok_or_else(|| AgentWorkflowError::MessageNotFound(id.to_string()))?;
        message.read = true;
        Ok(message)
    }

    /// How many messages nobody has read yet.
    pub fn unread_count(&self) -> usize {
        self.messages.iter().filter(|message| !message.read).count()
    }

    /// How many messages for `to` are still unread.
    pub fn unread_for(&self, to: &str) -> usize {
        self.messages
            .iter()
            .filter(|message| message.to == to && !message.read)
            .count()
    }

    /// Every message, oldest first.
    pub fn messages(&self) -> &[Message] {
        &self.messages
    }

    /// One message by id.
    pub fn get(&self, id: &str) -> Option<&Message> {
        self.messages.iter().find(|message| message.id == id)
    }

    /// How many messages were sent.
    pub fn len(&self) -> usize {
        self.messages.len()
    }

    /// Whether nothing was sent.
    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }
}

/// One skill, exposed to the composer as a slash command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlashCommand {
    /// The command as it is typed, with the leading `/`.
    pub name: String,
    /// One line the picker shows under the name.
    pub description: String,
}

impl SlashCommand {
    /// A command; the leading `/` is added if the caller left it out.
    pub fn new(name: impl Into<String>, description: impl Into<String>) -> Self {
        let name = name.into().trim().to_string();
        let name = if name.starts_with('/') {
            name
        } else {
            format!("/{name}")
        };
        Self {
            name,
            description: description.into().trim().to_string(),
        }
    }

    /// The name without its leading `/`, which is what a lookup compares.
    pub fn bare_name(&self) -> &str {
        self.name.trim_start_matches('/')
    }
}

/// The run's slash commands, backed by the skills the project installed.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SlashCommandRegistry {
    commands: Vec<SlashCommand>,
}

impl SlashCommandRegistry {
    /// An empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a command, rejecting a blank name, a blank description and a
    /// duplicate name (compared without the leading `/`, case-insensitively).
    pub fn register(&mut self, command: SlashCommand) -> Result<(), AgentWorkflowError> {
        if command.bare_name().is_empty() {
            return Err(AgentWorkflowError::InvalidCommand(
                "empty command name".to_string(),
            ));
        }
        if command.bare_name().contains(char::is_whitespace) {
            return Err(AgentWorkflowError::InvalidCommand(format!(
                "command `{}` contains whitespace",
                command.name
            )));
        }
        if is_blank(&command.description) {
            return Err(AgentWorkflowError::InvalidCommand(format!(
                "command `{}` has no description",
                command.name
            )));
        }
        if self.lookup(command.bare_name()).is_some() {
            return Err(AgentWorkflowError::DuplicateCommand(command.name));
        }
        self.commands.push(command);
        Ok(())
    }

    /// Find a command, with or without the leading `/`.
    pub fn lookup(&self, name: &str) -> Option<&SlashCommand> {
        let wanted = name.trim().trim_start_matches('/');
        self.commands
            .iter()
            .find(|command| command.bare_name().eq_ignore_ascii_case(wanted))
    }

    /// Every command, sorted by name so the picker's order is stable.
    pub fn list(&self) -> Vec<&SlashCommand> {
        let mut commands: Vec<&SlashCommand> = self.commands.iter().collect();
        commands.sort_by(|left, right| left.name.cmp(&right.name));
        commands
    }

    /// The commands whose name starts with `prefix` — the composer's
    /// autocomplete. An empty prefix lists everything.
    pub fn matching(&self, prefix: &str) -> Vec<&SlashCommand> {
        let wanted = prefix.trim().trim_start_matches('/').to_ascii_lowercase();
        self.list()
            .into_iter()
            .filter(|command| {
                command
                    .bare_name()
                    .to_ascii_lowercase()
                    .starts_with(&wanted)
            })
            .collect()
    }

    /// How many commands are registered.
    pub fn len(&self) -> usize {
        self.commands.len()
    }

    /// Whether no command is registered.
    pub fn is_empty(&self) -> bool {
        self.commands.is_empty()
    }
}

/// Three-stage context compaction: recent verbatim, older summarized, oldest
/// dropped.
///
/// The stages are the AC's wording, and the budget is what enforces them. There
/// is no provider call here — the "summary" is a marker naming how much older
/// context was folded away — so the cost of compaction is zero tokens and the
/// behaviour is deterministic and testable.
pub struct ContextCompactor;

impl ContextCompactor {
    /// Estimate the tokens `text` costs, at [`CHARS_PER_TOKEN`] characters per
    /// token. An estimate, as the name says: no tokenizer is involved.
    pub fn estimate_tokens(text: &str) -> usize {
        if text.is_empty() {
            return 0;
        }
        text.chars().count().div_ceil(CHARS_PER_TOKEN)
    }

    /// Compact `messages` into at most `budget_tokens` (estimated).
    ///
    /// - everything fits → the messages come back verbatim, in order;
    /// - it does not fit → the newest messages are kept verbatim until about
    ///   three quarters of the budget is used, and one summary marker stands in
    ///   for the rest;
    /// - even that is over budget → the summary is dropped, so the oldest
    ///   context is what goes first;
    /// - a single message is never split, so the newest one survives any budget,
    ///   including zero.
    pub fn compact(messages: &[String], budget_tokens: usize) -> Vec<String> {
        if messages.is_empty() {
            return Vec::new();
        }

        let total: usize = messages
            .iter()
            .map(|message| Self::estimate_tokens(message))
            .sum();
        if total <= budget_tokens {
            return messages.to_vec();
        }

        // Reserve a quarter of the budget for the summary line, so the marker
        // does not push the kept messages over the ceiling it is meant to keep.
        let keep_budget = budget_tokens - budget_tokens / 4;

        let mut kept: Vec<String> = Vec::new();
        let mut used = 0usize;
        for message in messages.iter().rev() {
            let cost = Self::estimate_tokens(message);
            if used + cost > keep_budget && !kept.is_empty() {
                break;
            }
            used += cost;
            kept.push(message.clone());
        }
        kept.reverse();

        let dropped = messages.len() - kept.len();
        if dropped == 0 {
            return kept;
        }

        let omitted_chars: usize = messages[..dropped]
            .iter()
            .map(|message| message.chars().count())
            .sum();
        let summary = format!(
            "[{dropped} earlier message(s) summarized, {omitted_chars} characters omitted]"
        );

        if used + Self::estimate_tokens(&summary) <= budget_tokens {
            kept.insert(0, summary);
        }

        kept
    }
}

/// What [`OutputCompressor::compress`] produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompressedOutput {
    /// The compressed text: head, an omission marker, tail.
    pub text: String,
    /// How many lines the input had.
    pub original_lines: usize,
    /// How many lines the output has.
    pub compressed_lines: usize,
    /// Estimated tokens saved, for the cost view.
    pub saved_tokens_estimate: usize,
}

impl CompressedOutput {
    /// Whether the text was cut at all.
    pub fn is_compressed(&self) -> bool {
        self.compressed_lines < self.original_lines
    }

    /// How many lines were dropped.
    pub fn saved_lines(&self) -> usize {
        self.original_lines.saturating_sub(self.compressed_lines)
    }
}

/// Head/tail truncation for tool output.
///
/// The first and last lines of a build log or a test run carry almost all of the
/// signal — what was attempted and what failed — so the middle is what goes. The
/// ceiling is a line count, not a byte count, because one very long line is one
/// useful fact.
pub struct OutputCompressor;

impl OutputCompressor {
    /// The marker that stands in for the lines that were cut.
    fn marker(omitted: usize) -> String {
        format!("[… {omitted} lines omitted …]")
    }

    /// Compress `output` to at most `max_lines` lines.
    ///
    /// - `output` already fits → returned unchanged, with no savings;
    /// - `max_lines` of 3 or more → `(max_lines - 1) / 2` head lines, the marker,
    ///   and the remaining tail lines, so the result is exactly `max_lines`;
    /// - `max_lines` of 1 or 2 → the leading lines only, because there is no room
    ///   for both a head, a tail and a marker;
    /// - `max_lines` of 0 → an empty text, with the whole input counted as saved.
    pub fn compress(output: &str, max_lines: usize) -> CompressedOutput {
        let lines: Vec<&str> = output.lines().collect();
        let original_lines = lines.len();
        let original_tokens = ContextCompactor::estimate_tokens(output);

        if original_lines <= max_lines {
            return CompressedOutput {
                text: output.to_string(),
                original_lines,
                compressed_lines: original_lines,
                saved_tokens_estimate: 0,
            };
        }

        if max_lines == 0 {
            return CompressedOutput {
                text: String::new(),
                original_lines,
                compressed_lines: 0,
                saved_tokens_estimate: original_tokens,
            };
        }

        let text = if max_lines <= 2 {
            lines[..max_lines].join("\n")
        } else {
            let head = (max_lines - 1) / 2;
            let tail = max_lines - 1 - head;
            let omitted = original_lines - head - tail;

            let mut parts: Vec<String> = Vec::with_capacity(max_lines);
            parts.extend(lines[..head].iter().map(|line| (*line).to_string()));
            parts.push(Self::marker(omitted));
            parts.extend(
                lines[original_lines - tail..]
                    .iter()
                    .map(|line| (*line).to_string()),
            );
            parts.join("\n")
        };

        let compressed_lines = text.lines().count();
        let saved_tokens_estimate =
            original_tokens.saturating_sub(ContextCompactor::estimate_tokens(&text));

        CompressedOutput {
            text,
            original_lines,
            compressed_lines,
            saved_tokens_estimate,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn messages(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn plan_to_agent_needs_an_approver() {
        let mut manager = ModeManager::new();
        assert_eq!(manager.current, AgentMode::Plan);

        let refused = manager.request_transition(AgentMode::Agent, "   ");

        assert_eq!(refused, Err(AgentWorkflowError::ApprovalRequired));
        assert_eq!(manager.current, AgentMode::Plan);
        assert!(manager.history.is_empty());
        assert!(!manager.can_edit());
    }

    #[test]
    fn plan_to_agent_records_the_approval() {
        let mut manager = ModeManager::new();

        let transition = manager
            .request_transition(AgentMode::Agent, " owner ")
            .expect("an approval should be accepted");

        assert_eq!(transition.from, AgentMode::Plan);
        assert_eq!(transition.to, AgentMode::Agent);
        assert_eq!(transition.approved_by, "owner");
        assert!(transition.is_owner_approved());
        assert!(transition.approved_at > 0);
        assert_eq!(manager.current, AgentMode::Agent);
        assert_eq!(manager.history.len(), 1);
        assert_eq!(manager.last_transition(), Some(&transition));
        assert!(manager.can_edit());
    }

    #[test]
    fn agent_to_plan_is_always_allowed() {
        let mut manager = ModeManager::new();
        manager
            .request_transition(AgentMode::Agent, "owner")
            .expect("an approval should be accepted");

        let back = manager
            .request_transition(AgentMode::Plan, "")
            .expect("switching back to plan needs no approval");

        assert_eq!(back.from, AgentMode::Agent);
        assert_eq!(back.to, AgentMode::Plan);
        assert!(!back.is_owner_approved());
        assert_eq!(manager.current, AgentMode::Plan);
        assert_eq!(manager.history.len(), 2);
    }

    #[test]
    fn same_mode_is_refused_and_keeps_the_history() {
        let mut manager = ModeManager::new();

        let refused = manager.request_transition(AgentMode::Plan, "owner");

        assert_eq!(refused, Err(AgentWorkflowError::SameMode { mode: "plan" }));
        assert!(manager.history.is_empty());
    }

    #[test]
    fn mode_and_transition_use_snake_case_on_the_wire() {
        assert_eq!(
            serde_json::to_value(AgentMode::Agent).expect("a mode serializes"),
            serde_json::json!("agent")
        );

        let transition = ModeTransition {
            from: AgentMode::Plan,
            to: AgentMode::Agent,
            approved_by: "owner".to_string(),
            approved_at: 42,
        };
        let wire = serde_json::to_value(&transition).expect("a transition serializes");
        assert_eq!(wire["from"], serde_json::json!("plan"));
        assert_eq!(wire["to"], serde_json::json!("agent"));
        assert_eq!(wire["approved_by"], serde_json::json!("owner"));
        assert_eq!(wire["approved_at"], serde_json::json!(42));
    }

    #[test]
    fn todos_add_update_remove_and_report_their_errors() {
        let mut list = TodoList::new();
        list.add(TodoItem::new("t1", "read the spec"))
            .expect("the first todo adds");
        assert_eq!(list.len(), 1);
        assert!(!list.is_empty());

        assert_eq!(
            list.add(TodoItem::new("t1", "again")),
            Err(AgentWorkflowError::DuplicateTodo("t1".to_string()))
        );
        assert_eq!(
            list.add(TodoItem::new("  ", "no id")),
            Err(AgentWorkflowError::InvalidTodo("empty id".to_string()))
        );
        assert!(matches!(
            list.add(TodoItem::new("t2", "  ")),
            Err(AgentWorkflowError::InvalidTodo(_))
        ));

        let updated = list
            .update("t1", TodoStatus::InProgress)
            .expect("an existing todo updates");
        assert_eq!(updated.status, TodoStatus::InProgress);

        let removed = list.remove("t1").expect("an existing todo removes");
        assert_eq!(removed.id, "t1");
        assert_eq!(
            list.remove("t1"),
            Err(AgentWorkflowError::TodoNotFound("t1".to_string()))
        );
        assert_eq!(
            list.update("missing", TodoStatus::Done),
            Err(AgentWorkflowError::TodoNotFound("missing".to_string()))
        );
        assert!(list.is_empty());
    }

    #[test]
    fn todo_list_pending_counts_open_items_only() {
        let mut list = TodoList::new();
        for (id, status) in [
            ("a", TodoStatus::Pending),
            ("b", TodoStatus::InProgress),
            ("c", TodoStatus::Done),
            ("d", TodoStatus::Cancelled),
        ] {
            list.add(TodoItem::new(id, "work").with_status(status))
                .expect("a fresh todo adds");
        }

        let pending: Vec<&str> = list
            .list_pending()
            .into_iter()
            .map(|item| item.id.as_str())
            .collect();
        assert_eq!(pending, vec!["a", "b"]);
        assert!(!list.is_complete());
        assert!(!TodoStatus::Cancelled.is_open());
        assert_eq!(TodoStatus::Pending.as_str(), "pending");
        assert_eq!(TodoStatus::InProgress.as_str(), "in_progress");
    }

    #[test]
    fn ask_user_answers_a_question_once() {
        let mut queue = AskUserQueue::new();
        queue
            .enqueue(AskUserRequest::new("q1", "which database?", true))
            .expect("the question queues");

        assert_eq!(queue.len(), 1);
        assert_eq!(queue.pending().len(), 1);
        assert_eq!(queue.answered_count(), 0);
        assert_eq!(
            queue.enqueue(AskUserRequest::new("q1", "again?", true)),
            Err(AgentWorkflowError::DuplicateQuestion("q1".to_string()))
        );

        let answered = queue
            .answer("q1", "SQLite")
            .expect("an unanswered question accepts an answer");
        assert_eq!(answered.answer.as_deref(), Some("SQLite"));
        assert!(answered.is_answered());
        assert_eq!(queue.pending().len(), 0);
        assert_eq!(queue.answered_count(), 1);

        assert_eq!(
            queue.answer("q1", "Postgres"),
            Err(AgentWorkflowError::AlreadyAnswered("q1".to_string()))
        );
        assert_eq!(
            queue.answer("q2", "nothing"),
            Err(AgentWorkflowError::QuestionNotFound("q2".to_string()))
        );
    }

    #[test]
    fn ask_user_blocks_the_run_only_for_a_blocking_question() {
        let mut queue = AskUserQueue::new();
        queue
            .enqueue(AskUserRequest::new("q1", "nice to know?", false))
            .expect("the question queues");
        assert!(!queue.blocks_run());
        assert!(queue.blocking().is_none());

        queue
            .enqueue(AskUserRequest::new("q2", "which database?", true))
            .expect("the question queues");
        assert!(queue.blocks_run());
        assert_eq!(
            queue.blocking().map(|request| request.id.as_str()),
            Some("q2")
        );

        queue
            .answer("q2", "SQLite")
            .expect("the blocking question accepts an answer");
        assert!(!queue.blocks_run());
    }

    #[test]
    fn ask_user_rejects_a_blank_question_or_answer() {
        let mut queue = AskUserQueue::new();
        assert!(matches!(
            queue.enqueue(AskUserRequest::new("", "which database?", true)),
            Err(AgentWorkflowError::InvalidQuestion(_))
        ));
        assert!(matches!(
            queue.enqueue(AskUserRequest::new("q1", " ", true)),
            Err(AgentWorkflowError::InvalidQuestion(_))
        ));

        queue
            .enqueue(AskUserRequest::new("q1", "which database?", true))
            .expect("the question queues");
        assert!(matches!(
            queue.answer("q1", "   "),
            Err(AgentWorkflowError::InvalidQuestion(_))
        ));
        assert_eq!(queue.pending().len(), 1);
    }

    #[test]
    fn message_bus_tracks_unread_messages() {
        let mut bus = MessageBus::new();
        bus.send(Message::new("m1", "coder", "reviewer", "PR is ready").sent_at(10))
            .expect("the first message sends");
        bus.send(Message::new("m2", "reviewer", "coder", "on it").sent_at(11))
            .expect("the second message sends");

        assert_eq!(bus.len(), 2);
        assert!(!bus.is_empty());
        assert_eq!(bus.unread_count(), 2);
        assert_eq!(bus.unread_for("coder"), 1);

        let read = bus.read("m1").expect("an existing message reads");
        assert!(read.read);
        assert_eq!(bus.unread_count(), 1);
        assert_eq!(bus.unread_for("reviewer"), 0);

        bus.read("m1").expect("reading twice is harmless");
        assert_eq!(bus.unread_count(), 1);
        assert_eq!(
            bus.read("m3"),
            Err(AgentWorkflowError::MessageNotFound("m3".to_string()))
        );
    }

    #[test]
    fn message_bus_rejects_an_incomplete_message() {
        let mut bus = MessageBus::new();
        assert!(matches!(
            bus.send(Message::new("", "coder", "reviewer", "hello")),
            Err(AgentWorkflowError::InvalidMessage(_))
        ));
        assert!(matches!(
            bus.send(Message::new("m1", "coder", " ", "hello")),
            Err(AgentWorkflowError::InvalidMessage(_))
        ));
        assert!(matches!(
            bus.send(Message::new("m1", "coder", "reviewer", "  ")),
            Err(AgentWorkflowError::InvalidMessage(_))
        ));

        bus.send(Message::new("m1", "coder", "reviewer", "hello"))
            .expect("a complete message sends");
        assert_eq!(
            bus.send(Message::new("m1", "coder", "reviewer", "again")),
            Err(AgentWorkflowError::DuplicateMessage("m1".to_string()))
        );
        assert_eq!(bus.messages().len(), 1);
        assert!(bus.get("m1").is_some());
    }

    #[test]
    fn mention_parser_reads_every_kind() {
        let text = "look at @file src/main.rs, then @folder apps/desktop, \
                    @codebase, @terminal cargo test, @web https://example.com/docs \
                    and @docs quickstart.md";

        let mentions = MentionParser::parse(text);

        assert_eq!(mentions.len(), 6);
        assert_eq!(mentions[0], Mention::new(MentionKind::File, "src/main.rs"));
        assert_eq!(
            mentions[1],
            Mention::new(MentionKind::Folder, "apps/desktop")
        );
        assert_eq!(mentions[2], Mention::new(MentionKind::Codebase, ""));
        assert_eq!(mentions[3], Mention::new(MentionKind::Terminal, "cargo"));
        assert_eq!(
            mentions[4],
            Mention::new(MentionKind::Web, "https://example.com/docs")
        );
        assert_eq!(
            mentions[5],
            Mention::new(MentionKind::Docs, "quickstart.md")
        );
        assert_eq!(mentions[0].rendered(), "@file src/main.rs");
        assert_eq!(mentions[2].rendered(), "@codebase");
    }

    #[test]
    fn mention_parser_ignores_addresses_unknown_kinds_and_bare_kinds() {
        let mentions = MentionParser::parse("mail dev@example.com, ask @nobody, see @file");

        assert!(mentions.is_empty());
    }

    #[test]
    fn mention_parser_accepts_the_colon_form_and_dedupes() {
        let mentions = MentionParser::parse("@file:src/a.rs and @FILE src/a.rs and @file src/b.rs");

        assert_eq!(
            mentions,
            vec![
                Mention::new(MentionKind::File, "src/a.rs"),
                Mention::new(MentionKind::File, "src/b.rs"),
            ]
        );
    }

    #[test]
    fn mention_kinds_round_trip_through_names_and_serde() {
        assert_eq!(MentionKind::ALL.len(), 6);
        for kind in MentionKind::ALL {
            assert_eq!(MentionKind::from_name(kind.as_str()), Some(kind));
            assert_eq!(kind.prefix(), format!("@{}", kind.as_str()));
            assert_eq!(
                serde_json::to_value(kind).expect("a kind serializes"),
                serde_json::json!(kind.as_str())
            );
        }
        assert_eq!(MentionKind::from_name("FILE"), Some(MentionKind::File));
        assert_eq!(MentionKind::from_name("nope"), None);
    }

    #[test]
    fn slash_commands_register_lookup_and_list_in_order() {
        let mut registry = SlashCommandRegistry::new();
        registry
            .register(SlashCommand::new("review", "Review the current diff"))
            .expect("the first command registers");
        registry
            .register(SlashCommand::new("/deploy", "Draft a release"))
            .expect("the second command registers");

        assert_eq!(registry.len(), 2);
        assert!(!registry.is_empty());
        assert_eq!(
            registry.lookup("/review").map(|c| c.name.as_str()),
            Some("/review")
        );
        assert_eq!(
            registry.lookup("review").map(|c| c.name.as_str()),
            Some("/review")
        );
        assert_eq!(
            registry.lookup("REVIEW").map(|c| c.name.as_str()),
            Some("/review")
        );
        assert!(registry.lookup("missing").is_none());

        let names: Vec<&str> = registry.list().iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["/deploy", "/review"]);
        assert_eq!(registry.list()[0].description, "Draft a release");
    }

    #[test]
    fn slash_commands_filter_for_autocomplete() {
        let mut registry = SlashCommandRegistry::new();
        for name in ["review", "refactor", "deploy"] {
            registry
                .register(SlashCommand::new(name, "does something"))
                .expect("the command registers");
        }

        let matching: Vec<&str> = registry
            .matching("re")
            .iter()
            .map(|command| command.name.as_str())
            .collect();
        assert_eq!(matching, vec!["/refactor", "/review"]);
        assert_eq!(registry.matching("/de").len(), 1);
        assert_eq!(registry.matching("").len(), 3);
        assert!(registry.matching("zzz").is_empty());
    }

    #[test]
    fn slash_commands_reject_bad_names_and_duplicates() {
        let mut registry = SlashCommandRegistry::new();
        assert!(matches!(
            registry.register(SlashCommand::new("/", "nothing")),
            Err(AgentWorkflowError::InvalidCommand(_))
        ));
        assert!(matches!(
            registry.register(SlashCommand::new("two words", "nope")),
            Err(AgentWorkflowError::InvalidCommand(_))
        ));
        assert!(matches!(
            registry.register(SlashCommand::new("review", "  ")),
            Err(AgentWorkflowError::InvalidCommand(_))
        ));

        registry
            .register(SlashCommand::new("review", "Review the current diff"))
            .expect("the command registers");
        assert_eq!(
            registry.register(SlashCommand::new("/REVIEW", "again")),
            Err(AgentWorkflowError::DuplicateCommand("/REVIEW".to_string()))
        );
    }

    #[test]
    fn compactor_keeps_everything_that_fits() {
        let input = messages(&["short one", "short two"]);

        assert_eq!(ContextCompactor::compact(&input, 1_000), input);
        assert!(ContextCompactor::compact(&[], 1_000).is_empty());
    }

    #[test]
    fn compactor_summarizes_the_older_messages() {
        let oldest = "a".repeat(200);
        let older = "b".repeat(200);
        let newest = "newest message".to_string();
        let input = vec![oldest, older, newest.clone()];

        // 50 + 50 + 4 estimated tokens against a 40 ceiling, so the two older
        // messages fold into the summary and the newest one stays verbatim.
        let compacted = ContextCompactor::compact(&input, 40);

        assert_eq!(compacted.len(), 2);
        assert_eq!(compacted.last(), Some(&newest));
        assert!(compacted[0].contains("2 earlier message(s) summarized"));
        assert!(compacted[0].contains("400 characters omitted"));
    }

    #[test]
    fn compactor_drops_the_summary_before_the_recent_messages() {
        let input = messages(&[
            "old context that is long enough to cost tokens",
            "recent message that also costs some tokens",
        ]);

        let compacted = ContextCompactor::compact(&input, 5);

        // The summary line cannot fit, so only the newest message stays.
        assert_eq!(compacted, vec![input[1].clone()]);
    }

    #[test]
    fn compactor_never_splits_the_newest_message() {
        let input = messages(&[
            "tiny",
            "a very long newest message that costs a lot of tokens",
        ]);

        let compacted = ContextCompactor::compact(&input, 0);

        assert_eq!(compacted, vec![input[1].clone()]);
    }

    #[test]
    fn token_estimate_is_chars_over_four() {
        assert_eq!(ContextCompactor::estimate_tokens(""), 0);
        assert_eq!(ContextCompactor::estimate_tokens("abc"), 1);
        assert_eq!(ContextCompactor::estimate_tokens("abcd"), 1);
        assert_eq!(ContextCompactor::estimate_tokens("abcde"), 2);
        assert_eq!(ContextCompactor::estimate_tokens("مرحبا"), 2);
    }

    #[test]
    fn compressor_keeps_output_that_already_fits() {
        let output = "line one\nline two";

        let compressed = OutputCompressor::compress(output, 10);

        assert_eq!(compressed.text, output);
        assert_eq!(compressed.original_lines, 2);
        assert_eq!(compressed.compressed_lines, 2);
        assert_eq!(compressed.saved_tokens_estimate, 0);
        assert!(!compressed.is_compressed());
        assert_eq!(compressed.saved_lines(), 0);
    }

    #[test]
    fn compressor_keeps_the_head_and_the_tail() {
        let output: String = (1..=100)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");

        let compressed = OutputCompressor::compress(&output, 10);

        assert_eq!(compressed.original_lines, 100);
        assert_eq!(compressed.compressed_lines, 10);
        assert_eq!(compressed.text.lines().count(), 10);
        assert!(compressed.text.starts_with("line 1\n"));
        assert!(compressed.text.ends_with("line 100"));
        assert!(compressed.text.contains("[… 91 lines omitted …]"));
        assert!(compressed.saved_tokens_estimate > 0);
        assert!(compressed.is_compressed());
        assert_eq!(compressed.saved_lines(), 90);
    }

    #[test]
    fn compressor_handles_tiny_and_zero_ceilings() {
        let output = "alpha\nbeta\ngamma\ndelta";

        let two = OutputCompressor::compress(output, 2);
        assert_eq!(two.text, "alpha\nbeta");
        assert_eq!(two.compressed_lines, 2);

        let zero = OutputCompressor::compress(output, 0);
        assert_eq!(zero.text, "");
        assert_eq!(zero.compressed_lines, 0);
        assert_eq!(zero.original_lines, 4);
        assert!(zero.saved_tokens_estimate > 0);
    }

    #[test]
    fn compressor_counts_lines_of_an_empty_output() {
        let compressed = OutputCompressor::compress("", 5);

        assert_eq!(compressed.text, "");
        assert_eq!(compressed.original_lines, 0);
        assert_eq!(compressed.compressed_lines, 0);
        assert_eq!(compressed.saved_tokens_estimate, 0);
    }
}
