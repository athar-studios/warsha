//! Ollama adapter (local LLM)

use crate::*;
use futures::StreamExt;
use reqwest::{
    header::{HeaderMap, HeaderValue, CONTENT_TYPE},
    Client,
};
use serde_json::json;
use std::time::Duration;
use warsha_core::{CredentialsRef, ProviderKind};

/// Ollama provider for local LLMs
pub struct OllamaProvider {
    id: String,
    client: Client,
    api_base: String,
    models: Vec<ModelInfo>,
}

impl OllamaProvider {
    /// Create a new Ollama provider with auto-detection
    pub async fn new(
        id: String,
        api_base: Option<String>,
        _credentials: &CredentialsRef,
        _keyring_service: &str,
    ) -> Result<Self> {
        // Auto-detect Ollama at common locations
        let api_base = if let Some(base) = api_base {
            base
        } else if Self::check_endpoint("http://localhost:11434").await {
            "http://localhost:11434".to_string()
        } else if Self::check_endpoint("http://127.0.0.1:11434").await {
            "http://127.0.0.1:11434".to_string()
        } else if let Ok(host) = std::env::var("OLLAMA_HOST") {
            host
        } else {
            "http://localhost:11434".to_string() // Default, will fail on health check
        };

        let client = Client::builder()
            .default_headers({
                let mut h = HeaderMap::new();
                h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
                h
            })
            .timeout(Duration::from_secs(300)) // Long timeout for local inference
            .build()
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let provider = Self {
            id: id.clone(),
            client,
            api_base,
            models: Vec::new(),
        };

        // Fetch available models
        let models = provider.fetch_models().await.unwrap_or_default();
        Ok(Self { models, ..provider })
    }

    /// Check if Ollama is running at the given endpoint
    async fn check_endpoint(url: &str) -> bool {
        let client = match reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
        {
            Ok(c) => c,
            Err(_) => return false,
        };
        client
            .get(format!("{}/api/tags", url.trim_end_matches('/')))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }

    async fn fetch_models(&self) -> Result<Vec<ModelInfo>> {
        let url = format!("{}/api/tags", self.api_base.trim_end_matches('/'));
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(ProviderError::Other(format!("HTTP {}", resp.status())));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let models = data["models"]
            .as_array()
            .ok_or_else(|| ProviderError::Other("Invalid tags response".to_string()))?
            .iter()
            .filter_map(|m| {
                let name = m["name"].as_str()?;
                Some(ollama_model_info(&self.id, name))
            })
            .collect();

        Ok(models)
    }
}

fn ollama_model_info(provider: &str, name: &str) -> ModelInfo {
    // Extract base model name for pricing lookup
    let base = name.split(':').next().unwrap_or(name).to_lowercase();

    let (pricing, context, max_out) = match base.as_str() {
        // High-end models
        "llama3.1:70b" | "llama3.1:70b-instruct" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            128_000,
            8_192,
        ),
        "llama3.1:8b" | "llama3.1:8b-instruct" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            128_000,
            8_192,
        ),
        "llama3.2:3b" | "llama3.2:3b-instruct" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            128_000,
            8_192,
        ),
        "llama3.2:1b" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            128_000,
            8_192,
        ),
        "mistral:7b" | "mistral:instruct" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            32_768,
            8_192,
        ),
        "mixtral:8x7b" | "mixtral:8x22b" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            32_768,
            8_192,
        ),
        "codellama:7b" | "codellama:13b" | "codellama:34b" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            16_384,
            4_096,
        ),
        "phi3:3.8b" | "phi3:14b" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            4_096,
            2_048,
        ),
        "gemma2:2b" | "gemma2:9b" | "gemma2:27b" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            8_192,
            8_192,
        ),
        "qwen2:7b" | "qwen2:72b" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            32_768,
            8_192,
        ),
        "deepseek-coder:6.7b" | "deepseek-coder:33b" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            16_384,
            8_192,
        ),
        "command-r" | "command-r-plus" => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            128_000,
            4_096,
        ),
        _ => (
            ModelPricing {
                input_per_million_cents: 0,
                output_per_million_cents: 0,
            },
            4_096,
            2_048,
        ),
    };

    ModelInfo {
        id: name.to_string(),
        name: name.to_string(),
        provider: provider.to_string(),
        context_window: context,
        max_output: max_out,
        pricing,
    }
}

