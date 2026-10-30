//! The agent loop — one turn of the conversation, on top of
//! [`crate::agent_workflow`] (the M18 wiring PLAN.md records as missing).
//!
//! The loop is the caller M18's stores and rules were waiting for. One
//! [`AgentLoop::run_turn`] reads the owner's input and, in this order:
//!
//! 1. parses the `@kind target` mentions ([`MentionParser`]);
//! 2. resolves the slash command the input starts with against the skills the
//!    caller passes in ([`SlashCommandRegistry::from_skills`]);
//! 3. asks the [`ModeManager`] what may happen. **Plan** mode returns a plan and
//!    executes nothing; **Agent** mode returns a summary of the turn;
//! 4. records one todo for the turn;
//! 5. compacts the transcript to [`TURN_CONTEXT_BUDGET_TOKENS`].
//!
//! It owns no model call, no file write and no socket: the Agent-mode
//! "execution" is a mock summary, because this repository has no tool layer for
//! the loop to drive. What it does own is the order above and the approval rule —
//! [`AgentLoop::approve_agent_mode`] is the only way into Agent mode, and it is
//! [`ModeManager::request_transition`] underneath, so a blank approver still
//! leaves the run in Plan.

use serde::{Deserialize, Serialize};

use crate::agent_workflow::{
    AgentMode, AgentWorkflowError, AskUserQueue, ContextCompactor, Mention, MentionParser,
    MessageBus, ModeManager, ModeTransition, OutputCompressor, SlashCommand, SlashCommandRegistry,
    TodoItem, TodoList, TodoStatus,
};

/// The transcript budget a turn is compacted to, in estimated tokens.
///
/// Small on purpose: the loop keeps the last few turns verbatim and folds the
/// older ones into one summary marker, and a budget a test can reach in a handful
/// of turns is a budget that is actually exercised. [`ContextCompactor`] does the
/// work; nothing here counts real tokens.
pub const TURN_CONTEXT_BUDGET_TOKENS: usize = 512;

/// How much of the input a response line quotes.
const MAX_SUMMARY_CHARS: usize = 120;

/// One turn's answer: what the loop understood and what it did about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentTurnResult {
    /// The mode the turn ran in.
    pub mode: AgentMode,
    /// Every mention the input carried, in the order they appeared.
    pub mentions: Vec<Mention>,
    /// The skill the input asked for, when it named one the catalog has.
    pub command: Option<SlashCommand>,
    /// The plan (Plan mode) or the summary (Agent mode).
    pub response: String,
    /// The whole todo list after the turn, oldest first.
    pub todos: Vec<TodoItem>,
}

/// The turn runner.
///
/// The six tools the loop holds are public because they are its state, not its
/// internals: the daemon reads the queue and the bus for the run view, and the
/// mode manager is the audit trail of every approval. `context` stays private —
/// it is read through [`AgentLoop::context`] and only the compactor writes it.
///
/// No `Debug`/`Clone` derive: the two tool types it holds are stateless unit
/// structs without those traits, and nothing clones a loop — the daemon keeps one
/// behind a lock.
pub struct AgentLoop {
    /// Plan ↔ Agent state and the approval history.
    pub mode_manager: ModeManager,
    /// What the loop said it would do, one item per turn.
    pub todo_list: TodoList,
    /// The `ask_user` questions of this run.
    pub ask_queue: AskUserQueue,
    /// The `send_message` notes of this run.
    pub message_bus: MessageBus,
    /// The three-stage context compactor, held as the loop's tool.
    pub compactor: ContextCompactor,
    /// Head/tail compression for tool output, held as the loop's tool.
    pub compressor: OutputCompressor,
    /// The transcript the compactor works on, oldest first.
    context: Vec<String>,
}

