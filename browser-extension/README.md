# LLMask Browser Extension

Chrome extension (Manifest V3) that intercepts chat input on **ChatGPT** and **Claude**, masks sensitive data through your local LLMask proxy before it reaches the AI, then remaps the pseudonyms back in the displayed response.

```
User types → [Extension intercepts] → LLMask masks → Chat platform → LLM
                                                                        ↓
User reads ← [Extension remaps] ← LLMask looks up mappings ← Response
```

## Prerequisites

- LLMask proxy running at `http://localhost:3456` (or configured URL)
- Node.js 18+ (for building)
- Google Chrome

## Build

```bash
cd browser-extension
npm install
npm run build      # → dist/
npm run watch      # dev mode with rebuild on save
npm run typecheck  # TypeScript check without emitting
```

The compiled extension is written to `dist/`.

## Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `browser-extension/dist/` directory
4. The LLMask shield icon appears in your toolbar

## Configuration

Click the toolbar icon to open the popup:

| Setting | Default | Description |
|---------|---------|-------------|
| Enable / disable | On | Toggle masking globally |
| Proxy URL | `http://localhost:3456` | LLMask server address |

The extension pings `/health` to show connection status.

## How it works

### Input masking

1. User presses **Enter** (or clicks Send) in ChatGPT / Claude
2. Content script intercepts in capture phase, prevents default submit
3. Sends text to background service worker → `POST /v1/text/mask`
4. Proxy returns masked text + `scope_id` (e.g. `Hello ORG_ZORION team`)
5. Content script replaces the input field text with the masked version
6. Submit is triggered programmatically on the now-masked input

### Response remapping

1. MutationObserver watches for new assistant messages
2. After streaming stops (1.5 s of no DOM changes + no streaming indicator), remap runs
3. Sends `scope_id` to background → `POST /v1/text/remap`
4. Proxy returns `{ replacements: [{from, to}] }` (pseudonym → original pairs)
5. Content script walks text nodes in the response and applies replacements in-place

### Fail-open behaviour

If the proxy is unreachable or returns an error, the original unmasked text is submitted. A warning is logged to the browser console. The extension never blocks a message.

## Required proxy endpoints

These two endpoints were added to LLMask specifically for the extension:

### `POST /v1/text/mask`

```json
// Request
{ "text": "Alice works at Acme Corp", "scope_id": "optional-existing-scope" }

// Response
{
  "masked_text": "PER_LENOX works at ORG_ZORION",
  "scope_id": "c3d4e5f6-...",
  "entity_count": 2
}
```

### `POST /v1/text/remap`

```json
// Request
{ "scope_id": "c3d4e5f6-..." }

// Response
{
  "replacements": [
    { "from": "PER_LENOX", "to": "Alice" },
    { "from": "ORG_ZORION", "to": "Acme Corp" }
  ]
}
```

Both endpoints return `Access-Control-Allow-Origin: *` so the background service worker can reach them.

## Updating selectors

ChatGPT and Claude update their DOM structure periodically. All CSS selectors are concentrated in one object at the top of `src/content.ts`:

```typescript
const SITE_CONFIGS: Record<string, SiteConfig> = {
  "chat.openai.com": {
    inputSelector: "#prompt-textarea, form [contenteditable='true']",
    submitSelector: "button[data-testid='send-button']",
    responseSelector: "[data-message-author-role='assistant']",
    streamingSelector: "button[data-testid='stop-button']",
    ...
  },
  "claude.ai": { ... },
};
```

Edit this object and rebuild (`npm run build`) when selectors break.

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab` | Read/write the current tab's DOM |
| `storage` | Persist settings and daily stats |
| `host_permissions: localhost:*` | Background worker fetches to local LLMask proxy |

No data is sent anywhere except your local LLMask instance.

## Development notes

- **CORS**: The background service worker (not content script) makes all HTTP requests to the proxy. The proxy's new endpoints include `Access-Control-Allow-Origin: *`.
- **ProseMirror inputs**: Both ChatGPT and Claude use ProseMirror. Text is set via `document.execCommand('insertText')` (deprecated but Chrome-supported) after selecting all content with the Selection API.
- **Scope ID**: One `scope_id` per page session. It's created by the proxy on the first `/v1/text/mask` call and reused for all subsequent messages in that conversation, ensuring consistent pseudonym mappings.
- **Stats**: Reset daily. Stored in `chrome.storage.sync` — survives restarts, syncs across devices if Chrome sync is enabled.
