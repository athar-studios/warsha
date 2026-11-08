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
//!    executes nothing; **Agent** mode runs the turn;
//! 4. records one todo for the turn;
//! 5. compacts the transcript to [`TURN_CONTEXT_BUDGET_TOKENS`].
//!
//! Agent mode does two things, in this order:
//!
//! - a turn that *is* a tool request (`read file <path>`, `write file
//!   <path>: <content>`, `run command <program> [args…]`) is executed through the
//!   loop's [`ToolExecutor`], and the result is recorded in the response and in
//!   [`AgentTurnResult::tools`];
//! - any other turn is sent to the loop's [`Router`] — the model call, which the
//!   daemon wires to its real [`ProviderRouter`] through
//!   [`ProviderRouterAdapter`] — and its answer is the response.
//!
//! Both are seams, and the response says which one answered: a loop with no
//! router returns a summary that says no model is wired, and a loop with no
//! executor reports that the tool did not run. Nothing here calls a model or
//! touches a file itself. The one rule that stays absolute is the M18 approval
//! rule — [`AgentLoop::approve_agent_mode`] is the only way into Agent mode, and
//! it is [`ModeManager::request_transition`] underneath, so a blank approver
//! still leaves the run in Plan.

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use warsha_core::Role;
use warsha_providers::{ChatMessage, ChatRequest, MessageRole, ProviderError, ProviderRouter};

use crate::agent_tools::{AgentTool, NoToolExecutor, ToolExecutor, ToolResult};
use crate::agent_workflow::{
    AgentMode, AgentWorkflowError, AskUserQueue, CompressedOutput, ContextCompactor, Mention,
    MentionKind, MentionParser, MessageBus, ModeManager, ModeTransition, OutputCompressor,
    SlashCommand, SlashCommandRegistry, TodoItem, TodoList, TodoStatus,
};
use crate::backend_kit::BackendKit;
use crate::mcp_transport::{McpManager, McpTransportError};

/// The transcript budget a turn is compacted to, in estimated tokens.
///
/// Small on purpose: the loop keeps the last few turns verbatim and folds the
/// older ones into one summary marker, and a budget a test can reach in a handful
/// of turns is a budget that is actually exercised. [`ContextCompactor`] does the
/// work; nothing here counts real tokens.
pub const TURN_CONTEXT_BUDGET_TOKENS: usize = 512;

/// How much of the input a response line quotes.
const MAX_SUMMARY_CHARS: usize = 120;

/// How many lines of a tool's output a response quotes.
///
/// The loop's own [`OutputCompressor`] does the folding, head and tail with an
/// omission marker, so a 5,000-line build log costs a response a dozen lines.
const MAX_TOOL_OUTPUT_LINES: usize = 12;

/// How many lines of the model's answer a response quotes.
const MAX_MODEL_REPLY_LINES: usize = 12;

/// The role the owner-facing conversation is routed as.
///
/// `warsha-core` has no separate orchestrator role: the twelve are the pipeline's
/// stages, and `Intake` is the one whose prompt is the owner's first conversation
/// (`prompts/intake.md`), which is what an agent turn is.
pub const AGENT_ROLE: Role = Role::Intake;

/// The temperature the agent turn asks the model for.
const AGENT_TEMPERATURE: f32 = 0.2;

/// The answer length ceiling the agent turn asks the model for.
const AGENT_MAX_TOKENS: u32 = 1024;

/// The instruction the router hands the model ahead of the turn.
///
/// One line, and deliberately modest: the role prompts in `prompts/` belong to the
/// pipeline stages, and an agent turn is the owner's own conversation. What it does
/// say is the one thing this loop can prove — nothing has run unless a tool ran.
const AGENT_INSTRUCTION: &str =
    "You are Warsha's agent. Answer the owner's request. Do not claim work you did not do.";

/// Why no model answered the turn.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum RouterError {
    /// No provider is routed for [`AGENT_ROLE`], so there is nothing to ask.
    #[error("no provider is routed for the agent role: {0}")]
    NoRoute(String),
    /// The provider was reached and the call failed.
    #[error("the provider call failed: {0}")]
    Failed(String),
}

impl From<ProviderError> for RouterError {
    fn from(error: ProviderError) -> Self {
        match error {
            ProviderError::NotFound(message) | ProviderError::ModelNotFound(message) => {
                RouterError::NoRoute(message)
            }
            other => RouterError::Failed(other.to_string()),
        }
    }
}

/// The model call an Agent-mode turn makes when it is not a tool request.
///
/// A seam, not a client: the loop never learns what a provider is. The daemon
/// implements it with [`ProviderRouterAdapter`], and a unit test implements it with
/// whatever answer it needs to pin.
#[async_trait]
pub trait Router: Send + Sync {
    /// Answer `prompt`, or say why no model answered.
    async fn complete(&self, prompt: &str) -> Result<String, RouterError>;
}

/// The [`Router`] over the daemon's real [`ProviderRouter`].
///
/// It is the whole model path an agent turn has: the prompt goes out as one user
/// message through [`ProviderRouter::chat_with_fallback`], so the router's own
/// role routing, fallback and cost meter apply exactly as they do to a pipeline
/// stage. `project_id` is the budget meter's key, not a project — an agent turn
/// has no run, so the daemon passes one stable key and the spend lands there.
pub struct ProviderRouterAdapter {
    providers: Arc<RwLock<ProviderRouter>>,
    role: Role,
    project_id: String,
}

impl ProviderRouterAdapter {
    /// An adapter that routes `role`'s turns through `providers`, metered against
    /// `project_id`.
    pub fn new(
        providers: Arc<RwLock<ProviderRouter>>,
        role: Role,
        project_id: impl Into<String>,
    ) -> Self {
        Self {
            providers,
            role,
            project_id: project_id.into(),
        }
    }

    /// The role this adapter routes as.
    pub fn role(&self) -> Role {
        self.role
    }

    /// The budget meter key its calls are recorded under.
    pub fn project_id(&self) -> &str {
        &self.project_id
    }
}

#[async_trait]
impl Router for ProviderRouterAdapter {
    async fn complete(&self, prompt: &str) -> Result<String, RouterError> {
        let request = ChatRequest {
            // The router replaces this with the target's model id.
            model: String::new(),
            messages: vec![ChatMessage {
                role: MessageRole::User,
                content: prompt.to_string(),
            }],
            temperature: Some(AGENT_TEMPERATURE),
            max_tokens: Some(AGENT_MAX_TOKENS),
            stream: false,
        };

        // A handle to the router, not a lock held through the call (audit N-3): the
        // adapter's turn is exactly the path where a retry sleep used to sit in front of
        // every other `providers.*` request and every other agent turn. The spend ledger,
        // the routing and the paid-call semaphore are shared with the router the daemon
        // holds, so an agent turn is metered and bounded like a pipeline stage.
        let providers = {
            let router = self.providers.read().await;
            (*router).clone()
        };
        let response = providers
            .chat_with_fallback(self.role, &self.project_id, request)
            .await?;
        let answer = response
            .choices
            .first()
            .map(|choice| choice.message.content.trim().to_string())
            .unwrap_or_default();
        if answer.is_empty() {
            return Err(RouterError::Failed(
                "the provider answered with an empty message".to_string(),
            ));
        }
        Ok(answer)
    }
}

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
    /// Every tool the turn ran, in the order it ran them.
    ///
    /// Empty for a Plan-mode turn and for an Agent-mode turn that only talked to
    /// the model; one entry for a turn that was a tool request.
    pub tools: Vec<ToolResult>,
}

