//! OpenAI-compatible adapter (OpenAI, Azure, DeepSeek, OpenRouter, etc.)

use crate::*;
use futures::StreamExt;
use reqwest::{
    header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    Client,
};
use serde_json::json;
use std::time::Duration;
use warsha_core::{CredentialsRef, ProviderKind};

/// OpenAI-compatible provider
pub struct OpenAIProvider {
    id: String,
    client: Client,
    api_base: String,
    _api_key: String,
    models: Vec<ModelInfo>,
}

impl OpenAIProvider {
    /// Create a new OpenAI-compatible provider
    pub async fn new(
        id: String,
        api_base: Option<String>,
        credentials: &CredentialsRef,
        keyring_service: &str,
    ) -> Result<Self> {
        let api_base = api_base.unwrap_or_else(|| "https://api.openai.com/v1".to_string());
        let api_key = load_key(credentials, keyring_service, &id).await?;

        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", api_key))
                .map_err(|e| ProviderError::Auth(format!("Invalid API key: {}", e)))?,
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

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
            models: Vec::new(),
        };

        // Fetch models on creation
        let models = provider.fetch_models().await.unwrap_or_else(|_| {
            vec![
                default_model_info(&id, "gpt-4o"),
                default_model_info(&id, "gpt-4o-mini"),
                default_model_info(&id, "gpt-4-turbo"),
            ]
        });

        Ok(Self { models, ..provider })
    }

    /// Build an OpenAI-compatible provider directly from an [`EnvLlmConfig`] —
    /// its `base_url`, its key and its model — without touching the OS keychain
    /// and without making any network call at construction time.
    ///
    /// A config with no key cannot serve a hosted endpoint, so this refuses with
    /// [`ProviderError::Auth`] rather than building a client that would fail at
    /// the first call. The key never appears in the error text.
    pub fn from_env_config(id: String, config: &EnvLlmConfig) -> Result<Self> {
        let api_key = config.api_key.as_ref().ok_or_else(|| {
            ProviderError::Auth(format!(
                "no API key in the environment (WARSHA_LLM_API_KEY) for provider {id}"
            ))
        })?;

        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {api_key}"))
                .map_err(|e| ProviderError::Auth(format!("Invalid API key: {e}")))?,
        );
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let client = Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        Ok(Self {
            models: vec![default_model_info(&id, &config.model)],
            id,
            client,
            api_base: config.base_url.clone(),
            _api_key: api_key.clone(),
        })
    }

    async fn fetch_models(&self) -> Result<Vec<ModelInfo>> {
        let url = format!("{}/models", self.api_base.trim_end_matches('/'));
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

        let models = data["data"]
            .as_array()
            .ok_or_else(|| ProviderError::Other("Invalid models response".to_string()))?
            .iter()
            .filter_map(|m| {
                let id = m["id"].as_str()?;
                Some(default_model_info(&self.id, id))
            })
            .collect();

        Ok(models)
    }
}

