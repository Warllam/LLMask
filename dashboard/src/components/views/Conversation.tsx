import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Search, MessageSquare, GitCompare, Table2,
  File, FileCode2, Folder, FolderOpen, ChevronRight, ChevronDown,
  Terminal, Eye, EyeOff,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { RequestLogEntry, MappingEntry } from "@/lib/types";

interface ConversationProps {
  traceId: string;
}

type MessageType = "system" | "user" | "assistant" | "tool_call" | "tool_result";

interface ParsedMessage {
  role: string;
  content: string;
  msgType: MessageType;
  toolName?: string;
  toolSummary?: string;
}

type ConversationTab = "messages" | "diff" | "mappings";

function extractContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: Record<string, unknown>) => {
        if (b.type === "text" || b.type === "input_text" || b.type === "output_text")
          return (b.text as string) ?? "";
        return `[${b.type}]`;
      })
      .join("");
  }
  if (content && typeof content === "object") return JSON.stringify(content);
  return "";
}

function toolCallSummary(name: string, args: Record<string, unknown>): string {
  const n = name.toLowerCase();
  if (n === "exec_command") return (args.cmd as string) ?? "";
  if (n === "read") return (args.file_path as string) ?? "";
  if (n === "write") return (args.file_path as string) ?? "";
  if (n === "edit") return (args.file_path as string) ?? "";
  if (n === "grep") return `${args.pattern ?? ""} ${args.path ?? ""}`.trim();
  if (n === "glob") return (args.pattern as string) ?? "";
  if (n === "bash") return (args.command as string) ?? "";
  return JSON.stringify(args).slice(0, 80);
}

function parseMessages(body: string): ParsedMessage[] {
  try {
    const parsed = JSON.parse(body);
    const msgs: ParsedMessage[] = [];

    // System / instructions — single collapsed entry
    const sysText = [
      parsed.system ? extractContent(parsed.system) : "",
      parsed.instructions && typeof parsed.instructions === "string" ? parsed.instructions : "",
    ].filter(Boolean).join("\n\n");
    if (sysText) {
      msgs.push({ role: "system", content: sysText, msgType: "system" });
    }

    // ChatCompletions format
    if (Array.isArray(parsed.messages)) {
      for (const m of parsed.messages) {
        const role: string = m.role;
        if (role === "system" || role === "developer") {
          msgs.push({ role, content: extractContent(m.content), msgType: "system" });
          continue;
        }
        if (role === "assistant") {
          const text = extractContent(m.content);
          if (text) msgs.push({ role, content: text, msgType: "assistant" });
          // Extract tool calls as separate messages
          if (Array.isArray(m.tool_calls)) {
            for (const tc of m.tool_calls) {
              let args: Record<string, unknown> = {};
              try {
                args = typeof tc.function?.arguments === "string"
                  ? JSON.parse(tc.function.arguments)
                  : tc.function?.arguments ?? {};
              } catch { /* ignore */ }
              const name = tc.function?.name ?? "";
              msgs.push({
                role: "assistant",
                content: "",
                msgType: "tool_call",
                toolName: name,
                toolSummary: toolCallSummary(name, args),
              });
            }
          }
          continue;
        }
        if (role === "tool") {
          // Skip tool results — they clutter the view
          continue;
        }
        // user or other
        msgs.push({ role, content: extractContent(m.content), msgType: "user" });
      }
      return msgs;
    }

    // Responses API format
    if (Array.isArray(parsed.input)) {
      for (const item of parsed.input) {
        // Skip reasoning blocks
        if (item.type === "reasoning") continue;

        if (item.type === "message" || item.role) {
          const role = item.role ?? "user";
          const mType: MessageType = (role === "system" || role === "developer") ? "system"
            : role === "assistant" ? "assistant"
            : "user";
          const text = extractContent(item.content);
          if (text) msgs.push({ role, content: text, msgType: mType });
          continue;
        }

        if (item.type === "function_call") {
          let args: Record<string, unknown> = {};
          try {
            args = typeof item.arguments === "string" ? JSON.parse(item.arguments) : item.arguments ?? {};
          } catch { /* ignore */ }
          const name = item.name ?? "";
          msgs.push({
            role: "assistant",
            content: "",
            msgType: "tool_call",
            toolName: name,
            toolSummary: toolCallSummary(name, args),
          });
          continue;
        }

        // Skip function_call_output — raw output is noise
      }
      return msgs;
    }

    return msgs;
  } catch {
    return [];
  }
}

