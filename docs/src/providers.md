# Providers

Warsha supports multiple AI providers. Configure them via CLI or the desktop app.

## Provider Types

| Provider | Type | Local | Cost Tracking | Notes |
|----------|------|-------|---------------|-------|
| OpenAI | Cloud | No | Yes | GPT-4o, GPT-4, GPT-3.5 |
| Anthropic | Cloud | No | Yes | Claude 3.5 Sonnet, Haiku |
| DeepSeek | Cloud | No | Yes | DeepSeek-V3, Coder |
| OpenRouter | Cloud | No | Yes | 100+ models via single API |
| Azure OpenAI | Cloud | No | Yes | Enterprise OpenAI |
| Ollama | Local | Yes | Estimated | Llama, Mistral, CodeLlama |
| LM Studio | Local | Yes | Estimated | Any GGUF model |
| Custom | Cloud/Local | Both | Optional | OpenAI-compatible API |

## Adding Providers

### Via CLI

```bash
# OpenAI
warsha providers add openai \
  --name openai-gpt4o \
  --key sk-... \
  --budget 50

# Anthropic
warsha providers add anthropic \
  --name claude-sonnet \
  --key sk-ant-... \
  --budget 30

# Ollama (local)
warsha providers add ollama \
  --name local-llama3 \
  --base-url http://localhost:11434

# Custom OpenAI-compatible
warsha providers add custom \
  --name my-provider \
  --key my-key \
  --base-url https://api.example.com/v1
```

### Via Desktop App

1. Open **Settings → Providers**
2. Click **Add Provider**
3. Select provider type
4. Enter API key (or use OS Keychain for secure storage)
5. Set optional budget
6. Click **Test** to verify connection
7. Click **Add**

## Role Routing

Each role in the pipeline can use a different provider/model:

```bash
# List current role routing
warsha roles list

# Set role to use specific provider/model
warsha roles set researcher openai-gpt4o gpt-4o
warsha roles set coder anthropic-claude claude-3-5-sonnet
warsha roles set security local-llama3 codellama
```

### Fallback

Enable fallback to automatically try the next provider if the primary fails:

```bash
warsha roles set researcher openai-gpt4o gpt-4o --fallback anthropic-claude
```

## Budget Tracking

### Per-Provider Budget

```bash
warsha providers budget openai-gpt4o 100  # $100/month
```

### Per-Project Budget

```bash
warsha budget set 50  # $50 for this project
```

### Per-Role Budget

```bash
warsha roles set coder openai-gpt4o gpt-4o --budget 10  # $10 per run
```

## Provider Testing

```bash
# Test all providers
warsha providers test

# Test specific provider
warsha providers test openai-gpt4o
```

## Removing Providers

```bash
warsha providers remove openai-gpt4o
```

## Environment Variables

For security, store API keys in OS Keychain (recommended) or environment variables:

```bash
export WARSHA_OPENAI_KEY=sk-...
export WARSHA_ANTHROPIC_KEY=sk-ant-...
```

## Mock Provider (Testing)

For CI/testing without real API keys:

```bash
warsha providers add mock --name test-provider
```

The mock provider returns deterministic responses for pipeline testing.