/// The turn runner.
///
/// The six M18 tools the loop holds are public because they are its state, not its
/// internals: the daemon reads the queue and the bus for the run view, and the mode
/// manager is the audit trail of every approval. `context` stays private — it is
/// read through [`AgentLoop::context`] and only the compactor writes it.
///
/// The two layers an Agent-mode turn drives are public for the same reason:
/// `tool_executor` is the file and command layer, and `router` is the model call.
///
/// No `Debug`/`Clone` derive: the tool types it holds are unit structs without
/// those traits, a `Box<dyn ToolExecutor>` is neither, and nothing clones a loop —
/// the daemon keeps one behind a lock.
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
    /// The file and command layer an Agent-mode tool request runs through.
    pub tool_executor: Box<dyn ToolExecutor>,
    /// The model call an Agent-mode turn makes. `None` means the response says so.
    pub router: Option<Arc<dyn Router>>,
    /// The MCP manager handling tool calls.
    pub mcp_manager: Option<Arc<dyn McpManager>>,
    /// The backend kit updated on backend tool mutations.
    pub backend_kit: Option<Arc<RwLock<BackendKit>>>,
    /// The transcript the compactor works on, oldest first.
    context: Vec<String>,
}

impl AgentLoop {
    /// A loop in Plan mode with empty stores and no tool layer or router wired.
    ///
    /// [`NoToolExecutor`] refuses every tool and a `None` router says no model is
    /// attached, so this loop runs a turn and reports honestly that nothing
    /// executed: it is the shape a test and a fresh daemon both start from.
    pub fn new() -> Self {
        Self::with_tool_executor(Box::new(NoToolExecutor))
    }

    /// A loop whose tool requests run through `tool_executor`, still with no router.
    ///
    /// [`AgentLoop::with_router`] adds the model call.
    pub fn with_tool_executor(tool_executor: Box<dyn ToolExecutor>) -> Self {
        Self {
            mode_manager: ModeManager::new(),
            todo_list: TodoList::new(),
            ask_queue: AskUserQueue::new(),
            message_bus: MessageBus::new(),
            compactor: ContextCompactor,
            compressor: OutputCompressor,
            tool_executor,
            router: None,
            mcp_manager: None,
            backend_kit: None,
            context: Vec::new(),
        }
    }

    /// The same loop with the model call wired.
    pub fn with_router(mut self, router: Arc<dyn Router>) -> Self {
        self.router = Some(router);
        self
    }

    /// The same loop with the MCP manager wired.
    pub fn with_mcp(mut self, mcp: Arc<dyn McpManager>) -> Self {
        self.mcp_manager = Some(mcp);
        self
    }

    /// The same loop with the BackendKit wired.
    pub fn with_backend_kit(mut self, backend_kit: Arc<RwLock<BackendKit>>) -> Self {
        self.backend_kit = Some(backend_kit);
        self
    }

