import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { ArrowUp, Loader2, Eye, EyeOff, ArrowRightLeft, Shield, X, Send, Copy, Check, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { RequestLogEntry, ChatPreviewResult } from "@/lib/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  maskedContent?: string;
  /** Provider + model that produced this assistant message */
  meta?: { provider: string; model: string };
}

interface ChatProps {
  sessionId?: string | null;
  onSessionUpdate?: () => void;
}

// ---------------------------------------------------------------------------
// Remap helper: replace pseudonyms with originals in text
// ---------------------------------------------------------------------------

function applyRemap(text: string, mappings: Array<[string, string]>): string {
  if (!mappings.length || !text) return text;
  // Sort longest first to avoid partial matches
  const sorted = [...mappings].sort((a, b) => b[0].length - a[0].length);
  const escaped = sorted.map(([pseudo]) => pseudo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Case-insensitive: LLMs may lowercase pseudonyms in free text
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const lowerLookup = new Map(sorted.map(([k, v]) => [k.toLowerCase(), v]));
  return text.replace(regex, (match) => lowerLookup.get(match.toLowerCase()) ?? match);
}

// ---------------------------------------------------------------------------
// Parse existing session requests into chat messages (with both versions)
// ---------------------------------------------------------------------------

function extractContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: Record<string, unknown>) => {
        if (b.type === "text" || b.type === "input_text" || b.type === "output_text")
          return (b.text as string) ?? "";
        return "";
      })
      .filter(Boolean)
      .join("");
  }
  return "";
}

function extractLastUserMessage(body: string): string {
  const parsed = JSON.parse(body);
  let lastUserText = "";

  if (Array.isArray(parsed.messages)) {
    for (const m of parsed.messages) {
      if (m.role === "user") {
        const text = extractContent(m.content);
        if (text) lastUserText = text;
      }
    }
  }

  if (Array.isArray(parsed.input)) {
    for (const item of parsed.input) {
      if ((item.type === "message" || item.role) && item.role === "user") {
        const text = extractContent(item.content);
        if (text) lastUserText = text;
      }
    }
  }

  return lastUserText;
}

function extractResponseBody(responseBody: string | null): string {
  if (!responseBody) return "";
  try {
    const resp = JSON.parse(responseBody);
    const choice = resp.choices?.[0];
    if (choice?.message?.content) return choice.message.content;
    if (resp.output_text) return resp.output_text;
    if (resp.output && Array.isArray(resp.output)) {
      let text = "";
      for (const item of resp.output) {
        if (item.type === "message" && item.role === "assistant") {
          text += extractContent(item.content);
        }
      }
      return text;
    }
    return "";
  } catch {
    return responseBody;
  }
}

function parseSessionMessages(
  requests: RequestLogEntry[],
  remapPairs: Array<[string, string]>
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const req of requests) {
    try {
      const originalText = extractLastUserMessage(req.originalBody);
      const maskedText = extractLastUserMessage(req.rewrittenBody);

      if (originalText) {
        messages.push({
          role: "user",
          content: originalText,
          maskedContent: maskedText !== originalText ? maskedText : undefined,
        });
      }
    } catch { /* skip */ }

    const responseText = extractResponseBody(req.responseBody);
    if (responseText) {
      const deobfuscated = remapPairs.length > 0
        ? applyRemap(responseText, remapPairs)
        : responseText;
      messages.push({
        role: "assistant",
        content: deobfuscated,
        maskedContent: deobfuscated !== responseText ? responseText : undefined,
      });
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Kind badge colors
// ---------------------------------------------------------------------------

const KIND_COLORS: Record<string, string> = {
  org: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  svc: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  tbl: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  col: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  idn: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  per: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  url: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  email: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  phone: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300",
};

// ---------------------------------------------------------------------------
// Code block with syntax highlighting + copy button
// ---------------------------------------------------------------------------

function CodeBlock({ className, children, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const codeString = String(children).replace(/\n$/, "");

  if (!match) {
    // Inline code
    return (
      <code className="px-1.5 py-0.5 rounded bg-muted text-[12px] font-mono" {...props}>
        {children}
      </code>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative rounded-lg overflow-hidden my-2 border border-border">
      <div className="flex items-center justify-between px-3 py-1.5 bg-muted/80 border-b border-border">
        <span className="text-[10px] font-mono text-muted-foreground">{match[1]}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark as Record<string, React.CSSProperties>}
        language={match[1]}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: "12px",
          lineHeight: "1.5",
          padding: "12px 16px",
        }}
      >
        {codeString}
      </SyntaxHighlighter>
    </div>
  );
}

const markdownComponents = {
  code: CodeBlock,
};

// ---------------------------------------------------------------------------
// Memoized message bubble — avoids re-rendering all messages on input change
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  msg: ChatMessage;
  viewMode: "original" | "masked";
  isStreaming: boolean;
  isLast: boolean;
}

