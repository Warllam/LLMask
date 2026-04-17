# LLMask MCP — Privacy Masking for Claude

Mask sensitive data (PII, API keys, secrets) before it leaves your machine. Works as a Claude plugin via the Model Context Protocol.

## Install in Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "llmask": {
      "command": "npx",
      "args": ["-y", "llmask-mcp"]
    }
  }
}
```

## Install in Claude Code

```bash
claude mcp add llmask -- npx -y llmask-mcp
```

## Usage

Once installed, you can ask Claude:

- "Mask this text before analyzing it: [sensitive content]"
- "Scan my project directory for sensitive data"
- "Mask the file src/config.ts and review it"
- "Unmask this response using scope_id scope_xxx"

## Tools

| Tool | Description |
|------|-------------|
| `mask_text` | Mask sensitive data in a string, returns `scope_id` for later reversal |
| `mask_file` | Read a file and return masked content |
| `unmask_text` | Restore originals using a `scope_id` |
| `scan_directory` | Report which files contain sensitive data |

## Strategies

| Strategy | What it masks |
|----------|---------------|
| `aggressive` (default) | Everything: PII, secrets, IPs, names, high-entropy strings |
| `code-aware` | Secrets + PII + IPs, skips name detection |
| `values-only` | Secrets + PII only, no structural masking |
| `pii-only` | Email, phone, SSN, credit cards, API keys only |
