import { spawn } from "node:child_process";
import { PassThrough, Readable } from "node:stream";
import type { FastifyBaseLogger } from "fastify";
import { isClaudeCliAvailable } from "../../shared/anthropic-claude-oauth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaudeCliResult = {
  exitCode: number;
  fullText: string;
  costUsd: number;
  usage: { inputTokens: number; outputTokens: number };
  error?: string;
};

export type SpawnClaudeCliOptions = {
  prompt: string;
  systemPrompt?: string;
  model: string;
  timeoutMs: number;
  logger: FastifyBaseLogger;
};

// ---------------------------------------------------------------------------
// CLI resolution (cached)
// ---------------------------------------------------------------------------

let cachedCommand: { command: string; prefixArgs: string[] } | null = null;

function resolveClaudeCommand(): { command: string; prefixArgs: string[] } {
  if (cachedCommand) return cachedCommand;

  if (process.platform === "win32") {
    // On Windows, .cmd files don't pipe stdout correctly with child_process.spawn.
    // Resolve the actual Node.js entry point and spawn node directly.
    const npmGlobal = process.env.APPDATA
      ? `${process.env.APPDATA}/npm/node_modules/@anthropic-ai/claude-code/cli.js`
      : null;
    const { existsSync } = require("fs");
    if (npmGlobal && existsSync(npmGlobal)) {
      cachedCommand = { command: process.execPath, prefixArgs: [npmGlobal] };
    } else {
      // Fallback: try npx
      cachedCommand = { command: process.execPath, prefixArgs: [require.resolve("npx"), "@anthropic-ai/claude-code"] };
    }
  } else if (isClaudeCliAvailable()) {
    cachedCommand = { command: "claude", prefixArgs: [] };
  } else {
    cachedCommand = { command: "npx", prefixArgs: ["@anthropic-ai/claude-code"] };
  }
  return cachedCommand;
}

// ---------------------------------------------------------------------------
// Prompt builder: messages array → { systemPrompt, userPrompt }
// ---------------------------------------------------------------------------

export function buildCliPrompt(
  messages: Array<{ role: string; content: string }>
): { systemPrompt: string | null; userPrompt: string } {
  const systemParts: string[] = [];
  const conversationParts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else if (msg.role === "user") {
      conversationParts.push(msg.content);
    } else if (msg.role === "assistant") {
      conversationParts.push(`[Previous assistant response]\n${msg.content}`);
    }
  }

  // If there's conversation history, structure it clearly
  if (conversationParts.length > 1) {
    const history = conversationParts.slice(0, -1).join("\n\n---\n\n");
    const currentMessage = conversationParts[conversationParts.length - 1];
    return {
      systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : null,
      userPrompt: `Previous conversation:\n\n${history}\n\n---\n\nCurrent question:\n${currentMessage}`
    };
  }

  return {
    systemPrompt: systemParts.length > 0 ? systemParts.join("\n\n") : null,
    userPrompt: conversationParts[0] ?? ""
  };
}

// ---------------------------------------------------------------------------
// Model alias → full Anthropic model ID (LiteLLM aliases → CLI-compatible)
// ---------------------------------------------------------------------------

const MODEL_ALIAS_MAP: Record<string, string> = {
  "claude-sonnet": "claude-sonnet-4-20250514",
  "claude-opus": "claude-opus-4-20250514",
  "claude-haiku": "claude-haiku-3-5-20241022",
};

function resolveModelName(model: string): string {
  return MODEL_ALIAS_MAP[model] ?? model;
}

// ---------------------------------------------------------------------------
// Parse NDJSON output → SSE events + result metadata
// ---------------------------------------------------------------------------

