# AI Assistant

The app includes an embedded AI assistant that provides contextual help for each screen.

## Features
- Context-aware responses based on current screen and app state
- Markdown-formatted answers with code blocks and links
- Remembers conversation history (last 20 messages)
- Privacy-first: your data goes directly to your chosen provider, never through our servers

## Supported Providers

| Provider | Cost | Notes |
|----------|------|-------|
| GitHub Models | Free | Recommended. Rate-limited. Requires GitHub PAT with `models:read` permission |
| OpenAI | Paid | Requires OpenAI API key |
| Claude | Paid | Requires Anthropic API key |

## Setup

1. Click the chat icon in the bottom-right corner
2. Select a provider
3. Click "Get API Key" to open the provider's key creation page in your browser
4. Paste your API key and click "Connect"

### GitHub Models (Free)
- Create a Fine-grained Personal Access Token at https://github.com/settings/personal-access-tokens/new
- Set permissions: Account permissions → Models → Read-only
- Copy and paste the `github_pat_...` token

### OpenAI
- Create an API key at https://platform.openai.com/api-keys
- Copy and paste the `sk-proj-...` key

### Claude
- Create an API key at https://console.anthropic.com/settings/keys
- Copy and paste the `sk-ant-...` key

## Model Selection (GitHub Models Only)

GitHub Models users can choose from multiple models:
1. Click the settings gear icon in the chat header
2. Select your preferred model (e.g., GPT-4o, Llama, Phi-4)
3. Click "Save"

The model list is fetched dynamically and cached for 24 hours.

## Rate Limits

**GitHub Models (Free):**
- Rate limited by requests per minute/day
- Limits vary by model (larger models have stricter limits)
- Switch to OpenAI/Claude if you hit limits

**OpenAI/Claude:**
- Rate limits based on your account tier
- Check provider documentation for details

## Troubleshooting

### AI Assistant not responding
Check the error message displayed. Common issues:
- **GitHub Models:** Token missing `models:read` permission. Create a new Fine-grained PAT with correct permissions.
- **Rate limit exceeded:** Wait for the limit to reset, or switch to a different provider.
- **Invalid API key:** Disconnect and reconnect with a fresh key.

### AI Assistant shows "Loading models..." indefinitely
Disconnect and reconnect. The models list is cached for 24 hours; disconnecting clears the cache.