#[async_trait]
impl ChatProvider for OllamaProvider {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> ProviderKind {
        ProviderKind::Ollama
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        Ok(self.models.clone())
    }

    async fn health(&self) -> Result<HealthCheck> {
        let start = std::time::Instant::now();
        let url = format!("{}/api/tags", self.api_base.trim_end_matches('/'));
        match self.client.get(&url).send().await {
            Ok(resp) => Ok(HealthCheck {
                healthy: resp.status().is_success(),
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
        let url = format!("{}/api/chat", self.api_base.trim_end_matches('/'));

        let messages: Vec<_> = request
            .messages
            .iter()
            .map(|m| {
                json!({
                    "role": m.role,
                    "content": m.content,
                })
            })
            .collect();

        let body = json!({
            "model": request.model,
            "messages": messages,
            "stream": request.stream,
            "options": {
                "temperature": request.temperature.unwrap_or(0.7),
                "num_predict": request.max_tokens.map(|t| t as i64).unwrap_or(-1),
            },
        });

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
            return Err(map_ollama_error(status, err_text));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let message = &data["message"];
        let content = message["content"].as_str().unwrap_or("");

        Ok(ChatResponse {
            id: data["id"].as_str().unwrap_or("").to_string(),
            model: data["model"].as_str().unwrap_or(&request.model).to_string(),
            choices: vec![ChatChoice {
                index: 0,
                message: ChatMessage {
                    role: MessageRole::Assistant,
                    content: content.to_string(),
                },
                finish_reason: data["done_reason"].as_str().map(|s| s.to_string()),
            }],
            usage: TokenUsage {
                input: data["prompt_eval_count"].as_u64().unwrap_or(0),
                output: data["eval_count"].as_u64().unwrap_or(0),
                total: data["prompt_eval_count"].as_u64().unwrap_or(0)
                    + data["eval_count"].as_u64().unwrap_or(0),
            },
        })
    }

    async fn chat_stream(
        &self,
        request: ChatRequest,
    ) -> Result<Box<dyn futures::Stream<Item = Result<ChatStreamChunk>> + Send + Unpin>> {
        let url = format!("{}/api/chat", self.api_base.trim_end_matches('/'));

        let messages: Vec<_> = request
            .messages
            .iter()
            .map(|m| {
                json!({
                    "role": m.role,
                    "content": m.content,
                })
            })
            .collect();

        let body = json!({
            "model": request.model,
            "messages": messages,
            "stream": true,
            "options": {
                "temperature": request.temperature.unwrap_or(0.7),
                "num_predict": request.max_tokens.map(|t| t as i64).unwrap_or(-1),
            },
        });

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
            return Err(map_ollama_error(status, err_text));
        }

        let stream = resp.bytes_stream().map(move |chunk| {
            let chunk = chunk.map_err(|e| ProviderError::Other(e.to_string()))?;
            parse_ollama_stream_chunk(&chunk)
        });

        Ok(Box::new(stream.boxed()))
    }

    fn cost_of(&self, _model: &str, _usage: &TokenUsage) -> Result<u64> {
        // Local models have zero cost
        Ok(0)
    }
}

fn map_ollama_error(status: reqwest::StatusCode, body: String) -> ProviderError {
    let code = status.as_u16();
    match code {
        404 => ProviderError::ModelNotFound(body),
        500..=599 => ProviderError::Other(format!("Server error: {}", code)),
        408 => ProviderError::Timeout("Request timeout".to_string()),
        _ => ProviderError::Other(format!("HTTP {}: {}", code, body)),
    }
}

fn parse_ollama_stream_chunk(chunk: &[u8]) -> Result<ChatStreamChunk> {
    let text = std::str::from_utf8(chunk).map_err(|e| ProviderError::Other(e.to_string()))?;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(data) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(message) = data["message"].as_object() {
                let content = message["content"].as_str();
                let done = data["done"].as_bool().unwrap_or(false);
                return Ok(ChatStreamChunk {
                    id: data["id"].as_str().unwrap_or("").to_string(),
                    model: data["model"].as_str().unwrap_or("").to_string(),
                    choices: vec![StreamChoice {
                        index: 0,
                        delta: ChatMessageDelta {
                            role: Some(MessageRole::Assistant),
                            content: content.map(|s| s.to_string()),
                        },
                        finish_reason: if done { Some("stop".to_string()) } else { None },
                    }],
                });
            }
        }
    }
    Err(ProviderError::Other("No valid chunk data".to_string()))
}
