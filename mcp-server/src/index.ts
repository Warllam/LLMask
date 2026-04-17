#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { maskText, unmaskText, type Strategy } from "./masker.js";

const server = new Server(
  { name: "llmask", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ── Tool definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "mask_text",
      description: "Mask sensitive data (PII, secrets, API keys) in text. Returns masked version and a scope_id for later unmasking.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to mask" },
          strategy: {
            type: "string",
            enum: ["aggressive", "code-aware", "values-only", "pii-only"],
            description: "Masking strategy. Default: aggressive",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "mask_file",
      description: "Read a file and return its content with sensitive data masked.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or relative path to the file" },
          strategy: {
            type: "string",
            enum: ["aggressive", "code-aware", "values-only", "pii-only"],
          },
        },
        required: ["path"],
      },
    },
    {
      name: "unmask_text",
      description: "Restore original values in previously masked text using a scope_id.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Masked text to restore" },
          scope_id: { type: "string", description: "scope_id returned by mask_text or mask_file" },
        },
        required: ["text", "scope_id"],
      },
    },
    {
      name: "scan_directory",
      description: "Scan a directory for files containing sensitive data and report what would be masked.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to scan" },
          strategy: {
            type: "string",
            enum: ["aggressive", "code-aware", "values-only", "pii-only"],
          },
        },
        required: ["path"],
      },
    },
  ],
}));

// ── Tool handlers ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    if (name === "mask_text") {
      const { text, strategy = "aggressive" } = args as { text: string; strategy?: Strategy };
      const result = maskText(text, strategy);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "mask_file") {
      const { path: filePath, strategy = "aggressive" } = args as { path: string; strategy?: Strategy };
      const resolved = path.resolve(filePath);
      let content: string;
      try {
        content = fs.readFileSync(resolved, "utf-8");
      } catch {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Cannot read file: ${resolved}` }) }],
          isError: true,
        };
      }
      const result = maskText(content, strategy);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ...result, file_path: resolved }, null, 2),
          },
        ],
      };
    }

    if (name === "unmask_text") {
      const { text, scope_id } = args as { text: string; scope_id: string };
      const result = unmaskText(text, scope_id);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === "scan_directory") {
      const { path: dirPath, strategy = "aggressive" } = args as { path: string; strategy?: Strategy };
      const resolved = path.resolve(dirPath);

      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: `Not a directory: ${resolved}` }) }],
          isError: true,
        };
      }

      const TEXT_EXTS = new Set([".ts", ".js", ".tsx", ".jsx", ".json", ".env", ".yaml", ".yml", ".toml", ".txt", ".md", ".py", ".rb", ".go", ".rs", ".java", ".cs", ".php", ".sh", ".bash", ".zsh", ".conf", ".config", ".ini"]);
      const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", "__pycache__"]);

      type FileSummary = { path: string; elements_count: number; categories: string[] };
      const filesWithSensitiveData: FileSummary[] = [];
      let filesScanned = 0;
      let totalElements = 0;

      function scanDir(dir: string) {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) scanDir(full);
          } else if (entry.isFile() && TEXT_EXTS.has(path.extname(entry.name))) {
            let text: string;
            try {
              text = fs.readFileSync(full, "utf-8");
            } catch {
              continue;
            }
            filesScanned++;
            const result = maskText(text, strategy);
            if (result.elements_masked > 0) {
              const categories = [...new Set(result.details.map(d => d.category))];
              filesWithSensitiveData.push({ path: full, elements_count: result.elements_masked, categories });
              totalElements += result.elements_masked;
            }
          }
        }
      }

      scanDir(resolved);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ files_scanned: filesScanned, files_with_sensitive_data: filesWithSensitiveData, total_elements: totalElements }, null, 2),
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }],
      isError: true,
    };
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("LLMask MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