function extractResponseText(responseBody: string | null): string {
  if (!responseBody) return "";
  try {
    const resp = JSON.parse(responseBody);
    const choice = resp.choices?.[0];
    if (choice?.message?.content) return choice.message.content;
    if (resp.content && Array.isArray(resp.content)) {
      return resp.content
        .filter((b: { type: string }) => b.type === "text")
        .map((b: { text: string }) => b.text)
        .join("");
    }
    if (resp.output && Array.isArray(resp.output)) {
      let text = "";
      for (const item of resp.output) {
        if (item.type === "message" && item.role === "assistant") {
          text += extractContent(item.content);
        }
      }
      return text;
    }
    if (resp.output_text && typeof resp.output_text === "string") {
      return resp.output_text;
    }
    // JSON parsed but no known format — might be tool call etc.
    return "";
  } catch {
    // Not valid JSON — raw accumulated streaming text
    return responseBody;
  }
}

const roleStyles: Record<string, string> = {
  user: "bg-primary text-primary-foreground rounded-2xl rounded-bl-sm ml-12",
  assistant: "bg-muted border border-border rounded-2xl rounded-br-sm mr-12",
  system: "bg-transparent text-center italic text-muted-foreground mx-auto max-w-lg",
  tool: "bg-muted/50 border border-border font-mono text-sm rounded-lg",
};

const kindColors: Record<string, string> = {
  org: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  svc: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  tbl: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  col: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  idn: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
};


function highlightTerms(text: string, terms: string[], className: string): React.ReactNode[] {
  if (terms.length === 0) return [text];

  // Escape regex chars and sort by length (longest first)
  const sorted = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");

  const parts = text.split(regex);
  const termsLower = new Set(sorted.map((t) => t.toLowerCase()));

  return parts.map((part, i) =>
    termsLower.has(part.toLowerCase()) ? (
      <mark key={i} className={className}>
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

// --- File extraction for Diff tab ---

interface ExtractedFile {
  path: string;
  content: string;
  operation: string;
}

interface DiffFile {
  originalPath: string;
  maskedPath: string;
  originalContent: string;
  maskedContent: string;
  operation: string;
}

interface TreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: TreeNode[];
  fileKey?: string;
}

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "hpp",
  "cs", "rb", "php", "swift", "kt", "scala", "vue", "svelte", "css", "scss",
  "html", "xml", "json", "yaml", "yml", "toml", "md", "sh", "bash", "zsh",
  "sql", "graphql", "prisma", "tf", "dockerfile",
]);

function isCodeFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return CODE_EXTENSIONS.has(ext);
}

