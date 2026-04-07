/**
 * LLMask Privacy Shield — Popup UI
 *
 * Communicates with the background service worker to read/write state
 * and display connection status + daily stats.
 */

// ── Helpers ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendMessage(msg: unknown): Promise<any> {
  return chrome.runtime.sendMessage(msg);
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

// ── UI refs ───────────────────────────────────────────────────────────────

const toggleEl = el<HTMLInputElement>("toggle-enabled");
const proxyUrlEl = el<HTMLInputElement>("proxy-url");
const btnCheck = el<HTMLButtonElement>("btn-check");
const statusDot = el<HTMLSpanElement>("status-dot");
const statusText = el<HTMLSpanElement>("status-text");
const statMasked = el<HTMLSpanElement>("stat-masked");
const statEntities = el<HTMLSpanElement>("stat-entities");

// ── Status indicator ──────────────────────────────────────────────────────

function setStatus(state: "checking" | "ok" | "error", message: string): void {
  statusDot.dataset["state"] = state;
  statusText.textContent = message;
}

// ── Load state ────────────────────────────────────────────────────────────

async function loadAndRender(): Promise<void> {
  const result = await sendMessage({ type: "GET_STATE" }).catch(() => null);
  if (!result?.ok || !result.state) {
    setStatus("error", "Could not load state");
    return;
  }

  const { enabled, proxyUrl, stats } = result.state;
  toggleEl.checked = enabled;
  proxyUrlEl.value = proxyUrl;
  statMasked.textContent = String(stats.maskedToday);
  statEntities.textContent = String(stats.entitiesProtected);

  checkProxy(proxyUrl);
}

// ── Proxy health check ────────────────────────────────────────────────────

async function checkProxy(url?: string): Promise<void> {
  setStatus("checking", "Connecting…");
  const result = await sendMessage({ type: "CHECK_PROXY" }).catch(() => null);
  if (result?.reachable) {
    const proxyUrl = url ?? proxyUrlEl.value;
    setStatus("ok", `Connected · ${new URL(proxyUrl).host}`);
  } else {
    setStatus("error", "Proxy unreachable — is LLMask running?");
  }
}

// ── Event listeners ───────────────────────────────────────────────────────

toggleEl.addEventListener("change", async () => {
  await sendMessage({ type: "SET_STATE", patch: { enabled: toggleEl.checked } });
});

proxyUrlEl.addEventListener("change", async () => {
  const url = proxyUrlEl.value.trim();
  if (!url) return;
  await sendMessage({ type: "SET_STATE", patch: { proxyUrl: url } });
  checkProxy(url);
});

btnCheck.addEventListener("click", () => {
  const url = proxyUrlEl.value.trim();
  if (url) {
    sendMessage({ type: "SET_STATE", patch: { proxyUrl: url } }).catch(() => null);
  }
  checkProxy(url || undefined);
});

// ── Init ──────────────────────────────────────────────────────────────────

loadAndRender().catch(console.error);

export {}; // Declare this file as an ES module (avoids duplicate-global errors with tsc)