impl AgentLoop {
    /// A loop in Plan mode with empty stores.
    pub fn new() -> Self {
        Self {
            mode_manager: ModeManager::new(),
            todo_list: TodoList::new(),
            ask_queue: AskUserQueue::new(),
            message_bus: MessageBus::new(),
            compactor: ContextCompactor,
            compressor: OutputCompressor,
            context: Vec::new(),
        }
    }

    /// The mode the loop is in.
    pub fn mode(&self) -> AgentMode {
        self.mode_manager.current
    }
    /// The todo list after the last turn.
    pub fn todos(&self) -> &[TodoItem] {
        &self.todo_list.items
    }

    /// The compacted transcript, oldest first.
    pub fn context(&self) -> &[String] {
        &self.context
    }

    /// Ask the mode manager for Agent mode, on the owner's behalf.
    ///
    /// The approval rule stays where M18 put it: a blank approver is
    /// [`AgentWorkflowError::ApprovalRequired`] and nothing changes, so the loop
    /// cannot approve itself.
    pub fn approve_agent_mode(
        &mut self,
        approved_by: &str,
    ) -> Result<ModeTransition, AgentWorkflowError> {
        self.mode_manager
            .request_transition(AgentMode::Agent, approved_by)
    }

    /// Switch back to Plan. Always allowed — the read-only direction is free.
    pub fn return_to_plan_mode(&mut self) -> Result<ModeTransition, AgentWorkflowError> {
        self.mode_manager.request_transition(AgentMode::Plan, "")
    }

    /// Run one turn of the conversation.
    ///
    /// `skills` is the catalog `skills.list` returns; an empty slice simply means
    /// no slash command resolves. Nothing is written and no model is called — the
    /// Agent-mode half is a summary of the turn, and the response says so.
    pub fn run_turn(&mut self, input: &str, skills: &[SlashCommand]) -> AgentTurnResult {
        let mentions = MentionParser::parse(input);
        let requested = requested_command(input);
        let command = requested.as_deref().and_then(|name| {
            SlashCommandRegistry::from_skills(skills)
                .lookup(name)
                .cloned()
        });
        let mode = self.mode_manager.current;

        let response = match mode {
            AgentMode::Plan => {
                self.plan_response(input, &mentions, command.as_ref(), requested.as_deref())
            }
            AgentMode::Agent => {
                self.execute_response(input, &mentions, command.as_ref(), requested.as_deref())
            }
        };

        // The transcript is the prompt and the answer of every turn so far, and
        // the compactor folds the oldest of them away once it passes the budget.
        self.context.push(format!("user: {}", input.trim()));
        self.context.push(format!("assistant: {response}"));
        self.context = ContextCompactor::compact(&self.context, TURN_CONTEXT_BUDGET_TOKENS);

        AgentTurnResult {
            mode,
            mentions,
            command,
            response,
            todos: self.todo_list.items.clone(),
        }
    }

    /// The Plan-mode answer: what the loop would do, with no execution.
    fn plan_response(
        &mut self,
        input: &str,
        mentions: &[Mention],
        command: Option<&SlashCommand>,
        requested: Option<&str>,
    ) -> String {
        let todo = self.record_todo(
            format!("plan the turn: {}", first_line(input)),
            TodoStatus::Pending,
        );

        [
            format!("Plan (nothing executed): {}", first_line(input)),
            format!("- mentions: {}", mention_summary(mentions)),
            format!("- command: {}", command_summary(command, requested)),
            format!(
                "- todo: {}",
                todo_line(todo.as_deref(), "recorded as pending")
            ),
            "- approval: the owner has to approve Agent mode before anything is edited".to_string(),
        ]
        .join("\n")
    }

