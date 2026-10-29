//! Anthropic adapter (Claude API)

use crate::*;
use futures::StreamExt;
use reqwest::{
    header::{HeaderMap, HeaderValue, CONTENT_TYPE, USER_AGENT},
    Client,
};
use serde_json::json;
use std::time::Duration;
use warsha_core::{CredentialsRef, ProviderKind};

/// Anthropic provider
pub struct AnthropicProvider {
    id: String,
    client: Client,
    api_base: String,
    _api_key: String,
    models: Vec<ModelInfo>,
}

impl AnthropicProvider {
    /// Create a new Anthropic provider
    pub async fn new(
        id: String,
        api_base: Option<String>,
        credentials: &CredentialsRef,
        keyring_service: &str,
    ) -> Result<Self> {
        let api_base = api_base.unwrap_or_else(|| "https://api.anthropic.com".to_string());
        let api_key = load_key(credentials, keyring_service, &id).await?;

        let mut headers = HeaderMap::new();
        headers.insert(
            "x-api-key",
            HeaderValue::from_str(&api_key)
                .map_err(|e| ProviderError::Auth(format!("Invalid API key: {}", e)))?,
        );
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(USER_AGENT, HeaderValue::from_static("warsha/0.1"));

        let client = Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let provider = Self {
            id: id.clone(),
            client,
            api_base,
            _api_key: api_key,
            models: vec![
                default_model_info(&id, "claude-3-5-sonnet-20241022"),
                default_model_info(&id, "claude-3-5-haiku-20241022"),
                default_model_info(&id, "claude-3-opus-20240229"),
            ],
        };

        // Try to fetch models
        let _ = provider.fetch_models().await;

        Ok(provider)
    }

    async fn fetch_models(&self) -> Result<()> {
        // Anthropic doesn't have a public models endpoint yet
        // Models are hardcoded above
        Ok(())
    }
}

fn default_model_info(provider: &str, id: &str) -> ModelInfo {
    let (pricing, context, max_out) = match id {
        s if s.contains("claude-3-5-sonnet") => (
            ModelPricing {
                input_per_million_cents: 300,
                output_per_million_cents: 1_500,
            },
            200_000,
            8_192,
        ),
        s if s.contains("claude-3-5-haiku") => (
            ModelPricing {
                input_per_million_cents: 80,
                output_per_million_cents: 400,
            },
            200_000,
            8_192,
        ),
        s if s.contains("claude-3-opus") => (
            ModelPricing {
                input_per_million_cents: 1_500,
                output_per_million_cents: 7_500,
            },
            200_000,
            4_096,
        ),
        _ => (
            ModelPricing {
                input_per_million_cents: 100,
                output_per_million_cents: 200,
            },
            200_000,
            4_096,
        ),
    };

    ModelInfo {
        id: id.to_string(),
        name: id.to_string(),
        provider: provider.to_string(),
        context_window: context,
        max_output: max_out,
        pricing,
    }
}

#[async_trait]
impl ChatProvider for AnthropicProvider {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> ProviderKind {
        ProviderKind::Anthropic
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        Ok(self.models.clone())
    }