const PROVIDER_SHORT: Record<string, string> = {
  anthropic: "Claude",
  "anthropic-oauth": "Claude",
  openai: "OpenAI",
  "openai-codex": "Codex",
  gemini: "Gemini",
  mistral: "Mistral",
};

const MessageBubble = memo(function MessageBubble({ msg, viewMode, isStreaming, isLast }: MessageBubbleProps) {
  const displayContent = viewMode === "masked" && msg.maskedContent
    ? msg.maskedContent
    : msg.content;

  if (msg.role === "user") {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className={cn(
          "max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-br-sm text-[13px] leading-relaxed whitespace-pre-wrap break-words",
          viewMode === "masked" && msg.maskedContent
            ? "bg-amber-500/90 text-white"
            : "bg-primary text-primary-foreground"
        )}>
          {displayContent}
        </div>
      </div>
    );
  }

  return (
    <div className="pr-12 animate-fade-in">
      <div className={cn(
        "text-[13px] leading-relaxed break-words prose prose-sm dark:prose-invert max-w-none",
        "prose-p:my-1.5 prose-headings:mt-3 prose-headings:mb-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-code:text-[12px]",
        viewMode === "masked" && msg.maskedContent
          ? "text-amber-600 dark:text-amber-400"
          : "text-foreground",
        !msg.content && isStreaming && isLast && "min-h-[20px]"
      )}>
        {displayContent ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {displayContent}
          </ReactMarkdown>
        ) : (isStreaming && isLast && (
          <span className="inline-flex gap-1 text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse [animation-delay:300ms]" />
          </span>
        ))}
      </div>
      {msg.meta && (
        <div className="mt-1 flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground/60 font-mono">
            {PROVIDER_SHORT[msg.meta.provider] ?? msg.meta.provider} · {msg.meta.model}
          </span>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Chat({ sessionId, onSessionUpdate }: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const [viewMode, setViewMode] = useState<"original" | "masked">("original");
  const [mappingPairs, setMappingPairs] = useState<Array<[string, string]>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionId = useRef<string | null>(sessionId ?? null);

  // Provider + model selector state
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const providerDropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [fetchedModels, setFetchedModels] = useState<Array<{ id: string; label: string; provider: string }>>([]);
  const [fetchedProviders, setFetchedProviders] = useState<Array<{ id: string; label: string; configured: boolean }>>([]);

  // Fetch providers and models from backend
  useEffect(() => {
    fetch("/dashboard/api/providers")
      .then(r => r.json())
      .then((data: { providers: Array<{ id: string; label: string; configured: boolean }>; activeProvider: string; defaultModel: string }) => {
        setFetchedProviders(data.providers ?? []);
        if (data.activeProvider) setSelectedProvider(data.activeProvider);
        if (data.defaultModel) setSelectedModel(data.defaultModel);
      })
      .catch(() => setFetchedProviders([]));

    fetch("/dashboard/api/models")
      .then(r => r.json())
      .then((data: { models: Array<{ id: string; label: string; provider: string }> }) => {
        setFetchedModels(data.models ?? []);
      })
      .catch(() => setFetchedModels([]));
  }, []);

  // When provider changes: reset model selection
  const handleProviderChange = (providerId: string) => {
    if (providerId === selectedProvider) return;
    setSelectedProvider(providerId);
    setSelectedModel("");
    // Don't clear messages — keep history visible but signal context break
    setMessages((prev) => prev.length > 0
      ? [...prev, { role: "assistant" as const, content: `_[Switched to provider: **${providerId}**. New context started.]_` }]
      : prev
    );
    activeSessionId.current = null;
  };

  const providerLabels: Record<string, string> = { anthropic: "Anthropic", "anthropic-oauth": "Claude OAuth", openai: "OpenAI", "openai-codex": "Codex", gemini: "Google", mistral: "Mistral" };

  const availableModels = useMemo(() => {
    const auto = { id: "", label: "Auto", group: "default" };
    const fromApi = fetchedModels.map(m => ({
      id: m.id,
      label: m.label,
      group: providerLabels[m.provider] ?? m.provider,
    }));
    return [auto, ...fromApi];
  }, [fetchedModels]);

  const selectedModelLabel = useMemo(() => {
    const found = availableModels.find(m => m.id === selectedModel);
    return found?.label ?? "Auto";
  }, [selectedModel, availableModels]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
      if (providerDropdownRef.current && !providerDropdownRef.current.contains(e.target as Node)) {
        setProviderDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Preview mode state
  const [previewMode, setPreviewMode] = useState(false);
  const [preview, setPreview] = useState<ChatPreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [excludedEntities, setExcludedEntities] = useState<Set<string>>(new Set());

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load existing session messages
  useEffect(() => {
    if (!sessionId) {
      activeSessionId.current = null;
      setMessages([]);
      setMappingPairs([]);
      return;
    }

    activeSessionId.current = sessionId;
    setLoadingSession(true);
    Promise.all([
      api.sessionRequests(sessionId),
      api.sessionMappings(sessionId),
    ])
      .then(([reqs, mappings]) => {
        const remapPairs: Array<[string, string]> = mappings.map(
          (m) => [m.pseudonym, m.originalValue] as [string, string]
        );
        setMappingPairs(remapPairs);
        const msgs = parseSessionMessages(reqs, remapPairs);
        setMessages(msgs);
      })
      .catch(console.error)
      .finally(() => setLoadingSession(false));
  }, [sessionId]);

  // Auto-resize textarea
  const adjustTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  // Compute masked text with exclusions applied client-side
  const previewMaskedText = useMemo(() => {
    if (!preview) return "";
    if (excludedEntities.size === 0) return preview.masked;
    // Replace excluded pseudonyms back to originals
    let text = preview.masked;
    for (const entity of preview.entities) {
      if (excludedEntities.has(entity.original)) {
        text = text.split(entity.pseudonym).join(entity.original);
      }
    }
    return text;
  }, [preview, excludedEntities]);

  const previewMessage = async () => {
    const text = input.trim();
    if (!text || streaming || previewLoading) return;

    setPreviewLoading(true);
    try {
      const result = await api.chatPreview(
        text,
        messages.map((m) => ({ role: m.role, content: m.content })),
        activeSessionId.current ?? undefined
      );
      setPreview(result);
      setExcludedEntities(new Set());
    } catch (err) {
      console.error("Preview error:", err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const send = async (overrideExclusions?: string[]) => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setPreview(null);
    setStreaming(true);

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const res = await fetch("/dashboard/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages
            .filter((m) => !m.content.startsWith("_[Switched to provider:"))
            .map((m) => ({ role: m.role, content: m.content })),
          sessionId: activeSessionId.current ?? undefined,
          excludeEntities: overrideExclusions,
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(selectedProvider ? { provider: selectedProvider } : {}),
        }),
      });

      if (!res.ok) throw new Error(`Chat error ${res.status}`);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let assistantContent = "";
      let obfuscatedUserText = "";
      let remapPairs: Array<[string, string]> = [];
      const messageMeta = { provider: selectedProvider, model: selectedModel };

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);

            // Capture obfuscated user message
            if (parsed.type === "llmask-obfuscated") {
              obfuscatedUserText = parsed.text ?? "";
              continue;
            }

            // Capture remap mappings
            if (parsed.type === "llmask-remap") {
              remapPairs = (parsed.mappings as Array<[string, string]>) ?? [];
              continue;
            }

            const delta =
              parsed.choices?.[0]?.delta?.content ??
              parsed.delta?.text ??
              (typeof parsed.delta === "string" ? parsed.delta : "") ??
              "";
            if (delta) {
              assistantContent += delta;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: assistantContent,
                };
                return updated;
              });
            }
          } catch {
            // ignore SSE parse errors
          }
        }
      }

      // Merge new remap pairs into mapping state
      if (remapPairs.length > 0) {
        setMappingPairs((prev) => {
          const existing = new Set(prev.map(([p]) => p));
          const merged = [...prev];
          for (const pair of remapPairs) {
            if (!existing.has(pair[0])) merged.push(pair);
          }
          return merged;
        });
      }

      // After streaming: attach masked versions using captured data
      setMessages((prev) => {
        const updated = [...prev];

        // Set masked content on the user message (second to last)
        if (obfuscatedUserText) {
          const userIdx = updated.length - 2;
          if (userIdx >= 0 && updated[userIdx].role === "user") {
            updated[userIdx] = {
              ...updated[userIdx],
              maskedContent: obfuscatedUserText,
            };
          }
        }

        // The streamed assistant content IS what the LLM produced (with pseudonyms).
        // Apply remap to get the de-anonymized "original" version.
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
          const rawContent = updated[lastIdx].content;
          updated[lastIdx] = {
            ...updated[lastIdx],
            content: remapPairs.length > 0 ? applyRemap(rawContent, remapPairs) : rawContent,
            maskedContent: remapPairs.length > 0 ? rawContent : undefined,
            meta: (messageMeta.provider || messageMeta.model) ? messageMeta : undefined,
          };
        }

        return updated;
      });

    } catch (err) {
      console.error("Chat error:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Error: Failed to get response. Is the proxy running?",
        },
      ]);
    } finally {
      setStreaming(false);
      onSessionUpdate?.();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (previewMode) {
        previewMessage();
      } else {
        send();
      }
    }
  };

  const handleSendFromPreview = () => {
    const exclusions = excludedEntities.size > 0 ? [...excludedEntities] : undefined;
    send(exclusions);
  };

  const toggleEntityExclusion = (original: string) => {
    setExcludedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(original)) {
        next.delete(original);
      } else {
        next.add(original);
      }
      return next;
    });
  };

  const hasMaskedContent = useMemo(() => messages.some((m) => m.maskedContent), [messages]);

  if (loadingSession) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Mapping panel — visible only in masked mode */}
      {viewMode === "masked" && mappingPairs.length > 0 && (
        <div className="w-64 flex-shrink-0 border-r border-border bg-card overflow-y-auto">
          <div className="sticky top-0 bg-card border-b border-border px-3 py-2 flex items-center gap-1.5">
            <ArrowRightLeft className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              Mappings ({mappingPairs.length})
            </span>
          </div>
          <div className="p-2 space-y-1">
            {mappingPairs.map(([pseudo, original], i) => (
              <div
                key={i}
                className="rounded-md bg-muted/50 px-2.5 py-1.5 text-[11px] leading-snug"
              >
                <div className="font-mono text-amber-600 dark:text-amber-400 truncate">
                  {pseudo}
                </div>
                <div className="text-muted-foreground truncate mt-0.5">
                  → {original}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* View mode toggle */}
        {hasMaskedContent && (
          <div className="flex justify-center py-2 border-b border-border">
            <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-[11px]">
              <button
                onClick={() => setViewMode("original")}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors",
                  viewMode === "original"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Eye className="h-3 w-3" />
                Original
              </button>
              <button
                onClick={() => setViewMode("masked")}
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors",
                  viewMode === "masked"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <EyeOff className="h-3 w-3" />
                Masked
              </button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-[60vh]">
              <div className="text-center">
                <p className="text-base font-medium text-muted-foreground">
                  What can I help with?
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Messages are masked through the proxy pipeline
                </p>
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <MessageBubble
                key={i}
                msg={msg}
                viewMode={viewMode}
                isStreaming={streaming}
                isLast={i === messages.length - 1}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-background">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="relative flex items-end rounded-xl border border-input bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent">
            <textarea
              ref={textareaRef}
              className="flex-1 min-h-[44px] max-h-[200px] resize-none bg-transparent px-3.5 py-3 text-[13px] leading-relaxed placeholder:text-muted-foreground focus:outline-none"
              placeholder={sessionId ? "Continue this conversation..." : "Message LLMask..."}
              value={input}
              onChange={(e) => { setInput(e.target.value); adjustTextarea(); }}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={streaming}
            />
            <div className="flex items-center gap-0.5 p-1.5">
              {/* Provider selector */}
              {fetchedProviders.length > 0 && (
                <div className="relative" ref={providerDropdownRef}>
                  <button
                    onClick={() => setProviderDropdownOpen(o => !o)}
                    disabled={streaming}
                    title="Select provider"
                    className={cn(
                      "flex items-center gap-1 h-8 px-2 rounded-lg text-[11px] font-medium transition-colors",
                      selectedProvider
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <span className="max-w-[70px] truncate">
                      {selectedProvider ? (providerLabels[selectedProvider] ?? selectedProvider) : "Provider"}
                    </span>
                    <ChevronDown className={cn("h-3 w-3 transition-transform", providerDropdownOpen && "rotate-180")} />
                  </button>
                  {providerDropdownOpen && (
                    <div className="absolute bottom-full mb-1 right-0 w-56 rounded-lg border border-border bg-card shadow-lg z-50 py-1 max-h-[300px] overflow-y-auto">
                      {fetchedProviders.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => { handleProviderChange(p.id); setProviderDropdownOpen(false); }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-[12px] hover:bg-muted transition-colors",
                            selectedProvider === p.id ? "text-primary font-medium bg-primary/5" : "text-foreground"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span>{p.label}</span>
                            {p.configured && (
                              <span className="text-[9px] text-emerald-600 dark:text-emerald-400">configured</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Model selector */}
              <div className="relative" ref={modelDropdownRef}>
                <button
                  onClick={() => setModelDropdownOpen(o => !o)}
                  disabled={streaming}
                  title="Select model"
                  className={cn(
                    "flex items-center gap-1 h-8 px-2 rounded-lg text-[11px] font-medium transition-colors",
                    selectedModel
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <span className="max-w-[80px] truncate">{selectedModelLabel}</span>
                  <ChevronDown className={cn("h-3 w-3 transition-transform", modelDropdownOpen && "rotate-180")} />
                </button>
                {modelDropdownOpen && (
                  <div className="absolute bottom-full mb-1 right-0 w-52 rounded-lg border border-border bg-card shadow-lg z-50 py-1 max-h-[300px] overflow-y-auto">
                    {(() => {
                      let lastGroup = "";
                      return availableModels.map((m) => {
                        const showGroup = m.group !== lastGroup && m.group !== "default";
                        lastGroup = m.group;
                        return (
                          <div key={m.id}>
                            {showGroup && (
                              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {m.group}
                              </div>
                            )}
                            <button
                              onClick={() => { setSelectedModel(m.id); setModelDropdownOpen(false); }}
                              className={cn(
                                "w-full text-left px-3 py-1.5 text-[12px] hover:bg-muted transition-colors",
                                selectedModel === m.id ? "text-primary font-medium bg-primary/5" : "text-foreground"
                              )}
                            >
                              {m.label}
                            </button>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
              {/* Shield toggle */}
              <button
                onClick={() => { setPreviewMode((p) => !p); setPreview(null); }}
                disabled={streaming}
                title={previewMode ? "Preview mode ON — click to disable" : "Enable preview before sending"}
                className={cn(
                  "flex items-center justify-center h-8 w-8 rounded-lg transition-colors",
                  previewMode
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <Shield className="h-4 w-4" />
              </button>
              {/* Send / Preview button */}
              <button
                onClick={previewMode ? previewMessage : () => send()}
                disabled={!input.trim() || streaming || previewLoading}
                className={cn(
                  "flex items-center justify-center h-8 w-8 rounded-lg transition-colors",
                  input.trim() && !streaming && !previewLoading
                    ? previewMode
                      ? "bg-amber-500 text-white hover:bg-amber-600"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                {streaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : previewLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : previewMode ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Preview panel */}
          {preview && (
            <div className="mt-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20 overflow-y-auto max-h-[60vh]">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    Masking Preview
                  </span>
                  {preview.entities.length > 0 && (
                    <span className="text-[10px] text-amber-600/70 dark:text-amber-400/70">
                      — {preview.entities.length - excludedEntities.size}/{preview.entities.length} entities masked
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setPreview(null)}
                  className="p-0.5 rounded hover:bg-amber-200/50 dark:hover:bg-amber-800/50 transition-colors"
                >
                  <X className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                </button>
              </div>

              {/* Side-by-side comparison */}
              <div className="grid grid-cols-2 divide-x divide-amber-200 dark:divide-amber-800">
                <div className="p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Original</div>
                  <div className="text-[12px] leading-relaxed whitespace-pre-wrap break-words text-foreground">
                    {preview.original}
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1.5">Masked</div>
                  <div className="text-[12px] leading-relaxed whitespace-pre-wrap break-words font-mono text-amber-700 dark:text-amber-300">
                    {previewMaskedText}
                  </div>
                </div>
              </div>

              {/* Entities list */}
              {preview.entities.length > 0 && (
                <div className="border-t border-amber-200 dark:border-amber-800 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    Detected entities
                  </div>
                  <div className="space-y-1">
                    {preview.entities.map((entity, i) => (
                      <label
                        key={i}
                        className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-amber-100/50 dark:hover:bg-amber-900/20 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={!excludedEntities.has(entity.original)}
                          onChange={() => toggleEntityExclusion(entity.original)}
                          className="h-3.5 w-3.5 rounded border-amber-400 text-amber-600 focus:ring-amber-500 accent-amber-600"
                        />
                        <span className={cn(
                          "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium",
                          KIND_COLORS[entity.kind] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                        )}>
                          {entity.kind}
                        </span>
                        <span className={cn(
                          "text-[12px] font-medium",
                          excludedEntities.has(entity.original) ? "line-through text-muted-foreground" : "text-foreground"
                        )}>
                          {entity.original}
                        </span>
                        <span className="text-[11px] text-muted-foreground">→</span>
                        <span className={cn(
                          "text-[12px] font-mono",
                          excludedEntities.has(entity.original)
                            ? "line-through text-muted-foreground"
                            : "text-amber-600 dark:text-amber-400"
                        )}>
                          {entity.pseudonym}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-amber-200 dark:border-amber-800">
                <button
                  onClick={() => setPreview(null)}
                  className="px-3 py-1.5 text-[11px] rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendFromPreview}
                  disabled={streaming}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50"
                >
                  <Send className="h-3 w-3" />
                  Send masked
                </button>
              </div>
            </div>
          )}

          {!preview && (
            <p className="text-[10px] text-muted-foreground/50 text-center mt-1.5">
              {previewMode
                ? "Preview mode — click Eye to inspect masking before sending"
                : "Shield → Detection → Policy → Rewrite → Provider → Remap → Unshield"}
            </p>
          )}
        </div>
      </div>
      </div>{/* end main chat area */}
    </div>
  );
}