    /// The Agent-mode answer: a mock execution summary, one line per fact.
    fn execute_response(
        &mut self,
        input: &str,
        mentions: &[Mention],
        command: Option<&SlashCommand>,
        requested: Option<&str>,
    ) -> String {
        let todo = self.record_todo(
            format!("execute the turn: {}", first_line(input)),
            TodoStatus::Done,
        );

        [
            format!("Summary (mock execution): {}", first_line(input)),
            format!("- mentions: {}", mention_summary(mentions)),
            format!("- command: {}", command_summary(command, requested)),
            format!("- todo: {}", todo_line(todo.as_deref(), "done")),
            "- execution: mock — no file was read, no tool ran and no model was called".to_string(),
        ]
        .join("\n")
    }

    /// Record the turn's todo and return its id.
    ///
    /// The id is the next free number, so the store's duplicate check cannot fire
    /// here; if a future caller removes todos and it does, the response says the
    /// todo was not recorded instead of failing a turn over bookkeeping.
    fn record_todo(&mut self, description: String, status: TodoStatus) -> Option<String> {
        let id = format!("turn-{}", self.todo_list.len() + 1);
        let item = TodoItem::new(id.clone(), description).with_status(status);
        self.todo_list.add(item).ok().map(|()| id)
    }
}

impl Default for AgentLoop {
    /// Hand-written rather than derived: the two tool types the loop holds are
    /// stateless unit structs with no `Default` of their own.
    fn default() -> Self {
        Self::new()
    }
}