    async fn health(&self) -> Result<HealthCheck> {
        let start = std::time::Instant::now();
        // Use a minimal request to check health
        let url = format!("{}/v1/messages", self.api_base.trim_end_matches('/'));
        let body = json!({
            "model": "claude-3-5-haiku-20241022",
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}],
        });
        match self.client.post(&url).json(&body).send().await {
            Ok(resp) => Ok(HealthCheck {
                healthy: resp.status().is_success() || resp.status().as_u16() == 400,
                latency_ms: Some(start.elapsed().as_millis() as u64),
                error: if resp.status().is_success() {
                    None
                } else {
                    Some(format!("HTTP {}", resp.status()))
                },
            }),
            Err(e) => Ok(HealthCheck {
                healthy: false,
                latency_ms: None,
                error: Some(e.to_string()),
            }),
        }
    }

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse> {
        let url = format!("{}/v1/messages", self.api_base.trim_end_matches('/'));

        let system = request
            .messages
            .iter()
            .find(|m| m.role == MessageRole::System)
            .map(|m| m.content.clone());

        let messages: Vec<_> = request
            .messages
            .iter()
            .filter(|m| m.role != MessageRole::System)
            .map(|m| {
                json!({
                    "role": m.role,
                    "content": m.content,
                })
            })
            .collect();

        let mut body = json!({
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_tokens.unwrap_or(4096),
            "temperature": request.temperature.unwrap_or(1.0),
        });

        if let Some(sys) = system {
            body["system"] = json!(sys);
        }

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(map_anthropic_error(status, err_text));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let usage = &data["usage"];
        let input = usage["input_tokens"].as_u64().unwrap_or(0);
        let output = usage["output_tokens"].as_u64().unwrap_or(0);

        let content = data["content"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|c| c["text"].as_str())
            .unwrap_or("");

        Ok(ChatResponse {
            id: data["id"].as_str().unwrap_or("").to_string(),
            model: data["model"].as_str().unwrap_or(&request.model).to_string(),
            choices: vec![ChatChoice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: content.to_string(),
                },
                finish_reason: data["stop_reason"].as_str().map(|s| s.to_string()),
            }],
            usage: TokenUsage {
                input,
                output,
                total: input + output,
            },
        })
    }

    async fn chat_stream(
        &self,
        request: ChatRequest,
    ) -> Result<Box<dyn futures::Stream<Item = Result<ChatStreamChunk>> + Send + Unpin>> {
        let url = format!("{}/v1/messages", self.api_base.trim_end_matches('/'));

        let system = request
            .messages
            .iter()
            .find(|m| m.role == MessageRole::System)
            .map(|m| m.content.clone());

        let messages: Vec<_> = request
            .messages
            .iter()
            .filter(|m| m.role != MessageRole::System)
            .map(|m| {
                json!({
                    "role": m.role,
                    "content": m.content,
                })
            })
            .collect();

        let mut body = json!({
            "model": request.model,
            "messages": messages,
            "max_tokens": request.max_tokens.unwrap_or(4096),
            "temperature": request.temperature.unwrap_or(1.0),
            "stream": true,
        });

        if let Some(sys) = system {
            body["system"] = json!(sys);
        }

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let status = resp.status();
        if !status.is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(map_anthropic_error(status, err_text));
        }

        let stream = resp.bytes_stream().map(move |chunk| {
            let chunk = chunk.map_err(|e| ProviderError::Other(e.to_string()))?;
            parse_anthropic_stream_chunk(&chunk)
        });

        Ok(Box::new(stream.boxed()))
    }

    fn cost_of(&self, model: &str, usage: &TokenUsage) -> Result<u64> {
        let pricing = self
            .models
            .iter()
            .find(|m| m.id == model)
            .map(|m| m.pricing)
            .unwrap_or_else(|| ModelPricing {
                input_per_million_cents: 300,
                output_per_million_cents: 1_500,
            });

        let input_cost =
            (usage.input as f64 / 1_000_000.0) * pricing.input_per_million_cents as f64;
        let output_cost =
            (usage.output as f64 / 1_000_000.0) * pricing.output_per_million_cents as f64;
        Ok((input_cost + output_cost).ceil() as u64)
    }
}

fn map_anthropic_error(status: reqwest::StatusCode, body: String) -> ProviderError {
    let code = status.as_u16();
    match code {
        401 => ProviderError::Auth("Invalid API key".to_string()),
        429 => ProviderError::RateLimited(body),
        402 => ProviderError::QuotaExhausted(body),
        500..=599 => ProviderError::Other(format!("Server error: {}", code)),
        408 => ProviderError::Timeout("Request timeout".to_string()),
        _ => ProviderError::Other(format!("HTTP {}: {}", code, body)),
    }
}

fn parse_anthropic_stream_chunk(chunk: &[u8]) -> Result<ChatStreamChunk> {
    let text = std::str::from_utf8(chunk).map_err(|e| ProviderError::Other(e.to_string()))?;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(json_str) = line.strip_prefix("data: ") {
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(json_str) {
                if data["type"] == "content_block_delta" {
                    if let Some(delta) = data["delta"]["text"].as_str() {
                        return Ok(ChatStreamChunk {
                            id: data["message"]["id"].as_str().unwrap_or("").to_string(),
                            model: data["message"]["model"].as_str().unwrap_or("").to_string(),
                            choices: vec![StreamChoice {
                                index: 0,
                                delta: ChatMessageDelta {
                                    role: Some(MessageRole::Assistant),
                                    content: Some(delta.to_string()),
                                },
                                finish_reason: None,
                            }],
                        });
                    }
                } else if data["type"] == "message_stop" {
                    return Ok(ChatStreamChunk {
                        id: data["message"]["id"].as_str().unwrap_or("").to_string(),
                        model: data["message"]["model"].as_str().unwrap_or("").to_string(),
                        choices: vec![StreamChoice {
                            index: 0,
                            delta: ChatMessageDelta {
                                role: None,
                                content: None,
                            },
                            finish_reason: Some("stop".to_string()),
                        }],
                    });
                }
            }
        }
    }
    Err(ProviderError::Other("No valid chunk data".to_string()))
}
