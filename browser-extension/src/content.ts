/**
 * LLMask Privacy Shield — Content Script
 *
 * Intercepts chat input on ChatGPT and Claude, masks sensitive data via the
 * LLMask proxy, then remaps pseudonyms back in the displayed responses.
 *
 * Design principles:
 * - SITE_CONFIGS object holds all site-specific selectors — update here when
 *   ChatGPT or Claude change their DOM structure.
 * - All proxy calls are routed through the background service worker to avoid
 *   cross-origin restrictions in the content script context.
 * - On proxy failure, the original text is submitted unmodified (fail-open).
 * - MutationObserver + debounce detects when streaming responses have finished.
 */

// ── Site selector configs (update when DOM changes) ──────────────────────

interface SiteConfig {
  /** Human-readable name for logging */
  name: string;
  /** CSS selector for the chat input element (contenteditable div) */
  inputSelector: string;
  /** CSS selector for the submit/send button */
  submitSelector: string;
  /** CSS selector for assistant response containers */
  responseSelector: string;
  /** CSS selector whose *presence* indicates active streaming */
  streamingSelector: string;
}

const SITE_CONFIGS: Record<string, SiteConfig> = {
  "chat.openai.com": {
    name: "ChatGPT",
    // ProseMirror contenteditable div — fallback to any contenteditable in the form
    inputSelector: "#prompt-textarea, form [contenteditable='true']",
    submitSelector: "button[data-testid='send-button']",
    responseSelector: "[data-message-author-role='assistant']",
    streamingSelector: "button[data-testid='stop-button']",
  },
  "chatgpt.com": {
    name: "ChatGPT",
    inputSelector: "#prompt-textarea, form [contenteditable='true']",
    submitSelector: "button[data-testid='send-button']",
    responseSelector: "[data-message-author-role='assistant']",
    streamingSelector: "button[data-testid='stop-button']",
  },
  "claude.ai": {
    name: "Claude",
    // ProseMirror contenteditable — Claude uses a div with enterkeyhint or role=textbox
    inputSelector:
      ".ProseMirror[contenteditable='true'], [contenteditable='true'][data-placeholder]",
    submitSelector:
      "button[aria-label='Send Message'], button[aria-label='Send message']",
    responseSelector:
      ".font-claude-message, [data-is-streaming]",
    streamingSelector: "[data-is-streaming='true']",
  },
};

// ── State ────────────────────────────────────────────────────────────────

let extensionEnabled = true;
let currentScopeId: string | undefined;
let maskingInProgress = false;

// Track response containers that have already been remapped
const remappedResponses = new WeakSet<Element>();

// ── Init ─────────────────────────────────────────────────────────────────

function getSiteConfig(): SiteConfig | null {
  return SITE_CONFIGS[location.hostname] ?? null;
}

async function init(): Promise<void> {
  const site = getSiteConfig();
  if (!site) return;

  // Load enabled state from background
  const stateResult = await sendMessage({ type: "GET_STATE" }).catch(() => null);
  extensionEnabled = stateResult?.state?.enabled ?? true;

  injectBadge();
  updateBadge(extensionEnabled ? "idle" : "disabled");
  setupSubmitInterception(site);
  setupResponseObserver(site);

  // Reflect state changes made in the popup
  chrome.storage.onChanged.addListener((changes) => {
    if (changes["llmask_state"]) {
      const newState = changes["llmask_state"].newValue as { enabled?: boolean } | undefined;
      extensionEnabled = newState?.enabled ?? extensionEnabled;
      updateBadge(extensionEnabled ? "idle" : "disabled");
    }
  });
}

// ── Submit interception ──────────────────────────────────────────────────

function setupSubmitInterception(site: SiteConfig): void {
  // Use capture phase so we intercept before the app's own handlers.
  // Handles Enter key — Shift+Enter is intentionally left alone (newline).
  document.addEventListener(
    "keydown",
    async (e: KeyboardEvent) => {
      if (!extensionEnabled || maskingInProgress) return;
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey) return;

      const input = findInputElement(site);
      if (!input || !isInputFocused(input)) return;

      const text = getInputText(input).trim();
      if (!text) return;

      e.stopImmediatePropagation();
      e.preventDefault();

      await maskAndSubmit(input, site, text);
    },
    true // capture phase
  );

  // Also intercept clicks on the submit button — some users click rather than Enter
  document.addEventListener(
    "click",
    async (e: MouseEvent) => {
      if (!extensionEnabled || maskingInProgress) return;

      const target = e.target as Element | null;
      if (!target) return;

      const submitBtn = target.closest(site.submitSelector);
      if (!submitBtn) return;

      const input = findInputElement(site);
      if (!input) return;

      const text = getInputText(input).trim();
      if (!text) return;

      e.stopImmediatePropagation();
      e.preventDefault();

      await maskAndSubmit(input, site, text);
    },
    true
  );
}