function normalizePath(p: string): string {
  return p
    .replace(/^\/home\/[^/]+\//, "~/")
    .replace(/^\/Users\/[^/]+\//, "~/");
}

function extractFilePathFromArgs(toolName: string, args: Record<string, unknown>): string | null {
  const name = toolName.toLowerCase();
  switch (name) {
    case "read":
    case "write":
    case "edit":
    case "notebookedit":
      return (args.file_path as string) ?? (args.notebook_path as string) ?? null;
    case "grep":
    case "glob":
      return (args.path as string) ?? null;
    default:
      return null;
  }
}

// Extract file path from shell commands (cat, sed, head, tail)
function extractFileFromShellCmd(cmd: string): string | null {
  const trimmed = cmd.trim();
  let match: RegExpMatchArray | null;

  // cat <file>
  match = trimmed.match(/^cat\s+(\S+)/);
  if (match) return match[1];

  // sed -n '<range>' <file>
  match = trimmed.match(/^sed\s+-n\s+'[^']+'\s+(\S+)/);
  if (match) return match[1];

  // head/tail [-n <N>] <file>
  match = trimmed.match(/^(?:head|tail)(?:\s+-n\s+\d+)?\s+(\S+)/);
  if (match) return match[1];

  // less/more <file>
  match = trimmed.match(/^(?:less|more)\s+(\S+)/);
  if (match) return match[1];

  return null;
}

// Strip exec_command output metadata to get actual content
function parseExecOutput(output: string): string {
  const idx = output.indexOf("Output:\n");
  if (idx >= 0) return output.slice(idx + 8);
  return output;
}

// Extract files from an exec_command call
function extractFilesFromExecCmd(cmd: string, rawOutput: string): ExtractedFile[] {
  const content = parseExecOutput(rawOutput);

  // Split compound commands on &&
  const subCmds = cmd.split(/\s*&&\s*/);
  const fileEntries: Array<{ path: string }> = [];

  for (const sub of subCmds) {
    // Skip echo separators
    if (/^echo\s/.test(sub.trim())) continue;
    const filePath = extractFileFromShellCmd(sub.trim());
    if (filePath) fileEntries.push({ path: filePath });
  }

  if (fileEntries.length === 0) return [];

  // Single file command — assign full content
  if (fileEntries.length === 1) {
    return [{
      path: normalizePath(fileEntries[0].path),
      content,
      operation: "exec_command",
    }];
  }

  // Multiple files — try splitting output on '---' separator
  const parts = content.split(/\n---\n/);
  return fileEntries.map((f, i) => ({
    path: normalizePath(f.path),
    content: parts[i]?.trim() ?? "",
    operation: "exec_command",
  }));
}

function extractToolFiles(body: string): ExtractedFile[] {
  try {
    const parsed = JSON.parse(body);
    const files: ExtractedFile[] = [];

    // ChatCompletions format
    if (Array.isArray(parsed.messages)) {
      const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
      const toolResults = new Map<string, string>();

      for (const msg of parsed.messages) {
        if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            let args: Record<string, unknown> = {};
            try {
              args = typeof tc.function?.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : tc.function?.arguments ?? {};
            } catch { /* ignore parse errors */ }
            toolCalls.push({
              id: tc.id,
              name: tc.function?.name ?? "",
              args,
            });
          }
        }
        if (msg.role === "tool" && msg.tool_call_id) {
          toolResults.set(msg.tool_call_id, extractContent(msg.content));
        }
      }

      for (const tc of toolCalls) {
        const nameLower = tc.name.toLowerCase();
        // Handle exec_command (Cursor/Windsurf style)
        if (nameLower === "exec_command") {
          const cmd = (tc.args.cmd as string) ?? "";
          const output = toolResults.get(tc.id) ?? "";
          files.push(...extractFilesFromExecCmd(cmd, output));
          continue;
        }
        const filePath = extractFilePathFromArgs(tc.name, tc.args);
        if (!filePath) continue;
        let content: string;
        if (nameLower === "write") {
          content = (tc.args.content as string) ?? "";
        } else if (nameLower === "edit") {
          content = `--- Edit ---\n- ${tc.args.old_string ?? ""}\n+ ${tc.args.new_string ?? ""}`;
        } else {
          content = toolResults.get(tc.id) ?? "";
        }
        files.push({ path: normalizePath(filePath), content, operation: nameLower });
      }
    }

    // Responses API format
    if (Array.isArray(parsed.input)) {
      const funcCalls = new Map<string, { name: string; args: Record<string, unknown> }>();

      for (const item of parsed.input) {
        if (item.type === "function_call") {
          let args: Record<string, unknown> = {};
          try {
            args = typeof item.arguments === "string"
              ? JSON.parse(item.arguments)
              : item.arguments ?? {};
          } catch { /* ignore */ }
          funcCalls.set(item.call_id, { name: item.name ?? "", args });
        }
        if (item.type === "function_call_output" && item.call_id) {
          const call = funcCalls.get(item.call_id);
          if (!call) continue;
          const nameLower = call.name.toLowerCase();
          const rawOutput = typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? "");

          // Handle exec_command (Cursor/Windsurf style)
          if (nameLower === "exec_command") {
            const cmd = (call.args.cmd as string) ?? "";
            files.push(...extractFilesFromExecCmd(cmd, rawOutput));
            continue;
          }

          const filePath = extractFilePathFromArgs(call.name, call.args);
          if (!filePath) continue;
          let content: string;
          if (nameLower === "write") {
            content = (call.args.content as string) ?? "";
          } else if (nameLower === "edit") {
            content = `--- Edit ---\n- ${call.args.old_string ?? ""}\n+ ${call.args.new_string ?? ""}`;
          } else {
            content = rawOutput;
          }
          files.push({ path: normalizePath(filePath), content, operation: nameLower });
        }
      }
    }

    return files;
  } catch {
    return [];
  }
}