/// The command the input names: its first token, when that token starts with `/`.
///
/// `/review the diff` asks for `/review`; `please /review` asks for nothing,
/// because a command is how a turn starts. A trailing `,`, `.`, `:` or `;` is
/// trimmed, the same way the mention parser trims punctuation.
fn requested_command(input: &str) -> Option<String> {
    let token = input.split_whitespace().next()?;
    if !token.starts_with('/') {
        return None;
    }
    let name = token
        .trim_start_matches('/')
        .trim_end_matches([',', '.', ':', ';']);
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// `none`, or `2 (@file src/main.rs, @codebase)`.
fn mention_summary(mentions: &[Mention]) -> String {
    if mentions.is_empty() {
        return "none".to_string();
    }
    let rendered: Vec<String> = mentions.iter().map(Mention::rendered).collect();
    format!("{} ({})", mentions.len(), rendered.join(", "))
}

/// The resolved command, the unknown one the input asked for, or `none`.
fn command_summary(command: Option<&SlashCommand>, requested: Option<&str>) -> String {
    match command {
        Some(command) => format!("{} — {}", command.name, command.description),
        None => match requested {
            Some(name) => format!("/{name} — unknown command, ignored"),
            None => "none".to_string(),
        },
    }
}

/// `turn-1 recorded as pending`, or the honest alternative.
fn todo_line(id: Option<&str>, recorded_as: &str) -> String {
    match id {
        Some(id) => format!("{id} {recorded_as}"),
        None => "not recorded".to_string(),
    }
}

/// The first line of the input, trimmed and capped, for a one-line answer.
fn first_line(input: &str) -> String {
    let line = input.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        return "(empty input)".to_string();
    }
    if line.chars().count() > MAX_SUMMARY_CHARS {
        let mut capped: String = line.chars().take(MAX_SUMMARY_CHARS).collect();
        capped.push('…');
        capped
    } else {
        line.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_workflow::MentionKind;

    /// The catalog `skills.list` reports, in the daemon's order.
    fn catalog() -> Vec<SlashCommand> {
        vec![
            SlashCommand::new("review", "Review the current diff"),
            SlashCommand::new("refactor", "Restructure without changing behaviour"),
            SlashCommand::new("test", "Write or run the tests"),
            SlashCommand::new("fix", "Repair the failing check"),
            SlashCommand::new("explain", "Explain what a file does"),
        ]
    }

    fn approved_loop() -> AgentLoop {
        let mut agent_loop = AgentLoop::new();
        agent_loop
            .approve_agent_mode("owner")
            .expect("an approval is accepted");
        agent_loop
    }

    #[test]
    fn a_new_loop_starts_in_plan_mode_with_empty_stores() {
        let agent_loop = AgentLoop::new();

        assert_eq!(agent_loop.mode(), AgentMode::Plan);
        assert!(agent_loop.todos().is_empty());
        assert!(agent_loop.context().is_empty());
        assert!(agent_loop.mode_manager.history.is_empty());
        assert!(agent_loop.ask_queue.is_empty());
        assert!(agent_loop.message_bus.is_empty());
    }

    #[test]
    fn plan_mode_returns_a_plan_and_executes_nothing() {
        let mut agent_loop = AgentLoop::new();

        let turn = agent_loop.run_turn("add a dark mode toggle", &catalog());

        assert_eq!(turn.mode, AgentMode::Plan);
        assert!(turn.response.starts_with("Plan (nothing executed):"));
        assert!(turn.response.contains("add a dark mode toggle"));
        assert!(turn.response.contains("approve Agent mode"));
        // One pending todo: the plan announced work, nothing was completed.
        assert_eq!(turn.todos.len(), 1);
        assert_eq!(turn.todos[0].status, TodoStatus::Pending);
        assert_eq!(turn.todos[0].id, "turn-1");
        assert!(!agent_loop.mode_manager.can_edit());
    }

    #[test]
    fn agent_mode_returns_an_execution_summary() {
        let mut agent_loop = approved_loop();

        let turn = agent_loop.run_turn("add a dark mode toggle", &catalog());

        assert_eq!(turn.mode, AgentMode::Agent);
        assert!(turn.response.starts_with("Summary (mock execution):"));
        assert!(turn.response.contains("no file was read"));
        assert_eq!(turn.todos.len(), 1);
        assert_eq!(turn.todos[0].status, TodoStatus::Done);
        assert!(agent_loop.mode_manager.can_edit());
    }

    #[test]
    fn mentions_are_parsed_from_the_input() {
        let mut agent_loop = AgentLoop::new();

        let turn = agent_loop.run_turn(
            "compare @file src/main.rs with @folder src and @codebase",
            &catalog(),
        );

        assert_eq!(turn.mentions.len(), 3);
        assert_eq!(
            turn.mentions[0],
            Mention::new(MentionKind::File, "src/main.rs")
        );
        assert_eq!(turn.mentions[1], Mention::new(MentionKind::Folder, "src"));
        assert_eq!(turn.mentions[2], Mention::new(MentionKind::Codebase, ""));
        // The response repeats them, so a reader sees what was attached.
        assert!(turn.response.contains("3 (@file src/main.rs"));
        assert!(turn.response.contains("@codebase"));
    }

    #[test]
    fn a_known_slash_command_is_detected() {
        let mut agent_loop = AgentLoop::new();

        let turn = agent_loop.run_turn("/review the last commit", &catalog());

        let command = turn.command.expect("a catalogued command resolves");
        assert_eq!(command.name, "/review");
        assert_eq!(command.description, "Review the current diff");
        assert!(turn.response.contains("/review — Review the current diff"));
    }

    #[test]
    fn an_unknown_slash_command_is_none_and_says_so() {
        let mut agent_loop = AgentLoop::new();

        let turn = agent_loop.run_turn("/deploy everything", &catalog());

        assert_eq!(turn.command, None);
        assert!(turn.response.contains("/deploy — unknown command, ignored"));
        // A command that is not at the start of the turn is not a command.
        let later = agent_loop.run_turn("please /review this", &catalog());
        assert_eq!(later.command, None);
        assert!(!later.response.contains("unknown command"));
        // No catalog means no command, whatever the input says.
        let empty = agent_loop.run_turn("/review", &[]);
        assert_eq!(empty.command, None);
    }

    #[test]
    fn the_context_is_compacted_when_it_passes_the_budget() {
        let mut agent_loop = AgentLoop::new();
        let long_input = "walk the whole codebase and list every module ".repeat(4);

        for _ in 0..8 {
            agent_loop.run_turn(&long_input, &catalog());
        }

        // Eight turns cost two entries each; the compactor folds the oldest into
        // one marker rather than letting the transcript grow without bound.
        let context = agent_loop.context();
        assert!(context.len() < 16, "unexpected context: {context:?}");
        assert!(
            context[0].contains("earlier message(s) summarized"),
            "unexpected context: {context:?}"
        );
        // The newest turn is still verbatim.
        assert!(context
            .last()
            .is_some_and(|message| message.starts_with("assistant: Plan")));
    }

    #[test]
    fn the_todo_list_records_one_item_per_turn() {
        let mut agent_loop = AgentLoop::new();

        agent_loop.run_turn("first request", &catalog());
        let second = agent_loop.run_turn("second request", &catalog());

        assert_eq!(second.todos.len(), 2);
        assert_eq!(second.todos[0].id, "turn-1");
        assert_eq!(second.todos[1].id, "turn-2");
        assert_eq!(second.todos[1].description, "plan the turn: second request");
        assert_eq!(agent_loop.todos().len(), 2);
    }

    #[test]
    fn agent_mode_needs_an_owner_approval() {
        let mut agent_loop = AgentLoop::new();

        let refused = agent_loop.approve_agent_mode("   ");

        assert_eq!(refused, Err(AgentWorkflowError::ApprovalRequired));
        assert_eq!(agent_loop.mode(), AgentMode::Plan);
        assert!(agent_loop.mode_manager.history.is_empty());

        agent_loop
            .approve_agent_mode("owner")
            .expect("an approval is accepted");
        assert_eq!(agent_loop.mode(), AgentMode::Agent);
        agent_loop
            .return_to_plan_mode()
            .expect("switching back to plan is allowed");
        assert_eq!(agent_loop.mode(), AgentMode::Plan);
        assert_eq!(agent_loop.mode_manager.history.len(), 2);
    }

    #[test]
    fn the_loop_owns_the_ask_user_queue_and_the_message_bus() {
        use crate::agent_workflow::{AskUserRequest, Message};

        let mut agent_loop = AgentLoop::new();
        agent_loop
            .ask_queue
            .enqueue(AskUserRequest::new("q1", "which database?", true))
            .expect("the question queues");
        assert!(agent_loop.ask_queue.blocks_run());

        agent_loop
            .ask_queue
            .answer("q1", "SQLite")
            .expect("an unanswered question accepts an answer");
        assert!(!agent_loop.ask_queue.blocks_run());

        agent_loop
            .message_bus
            .send(Message::new("m1", "coder", "reviewer", "PR is ready"))
            .expect("the note sends");
        assert_eq!(agent_loop.message_bus.unread_for("reviewer"), 1);
    }

    #[test]
    fn a_turn_result_uses_snake_case_on_the_wire() {
        let mut agent_loop = approved_loop();

        // The command has to start the turn, so the mention follows it here.
        let turn = agent_loop.run_turn("/fix the build for @file src/lib.rs", &catalog());
        let wire = serde_json::to_value(&turn).expect("a turn result serializes");

        assert_eq!(wire["mode"], serde_json::json!("agent"));
        assert_eq!(wire["mentions"][0]["kind"], serde_json::json!("file"));
        assert_eq!(
            wire["mentions"][0]["target"],
            serde_json::json!("src/lib.rs")
        );
        assert_eq!(wire["command"]["name"], serde_json::json!("/fix"));
        assert_eq!(wire["todos"][0]["status"], serde_json::json!("done"));
        assert!(wire["response"].is_string());
    }

    #[test]
    fn an_empty_input_still_produces_a_turn() {
        let mut agent_loop = AgentLoop::new();

        let turn = agent_loop.run_turn("   \n  ", &catalog());

        assert!(turn.mentions.is_empty());
        assert_eq!(turn.command, None);
        assert!(turn.response.contains("(empty input)"));
        assert_eq!(turn.todos.len(), 1);
    }
}