async function maskAndSubmit(
  input: Element,
  site: SiteConfig,
  text: string
): Promise<void> {
  maskingInProgress = true;
  updateBadge("masking");

  try {
    const result = await sendMessage({
      type: "MASK_TEXT",
      text,
      scopeId: currentScopeId,
    });

    if (result?.ok && result.masked_text) {
      setInputText(input, result.masked_text);
      currentScopeId = result.scope_id;

      // Update stats
      if (result.entity_count > 0) {
        sendMessage({
          type: "RECORD_MASK",
          entityCount: result.entity_count,
        }).catch(() => null);
      }
    }
    // On failure, fall through and submit original text
  } catch {
    // Proxy unreachable — submit original without masking
  }

  maskingInProgress = false;
  updateBadge("idle");
  submitMessage(input, site);
}

// ── Response remapping ────────────────────────────────────────────────────

function setupResponseObserver(site: SiteConfig): void {
  const chatRoot =
    document.querySelector("main") ??
    document.querySelector('[role="main"]') ??
    document.body;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const observer = new MutationObserver(() => {
    if (!extensionEnabled || !currentScopeId) return;
    // Debounce: wait for DOM mutations to settle (streaming in progress keeps resetting)
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      // Only remap if no active streaming indicator
      if (document.querySelector(site.streamingSelector)) return;
      tryRemapResponses(site);
    }, 1500);
  });

  observer.observe(chatRoot, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

async function tryRemapResponses(site: SiteConfig): Promise<void> {
  if (!currentScopeId) return;

  const containers = document.querySelectorAll(site.responseSelector);
  const unremapped = Array.from(containers).filter(
    (el) => !remappedResponses.has(el) && el.textContent?.trim()
  );

  if (unremapped.length === 0) return;

  // Fetch the replacement pairs for this scope once
  const result = await sendMessage({
    type: "REMAP_RESPONSE",
    scopeId: currentScopeId,
  }).catch(() => null);

  if (!result?.ok || !result.replacements || result.replacements.length === 0) {
    // No mappings yet (can happen if masking produced 0 entities); mark as done
    unremapped.forEach((el) => remappedResponses.add(el));
    return;
  }

  for (const container of unremapped) {
    applyReplacementsToElement(container, result.replacements);
    remappedResponses.add(container);
  }
}

/**
 * Walks all text nodes under `element` and applies pseudonym → original
 * string replacements, sorted longest-first to avoid partial matches.
 */
function applyReplacementsToElement(
  element: Element,
  replacements: Array<{ from: string; to: string }>
): void {
  // Sort longest pseudonym first to avoid partial substitutions
  const sorted = [...replacements].sort((a, b) => b.from.length - a.from.length);

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    let content = textNode.textContent ?? "";
    for (const { from, to } of sorted) {
      if (content.includes(from)) {
        content = content.split(from).join(to);
      }
    }
    if (content !== textNode.textContent) {
      textNode.textContent = content;
    }
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────

function findInputElement(site: SiteConfig): Element | null {
  // Try each selector in the comma-separated list
  const selectors = site.inputSelector.split(",").map((s) => s.trim());
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function isInputFocused(input: Element): boolean {
  // The focused element may be a child of the ProseMirror container
  return (
    document.activeElement === input ||
    input.contains(document.activeElement)
  );
}

function getInputText(input: Element): string {
  // innerText preserves newlines better than textContent for multi-paragraph inputs
  return (input as HTMLElement).innerText ?? input.textContent ?? "";
}

function setInputText(input: Element, text: string): void {
  // Focus first so execCommand targets the right element
  (input as HTMLElement).focus();

  // Select all existing content and replace via execCommand.
  // execCommand is deprecated but remains the most reliable way to set
  // ProseMirror / contenteditable content while preserving undo history.
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(input);
  selection?.removeAllRanges();
  selection?.addRange(range);

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  document.execCommand("insertText", false, text);
}

function submitMessage(input: Element, site: SiteConfig): void {
  // Prefer clicking the submit button — it's the safest trigger
  const submitSelectors = site.submitSelector.split(",").map((s) => s.trim());
  for (const selector of submitSelectors) {
    const btn = document.querySelector(selector);
    if (btn instanceof HTMLButtonElement && !btn.disabled) {
      btn.click();
      return;
    }
  }

  // Fallback: dispatch an Enter keydown on the input itself
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    })
  );
}

// ── Badge UI ──────────────────────────────────────────────────────────────

type BadgeState = "idle" | "masking" | "disabled";

function injectBadge(): void {
  if (document.getElementById("llmask-badge")) return;

  const badge = document.createElement("div");
  badge.id = "llmask-badge";
  badge.innerHTML = `<span class="llmask-icon">&#128274;</span><span class="llmask-label">LLMask</span>`;
  badge.title = "LLMask Privacy Shield — click to open settings";
  badge.addEventListener("click", () => {
    // Opens the extension popup — no direct API for this, so do nothing visible
    // The user can click the extension icon in the toolbar
  });
  document.body.appendChild(badge);
}

function updateBadge(state: BadgeState): void {
  const badge = document.getElementById("llmask-badge");
  if (!badge) return;
  badge.dataset["state"] = state;
}

// ── Message passing ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendMessage(msg: unknown): Promise<any> {
  return chrome.runtime.sendMessage(msg);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

init().catch(console.error);

export {}; // Declare this file as an ES module (avoids duplicate-global errors with tsc)