function parseNdjsonToSse(
  raw: string,
  model: string,
  logger: FastifyBaseLogger
): { ssePayload: string; resultData: Record<string, unknown> | null } {
  const messageId = `cli-${Date.now()}`;
  let started = false;
  let output = "";
  let resultData: Record<string, unknown> | null = null;

  const lines = raw.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      logger.debug({ line: trimmed.slice(0, 200) }, "claude-cli non-JSON line");
      continue;
    }

    // stream_event wrapping (older CLI versions)
    if (parsed.type === "stream_event") {
      const event = parsed.event as Record<string, unknown> | undefined;
      if (!event) continue;

      if (!started && event.type === "content_block_delta") {
        started = true;
        output += `data: ${JSON.stringify({
          type: "message_start",
          message: { id: messageId, type: "message", role: "assistant", model, content: [] }
        })}\n\n`;
      }

      if (event.type === "content_block_delta") {
        output += `data: ${JSON.stringify(event)}\n\n`;
      }
    }

    // "assistant" event with full text blocks (current CLI format)
    if (parsed.type === "assistant") {
      const msg = parsed.message as Record<string, unknown> | undefined;
      const content = msg?.content as Array<Record<string, unknown>> | undefined;
      if (content && Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && typeof block.text === "string" && block.text) {
            if (!started) {
              started = true;
              output += `data: ${JSON.stringify({
                type: "message_start",
                message: { id: messageId, type: "message", role: "assistant", model, content: [] }
              })}\n\n`;
            }
            output += `data: ${JSON.stringify({
              type: "content_block_delta",
              delta: { type: "text_delta", text: block.text }
            })}\n\n`;
          }
        }
      }
    }

    if (parsed.type === "result") {
      logger.info("claude-cli result event received");
      resultData = parsed;
    }
  }

  if (started) {
    output += `data: ${JSON.stringify({ type: "message_stop" })}\n\n`;
  }

  return { ssePayload: output, resultData };
}

// ---------------------------------------------------------------------------
// Spawn Claude CLI
// ---------------------------------------------------------------------------

export function spawnClaudeCli(opts: SpawnClaudeCliOptions): {
  sseStream: Readable;
  processPromise: Promise<ClaudeCliResult>;
} {
  const { command, prefixArgs } = resolveClaudeCommand();

  const args = [
    ...prefixArgs,
    "-p", opts.prompt,
    "--verbose",
    "--output-format", "stream-json",
    "--model", resolveModelName(opts.model),
    "--max-turns", "1",
    "--tools", ""
  ];

  if (opts.systemPrompt) {
    args.push("--system-prompt", opts.systemPrompt);
  }

  opts.logger.info(
    { command, argsCount: args.length, promptLength: opts.prompt.length, model: resolveModelName(opts.model) },
    "spawning claude-cli"
  );

  // Strip env vars that would interfere with the CLI's own OAuth auth
  const childEnv = { ...process.env };
  delete childEnv.CLAUDECODE;        // avoid "nested session" error
  delete childEnv.ANTHROPIC_API_KEY; // let CLI use its own OAuth credentials

  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv,
    cwd: process.platform === "win32" ? process.env.TEMP : "/tmp"
  });

  // PassThrough that we push SSE data into after parsing
  const sseStream = new PassThrough();

  // Collect all stdout and stderr
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
    opts.logger.warn({ stderr: chunk.toString("utf8").trim() }, "claude-cli stderr");
  });

  // Timeout — kill process if it runs too long
  const timeout = setTimeout(() => {
    opts.logger.warn({ model: opts.model }, "claude-cli timeout, killing process");
    child.kill("SIGTERM");
  }, opts.timeoutMs);

  const processPromise = new Promise<ClaudeCliResult>((resolve) => {
    child.on("close", (code) => {
      clearTimeout(timeout);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

      opts.logger.info(
        { exitCode: code, stdoutLen: stdout.length, stderrLen: stderr.length },
        "claude-cli process closed"
      );

      // Parse NDJSON → SSE and push into the PassThrough
      const { ssePayload, resultData } = parseNdjsonToSse(stdout, opts.model, opts.logger);

      if (ssePayload) {
        sseStream.write(ssePayload);
      }
      sseStream.end();

      opts.logger.info({ hasResult: !!resultData, exitCode: code }, "claude-cli done");

      const usage = resultData?.usage as Record<string, number> | undefined;
      resolve({
        exitCode: code ?? 1,
        fullText: (resultData?.result as string) ?? "",
        costUsd: (resultData?.total_cost_usd as number) ?? 0,
        usage: {
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0
        },
        error: code !== 0 ? (stderr || `Process exited with code ${code}`) : undefined
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      opts.logger.error({ err }, "claude-cli spawn error");
      sseStream.end();
      resolve({
        exitCode: 1,
        fullText: "",
        costUsd: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
        error: err.message
      });
    });
  });

  return { sseStream, processPromise };
}