function buildDiffFiles(requests: RequestLogEntry[]): DiffFile[] {
  const filesMap = new Map<string, DiffFile>();

  for (const req of requests) {
    const origFiles = extractToolFiles(req.originalBody);
    const maskedFiles = extractToolFiles(req.rewrittenBody);

    for (let i = 0; i < origFiles.length; i++) {
      const orig = origFiles[i];
      const masked = maskedFiles[i];
      filesMap.set(orig.path, {
        originalPath: orig.path,
        maskedPath: masked?.path ?? orig.path,
        originalContent: orig.content,
        maskedContent: masked?.content ?? orig.content,
        operation: orig.operation,
      });
    }
  }

  return Array.from(filesMap.values());
}

function buildFileTree(files: DiffFile[]): TreeNode[] {
  const root: TreeNode = { name: "", fullPath: "", isDirectory: true, children: [] };

  for (const file of files) {
    const parts = file.originalPath.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          fullPath,
          isDirectory: !isLast,
          children: [],
          fileKey: isLast ? file.originalPath : undefined,
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  // Sort: directories first, then alphabetical
  function sortTree(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortTree(node.children);
    }
  }
  sortTree(root.children);

  // Collapse single-child directories
  function collapse(nodes: TreeNode[]): TreeNode[] {
    return nodes.map((node) => {
      if (node.isDirectory && node.children.length === 1 && node.children[0].isDirectory) {
        const child = node.children[0];
        return {
          ...child,
          name: `${node.name}/${child.name}`,
          children: collapse(child.children),
        };
      }
      return { ...node, children: collapse(node.children) };
    });
  }

  return collapse(root.children);
}

// --- Components ---

export function Conversation({ traceId }: ConversationProps) {
  const [requests, setRequests] = useState<RequestLogEntry[]>([]);
  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<ConversationTab>("messages");
  const [viewMode, setViewMode] = useState<"original" | "masked">("masked");
  const [mappingSearch, setMappingSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.sessionRequests(traceId),
      api.sessionMappings(traceId),
    ])
      .then(([reqs, maps]) => {
        setRequests(reqs);
        setMappings(maps);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [traceId]);

  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-fade-in">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn("h-20 rounded-2xl", i % 2 === 0 ? "ml-12" : "mr-12")}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Sub-navigation */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-border">
        <TabsList>
          <TabsTrigger active={tab === "messages"} onClick={() => setTab("messages")}>
            <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
            Messages
          </TabsTrigger>
          <TabsTrigger active={tab === "diff"} onClick={() => setTab("diff")}>
            <GitCompare className="h-3.5 w-3.5 mr-1.5" />
            Diff
          </TabsTrigger>
          <TabsTrigger active={tab === "mappings"} onClick={() => setTab("mappings")}>
            <Table2 className="h-3.5 w-3.5 mr-1.5" />
            Mappings ({mappings.length})
          </TabsTrigger>
        </TabsList>

        <div className="flex items-center gap-2">
          {tab === "messages" && (
            <TabsList>
              <TabsTrigger
                active={viewMode === "original"}
                onClick={() => setViewMode("original")}
              >
                Original
              </TabsTrigger>
              <TabsTrigger
                active={viewMode === "masked"}
                onClick={() => setViewMode("masked")}
              >
                Masked
              </TabsTrigger>
            </TabsList>
          )}
          <Badge variant="outline">
            {requests.length} req{requests.length !== 1 ? "s" : ""}
          </Badge>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === "messages" && (
          <MessagesTab
            requests={requests}
            viewMode={viewMode}
          />
        )}
        {tab === "diff" && (
          <DiffTab requests={requests} mappings={mappings} />
        )}
        {tab === "mappings" && (
          <MappingsTab
            mappings={mappings}
            search={mappingSearch}
            onSearchChange={setMappingSearch}
          />
        )}
      </div>
    </div>
  );
}

