# LLMask

**Mask sensitive data before it reaches any LLM**

LLMask is an OpenAI-compatible proxy that automatically detects and masks sensitive information (PII, credentials, business data) in your prompts before they reach language models. The masked data is stored locally and automatically remapped in responses.

## Features

- ✅ **OpenAI-compatible API** — Drop-in replacement for OpenAI, Anthropic, and other providers
- 🔒 **Automatic PII detection** — Emails, phone numbers, credit cards, SSNs, API keys, and more
- 🎭 **Reversible masking** — Original data never leaves your infrastructure
- 🔄 **Multi-provider support** — OpenAI, Anthropic Claude, Azure OpenAI, Google Gemini, Mistral
- 🔐 **4 authentication modes** — API keys + OAuth (Claude CLI, Codex CLI)
- 📊 **Live dashboard** — Monitor masked data, mappings, and stats in real-time
- 🚀 **Zero configuration** — Works out of the box with sensible defaults

## Quick Start

### NPM

```bash
# Clone and install
git clone https://github.com/yourusername/llmask.git
cd llmask
npm install

# Configure (copy and edit .env)
cp .env.example .env

# Start the server
npm start
```

LLMask will start on `http://localhost:8787`

### Docker

```bash
docker-compose up -d
```

Dashboard: `http://localhost:8787/dashboard`  
API: `http://localhost:8787/v1/chat/completions`

## Authentication Modes

LLMask supports **4 authentication modes**, configurable via `.env`:

### 1. OpenAI API Key (default)

```bash
PRIMARY_PROVIDER=openai
OPENAI_AUTH_MODE=api_key
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com
```

### 2. OpenAI Codex OAuth (ChatGPT CLI)

```bash
PRIMARY_PROVIDER=openai
OPENAI_AUTH_MODE=oauth_codex
OPENAI_OAUTH_TOKEN_PATH=/path/to/codex/auth.json
OPENAI_BASE_URL=https://chatgpt.com/backend-api
```

Requires a valid OAuth token from Codex CLI (`~/.codex/auth.json`)

### 3. Anthropic API Key

```bash
PRIMARY_PROVIDER=anthropic
ANTHROPIC_AUTH_MODE=api_key
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

### 4. Anthropic Claude CLI OAuth

```bash
PRIMARY_PROVIDER=anthropic
ANTHROPIC_AUTH_MODE=oauth_claude_code
ANTHROPIC_OAUTH_TOKEN_PATH=/path/to/.claude/.credentials.json
```

Requires Claude CLI authentication:
```bash
npx @anthropic-ai/claude-code login
```

Tokens are read from `~/.claude/.credentials.json` by default.

## Configuration

All configuration is done via environment variables (`.env` file):

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `8787` |
| `PRIMARY_PROVIDER` | LLM provider (`openai`, `anthropic`, `gemini`, `mistral`) | `openai` |
| `LLMASK_MODE` | `trust` (auto-mask) or `review` (manual approval) | `trust` |
| `DATA_DIR` | Local data storage directory | `./data` |
| `LOG_LEVEL` | Log verbosity (`info`, `debug`, `trace`) | `info` |

See `.env.example` for the complete list.

## API Endpoints

### Proxy (OpenAI-compatible)

- `POST /v1/chat/completions` — Chat completions (OpenAI format)
- `POST /v1/messages` — Messages (Anthropic format)
- `POST /v1/responses` — Responses (OpenAI Responses API)

### Dashboard & Admin

- `GET /dashboard` — Live web dashboard
- `GET /health` — Health check
- `GET /metrics` — Prometheus metrics

## Usage Example

Once LLMask is running, point your LLM client to `http://localhost:8787`:

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:8787/v1",
    api_key="your-api-key"  # Or leave empty if using OAuth
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[
        {"role": "user", "content": "My email is john@example.com and my phone is +1-555-1234"}
    ]
)

print(response.choices[0].message.content)
```

**What happens:**
1. LLMask detects `john@example.com` and `+1-555-1234`
2. Replaces them with tokens like `[EMAIL_1]` and `[PHONE_1]`
3. Sends masked prompt to the LLM
4. Remaps tokens back to real values in the response
5. Returns the complete response to your app

## Dashboard

Open `http://localhost:8787/dashboard` to:

- 💬 **Chat** — Test masking with a live chat interface
- 📋 **Mappings** — View all detected/masked entities
- ⚙️ **Config** — Adjust detection rules and policies
- 📊 **Stats** — Request counts, masking stats, response times

_Screenshot placeholder: `docs/dashboard-screenshot.png`_

## Docker Deployment

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f llmask

# Stop
docker-compose down
```

## Development

```bash
# Install dependencies
npm install
cd dashboard && npm install

# Run in dev mode (hot reload)
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Build
npm run build
```

## License

This project is licensed under the **PolyForm Noncommercial License 1.0.0**.

You are free to use LLMask for **non-commercial purposes** (personal projects, research, evaluation).  
Commercial use requires a separate license. Contact us at [your-email@example.com].

See [LICENSE](./LICENSE) for details.

## Support

- 📖 **Documentation**: [docs/](./docs/)
- 🐛 **Issues**: [GitHub Issues](https://github.com/yourusername/llmask/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/yourusername/llmask/discussions)

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

---

**Note**: LLMask is a privacy-focused tool designed for non-commercial use. All sensitive data is processed locally and never sent to third parties. Always review your organization's data policies before deploying.
