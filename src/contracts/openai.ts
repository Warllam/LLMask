/**
 * OpenAI API type definitions
 * Minimal subset for type safety
 */

import { z } from "zod";

export type OpenAiChatMessage = {
  role: "system" | "user" | "assistant" | "function" | "tool" | "developer";
  content?: string | null;
  name?: string;
  function_call?: unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
};

export type OpenAiChatCompletionRequest = {
  model: string;
  messages: OpenAiChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  tools?: unknown[];
  tool_choice?: unknown;
  [key: string]: unknown;
};

// Alias for compatibility
export type ChatCompletionsRequest = OpenAiChatCompletionRequest;

export type OpenAiResponsesRequest = {
  model: string;
  input: unknown;
  instructions?: string;
  temperature?: number;
  max_tokens?: number;
  max_output_tokens?: number;
  stream?: boolean;
  tools?: unknown[];
  [key: string]: unknown;
};

// Alias for compatibility
export type ResponsesRequest = OpenAiResponsesRequest;

export type OpenAiError = {
  error: {
    message: string;
    type?: string;
    code?: string;
    param?: string | null;
  };
};

export type OpenAiCompatibleError = OpenAiError;

export type OpenAiChatChoice = {
  index: number;
  message: OpenAiChatMessage;
  finish_reason: string | null;
};

export type OpenAiChatCompletionResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAiChatChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

// Minimal validation schemas (relaxed for OSS version)
export const chatCompletionsRequestSchema = z.object({
  model: z.string(),
  messages: z.array(z.any()),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
}).passthrough();

export const responsesRequestSchema = z.object({
  model: z.string(),
  input: z.any(),
  instructions: z.string().optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  max_output_tokens: z.number().optional(),
}).passthrough();
