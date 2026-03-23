/**
 * Utilities for handling multimodal content in OpenAI-compatible messages.
 *
 * Content can be either:
 *   - A plain string
 *   - An array of content blocks: [{type: "text", text: "..."}, {type: "image_url", image_url: {...}}]
 */

import { stripImageMetadata } from "./image-sanitizer";

type ContentBlock = {
  type: string;
  text?: string;
  image_url?: { url: string; detail?: string };
  [key: string]: unknown;
};

/**
 * Extract all text from message content, regardless of format.
 * Returns concatenated text from string content or text blocks in arrays.
 */
export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
    } else if (block && typeof block === "object") {
      const b = block as ContentBlock;
      if (b.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      }
      if (b.type === "input_text" && typeof b.text === "string") {
        parts.push(b.text);
      }
    }
  }
  return parts.join("\n");
}

/**
 * Rewrite text blocks in a content array, leaving non-text blocks untouched.
 * If content is a string, applies rewriter directly.
 * Returns the modified content in the same format as input.
 */
export function rewriteContentBlocks(
  content: unknown,
  rewriter: (text: string) => string
): unknown {
  if (typeof content === "string") return rewriter(content);
  if (!Array.isArray(content)) return content;

  return content.map((block: unknown) => {
    if (typeof block === "string") return rewriter(block);
    if (!block || typeof block !== "object") return block;

    const b = block as ContentBlock;
    if (b.type === "text" && typeof b.text === "string") {
      return { ...b, text: rewriter(b.text) };
    }
    if (b.type === "input_text" && typeof b.text === "string") {
      return { ...b, text: rewriter(b.text) };
    }
    // image_url: strip EXIF from inline base64 data URIs
    if (b.type === "image_url" && b.image_url) {
      return { ...b, image_url: sanitizeImageUrl(b.image_url) };
    }

    // image, audio, etc. — pass through unchanged
    return block;
  });
}

/**
 * Check if content contains any image blocks.
 */
export function hasImageContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((block: unknown) => {
    if (!block || typeof block !== "object") return false;
    const b = block as ContentBlock;
    return b.type === "image_url" || b.type === "image" || b.type === "input_image";
  });
}

/**
 * Convert chat/completions content blocks to Responses API content blocks.
 * Preserves image_url blocks by converting them to input_image format.
 */
export function contentBlocksToResponsesFormat(content: unknown, role: string): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    const contentType = role === "assistant" ? "output_text" : "input_text";
    return [{ type: contentType, text: content }];
  }

  if (!Array.isArray(content)) {
    const contentType = role === "assistant" ? "output_text" : "input_text";
    return [{ type: contentType, text: JSON.stringify(content ?? "") }];
  }

  return content.map((block: unknown) => {
    if (typeof block === "string") {
      const contentType = role === "assistant" ? "output_text" : "input_text";
      return { type: contentType, text: block };
    }
    if (!block || typeof block !== "object") {
      return { type: "input_text", text: String(block) };
    }

    const b = block as ContentBlock;

    // text → input_text / output_text
    if (b.type === "text") {
      const contentType = role === "assistant" ? "output_text" : "input_text";
      return { type: contentType, text: b.text ?? "" };
    }

    // image_url → input_image (Responses API format)
    if (b.type === "image_url" && b.image_url) {
      return {
        type: "input_image",
        image_url: b.image_url.url,
        detail: b.image_url.detail ?? "auto"
      };
    }

    // Already in Responses API format or unknown — pass through
    return block as Record<string, unknown>;
  });
}

/**
 * Strip EXIF metadata from a base64 data URI image.
 * Remote URLs are left unchanged (no PII in the URL itself typically).
 */
function sanitizeImageUrl(imageUrl: { url: string; detail?: string }): { url: string; detail?: string } {
  const dataUriMatch = imageUrl.url.match(/^data:image\/(jpeg|png|webp|jpg);base64,(.+)$/);
  if (!dataUriMatch) {
    // Remote URL — return as-is
    return imageUrl;
  }

  const [, mimeSubtype, base64Data] = dataUriMatch;
  try {
    const buf = Buffer.from(base64Data, "base64");
    const { sanitized, strippedChunks } = stripImageMetadata(buf);
    if (strippedChunks === 0) return imageUrl;
    return {
      ...imageUrl,
      url: `data:image/${mimeSubtype};base64,${sanitized.toString("base64")}`
    };
  } catch {
    return imageUrl;
  }
}