fn default_model_info(provider: &str, id: &str) -> ModelInfo {
    let (pricing, context, max_out) = match id {
        s if s.contains("gpt-4o-mini") => (
            ModelPricing {
                input_per_million_cents: 15,
                output_per_million_cents: 60,
            },
            128_000,
            16_384,
        ),
        s if s.contains("gpt-4o") => (
            ModelPricing {
                input_per_million_cents: 250,
                output_per_million_cents: 1_000,
            },
            128_000,
            16_384,
        ),
        s if s.contains("gpt-4-turbo") => (
            ModelPricing {
                input_per_million_cents: 1_000,
                output_per_million_cents: 3_000,
            },
            128_000,
            4_096,
        ),
        s if s.contains("gpt-3.5-turbo") => (
            ModelPricing {
                input_per_million_cents: 50,
                output_per_million_cents: 150,
            },
            16_384,
            4_096,
        ),
        _ => (
            ModelPricing {
                input_per_million_cents: 100,
                output_per_million_cents: 200,
            },
            4_096,
            2_048,
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
impl ChatProvider for OpenAIProvider {
    fn id(&self) -> &str {
        &self.id
    }
    fn kind(&self) -> ProviderKind {
        ProviderKind::OpenAI
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>> {
        Ok(self.models.clone())
    }

    async fn health(&self) -> Result<HealthCheck> {
        let start = std::time::Instant::now();
        let url = format!("{}/models", self.api_base.trim_end_matches('/'));
        match self.client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => Ok(HealthCheck {
                healthy: true,
                latency_ms: Some(start.elapsed().as_millis() as u64),
                error: None,
            }),
            Ok(resp) => Ok(HealthCheck {
                healthy: false,
                latency_ms: Some(start.elapsed().as_millis() as u64),
                error: Some(format!("HTTP {}", resp.status())),
            }),
            Err(e) => Ok(HealthCheck {
                healthy: false,
                latency_ms: None,
                error: Some(e.to_string()),
            }),
        }
    }

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse> {
        let url = format!("{}/chat/completions", self.api_base.trim_end_matches('/'));

        let body = json!({
            "model": request.model,
            "messages": request.messages.iter().map(|m| json!({
                "role": m.role,
                "content": m.content,
            })).collect::<Vec<_>>(),
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": request.stream,
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
            return Err(map_openai_error(status, err_text));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| ProviderError::Other(e.to_string()))?;

        let usage = data["usage"].clone();
        let input = usage["prompt_tokens"].as_u64().unwrap_or(0);
        let output = usage["completion_tokens"].as_u64().unwrap_or(0);

        let choices = data["choices"]
            .as_array()
            .ok_or_else(|| ProviderError::Other("No choices in response".to_string()))?
            .iter()
            .map(|c| ChatChoice {
                index: c["index"].as_u64().unwrap_or(0) as u32,
                message: ChatMessage {
                    role: c["message"]["role"]
                        .as_str()
                        .map(parse_role)
                        .unwrap_or(MessageRole::Assistant),
                    content: c["message"]["content"].as_str().unwrap_or("").to_string(),
                },
                finish_reason: c["finish_reason"].as_str().map(|s| s.to_string()),
            })
            .collect();

        Ok(ChatResponse {
            id: data["id"].as_str().unwrap_or("").to_string(),
            model: data["model"].as_str().unwrap_or(&request.model).to_string(),
            choices,
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
        let url = format!("{}/chat/completions", self.api_base.trim_end_matches('/'));

        let body = json!({
            "model": request.model,
            "messages": request.messages.iter().map(|m| json!({
                "role": m.role,
                "content": m.content,
            })).collect::<Vec<_>>(),
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "stream": true,
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
            return Err(map_openai_error(status, err_text));
        }

        let stream = resp.bytes_stream().map(move |chunk| {
            let chunk = chunk.map_err(|e| ProviderError::Other(e.to_string()))?;
            parse_openai_stream_chunk(&chunk)
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
                input_per_million_cents: 100,
                output_per_million_cents: 200,
            });

        let input_cost =
            (usage.input as f64 / 1_000_000.0) * pricing.input_per_million_cents as f64;
        let output_cost =
            (usage.output as f64 / 1_000_000.0) * pricing.output_per_million_cents as f64;
        Ok((input_cost + output_cost).ceil() as u64)
    }
}

fn map_openai_error(status: reqwest::StatusCode, body: String) -> ProviderError {
    let code = status.as_u16();
    match code {
        401 | 403 => ProviderError::Auth(format!("Authentication failed: {code}")),
        404 => ProviderError::ModelNotFound(body),
        429 => ProviderError::RateLimited(body),
        402 => ProviderError::QuotaExhausted(body),
        500..=599 => ProviderError::Other(format!("Server error: {}", code)),
        408 => ProviderError::Timeout("Request timeout".to_string()),
        _ => ProviderError::Other(format!("HTTP {}: {}", code, body)),
    }
}

fn parse_openai_stream_chunk(chunk: &[u8]) -> Result<ChatStreamChunk> {
    let text = std::str::from_utf8(chunk).map_err(|e| ProviderError::Other(e.to_string()))?;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line == "data: [DONE]" {
            continue;
        }
        if let Some(json_str) = line.strip_prefix("data: ") {
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(json_str) {
                if let Some(choices) = data["choices"].as_array() {
                    if let Some(choice) = choices.first() {
                        return Ok(ChatStreamChunk {
                            id: data["id"].as_str().unwrap_or("").to_string(),
                            model: data["model"].as_str().unwrap_or("").to_string(),
                            choices: vec![StreamChoice {
                                index: choice["index"].as_u64().unwrap_or(0) as u32,
                                delta: ChatMessageDelta {
                                    role: choice["delta"]["role"].as_str().map(parse_role),
                                    content: choice["delta"]["content"]
                                        .as_str()
                                        .map(|s| s.to_string()),
                                },
                                finish_reason: choice["finish_reason"]
                                    .as_str()
                                    .map(|s| s.to_string()),
                            }],
                        });
                    }
                }
            }
        }
    }
    Err(ProviderError::Other("No valid chunk data".to_string()))
}

/// Parse role from string
fn parse_role(s: &str) -> MessageRole {
    match s.to_lowercase().as_str() {
        "system" => MessageRole::System,
        "user" => MessageRole::User,
        "assistant" => MessageRole::Assistant,
        "tool" => MessageRole::Tool,
        _ => MessageRole::Assistant,
    }
}
pub async fn load_key(
    credentials: &CredentialsRef,
    _service: &str,
    _account: &str,
) -> Result<String> {
    match credentials {
        CredentialsRef::Keychain {
            service: svc,
            account: acc,
        } => {
            let entry = keyring::Entry::new(svc, acc);
            entry
                .get_password()
                .map_err(|e| ProviderError::Auth(e.to_string()))
        }
        CredentialsRef::EnvVar { var } => {
            std::env::var(var).map_err(|_| ProviderError::Auth(format!("Env var {} not set", var)))
        }
        CredentialsRef::None => Err(ProviderError::Auth("No credentials configured".to_string())),
    }
}

/// Store API key to keychain
pub async fn store_key(
    credentials: &CredentialsRef,
    _service: &str,
    _account: &str,
    key: &str,
) -> Result<()> {
    match credentials {
        CredentialsRef::Keychain {
            service: svc,
            account: acc,
        } => {
            let entry = keyring::Entry::new(svc, acc);
            entry
                .set_password(key)
                .map_err(|e| ProviderError::Auth(e.to_string()))
        }
        CredentialsRef::EnvVar { .. } => {
            Err(ProviderError::Auth("Cannot store to env var".to_string()))
        }
        CredentialsRef::None => Err(ProviderError::Auth("No credentials configured".to_string())),
    }
}

/// Delete API key from keychain
pub async fn delete_key(credentials: &CredentialsRef) -> Result<()> {
    match credentials {
        CredentialsRef::Keychain {
            service: svc,
            account: acc,
        } => {
            let entry = keyring::Entry::new(svc, acc);
            let _ = entry.delete_password();
            Ok(())
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with_key() -> EnvLlmConfig {
        EnvLlmConfig {
            base_url: "https://router.test/v1".to_string(),
            api_key: Some("sk-test-not-a-real-key".to_string()),
            model: "vendor/test-model".to_string(),
        }
    }

    #[tokio::test]
    async fn from_env_config_builds_without_keychain_or_network() {
        // Construction reads nothing but the config it is given: no keychain and
        // no model fetch. `list_models` answering from the stored catalog proves
        // the built client carries the config's model.
        let provider =
            OpenAIProvider::from_env_config("env-openai".to_string(), &config_with_key())
                .expect("a config with a key builds");
        assert_eq!(provider.id(), "env-openai");
        let models = provider
            .list_models()
            .await
            .expect("the catalog is read locally");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "vendor/test-model");
    }

    #[test]
    fn from_env_config_without_a_key_is_an_auth_error_that_leaks_nothing() {
        let config = EnvLlmConfig {
            base_url: "https://router.test/v1".to_string(),
            api_key: None,
            model: "vendor/test-model".to_string(),
        };
        // `OpenAIProvider` carries live request headers, so it deliberately has no
        // `Debug`; the result is matched by hand instead of `expect_err`.
        let error = match OpenAIProvider::from_env_config("env-openai".to_string(), &config) {
            Ok(_) => panic!("a config without a key must not build a provider"),
            Err(error) => error,
        };
        match &error {
            ProviderError::Auth(message) => {
                assert!(
                    !message.contains("sk-"),
                    "the error text names a key: {message}"
                );
            }
            other => panic!("expected an auth error, got {other:?}"),
        }
    }

    #[test]
    fn from_env_config_uses_the_env_defaults_when_the_lookup_is_empty() {
        // The defaults a caller gets from `EnvLlmConfig::from_lookup` land in the
        // provider unchanged — the base url and model wiring is the whole point.
        match OpenAIProvider::from_env_config(
            "env-openai".to_string(),
            &EnvLlmConfig::from_lookup(|_| None),
        ) {
            Ok(_) => panic!("the default config has no key"),
            Err(ProviderError::Auth(_)) => {}
            Err(other) => panic!("expected an auth error, got {other:?}"),
        }

        let config = EnvLlmConfig {
            api_key: Some("sk-again-not-real".to_string()),
            ..EnvLlmConfig::from_lookup(|_| None)
        };
        let provider = OpenAIProvider::from_env_config("env-openai".to_string(), &config)
            .expect("a key completes the default config");
        assert_eq!(provider.api_base, DEFAULT_LLM_BASE_URL);
        assert_eq!(provider.models[0].id, DEFAULT_LLM_MODEL);
    }
}