    /// Whether a model call is wired. The daemon reports this; a turn states it.
    pub fn has_router(&self) -> bool {
        self.router.is_some()
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
    /// no slash command resolves. Async because an Agent-mode turn may ask the
    /// router for an answer; a Plan-mode turn and a tool turn both complete
    /// without waiting on anything.
    pub async fn run_turn(&mut self, input: &str, skills: &[SlashCommand]) -> AgentTurnResult {
        let mentions = MentionParser::parse(input);
        let requested = requested_command(input);
        let command = requested.as_deref().and_then(|name| {
            SlashCommandRegistry::from_skills(skills)
                .lookup(name)
                .cloned()
        });
        let mode = self.mode_manager.current;

        let (response, tools) = match mode {
            AgentMode::Plan => (
                self.plan_response(input, &mentions, command.as_ref(), requested.as_deref()),
                Vec::new(),
            ),
            AgentMode::Agent => {
                self.execute_turn(input, &mentions, command.as_ref(), requested.as_deref())
                    .await
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
            tools,
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

    /// The Agent-mode answer: run the turn's tool, or ask the model.
    ///
    /// Returns the response and the tools it ran, so the caller gets both the line
    /// a human reads and the record a run view shows.
    async fn execute_turn(
        &mut self,
        input: &str,
        mentions: &[Mention],
        command: Option<&SlashCommand>,
        requested: Option<&str>,
    ) -> (String, Vec<ToolResult>) {
        let todo = self.record_todo(
            format!("execute the turn: {}", first_line(input)),
            TodoStatus::Done,
        );

        let mut lines = vec![
            String::new(), // the summary line, filled in below
            format!("- mentions: {}", mention_summary(mentions)),
            format!("- command: {}", command_summary(command, requested)),
        ];

        let mut tools = Vec::new();
        match parse_tool_request(input) {
            Some(AgentTool::CallTool {
                server,
                tool,
                arguments,
            }) => {
                let call_tool_obj = AgentTool::CallTool {
                    server: server.clone(),
                    tool: tool.clone(),
                    arguments: arguments.clone(),
                };
                let result = if let Some(mcp) = &self.mcp_manager {
                    let target_server = if let Some(s) = server {
                        s
                    } else {
                        // Find connected server that advertises this tool
                        let list = mcp.list().await;
                        let found = list.into_iter().find(|conn| {
                            conn.status.is_connected()
                                && (conn.tools.iter().any(|t| t == &tool)
                                    || conn.tool_definitions.iter().any(|td| td.name == tool))
                        });
                        match found {
                            Some(conn) => conn.config.name,
                            None => {
                                let res = ToolResult::failed(
                                    call_tool_obj.clone(),
                                    format!("no connected MCP server advertises tool `{tool}`"),
                                );
                                lines.push(format!(
                                    "- tool: {} — {}",
                                    res.tool.summary(),
                                    res.status()
                                ));
                                lines.push("- output:".to_string());
                                lines.push(format!("  {}", res.output));
                                tools.push(res);
                                lines[0] =
                                    format!("Summary (tool execution): {}", first_line(input));
                                lines.push(format!(
                                    "- todo: {}",
                                    todo_line(todo.as_deref(), "done")
                                ));
                                return (lines.join("\n"), tools);
                            }
                        }
                    };

                    match mcp
                        .call_tool(&target_server, &tool, arguments.clone())
                        .await
                    {
                        Ok(tool_res) => {
                            if tool_res.is_error {
                                let text = tool_res
                                    .content
                                    .iter()
                                    .map(|c| match c {
                                        crate::mcp::McpContent::Text { text } => text.clone(),
                                        crate::mcp::McpContent::Image { mime_type, .. } => {
                                            format!("[image ({mime_type})]")
                                        }
                                        crate::mcp::McpContent::Resource { resource } => {
                                            format!("[resource ({})]", resource.uri)
                                        }
                                    })
                                    .collect::<Vec<_>>()
                                    .join("\n");
                                let out = if text.is_empty() {
                                    format!("tool `{tool}` returned an error")
                                } else {
                                    text
                                };
                                ToolResult::failed(call_tool_obj, out)
                            } else {
                                let text_parts = tool_res
                                    .content
                                    .iter()
                                    .map(|c| match c {
                                        crate::mcp::McpContent::Text { text } => text.clone(),
                                        crate::mcp::McpContent::Image { mime_type, .. } => {
                                            format!("[image ({mime_type})]")
                                        }
                                        crate::mcp::McpContent::Resource { resource } => {
                                            format!("[resource ({})]", resource.uri)
                                        }
                                    })
                                    .collect::<Vec<_>>();
                                let base_out = if text_parts.is_empty() {
                                    format!("tool `{tool}` succeeded")
                                } else {
                                    text_parts.join("\n")
                                };

                                let is_backend_mutation = matches!(
                                    tool.as_str(),
                                    "create_table"
                                        | "add_table"
                                        | "create_rls_policy"
                                        | "add_rls_policy"
                                        | "create_storage_bucket"
                                        | "add_storage_bucket"
                                        | "create_function"
                                        | "add_function"
                                );
                                if is_backend_mutation {
                                    if let Some(kit_lock) = &self.backend_kit {
                                        let mut kit = kit_lock.write().await;
                                        match kit.apply_tool_call(&tool, &arguments) {
                                            Ok(msg) => ToolResult::ok(
                                                call_tool_obj,
                                                format!("{base_out}\n{msg}").trim().to_string(),
                                            ),
                                            Err(e) => ToolResult::failed(
                                                call_tool_obj,
                                                format!("backend update failed: {e}"),
                                            ),
                                        }
                                    } else {
                                        ToolResult::ok(call_tool_obj, base_out)
                                    }
                                } else {
                                    ToolResult::ok(call_tool_obj, base_out)
                                }
                            }
                        }
                        Err(McpTransportError::Timeout { seconds, .. }) => ToolResult::failed(
                            call_tool_obj,
                            format!("MCP tool call `{tool}` timed out after {seconds}s"),
                        ),
                        Err(McpTransportError::Protocol { problem, .. }) => ToolResult::failed(
                            call_tool_obj,
                            format!("MCP protocol error calling `{tool}`: {problem}"),
                        ),
                        Err(err) => ToolResult::failed(
                            call_tool_obj,
                            format!("MCP tool call `{tool}` failed: {err}"),
                        ),
                    }
                } else {
                    ToolResult::failed(
                        call_tool_obj,
                        "no MCP manager is wired into this agent loop",
                    )
                };

                lines.push(format!(
                    "- tool: {} — {}",
                    result.tool.summary(),
                    result.status()
                ));
                lines.push("- output:".to_string());
                let output =
                    OutputCompressor::compress(result.output.trim_end(), MAX_TOOL_OUTPUT_LINES);
                for line in output.text.lines() {
                    lines.push(format!("  {line}"));
                }
                tools.push(result);
                lines[0] = format!("Summary (tool execution): {}", first_line(input));
            }
            Some(tool) => {
                let result = self.tool_executor.execute(&tool);
                lines.push(format!(
                    "- tool: {} — {}",
                    result.tool.summary(),
                    result.status()
                ));
                lines.push("- output:".to_string());
                // The loop's own compressor bounds what a response quotes: a build
                // log's 5,000 lines become head, a marker and tail.
                let output =
                    OutputCompressor::compress(result.output.trim_end(), MAX_TOOL_OUTPUT_LINES);
                for line in output.text.lines() {
                    lines.push(format!("  {line}"));
                }
                tools.push(result);
                lines[0] = format!("Summary (tool execution): {}", first_line(input));
            }
            None => {
                // The router is cloned out of the loop so the borrow does not sit
                // across the await; `Arc<dyn Router>` is what the daemon holds too.
                let router = self.router.clone();
                let (source, model_line) = match router {
                    Some(router) => {
                        let attachments = self.attach_file_mentions(mentions);
                        let prompt = model_prompt(input, mentions, command, &attachments);
                        match router.complete(&prompt).await {
                            Ok(answer) => {
                                let answer = OutputCompressor::compress(
                                    answer.trim(),
                                    MAX_MODEL_REPLY_LINES,
                                )
                                .text;
                                (
                                    "model completion",
                                    format!("- model: {}", answer.replace('\n', " ")),
                                )
                            }
                            Err(error) => ("model unavailable", format!("- model: {error}")),
                        }
                    }
                    None => (
                        "no model",
                        "- model: not wired — no router is attached to this agent loop, so no model was called".to_string(),
                    ),
                };
                lines.push("- tool: none".to_string());
                lines.push(model_line);
                lines[0] = format!("Summary ({source}): {}", first_line(input));
            }
        }

        lines.push(format!("- todo: {}", todo_line(todo.as_deref(), "done")));
        (lines.join("\n"), tools)
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

    /// Read every `@file` mention through the tool layer for the model prompt.
    ///
    /// A successful read is compressed to [`MAX_TOOL_OUTPUT_LINES`] and attached as
    /// a block; a failed read becomes a one-line note. Either way the turn
    /// continues. Reading through the executor lets an enforced read-before-write
    /// guard record the mention as read. Non-file mentions are left to the prompt's
    /// `attached:` line.
    fn attach_file_mentions(&self, mentions: &[Mention]) -> Vec<FileAttachment> {
        let mut attachments = Vec::new();
        for mention in mentions {
            if mention.kind != MentionKind::File {
                continue;
            }
            let result = self.tool_executor.execute(&AgentTool::ReadFile {
                path: mention.target.clone(),
            });
            if result.success {
                attachments.push(FileAttachment::Read {
                    path: mention.target.clone(),
                    content: OutputCompressor::compress(&result.output, MAX_TOOL_OUTPUT_LINES),
                });
            } else {
                attachments.push(FileAttachment::Failed {
                    path: mention.target.clone(),
                    reason: result.output,
                });
            }
        }
        attachments
    }
}

impl Default for AgentLoop {
    /// Hand-written rather than derived: the tool types the loop holds are unit
    /// structs, a `Box<dyn ToolExecutor>` and an `Option<Arc<dyn Router>>`, none of
    /// which derive `Default`.
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

/// `read file <path>`: the turn reads one file.
const READ_FILE_PREFIX: &str = "read file ";
/// `write file <path>: <content>`: the turn writes one file.
const WRITE_FILE_PREFIX: &str = "write file ";
/// `run command <program> [args…]`: the turn runs one program.
const RUN_COMMAND_PREFIX: &str = "run command ";
/// `call tool <target> [json_args]`: call an MCP tool.
const CALL_TOOL_PREFIX: &str = "call tool ";
/// `call mcp <target> [json_args]`: call an MCP tool.
const CALL_MCP_PREFIX: &str = "call mcp ";

/// The tool a turn asks for, or `None` when the turn is a request to the model.
///
/// This is a plain reading of the owner's words, not a model's tool call, so its
/// limits are worth stating exactly:
///
/// - the turn has to **start** with one of the tool verbs (case-insensitively);
///   `please read file notes.md` is a request to the model, not a tool call;
/// - the first line names the target, and only the first line. A `write file`
///   turn takes its content from after the first `:` plus every following line,
///   so multi-line content needs no quoting; a `write file` with no `:` writes an
///   empty file;
/// - a `run command` turn splits its line on whitespace, with no shell and no
///   quoting;
/// - a `call tool` / `call mcp` turn splits the target (which may be `server/tool`
///   or `tool`) and parses trailing JSON arguments, defaulting to `{}`;
/// - a blank target is not a tool request at all, so `read file ` falls through to
///   the model rather than running a tool that cannot work;
/// - an `@file src/main.rs` mention is *not* a tool request: a mention is context
///   the loop attaches to the model's prompt ([`Mention`]). The loop reads each
///   file mention through its [`ToolExecutor`] and attaches the compressed
///   content, so an enforced read-before-write guard records the mention as read.
fn parse_tool_request(input: &str) -> Option<AgentTool> {
    let trimmed = input.trim();
    let (head, rest_of_input) = match trimmed.split_once('\n') {
        Some((head, tail)) => (head.trim_end(), tail),
        None => (trimmed, ""),
    };

    if let Some(rest) = rest_after_prefix(head, READ_FILE_PREFIX) {
        let path = trim_quotes(rest);
        return if path.is_empty() {
            None
        } else {
            Some(AgentTool::ReadFile {
                path: path.to_string(),
            })
        };
    }

    if let Some(rest) = rest_after_prefix(head, WRITE_FILE_PREFIX) {
        let (path_part, content_part) = match rest.split_once(':') {
            Some((path, content)) => (path, Some(content)),
            None => (rest, None),
        };
        let path = trim_quotes(path_part);
        if path.is_empty() {
            return None;
        }
        let mut content = content_part
            .map(|content| content.strip_prefix(' ').unwrap_or(content).to_string())
            .unwrap_or_default();
        if !rest_of_input.is_empty() {
            if !content.is_empty() {
                content.push('\n');
            }
            content.push_str(rest_of_input);
        }
        return Some(AgentTool::WriteFile {
            path: path.to_string(),
            content,
        });
    }

    if let Some(rest) = rest_after_prefix(head, RUN_COMMAND_PREFIX) {
        let mut parts = rest.split_whitespace();
        let command = parts.next()?;
        return Some(AgentTool::RunCommand {
            command: command.to_string(),
            args: parts.map(str::to_string).collect(),
        });
    }

    if let Some(rest) = rest_after_prefix(head, CALL_TOOL_PREFIX)
        .or_else(|| rest_after_prefix(head, CALL_MCP_PREFIX))
    {
        let rest = rest.trim();
        if rest.is_empty() {
            return None;
        }

        let (target_part, trailing_head) = match rest.split_once(|c: char| c.is_whitespace()) {
            Some((target, trailing)) => (target, trailing),
            None => (rest, ""),
        };
        let target = trim_quotes(target_part);
        if target.is_empty() {
            return None;
        }

        let (server, tool) = if let Some((s, t)) = target.split_once('/') {
            (Some(s.trim().to_string()), t.trim().to_string())
        } else {
            (None, target.to_string())
        };

        let mut args_str = trailing_head.trim().to_string();
        if !rest_of_input.is_empty() {
            if !args_str.is_empty() {
                args_str.push('\n');
            }
            args_str.push_str(rest_of_input);
        }

        let arguments = if args_str.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str::<serde_json::Value>(args_str.trim())
                .unwrap_or_else(|_| serde_json::json!({}))
        };

        return Some(AgentTool::CallTool {
            server,
            tool,
            arguments,
        });
    }

    None
}

/// The tail of `line` after an ASCII-case-insensitive `prefix`, when it starts
/// with it. `None` when it does not, or when the split would land inside a
/// character.
fn rest_after_prefix<'a>(line: &'a str, prefix: &str) -> Option<&'a str> {
    let slice = line.get(..prefix.len())?;
    if slice.eq_ignore_ascii_case(prefix) {
        Some(&line[prefix.len()..])
    } else {
        None
    }
}

/// A path without the quotes an owner may have typed around it.
fn trim_quotes(text: &str) -> &str {
    let trimmed = text.trim();
    for quote in ['"', '\''] {
        if let Some(inner) = trimmed
            .strip_prefix(quote)
            .and_then(|rest| rest.strip_suffix(quote))
        {
            return inner.trim();
        }
    }
    trimmed
}

/// One `@file` mention the loop read (or tried to read) for the model's prompt.
///
/// Reading goes through the loop's [`ToolExecutor`], so a read-before-write guard
/// records the mention as read; a failed read becomes a note rather than aborting
/// the turn.
enum FileAttachment {
    /// The file was read and compressed to the tool-output line budget.
    Read {
        /// The mention's target path.
        path: String,
        /// The head/tail-compressed content.
        content: CompressedOutput,
    },
    /// The read failed; the turn continues with a one-line note.
    Failed {
        /// The mention's target path.
        path: String,
        /// Why the read failed, as the executor reported it.
        reason: String,
    },
}

/// The prompt the router is handed: the instruction, the owner's turn, and what
/// the loop attached to it.
///
/// Every mention keeps its place on the `attached:` line; a file mention that was
/// read additionally gets a content block (path, compressed text, and an "N of M
/// lines shown" note), and one that could not be read gets a one-line note.
fn model_prompt(
    input: &str,
    mentions: &[Mention],
    command: Option<&SlashCommand>,
    attachments: &[FileAttachment],
) -> String {
    let mut lines = vec![
        AGENT_INSTRUCTION.to_string(),
        String::new(),
        format!("owner: {}", input.trim()),
    ];
    if !mentions.is_empty() {
        let rendered: Vec<String> = mentions.iter().map(Mention::rendered).collect();
        lines.push(format!("attached: {}", rendered.join(", ")));
    }
    for attachment in attachments {
        match attachment {
            FileAttachment::Read { path, content } => {
                lines.push(format!("@file {path}:"));
                lines.extend(content.text.lines().map(str::to_string));
                lines.push(format!(
                    "({} of {} lines shown)",
                    content.compressed_lines, content.original_lines
                ));
            }
            FileAttachment::Failed { path, reason } => {
                lines.push(format!(
                    "could not attach @file {path}: {}",
                    reason.replace('\n', " ")
                ));
            }
        }
    }
    if let Some(command) = command {
        lines.push(format!("skill: {} — {}", command.name, command.description));
    }
    lines.join("\n")
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
    use crate::agent_tools::FilesystemToolExecutor;
    use crate::agent_workflow::MentionKind;
    use crate::test_util::fresh_tempdir;
    use async_trait::async_trait;
    use std::path::Path;
    use std::sync::Mutex;
    use warsha_core::{RoleRouting, RoutingTarget};
    use warsha_providers::MockProvider;

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

    /// An Agent-mode loop whose tools run against `dir`.
    fn tool_loop(dir: &Path) -> AgentLoop {
        let mut agent_loop =
            AgentLoop::with_tool_executor(Box::new(FilesystemToolExecutor::new(dir)));
        agent_loop
            .approve_agent_mode("owner")
            .expect("an approval is accepted");
        agent_loop
    }

    /// A program plus arguments that print `hello` after a turn's own whitespace
    /// split — so no argument carries a space, unlike the tool layer's test helper,
    /// which passes its arguments directly.
    fn printing_command() -> (String, Vec<String>) {
        #[cfg(windows)]
        {
            (
                "cmd".to_string(),
                vec!["/C".to_string(), "echo hello".to_string()],
            )
        }
        #[cfg(not(windows))]
        {
            ("/bin/echo".to_string(), vec!["hello".to_string()])
        }
    }

    /// A router that answers with whatever a test pinned, and records its prompts.
    struct FixedRouter {
        answer: Result<String, RouterError>,
        prompts: Mutex<Vec<String>>,
    }

    impl FixedRouter {
        fn answering(answer: &str) -> Self {
            Self {
                answer: Ok(answer.to_string()),
                prompts: Mutex::new(Vec::new()),
            }
        }

        fn failing(error: RouterError) -> Self {
            Self {
                answer: Err(error),
                prompts: Mutex::new(Vec::new()),
            }
        }

        fn prompts(&self) -> Vec<String> {
            self.prompts
                .lock()
                .expect("the prompt log is not poisoned")
                .clone()
        }
    }

    #[async_trait]
    impl Router for FixedRouter {
        async fn complete(&self, prompt: &str) -> Result<String, RouterError> {
            self.prompts
                .lock()
                .expect("the prompt log is not poisoned")
                .push(prompt.to_string());
            self.answer.clone()
        }
    }

    /// A router over the real [`ProviderRouter`], with one mock provider routed for
    /// [`AGENT_ROLE`] — the daemon's model path, with the mock provider the AGENTS.md
    /// test rule asks for.
    fn mock_router_adapter() -> ProviderRouterAdapter {
        let mut router = ProviderRouter::new();
        router.register_provider(Box::new(MockProvider::new("mock")));
        router.set_role_routing(RoleRouting {
            role: AGENT_ROLE,
            targets: vec![RoutingTarget {
                provider_id: "mock".to_string(),
                model_id: "mock-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
        ProviderRouterAdapter::new(Arc::new(RwLock::new(router)), AGENT_ROLE, "agent")
    }

    /// Audit N-3 on the path an agent turn actually takes.
    ///
    /// `ProviderRouterAdapter::complete` used to take the daemon's router **write** guard
    /// and keep it across every await, so one turn's retry sleep sat in front of every
    /// other `providers.*` request and every other turn, and the router's paid-call cap
    /// could not be reached on this path at all. The adapter now takes a handle and
    /// releases the lock, which is what this test measures the way the finding asked for:
    /// the lock is free while a turn is backing off, and a second turn is served inside
    /// that window.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn an_agent_turn_backing_off_holds_no_router_lock() {
        use std::sync::atomic::Ordering;
        use std::time::Duration;
        use warsha_providers::{MockProvider, RetryPolicy};

        /// Long enough for the test to observe the sleep, short enough to stay a unit test.
        const BACKOFF: u64 = 400;

        let mut router = ProviderRouter::new();
        router.set_retry_policy(RetryPolicy {
            max_retries_per_target: 1,
            max_total_attempts: 2,
            base_backoff_ms: BACKOFF,
            max_backoff_ms: BACKOFF,
            jitter: false,
        });
        // Every attempt is refused retryably, so each walk sleeps once and then gives up.
        let provider = MockProvider::new("mock").with_retryable_failures(u32::MAX);
        let calls = provider.call_counter();
        router.register_provider(Box::new(provider));
        router.set_role_routing(RoleRouting {
            role: AGENT_ROLE,
            targets: vec![RoutingTarget {
                provider_id: "mock".to_string(),
                model_id: "mock-model".to_string(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: None,
        });
        let router = Arc::new(RwLock::new(router));
        let adapter = ProviderRouterAdapter::new(Arc::clone(&router), AGENT_ROLE, "agent");

        let first = tokio::spawn(async move { adapter.complete("the first turn").await });

        // Wait until the attempt has actually been made: the turn is now in its sleep.
        tokio::time::timeout(Duration::from_secs(5), async {
            while calls.load(Ordering::Acquire) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("the turn reached the router");

        // The write lock is what `providers.add`, `providers.remove` and `roles.set` need.
        let acquired = tokio::time::timeout(Duration::from_millis(100), router.write()).await;
        assert!(
            acquired.is_ok(),
            "an agent turn held the router's write lock across its backoff sleep"
        );
        drop(acquired.expect("the router lock is free"));

        // A second turn is served in the same window rather than queued behind the first,
        // and it is metered under its own key: neither turn's spend is the other's.
        let second = ProviderRouterAdapter::new(Arc::clone(&router), AGENT_ROLE, "second");
        let second_outcome = second.complete("the second turn").await;
        assert!(
            second_outcome.is_err(),
            "the throttled provider answered: {second_outcome:?}"
        );

        let first_outcome = first.await.expect("the turn finished");
        assert!(
            first_outcome.is_err(),
            "the throttled provider answered the first turn: {first_outcome:?}"
        );
        // Two attempts each and no more: the per-call attempt cap survived the change, so
        // removing the lock did not remove the bound on spend.
        assert_eq!(calls.load(Ordering::Acquire), 4, "the attempt cap changed");

        // Nothing is left holding a permit, which is what a leak would have shown as.
        let guard = router.read().await;
        assert_eq!(guard.paid_calls_in_flight(), 0);
        assert_eq!(
            guard.available_paid_permits(),
            guard.max_concurrent_paid_calls(),
            "a paid-call permit was not returned"
        );
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
        // Nothing is wired: the loop reports that rather than pretending.
        assert!(!agent_loop.has_router());
        assert!(agent_loop.router.is_none());
    }

    #[tokio::test]
    async fn plan_mode_returns_a_plan_and_executes_nothing() {
        let mut agent_loop = AgentLoop::new();

        let turn = agent_loop
            .run_turn("add a dark mode toggle", &catalog())
            .await;

        assert_eq!(turn.mode, AgentMode::Plan);
        assert!(turn.response.starts_with("Plan (nothing executed):"));
        assert!(turn.response.contains("add a dark mode toggle"));
        assert!(turn.response.contains("approve Agent mode"));
        // One pending todo: the plan announced work, nothing was completed.
        assert_eq!(turn.todos.len(), 1);
        assert_eq!(turn.todos[0].status, TodoStatus::Pending);
        assert_eq!(turn.todos[0].id, "turn-1");
        assert!(turn.tools.is_empty());
        assert!(!agent_loop.mode_manager.can_edit());
    }

    #[tokio::test]
    async fn agent_mode_without_a_router_says_no_model_is_wired() {
        let mut agent_loop = approved_loop();

        let turn = agent_loop
            .run_turn("add a dark mode toggle", &catalog())
            .await;

        assert_eq!(turn.mode, AgentMode::Agent);
        assert!(turn.response.starts_with("Summary (no model):"));
        assert!(turn
            .response
            .contains("no router is attached to this agent loop"));
        assert!(turn.response.contains("- tool: none"));
        assert!(turn.tools.is_empty());
        assert_eq!(turn.todos.len(), 1);
        assert_eq!(turn.todos[0].status, TodoStatus::Done);
        assert!(agent_loop.mode_manager.can_edit());
    }

    #[tokio::test]
    async fn agent_mode_asks_the_router_and_uses_its_answer() {
        let router = Arc::new(FixedRouter::answering(
            "Added the toggle.\nTouched two files.",
        ));
        let mut agent_loop = AgentLoop::new().with_router(router.clone());
        agent_loop
            .approve_agent_mode("owner")
            .expect("an approval is accepted");
        assert!(agent_loop.has_router());

        let turn = agent_loop
            .run_turn("add a dark mode toggle @file src/app.tsx", &catalog())
            .await;

        assert!(turn.response.starts_with("Summary (model completion):"));
        assert!(turn
            .response
            .contains("- model: Added the toggle. Touched two files."));
        assert!(turn.tools.is_empty());
        // The prompt carried the owner's turn, the attachment and the one rule the
        // loop can prove.
        let prompts = router.prompts();
        assert_eq!(prompts.len(), 1);
        assert!(prompts[0].contains("Do not claim work you did not do"));
        assert!(prompts[0].contains("owner: add a dark mode toggle @file src/app.tsx"));
        assert!(prompts[0].contains("attached: @file src/app.tsx"));
    }

    #[tokio::test]
    async fn a_router_failure_is_reported_in_the_summary() {
        let router = Arc::new(FixedRouter::failing(RouterError::NoRoute(
            "no role routing is set".to_string(),
        )));
        let mut agent_loop = AgentLoop::new().with_router(router);
        agent_loop
            .approve_agent_mode("owner")
            .expect("an approval is accepted");

        let turn = agent_loop.run_turn("add a toggle", &catalog()).await;

        assert!(turn.response.starts_with("Summary (model unavailable):"));
        assert!(turn
            .response
            .contains("- model: no provider is routed for the agent role: no role routing is set"));
        assert!(turn.tools.is_empty());
    }

    #[tokio::test]
    async fn the_provider_router_adapter_reaches_the_real_router() {
        let mut agent_loop = AgentLoop::new().with_router(Arc::new(mock_router_adapter()));
        agent_loop
            .approve_agent_mode("owner")
            .expect("an approval is accepted");

        let turn = agent_loop.run_turn("say something", &catalog()).await;

        // `MockProvider` answers "Mock response": the turn really went through the
        // router's routing and provider registry.
        assert!(turn.response.starts_with("Summary (model completion):"));
        assert!(turn.response.contains("- model: Mock response"));
    }

    #[tokio::test]
    async fn the_provider_router_adapter_reports_a_role_with_no_route() {
        let providers = Arc::new(RwLock::new(ProviderRouter::new()));
        let adapter = ProviderRouterAdapter::new(providers, AGENT_ROLE, "agent");
        assert_eq!(adapter.role(), AGENT_ROLE);
        assert_eq!(adapter.project_id(), "agent");

        let mut agent_loop = AgentLoop::new().with_router(Arc::new(adapter));
        agent_loop
            .approve_agent_mode("owner")
            .expect("an approval is accepted");

        let turn = agent_loop.run_turn("say something", &catalog()).await;

        assert!(turn.response.starts_with("Summary (model unavailable):"));
        assert!(turn
            .response
            .contains("- model: no provider is routed for the agent role"));
    }

    #[tokio::test]
    async fn agent_mode_reads_a_file_through_the_tool_layer() {
        let temp = fresh_tempdir();
        std::fs::write(temp.path().join("notes.md"), "the file\n").expect("the file is written");
        let mut agent_loop = tool_loop(temp.path());

        let turn = agent_loop.run_turn("read file notes.md", &catalog()).await;

        assert!(turn
            .response
            .starts_with("Summary (tool execution): read file notes.md"));
        assert!(turn.response.contains("- tool: read_file notes.md — ok"));
        assert!(turn.response.contains("  the file"));
        assert_eq!(turn.tools.len(), 1);
        assert!(turn.tools[0].success);
        assert_eq!(
            turn.tools[0].tool,
            AgentTool::ReadFile {
                path: "notes.md".to_string()
            }
        );
        assert_eq!(turn.tools[0].output, "the file\n");
        assert_eq!(turn.todos[0].status, TodoStatus::Done);
    }

    #[tokio::test]
    async fn agent_mode_writes_a_file_through_the_tool_layer() {
        let temp = fresh_tempdir();
        let mut agent_loop = tool_loop(temp.path());

        let turn = agent_loop
            .run_turn("write file docs/notes.md: hello\nsecond line", &catalog())
            .await;

        assert!(turn
            .response
            .starts_with("Summary (tool execution): write file docs/notes.md"));
        assert!(turn
            .response
            .contains("- tool: write_file docs/notes.md — ok"));
        assert_eq!(turn.tools.len(), 1);
        assert!(turn.tools[0].success);
        // The content is the rest of the line plus every line after it.
        assert_eq!(
            std::fs::read_to_string(temp.path().join("docs/notes.md"))
                .expect("the nested file is readable"),
            "hello\nsecond line"
        );
    }

    #[tokio::test]
    async fn agent_mode_runs_a_command_through_the_tool_layer() {
        let temp = fresh_tempdir();
        let mut agent_loop = tool_loop(temp.path());
        let (command, args) = printing_command();
        let input = format!(
            "run command {}",
            std::iter::once(command)
                .chain(args)
                .collect::<Vec<String>>()
                .join(" ")
        );

        let turn = agent_loop.run_turn(&input, &catalog()).await;

        assert!(turn
            .response
            .starts_with("Summary (tool execution): run command"));
        assert_eq!(turn.tools.len(), 1);
        assert!(
            turn.tools[0].success,
            "unexpected tool: {:?}",
            turn.tools[0]
        );
        assert!(turn.tools[0].output.contains("hello"));
        assert!(turn.tools[0].output.contains("exit code: 0"));
    }

    #[tokio::test]
    async fn a_tool_request_with_no_executor_wired_reports_that_nothing_ran() {
        let mut agent_loop = approved_loop();

        let turn = agent_loop.run_turn("read file notes.md", &catalog()).await;

        assert!(turn.response.starts_with("Summary (tool execution):"));
        assert!(turn.response.contains("no tool executor is wired"));
        assert_eq!(turn.tools.len(), 1);
        assert!(!turn.tools[0].success);
    }

    #[tokio::test]
    async fn plan_mode_never_runs_a_tool() {
        let temp = fresh_tempdir();
        let mut agent_loop =
            AgentLoop::with_tool_executor(Box::new(FilesystemToolExecutor::new(temp.path())));

        let turn = agent_loop
            .run_turn("write file notes.md: should not happen", &catalog())
            .await;

        assert_eq!(turn.mode, AgentMode::Plan);
        assert!(turn.response.starts_with("Plan (nothing executed):"));
        assert!(turn.tools.is_empty());
        assert!(
            !temp.path().join("notes.md").exists(),
            "Plan mode wrote a file"
        );
    }

    #[tokio::test]
    async fn only_a_turn_that_starts_with_a_verb_is_a_tool_request() {
        let router = Arc::new(FixedRouter::answering("Mock response"));
        let mut agent_loop = AgentLoop::new().with_router(router);
        agent_loop
            .approve_agent_mode("owner")
            .expect("an approval is accepted");

        let turn = agent_loop
            .run_turn("please read file notes.md", &catalog())
            .await;

        assert!(turn.response.starts_with("Summary (model completion):"));
        assert!(turn.tools.is_empty());
    }

    #[test]
    fn a_tool_request_is_read_from_the_turns_first_line() {
        assert_eq!(
            parse_tool_request("read file src/main.rs"),
            Some(AgentTool::ReadFile {
                path: "src/main.rs".to_string()
            })
        );
        assert_eq!(
            parse_tool_request("READ FILE \"src/my notes.md\""),
            Some(AgentTool::ReadFile {
                path: "src/my notes.md".to_string()
            })
        );
        assert_eq!(
            parse_tool_request("write file notes.md: hello\nworld"),
            Some(AgentTool::WriteFile {
                path: "notes.md".to_string(),
                content: "hello\nworld".to_string()
            })
        );
        assert_eq!(
            parse_tool_request("write file empty.md"),
            Some(AgentTool::WriteFile {
                path: "empty.md".to_string(),
                content: String::new()
            })
        );
        assert_eq!(
            parse_tool_request("run command cargo test --all"),
            Some(AgentTool::RunCommand {
                command: "cargo".to_string(),
                args: vec!["test".to_string(), "--all".to_string()]
            })
        );

        // A blank target, a bare verb and any other turn are not tool requests.
        assert_eq!(parse_tool_request("read file "), None);
        assert_eq!(parse_tool_request("write file : content"), None);
        assert_eq!(parse_tool_request("run command"), None);
        assert_eq!(parse_tool_request("run command   "), None);
        assert_eq!(parse_tool_request("add a dark mode toggle"), None);
        assert_eq!(parse_tool_request("@file src/main.rs"), None);
        assert_eq!(parse_tool_request(""), None);
    }

    #[tokio::test]
    async fn mentions_are_parsed_from_the_input() {
        let mut agent_loop = AgentLoop::new();

        let turn = agent_loop
            .run_turn(
                "compare @file src/main.rs with @folder src and @codebase",
                &catalog(),
            )
            .await;

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
        // A mention is context for the model, not a tool call.
        assert!(turn.tools.is_empty());
    }

    #[tokio::test]
    async fn a_known_slash_command_is_detected() {
        let mut agent_loop = AgentLoop::new();

        let turn = agent_loop
            .run_turn("/review the last commit", &catalog())
            .await;

        let command = turn.command.expect("a catalogued command resolves");
        assert_eq!(command.name, "/review");
        assert_eq!(command.description, "Review the current diff");
        assert!(turn.response.contains("/review — Review the current diff"));
    }

    #[tokio::test]
    async fn an_unknown_slash_command_is_none_and_says_so() {
        let mut agent_loop = AgentLoop::new();

        let turn = agent_loop.run_turn("/deploy everything", &catalog()).await;

        assert_eq!(turn.command, None);
        assert!(turn.response.contains("/deploy — unknown command, ignored"));
        // A command that is not at the start of the turn is not a command.
        let later = agent_loop.run_turn("please /review this", &catalog()).await;
        assert_eq!(later.command, None);
        assert!(!later.response.contains("unknown command"));
        // No catalog means no command, whatever the input says.
        let empty = agent_loop.run_turn("/review", &[]).await;
        assert_eq!(empty.command, None);
    }

    #[tokio::test]
    async fn the_context_is_compacted_when_it_passes_the_budget() {
        let mut agent_loop = AgentLoop::new();
        let long_input = "walk the whole codebase and list every module ".repeat(4);

        for _ in 0..8 {
            agent_loop.run_turn(&long_input, &catalog()).await;
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

    #[tokio::test]
    async fn the_todo_list_records_one_item_per_turn() {
        let mut agent_loop = AgentLoop::new();

        agent_loop.run_turn("first request", &catalog()).await;
        let second = agent_loop.run_turn("second request", &catalog()).await;

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

    #[tokio::test]
    async fn a_turn_result_uses_snake_case_on_the_wire() {
        let mut agent_loop = approved_loop();

        // The command has to start the turn, so the mention follows it here.
        let turn = agent_loop
            .run_turn("/fix the build for @file src/lib.rs", &catalog())
            .await;
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
        assert_eq!(wire["tools"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn a_tool_turn_names_its_call_on_the_wire() {
        let temp = fresh_tempdir();
        let mut agent_loop = tool_loop(temp.path());

        let turn = agent_loop
            .run_turn("write file notes.md: on the wire", &catalog())
            .await;
        let wire = serde_json::to_value(&turn).expect("a turn result serializes");

        assert_eq!(
            wire["tools"][0]["tool"]["tool"],
            serde_json::json!("write_file")
        );
        assert_eq!(
            wire["tools"][0]["tool"]["path"],
            serde_json::json!("notes.md")
        );
        assert_eq!(wire["tools"][0]["success"], serde_json::json!(true));
    }

    #[tokio::test]
    async fn an_empty_input_still_produces_a_turn() {
        let mut agent_loop = AgentLoop::new();

        let turn = agent_loop.run_turn("   \n  ", &catalog()).await;

        assert!(turn.mentions.is_empty());
        assert_eq!(turn.command, None);
        assert!(turn.response.contains("(empty input)"));
        assert_eq!(turn.todos.len(), 1);
    }

    #[test]
    fn parse_call_tool_and_call_mcp() {
        let t1 = parse_tool_request("call tool echo {\"msg\":\"hi\"}").expect("parses call tool");
        match t1 {
            AgentTool::CallTool {
                server,
                tool,
                arguments,
            } => {
                assert_eq!(server, None);
                assert_eq!(tool, "echo");
                assert_eq!(arguments["msg"], "hi");
            }
            _ => panic!("expected CallTool"),
        }

        let t2 = parse_tool_request("call mcp files/read_file {\"path\":\"a.txt\"}")
            .expect("parses call mcp");
        match t2 {
            AgentTool::CallTool {
                server,
                tool,
                arguments,
            } => {
                assert_eq!(server, Some("files".to_string()));
                assert_eq!(tool, "read_file");
                assert_eq!(arguments["path"], "a.txt");
            }
            _ => panic!("expected CallTool"),
        }
    }

    struct MockAgentLoopMcpManager;
    #[async_trait]
    impl McpManager for MockAgentLoopMcpManager {
        async fn connect(
            &self,
            _config: crate::mcp_transport::McpServerConfig,
        ) -> Result<(), McpTransportError> {
            Ok(())
        }
        async fn disconnect(&self, _name: &str) -> Result<(), McpTransportError> {
            Ok(())
        }
        async fn list(&self) -> Vec<crate::mcp_transport::McpConnection> {
            vec![crate::mcp_transport::McpConnection {
                config: crate::mcp_transport::McpServerConfig {
                    name: "test_srv".to_string(),
                    transport: crate::mcp_transport::McpTransport::Stdio,
                    command: Some("dummy".to_string()),
                    args: vec![],
                },
                status: crate::mcp_transport::McpStatus::Connected,
                process_id: Some("p1".to_string()),
                tools: vec!["create_table".to_string(), "echo".to_string()],
                tool_definitions: vec![],
            }]
        }
        async fn send(&self, _name: &str, _payload: &str) -> Result<String, McpTransportError> {
            Ok(String::new())
        }
        async fn call_tool(
            &self,
            _name: &str,
            tool: &str,
            arguments: serde_json::Value,
        ) -> Result<crate::mcp::McpToolResult, McpTransportError> {
            if tool == "create_table" {
                let tbl_name = arguments
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("users");
                Ok(crate::mcp::McpToolResult {
                    content: vec![crate::mcp::McpContent::Text {
                        text: format!("Table {tbl_name} created"),
                    }],
                    is_error: false,
                })
            } else if tool == "echo" {
                let msg = arguments.get("msg").and_then(|v| v.as_str()).unwrap_or("");
                Ok(crate::mcp::McpToolResult {
                    content: vec![crate::mcp::McpContent::Text {
                        text: msg.to_string(),
                    }],
                    is_error: false,
                })
            } else {
                Err(McpTransportError::NotFound(tool.to_string()))
            }
        }
    }

    #[tokio::test]
    async fn agent_loop_executes_call_tool_and_mutates_backend_kit() {
        let mut agent_loop = approved_loop();
        let mcp = Arc::new(MockAgentLoopMcpManager);
        let backend_kit = Arc::new(RwLock::new(BackendKit::from_project(
            "test",
            "http://localhost",
            crate::backend_kit::BackendKind::PocketBase,
        )));

        agent_loop = agent_loop
            .with_mcp(mcp)
            .with_backend_kit(backend_kit.clone());

        let turn = agent_loop
            .run_turn(
                "call tool create_table {\"name\": \"users\", \"columns\": [{\"name\": \"id\", \"data_type\": \"uuid\"}]}",
                &catalog(),
            )
            .await;

        assert_eq!(turn.tools.len(), 1);
        assert!(turn.tools[0].success);
        assert!(turn.tools[0].output.contains("Table users created"));

        let kit = backend_kit.read().await;
        assert_eq!(kit.tables.len(), 1);
        assert_eq!(kit.tables[0].name, "users");
    }

    #[tokio::test]
    async fn a_file_mentions_content_reaches_the_model_prompt() {
        let temp = fresh_tempdir();
        std::fs::write(temp.path().join("notes.md"), "alpha\nbeta\n").expect("the file is written");
        let router = Arc::new(FixedRouter::answering("Read it."));
        let mut agent_loop = tool_loop(temp.path()).with_router(router.clone());

        let turn = agent_loop
            .run_turn("summarize @file notes.md", &catalog())
            .await;

        assert!(turn.response.starts_with("Summary (model completion):"));
        let prompts = router.prompts();
        assert_eq!(prompts.len(), 1);
        assert!(prompts[0].contains("@file notes.md"));
        assert!(prompts[0].contains("alpha"));
        assert!(prompts[0].contains("beta"));
        assert!(prompts[0].contains("(2 of 2 lines shown)"));
        // Reading a mention is prompt context, not a tool the turn ran.
        assert!(turn.tools.is_empty());
    }

    #[tokio::test]
    async fn a_long_file_mention_is_compressed_in_the_prompt() {
        let temp = fresh_tempdir();
        let long: String = (1..=200).map(|index| format!("line {index}\n")).collect();
        std::fs::write(temp.path().join("big.log"), &long).expect("the file is written");
        let router = Arc::new(FixedRouter::answering("Compressed."));
        let mut agent_loop = tool_loop(temp.path()).with_router(router.clone());

        agent_loop
            .run_turn("summarize @file big.log", &catalog())
            .await;

        let prompts = router.prompts();
        assert_eq!(prompts.len(), 1);
        assert!(prompts[0].contains("(12 of 200 lines shown)"));
        assert!(prompts[0].contains("lines omitted"));
        // Head and tail survive; the middle was dropped.
        assert!(prompts[0].contains("line 1\n"));
        assert!(prompts[0].contains("line 200\n"));
        assert!(!prompts[0].contains("line 100\n"));
    }

    #[tokio::test]
    async fn a_missing_file_mention_notes_the_failure_and_completes_the_turn() {
        let temp = fresh_tempdir();
        let router = Arc::new(FixedRouter::answering("Still answered."));
        let mut agent_loop = tool_loop(temp.path()).with_router(router.clone());

        let turn = agent_loop
            .run_turn("summarize @file missing.md", &catalog())
            .await;

        assert!(turn.response.starts_with("Summary (model completion):"));
        let prompts = router.prompts();
        assert_eq!(prompts.len(), 1);
        assert!(prompts[0].contains("could not attach @file missing.md"));
        assert!(turn.tools.is_empty());
    }

    #[tokio::test]
    async fn non_file_mentions_keep_the_attached_line_without_a_read() {
        let temp = fresh_tempdir();
        let router = Arc::new(FixedRouter::answering("Overview."));
        let mut agent_loop = tool_loop(temp.path()).with_router(router.clone());

        agent_loop
            .run_turn("overview @folder src and @codebase", &catalog())
            .await;

        let prompts = router.prompts();
        assert_eq!(prompts.len(), 1);
        assert!(prompts[0].contains("attached: @folder src, @codebase"));
        // No file mention means no content block and no failure note.
        assert!(!prompts[0].contains("could not attach"));
        assert!(!prompts[0].contains("lines shown"));
    }

    #[tokio::test]
    async fn a_file_mention_is_recorded_as_read_for_the_guard() {
        let temp = fresh_tempdir();
        std::fs::write(temp.path().join("notes.md"), "original").expect("the file is written");
        let executor = FilesystemToolExecutor::new(temp.path()).with_read_before_write(true);
        let router = Arc::new(FixedRouter::answering("Now edit it."));
        let mut agent_loop = AgentLoop::with_tool_executor(Box::new(executor)).with_router(router);
        agent_loop
            .approve_agent_mode("owner")
            .expect("an approval is accepted");

        // The mention reads the file through the guarded executor...
        agent_loop
            .run_turn("look at @file notes.md", &catalog())
            .await;
        // ...so a later write turn to the same path is allowed.
        let turn = agent_loop
            .run_turn("write file notes.md: updated", &catalog())
            .await;

        assert_eq!(turn.tools.len(), 1);
        assert!(
            turn.tools[0].success,
            "the guarded write was refused: {:?}",
            turn.tools[0]
        );
        assert_eq!(
            std::fs::read_to_string(temp.path().join("notes.md")).expect("the file is readable"),
            "updated"
        );
    }
}