// --- Messages Tab ---

function SystemMessage({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = content.slice(0, 80).replace(/\n/g, " ");
  return (
    <button
      onClick={() => setExpanded((e) => !e)}
      className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-md bg-muted/40 border border-border/50 hover:bg-muted/60 transition-colors"
    >
      {expanded ? <EyeOff className="h-3 w-3 shrink-0 text-muted-foreground" /> : <Eye className="h-3 w-3 shrink-0 text-muted-foreground" />}
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium shrink-0">System</span>
      {expanded ? (
        <span className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{content}</span>
      ) : (
        <span className="text-xs text-muted-foreground truncate">{preview}...</span>
      )}
    </button>
  );
}

function ToolCallMessage({ toolName, toolSummary }: { toolName: string; toolSummary: string }) {
  const name = toolName.toLowerCase();
  const displayName = name === "exec_command" ? "exec" : toolName;
  // Truncate long commands
  const summary = toolSummary.length > 120 ? toolSummary.slice(0, 120) + "..." : toolSummary;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/30 border border-border/50">
      <Terminal className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium shrink-0">{displayName}</span>
      <code className="text-xs text-foreground/70 font-mono truncate">{summary}</code>
    </div>
  );
}

function MessagesTab({
  requests,
  viewMode,
}: {
  requests: RequestLogEntry[];
  viewMode: "original" | "masked";
}) {
  const allMessages: Array<ParsedMessage & { requestId: number }> = [];
  for (const req of requests) {
    const body = viewMode === "original" ? req.originalBody : req.rewrittenBody;
    const msgs = parseMessages(body);
    for (const msg of msgs) {
      allMessages.push({ ...msg, requestId: req.id });
    }
    const assistantText = extractResponseText(req.responseBody);
    if (assistantText) {
      allMessages.push({ role: "assistant", content: assistantText, requestId: req.id, msgType: "assistant" });
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-3">
      {allMessages.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No messages in this session
        </p>
      ) : (
        allMessages.map((msg, i) => {
          // System — collapsed one-liner
          if (msg.msgType === "system") {
            return <SystemMessage key={i} content={msg.content} />;
          }

          // Tool call — compact summary
          if (msg.msgType === "tool_call") {
            return <ToolCallMessage key={i} toolName={msg.toolName ?? ""} toolSummary={msg.toolSummary ?? ""} />;
          }

          // User / Assistant — full content
          return (
            <div key={i} className="animate-fade-in">
              <div className="mb-1 px-1">
                <span className="text-[10px] uppercase tracking-[0.5px] text-muted-foreground font-medium">
                  {msg.role}
                </span>
              </div>
              <div
                className={cn(
                  "px-4 py-3 whitespace-pre-wrap break-words",
                  roleStyles[msg.role] ?? roleStyles.assistant
                )}
              >
                {msg.content}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// --- Diff Tab: File Tree + Side-by-side ---

function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (node.isDirectory) {
    return (
      <div>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 w-full px-2 py-1 text-xs hover:bg-muted/50 transition-colors text-left"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          {expanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          )}
          <span className="truncate text-muted-foreground">{node.name}</span>
        </button>
        {expanded && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.fullPath}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.fileKey;
  const FileIcon = isCodeFile(node.name) ? FileCode2 : File;

  return (
    <button
      onClick={() => node.fileKey && onSelect(node.fileKey)}
      className={cn(
        "flex items-center gap-1.5 w-full px-2 py-1 text-xs transition-colors text-left",
        isSelected
          ? "bg-accent/10 text-accent-foreground font-medium"
          : "hover:bg-muted/50 text-foreground"
      )}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <FileIcon className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "text-accent" : "text-muted-foreground")} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function DiffTab({
  requests,
  mappings,
}: {
  requests: RequestLogEntry[];
  mappings: MappingEntry[];
}) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const diffFiles = useMemo(() => buildDiffFiles(requests), [requests]);
  const tree = useMemo(() => buildFileTree(diffFiles), [diffFiles]);
  const filesMap = useMemo(() => {
    const map = new Map<string, DiffFile>();
    for (const f of diffFiles) map.set(f.originalPath, f);
    return map;
  }, [diffFiles]);

  // Auto-select first file
  useEffect(() => {
    if (diffFiles.length > 0 && !selectedFile) {
      setSelectedFile(diffFiles[0].originalPath);
    }
  }, [diffFiles, selectedFile]);

  const currentFile = selectedFile ? filesMap.get(selectedFile) : null;

  if (diffFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">
          No file operations found in this session
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* File tree sidebar */}
      <div className="w-56 border-r border-border flex flex-col shrink-0">
        <div className="px-3 py-2 border-b border-border">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            Files ({diffFiles.length})
          </span>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {tree.map((node) => (
            <FileTreeNode
              key={node.fullPath}
              node={node}
              depth={0}
              selectedPath={selectedFile}
              onSelect={setSelectedFile}
            />
          ))}
        </div>
      </div>

      {/* Diff panels */}
      {currentFile ? (
        <div className="flex-1 overflow-y-auto min-w-0">
          <div className="grid grid-cols-2 min-h-full">
            {/* Original column */}
            <div className="border-r border-border">
              <div className="sticky top-0 z-10 bg-red-50 dark:bg-red-950/20 px-4 py-2 border-b border-border">
                <span className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">
                  Original
                </span>
                <span className="ml-2 text-[10px] text-muted-foreground font-mono truncate">
                  {currentFile.originalPath}
                </span>
              </div>
              <div className="p-4">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {highlightTerms(
                    currentFile.originalContent,
                    mappings.map((m) => m.originalValue),
                    "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-0.5 rounded"
                  )}
                </pre>
              </div>
            </div>

            {/* Masked column */}
            <div>
              <div className="sticky top-0 z-10 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-2 border-b border-border">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Masked
                </span>
                <span className="ml-2 text-[10px] text-muted-foreground font-mono truncate">
                  {currentFile.maskedPath}
                </span>
              </div>
              <div className="p-4">
                <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
                  {highlightTerms(
                    currentFile.maskedContent,
                    mappings.map((m) => m.pseudonym),
                    "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-0.5 rounded"
                  )}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Select a file to view diff</p>
        </div>
      )}
    </div>
  );
}

// --- Mappings Tab ---
function MappingsTab({
  mappings,
  search,
  onSearchChange,
}: {
  mappings: MappingEntry[];
  search: string;
  onSearchChange: (s: string) => void;
}) {
  const filtered = mappings.filter(
    (m) =>
      !search ||
      m.originalValue.toLowerCase().includes(search.toLowerCase()) ||
      m.pseudonym.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-border">
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search mappings..."
            className="pl-8 h-8 text-xs"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground text-center">
            No mappings
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border">
                <th className="text-left py-2 px-6 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Original
                </th>
                <th className="text-left py-2 px-6 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Pseudonym
                </th>
                <th className="text-left py-2 px-6 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  Kind
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, i) => (
                <tr
                  key={i}
                  className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                >
                  <td className="py-2 px-6 font-mono text-destructive">
                    {m.originalValue}
                  </td>
                  <td className="py-2 px-6 font-mono text-emerald-600 dark:text-emerald-400">
                    {m.pseudonym}
                  </td>
                  <td className="py-2 px-6">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                        kindColors[m.kind] ?? "bg-secondary text-secondary-foreground"
                      )}
                    >
                      {m.kind.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
