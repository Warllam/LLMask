type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (!isRecord(item)) return "";
        if (typeof item.text === "string") return item.text;
        if (typeof item.input_text === "string") return item.input_text;
        return "";
      })
      .filter(Boolean);
    return parts.join("\n");
  }
  if (isRecord(content) && typeof content.text === "string") return content.text;
  return "";
}

export function responsesBodyToChatCompletions(body: unknown): AnyRecord {
  const input = isRecord(body) ? body : {};
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

  if (typeof input.instructions === "string" && input.instructions.trim()) {
    messages.push({ role: "system", content: input.instructions });
  }

  const rawInput = input.input;
  if (typeof rawInput === "string") {
    messages.push({ role: "user", content: rawInput });
  } else if (Array.isArray(rawInput)) {
    for (const item of rawInput) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
        continue;
      }
      if (!isRecord(item)) continue;
      const role = item.role === "assistant" ? "assistant" : "user";
      const content = contentToText(item.content);
      messages.push({ role, content });
    }
  }

  if (messages.length === 0) {
    messages.push({ role: "user", content: "" });
  }

  const maxTokens =
    typeof input.max_output_tokens === "number"
      ? input.max_output_tokens
      : typeof input.max_tokens === "number"
        ? input.max_tokens
        : undefined;

  return {
    model: input.model,
    messages,
    stream: false,
    ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
    ...(typeof input.top_p === "number" ? { top_p: input.top_p } : {}),
    ...(typeof maxTokens === "number" ? { max_tokens: maxTokens } : {})
  };
}

export function messagesBodyToChatCompletions(body: unknown): AnyRecord {
  const input = isRecord(body) ? body : {};
  const output: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

  if (typeof input.system === "string" && input.system.trim()) {
    output.push({ role: "system", content: input.system });
  }

  const messages = Array.isArray(input.messages) ? input.messages : [];
  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    const role = msg.role === "assistant" ? "assistant" : "user";
    output.push({ role, content: contentToText(msg.content) });
  }

  if (output.length === 0) {
    output.push({ role: "user", content: "" });
  }

  return {
    model: input.model,
    messages: output,
    stream: false,
    ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
    ...(typeof input.top_p === "number" ? { top_p: input.top_p } : {}),
    ...(typeof input.max_tokens === "number" ? { max_tokens: input.max_tokens } : {})
  };
}

export function chatCompletionsToResponsesJson(raw: unknown): AnyRecord {
  const input = isRecord(raw) ? raw : {};
  const choices = Array.isArray(input.choices) ? input.choices : [];
  const first = isRecord(choices[0]) ? choices[0] : {};
  const message = isRecord(first.message) ? first.message : {};
  const content = typeof message.content === "string" ? message.content : "";
  const usage = isRecord(input.usage) ? input.usage : {};
  const prompt = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completion = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;

  return {
    id: input.id ?? `resp_${Date.now()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: input.model,
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: content }]
      }
    ],
    usage: {
      input_tokens: prompt,
      output_tokens: completion,
      total_tokens: prompt + completion
    }
  };
}

export function chatCompletionsToAnthropicJson(raw: unknown): AnyRecord {
  const input = isRecord(raw) ? raw : {};
  const choices = Array.isArray(input.choices) ? input.choices : [];
  const first = isRecord(choices[0]) ? choices[0] : {};
  const message = isRecord(first.message) ? first.message : {};
  const content = typeof message.content === "string" ? message.content : "";
  const usage = isRecord(input.usage) ? input.usage : {};
  const prompt = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completion = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;

  return {
    id: input.id ?? `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: input.model,
    stop_reason: first.finish_reason ?? "stop",
    content: [{ type: "text", text: content }],
    usage: {
      input_tokens: prompt,
      output_tokens: completion
    }
  };
}
