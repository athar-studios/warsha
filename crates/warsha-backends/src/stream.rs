use serde_json::Value;
use warsha_core::TokenUsage;

#[derive(Debug, Clone, PartialEq)]
pub enum StreamEvent {
    SessionStarted {
        cli_session_id: Option<String>,
        model: Option<String>,
    },
    StatusChanged {
        status: String,
    },
    ToolStarted {
        tool: String,
        target: String,
    },
    ToolFinished {
        tool: String,
        target: String,
        duration_ms: Option<u64>,
        status: String,
    },
    FileTouched {
        path: String,
        action: String,
    },
    SessionEnded {
        status: String,
        duration_ms: Option<u64>,
        usage: Option<TokenUsage>,
    },
}

pub fn command_name_without_args(cmd: &str) -> String {
    cmd.split_whitespace()
        .next()
        .map(|s| s.trim_matches('\'').trim_matches('"'))
        .map(|s| {
            std::path::Path::new(s)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(s)
        })
        .unwrap_or("")
        .to_string()
}

pub fn parse_claude_stream_line(line: &str) -> Vec<StreamEvent> {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return vec![];
    };
    let Some(obj) = v.as_object() else {
        return vec![];
    };

    let mut events = Vec::new();
    match obj.get("type").and_then(|v| v.as_str()) {
        Some("system") if obj.get("subtype").and_then(|v| v.as_str()) == Some("init") => {
            events.push(StreamEvent::SessionStarted {
                cli_session_id: obj
                    .get("session_id")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                model: obj.get("model").and_then(|v| v.as_str()).map(String::from),
            });
        }
        Some("status") => {
            if let Some(status) = obj.get("status").and_then(|v| v.as_str()) {
                events.push(StreamEvent::StatusChanged {
                    status: status.to_string(),
                });
            }
        }
        Some("assistant") => {
            if let Some(content) = obj
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                        let name = item
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let input = item.get("input").and_then(|v| v.as_object());
                        let target = if let Some(cmd) = input
                            .and_then(|i| i.get("command"))
                            .and_then(|v| v.as_str())
                        {
                            command_name_without_args(cmd)
                        } else if let Some(path) = input
                            .and_then(|i| i.get("file_path"))
                            .and_then(|v| v.as_str())
                        {
                            path.to_string()
                        } else {
                            name.clone()
                        };
                        events.push(StreamEvent::ToolStarted {
                            tool: name.clone(),
                            target: target.clone(),
                        });

                        if matches!(
                            name.as_str(),
                            "Edit" | "Write" | "Replace" | "View" | "Read"
                        ) {
                            let path = input
                                .and_then(|i| i.get("file_path"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("unknown")
                                .to_string();
                            let action = if matches!(name.as_str(), "Edit" | "Write" | "Replace") {
                                "modify"
                            } else {
                                "read"
                            };
                            events.push(StreamEvent::FileTouched {
                                path,
                                action: action.to_string(),
                            });
                        }
                    }
                }
            }
        }
        Some("user") => {
            if let Some(content) = obj
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    if item.get("type").and_then(|v| v.as_str()) == Some("tool_result") {
                        // We need the tool name. Claude's result does not contain tool name directly.
                        // We need to correlate with tool_use_id, which we don't have here easily.
                        // For N1, we can skip duration for now if not available or assume it's part of result line.
                        events.push(StreamEvent::ToolFinished {
                            tool: "unknown".to_string(),
                            target: "unknown".to_string(),
                            duration_ms: None,
                            status: if item.get("is_error").and_then(|v| v.as_bool()) == Some(true)
                            {
                                "failed".to_string()
                            } else {
                                "success".to_string()
                            },
                        });
                    }
                }
            }
        }
        Some("result") => {
            let usage = obj.get("usage").map(|u| {
                let input = u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                let output = u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                let cost_cents = u.get("cost_cents").and_then(|v| v.as_u64());
                TokenUsage {
                    input,
                    output,
                    total: input + output,
                    cost_cents,
                }
            });
            let status = obj
                .get("subtype")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("status").and_then(|v| v.as_str()))
                .unwrap_or("done")
                .to_string();
            events.push(StreamEvent::SessionEnded {
                status,
                duration_ms: obj.get("duration_ms").and_then(|v| v.as_u64()),
                usage,
            });
        }
        _ => {}
    }
    events
}

pub fn parse_codex_stream_line(line: &str) -> Vec<StreamEvent> {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return vec![];
    };
    let Some(obj) = v.as_object() else {
        return vec![];
    };

    let mut events = Vec::new();
    match obj.get("type").and_then(|v| v.as_str()) {
        Some("session_start") => {
            events.push(StreamEvent::SessionStarted {
                cli_session_id: obj
                    .get("session_id")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                model: obj.get("model").and_then(|v| v.as_str()).map(String::from),
            });
        }
        Some("tool_start") | Some("tool_call") | Some("call") | Some("item.created") => {
            let tool = obj
                .get("tool")
                .and_then(|v| v.as_str())
                .map(String::from)
                .unwrap_or_else(|| {
                    obj.get("item")
                        .and_then(|i| i.get("name"))
                        .and_then(|n| n.as_str())
                        .unwrap_or("unknown")
                        .to_string()
                });
            let target = if let Some(cmd) = obj.get("command").and_then(|v| v.as_str()) {
                command_name_without_args(cmd)
            } else if let Some(path) = obj.get("path").and_then(|v| v.as_str()) {
                path.to_string()
            } else if let Some(args) = obj
                .get("input")
                .and_then(|i| i.get("command"))
                .and_then(|v| v.as_str())
            {
                command_name_without_args(args)
            } else {
                "unknown".to_string()
            };
            events.push(StreamEvent::ToolStarted {
                tool: tool.clone(),
                target: target.clone(),
            });
        }
        Some("tool_result") => {
            events.push(StreamEvent::ToolFinished {
                tool: obj
                    .get("tool")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                target: "unknown".to_string(),
                duration_ms: obj.get("duration_ms").and_then(|v| v.as_u64()),
                status: obj
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("success")
                    .to_string(),
            });
        }
        Some("file_touched") | Some("file_edit") => {
            events.push(StreamEvent::FileTouched {
                path: obj
                    .get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                action: obj
                    .get("action")
                    .and_then(|v| v.as_str())
                    .unwrap_or("modify")
                    .to_string(),
            });
        }
        Some("session_end") => {
            let usage = obj.get("usage").map(|u| {
                let input = u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                let output = u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                let cost_cents = u.get("cost_cents").and_then(|v| v.as_u64());
                TokenUsage {
                    input,
                    output,
                    total: input + output,
                    cost_cents,
                }
            });
            events.push(StreamEvent::SessionEnded {
                status: obj
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("done")
                    .to_string(),
                duration_ms: obj.get("duration_ms").and_then(|v| v.as_u64()),
                usage,
            });
        }
        _ => {
            if let Some(u) = obj.get("usage") {
                let input = u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                let output = u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
                let cost_cents = u.get("cost_cents").and_then(|v| v.as_u64());
                if input > 0 || output > 0 {
                    events.push(StreamEvent::SessionEnded {
                        status: "done".to_string(),
                        duration_ms: None,
                        usage: Some(TokenUsage {
                            input,
                            output,
                            total: input + output,
                            cost_cents,
                        }),
                    });
                }
            }
        }
    }
    events
}
