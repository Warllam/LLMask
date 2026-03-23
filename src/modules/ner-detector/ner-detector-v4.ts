import type { AstClassification, AstRole } from "../ast/ast-classifier";
import type { MappingKind } from "../mapping-store/mapping-store";

/**
 * NerDetectorV4 — Precision + recall optimized.
 *
 * Fixes over V3:
 * 1. extractImportedSymbols: only filters standard library, not business imports
 * 2. CREATE TABLE column definitions fully parsed
 * 3. SQL SELECT aliases (AS clause) captured
 * 4. CREATE INDEX parsing
 * 5. More aggressive cross-ref: camelCase ↔ snake_case mutual boost
 * 6. INSERT column list parsing
 */

export type NerEntityV4 = {
  name: string;
  kind: MappingKind;
  score: number;
  source: "ast" | "sql" | "heuristic" | "cross-ref";
};

export type NerDetectionResultV4 = {
  entities: NerEntityV4[];
  entityNames: Set<string>;
  entityKinds: Map<string, MappingKind>;
};

// ── Generic tech tokens ─────────────────────────────────────────────────────

const GENERIC_TECH_TOKENS = new Set([
  // Common field names
  "createdAt", "updatedAt", "deletedAt", "created_at", "updated_at", "deleted_at",
  "description", "title", "name", "label", "value", "type", "status",
  "enabled", "disabled", "active", "inactive",
  "startDate", "endDate", "start_date", "end_date",
  "firstName", "lastName", "first_name", "last_name",
  "email", "phone", "address", "password", "username",
  "isActive", "isDeleted", "isEnabled", "isValid",
  "getId", "getName", "getType", "getStatus", "getValue",
  "setId", "setName", "setType", "setStatus", "setValue",
  // Java standard methods
  "toLocalDateTime", "toLocalDate", "toInstant", "toEpochMilli",
  "toString", "hashCode", "equals", "compareTo", "getClass",
  "println", "printf", "format", "append", "charAt", "substring",
  "indexOf", "lastIndexOf", "contains", "isEmpty", "length",
  "prepareStatement", "executeQuery", "executeUpdate", "executeBatch",
  "getConnection", "getStatement", "getResultSet", "getMetaData",
  "getString", "getInt", "getLong", "getFloat", "getDouble",
  "getBoolean", "getObject", "getDate", "getTimestamp", "getBytes",
  "setString", "setInt", "setLong", "setFloat", "setDouble",
  "setBoolean", "setObject", "setDate", "setTimestamp", "setNull",
  "addBatch", "clearBatch", "clearParameters",
  // Java standard types
  "ArrayList", "HashMap", "HashSet", "LinkedList", "TreeMap", "TreeSet",
  "Collections", "Arrays", "Objects", "Optional", "Stream",
  "StringBuilder", "StringBuffer", "IOException", "RuntimeException",
  "NullPointerException", "IllegalArgumentException", "IllegalStateException",
  "ResultSet", "Statement", "Connection", "PreparedStatement",
  "DriverManager", "DataSource", "SQLException",
  "LocalDateTime", "LocalDate", "LocalTime", "Instant", "Duration",
  "BigDecimal", "BigInteger",
  // Spring/annotations
  "Autowired", "Component", "Service", "Repository", "Controller",
  "RequestMapping", "GetMapping", "PostMapping", "Override", "Deprecated",
  "SpringBootApplication", "SpringApplication",
  "Transactional", "PathVariable", "RequestBody", "ResponseBody",
  // JS/TS
  "useEffect", "useState", "useContext", "useReducer", "useRef",
  "useMemo", "useCallback", "forwardRef", "createContext", "createElement",
  "console", "window", "document", "navigator", "location",
  "Promise", "function", "return",
  // Python
  "dataclass", "staticmethod", "classmethod", "property",
  "__init__", "__str__", "__repr__", "__dict__",
  // Generic programming terms (prevent false positives on common words)
  "code", "data", "file", "error", "result", "message",
  "request", "response", "field", "parameter", "config",
  "output", "input", "token", "model", "schema", "query",
  "table", "index", "record", "object", "array", "string",
  "number", "boolean", "buffer", "stream", "event", "handler",
  "callback", "module", "context", "state", "props", "element",
  "middleware", "logger", "parser", "formatter", "encoder",
  "decoder", "manager", "engine", "registry", "container",
]);

// Standard library class names — only these get filtered from Java imports
const STANDARD_LIBRARY_CLASSES = new Set([
  "ArrayList", "HashMap", "HashSet", "LinkedList", "TreeMap", "TreeSet",
  "Collections", "Arrays", "Objects", "Optional", "Stream",
  "StringBuilder", "StringBuffer", "IOException", "RuntimeException",
  "NullPointerException", "IllegalArgumentException", "IllegalStateException",
  "ResultSet", "Statement", "Connection", "PreparedStatement",
  "DriverManager", "DataSource", "SQLException",
  "LocalDateTime", "LocalDate", "LocalTime", "Instant", "Duration",
  "BigDecimal", "BigInteger", "Integer", "Long", "Double", "Float",
  "Boolean", "String", "Object", "Class", "System", "Math",
  "List", "Map", "Set", "Queue", "Deque", "Collection", "Iterator",
  "Comparable", "Iterable", "Runnable", "Callable", "Future",
  "Thread", "Process", "Runtime", "ClassLoader",
  "InputStream", "OutputStream", "Reader", "Writer",
  "File", "Path", "Files", "Paths",
  "Pattern", "Matcher",
  "Date", "Calendar", "TimeZone",
  "UUID", "Random", "Scanner",
  "Annotation", "Override", "Deprecated", "SuppressWarnings",
  "Component", "Service", "Repository", "Controller",
  "Autowired", "Transactional", "RequestMapping",
  "SpringBootApplication", "SpringApplication",
]);

// ── SQL parsing ─────────────────────────────────────────────────────────────

const SQL_KEYWORDS = new Set([
  "select", "from", "where", "insert", "update", "delete", "create",
  "alter", "table", "index", "group", "order", "limit", "offset",
  "inner", "outer", "left", "right", "join", "having", "union",
  "values", "into", "primary", "foreign", "references", "cascade",
  "constraint", "unique", "check", "default", "begin", "commit",
  "rollback", "transaction", "distinct", "between", "like", "null",
  "true", "false", "count", "coalesce", "current_timestamp", "desc", "asc",
  "integer", "varchar", "boolean", "timestamp", "text", "serial",
  "autoincrement", "not", "and", "exists", "case", "when", "then",
  "else", "end", "with", "recursive", "over", "partition", "window",
  "set", "drop", "grant", "revoke", "view", "trigger", "function",
  "key", "real",
]);

const SQL_TYPES = new Set([
  "integer", "varchar", "boolean", "timestamp", "text", "serial",
  "bigint", "smallint", "decimal", "numeric", "real", "float",
  "double", "char", "blob", "clob", "date", "time", "datetime",
  "binary", "varbinary", "json", "xml", "uuid",
]);

const SQL_DETECTION_RE =
  /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i;

// Skip tokens inside SQL string literals and VALUES(...) blocks
const SQL_STRING_LITERAL_RE = /'(?:[^'\\]|\\.)*'/g;
const SQL_VALUES_RE = /\bVALUES\s*\(([^)]*)\)/gi;

/**
 * Build skip ranges for SQL extraction ONLY.
 * We only skip VALUES(...) blocks — not string literals,
 * because naive single-quote matching breaks on French text
 * (l'Ordre, d'honneur create massive false skip ranges).
 */
function buildSqlSkipRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;

  // Only skip VALUES(...) blocks — these contain data, not identifiers
  SQL_VALUES_RE.lastIndex = 0;
  while ((m = SQL_VALUES_RE.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }

  return ranges;
}

function isInSkipRange(pos: number, ranges: Array<[number, number]>): boolean {
  for (const [start, end] of ranges) {
    if (pos >= start && pos < end) return true;
  }
  return false;
}

function extractSqlEntities(text: string): NerEntityV4[] {
  if (!SQL_DETECTION_RE.test(text)) return [];

  const entities: NerEntityV4[] = [];
  const seen = new Set<string>();
  const skipRanges = buildSqlSkipRanges(text);

  const addEntity = (name: string, kind: MappingKind, matchIndex?: number): void => {
    const clean = name.trim().replace(/^[\w]+\./, "");
    if (clean.length < 4) return;
    if (SQL_KEYWORDS.has(clean.toLowerCase())) return;
    if (SQL_TYPES.has(clean.toLowerCase())) return;
    if (seen.has(clean)) return;
    if (/^\d/.test(clean)) return;
    if (/^(?:org|svc|tbl|col|idn)_\d+$/.test(clean)) return;
    if (GENERIC_TECH_TOKENS.has(clean)) return;
    if (matchIndex !== undefined && isInSkipRange(matchIndex, skipRanges)) return;
    seen.add(clean);
    entities.push({ name: clean, kind, score: 0.9, source: "sql" });
  };

  let m: RegExpExecArray | null;

  // 1. Table names from FROM, JOIN, INTO, UPDATE, CREATE TABLE
  // Simple per-table patterns (no nested quantifiers — avoids catastrophic backtracking)
  const tablePatterns: RegExp[] = [
    /\bFROM\s+(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)/gi,
    /\bJOIN\s+(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)/gi,
    /\bINTO\s+(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)/gi,
    /\bUPDATE\s+(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)\s+SET/gi,
    /\bTABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*)/gi,
  ];

  for (const pattern of tablePatterns) {
    pattern.lastIndex = 0;
    while ((m = pattern.exec(text)) !== null) {
      const captured = m[1];
      if (captured) addEntity(captured, "tbl", m.index);
    }
  }

  // 2. Column names from SELECT, WHERE, ORDER BY, GROUP BY, SET
  const colPatterns: RegExp[] = [
    /\bSELECT\s+([\s\S]+?)\s+FROM\b/gi,
    /\b(?:WHERE|AND|OR)\s+(?:\w+\.)?([A-Za-z_]\w+)\s*(?:=|!=|<>|>|<|>=|<=|LIKE|IN|IS|BETWEEN)\b/gi,
    /\b(?:ORDER|GROUP)\s+BY\s+([\w.,\s]+)/gi,
    /\bSET\s+([\s\S]+?)\s*(?:WHERE|$)/gi,
  ];

  for (const pattern of colPatterns) {
    pattern.lastIndex = 0;
    while ((m = pattern.exec(text)) !== null) {
      if (isInSkipRange(m.index, skipRanges)) continue;
      const captured = m[1];
      if (!captured) continue;
      for (const part of captured.split(",")) {
        const colMatch = part.trim().match(/^(?:\w+\.)?([A-Za-z_]\w*)/);
        if (colMatch?.[1]) {
          const col = colMatch[1];
          if (!seen.has(col)) addEntity(col, "col", m.index);
        }
        // *** FIX: Also capture aliases: "expr AS alias_name"
        const aliasMatch = part.match(/\bAS\s+([A-Za-z_]\w*)/i);
        if (aliasMatch?.[1]) {
          addEntity(aliasMatch[1], "col", m.index);
        }
      }
    }
  }

  // 3. *** NEW: CREATE TABLE column definitions ***
  const createTableRe = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\)(?:\s*;|\s*$)/gi;
  while ((m = createTableRe.exec(text)) !== null) {
    const tableName = m[1];
    const body = m[2];
    if (tableName) addEntity(tableName, "tbl", m.index);

    // Parse each line of the CREATE TABLE body
    for (const line of body.split(/[,\n]/)) {
      const trimmed = line.trim();
      // Skip constraints: PRIMARY KEY, FOREIGN KEY, CONSTRAINT, CHECK, UNIQUE, INDEX
      if (/^\s*(?:PRIMARY\s+KEY|FOREIGN\s+KEY|CONSTRAINT|CHECK|UNIQUE|INDEX)/i.test(trimmed)) continue;
      // Skip empty lines
      if (!trimmed) continue;
      // Extract column name: first identifier on the line
      const colDef = trimmed.match(/^([A-Za-z_]\w*)\s+/);
      if (colDef?.[1]) {
        const colName = colDef[1];
        // Skip if it's a SQL type or keyword
        if (!SQL_KEYWORDS.has(colName.toLowerCase()) && !SQL_TYPES.has(colName.toLowerCase())) {
          addEntity(colName, "col", m.index);
        }
      }
    }
  }

  // 4. *** NEW: INSERT INTO table (col1, col2, ...) column list ***
  const insertColRe = /\bINSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/gi;
  while ((m = insertColRe.exec(text)) !== null) {
    // Table already caught above, but add columns
    for (const col of m[2].split(",")) {
      const colName = col.trim();
      if (colName) addEntity(colName, "col", m.index);
    }
  }

  // 5. *** NEW: CREATE INDEX idx_name ON table(col) ***
  const createIndexRe = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)/gi;
  while ((m = createIndexRe.exec(text)) !== null) {
    // Index name is technical, don't anonymize it
    // But the table and columns are business entities
    addEntity(m[2], "tbl", m.index);
    for (const col of m[3].split(",")) {
      addEntity(col.trim(), "col", m.index);
    }
  }

  return entities;
}

// ── AST to NER ──────────────────────────────────────────────────────────────

const AST_ROLE_TO_KIND: Record<string, MappingKind> = {
  class_name: "org",
  type_name: "org",
  function_name: "svc",
  variable_name: "idn",
  parameter_name: "idn",
  property_name: "col",
};

const AST_SKIP_ROLES: Set<AstRole> = new Set([
  "import_source", "import_symbol", "decorator",
  "string_literal", "comment",
]);

function astToNerEntities(astHints: Map<string, AstClassification>): NerEntityV4[] {
  const entities: NerEntityV4[] = [];

  for (const [token, classification] of astHints) {
    if (AST_SKIP_ROLES.has(classification.role)) continue;
    if (GENERIC_TECH_TOKENS.has(token)) continue;

    const kind = AST_ROLE_TO_KIND[classification.role] ?? "idn";
    const score = (classification.role === "class_name" || classification.role === "function_name" || classification.role === "type_name")
      ? 0.95
      : 0.7;

    entities.push({ name: token, kind, score, source: "ast" });
  }

  return entities;
}

// ── Heuristic detection ─────────────────────────────────────────────────────

const PASCAL_CASE_MULTI = /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/;
const CAMEL_CASE_MULTI = /^[a-z]+(?:[A-Z][a-z]+)+$/;
const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)+$/;
const UPPER_SNAKE = /^[A-Z][A-Z0-9]*(?:_[A-Z][A-Z0-9]*)+$/;

const TECH_PASCAL_PATTERNS = [
  /^(?:Get|Set|Add|Remove|Find|Create|Delete|Update|List|Count|Is|Has|Can|Should|Will)(?:All|One|By|To|From|With|Without|Into|For|Of)?$/,
  /^(?:Abstract|Base)(?:Factory|Builder|Handler|Adapter|Provider|Listener|Controller|Service|Repository)$/,
  /Exception$/, /Error$/,
  /Test$/, /Spec$/, /Mock$/, /Stub$/, /Fake$/,
  /Config$/, /Configuration$/, /Properties$/,
  /^(?:Request|Response|Dto|DTO)$/,
  // Generic technical suffixes
  /Utils$/, /Helper$/, /Manager$/, /Handler$/, /Listener$/,
  /Adapter$/, /Wrapper$/, /Provider$/, /Resolver$/, /Validator$/,
  /Converter$/, /Mapper$/, /Serializer$/, /Formatter$/, /Parser$/,
  /Logger$/, /Writer$/, /Reader$/, /Client$/, /Server$/,
  /Iterator$/, /Generator$/,
  /Context$/, /Registry$/, /Container$/, /Module$/, /Plugin$/,
  /Interceptor$/, /Middleware$/, /Filter$/, /Guard$/,
  // Generic technical prefixes
  /^(?:Default|Base|Abstract|Generic|Common|Internal)./,
  /^(?:Http|Json|Xml|Sql|Rest)/,
  // Generic noun + technical suffix compounds
  /^(?:Data|Error|Event|Result|Config|Status)(?:Type|Code|Name|Handler|Model|Source|Set|List|Map)?$/,
];

const TECH_CAMEL_PATTERNS = [
  // Generic CRUD/accessor methods
  /^(?:get|set|is|has|can|should|will|find|create|delete|update|add|remove|list|count|check|validate|parse|format|convert)(?:[A-Z][a-z]{0,6}){0,2}$/,
  // Generic action/lifecycle methods
  /^(?:on|handle|emit|dispatch|process|execute|invoke|run|start|stop|init|reset|clear|close|open|read|write|load|save|fetch|send)(?:[A-Z][a-z]{0,6})?$/,
  /^(?:toString|hashCode|valueOf|compareTo|iterator|stream|collect|forEach|filter|reduce|apply)$/,
  // Generic noun + technical suffix compounds (e.g. errorCode, dataModel, fileHandler)
  /^(?:error|data|file|result|message|request|response|field|config|input|output|token|model|query|record|node|item|entry|value|key|source|target|path|code|info|meta|body|header|status|state|mode|option|context)(?:[A-Z][a-z]+){1,2}$/,
];

/**
 * Extract imported symbols — ONLY standard library classes get filtered.
 * Business imports (com.mycompany.MyClass) are NOT filtered.
 */
function extractStdlibImports(text: string): Set<string> {
  const imported = new Set<string>();

  // JS/TS imports: only filter known standard libs
  const jsImport = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = jsImport.exec(text)) !== null) {
    const source = m[3];
    // Only filter if from a standard/framework package (not relative path)
    if (source && !source.startsWith(".") && !source.startsWith("@/")) {
      if (m[1]) {
        for (const name of m[1].split(",")) {
          const clean = name.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
          if (clean && clean.length >= 4 && STANDARD_LIBRARY_CLASSES.has(clean)) {
            imported.add(clean);
          }
        }
      }
      if (m[2] && m[2].length >= 4 && STANDARD_LIBRARY_CLASSES.has(m[2])) {
        imported.add(m[2]);
      }
    }
  }

  // Java imports: only filter standard library classes
  const javaImport = /import\s+(?:static\s+)?([\w.]+)\s*;/g;
  while ((m = javaImport.exec(text)) !== null) {
    const fullPath = m[1];
    const parts = fullPath.split(".");
    const className = parts[parts.length - 1];
    // ONLY filter known standard library — business classes pass through
    if (className && className.length >= 4 && className !== "*") {
      if (STANDARD_LIBRARY_CLASSES.has(className)) {
        imported.add(className);
      }
    }
  }

  return imported;
}

function heuristicDetect(text: string, alreadyCovered: Set<string>): NerEntityV4[] {
  const entities: NerEntityV4[] = [];
  const seen = new Set<string>(alreadyCovered);
  const stdlibImports = extractStdlibImports(text);
  // NOTE: no skip ranges here — skip ranges are only for SQL extraction
  // where we need to avoid VALUES(...) data. Heuristic scans ALL text
  // because identifiers appear in code, comments, and JavaDoc.

  const IDENTIFIER_RE = /\b[A-Za-z_][A-Za-z0-9_]{4,}\b/g;
  let match: RegExpExecArray | null;

  while ((match = IDENTIFIER_RE.exec(text)) !== null) {
    const token = match[0];
    if (seen.has(token)) continue;
    if (stdlibImports.has(token)) continue;
    if (GENERIC_TECH_TOKENS.has(token)) continue;
    if (STANDARD_LIBRARY_CLASSES.has(token)) continue;
    if (SQL_KEYWORDS.has(token.toLowerCase())) continue;
    if (SQL_TYPES.has(token.toLowerCase())) continue;

    let entity: NerEntityV4 | null = null;

    if (PASCAL_CASE_MULTI.test(token)) {
      if (!TECH_PASCAL_PATTERNS.some(p => p.test(token))) {
        entity = { name: token, kind: "org", score: 0.8, source: "heuristic" };
      }
    } else if (CAMEL_CASE_MULTI.test(token)) {
      if (!TECH_CAMEL_PATTERNS.some(p => p.test(token))) {
        entity = { name: token, kind: "svc", score: 0.7, source: "heuristic" };
      }
    } else if (SNAKE_CASE.test(token)) {
      entity = { name: token, kind: "col", score: 0.55, source: "heuristic" };
    } else if (UPPER_SNAKE.test(token)) {
      entity = { name: token, kind: "idn", score: 0.55, source: "heuristic" };
    }

    if (entity) {
      seen.add(token);
      entities.push(entity);
    }
  }

  return entities;
}

// ── Cross-reference boost ───────────────────────────────────────────────────

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
}

function applyCrossReferenceBoost(entities: NerEntityV4[]): void {
  const nameSet = new Set(entities.map(e => e.name));

  // Multi-source boost
  const bySources = new Map<string, Set<string>>();
  for (const e of entities) {
    const sources = bySources.get(e.name) ?? new Set();
    sources.add(e.source);
    bySources.set(e.name, sources);
  }

  for (const e of entities) {
    const sources = bySources.get(e.name);
    if (sources && sources.size > 1) {
      e.score = Math.min(1.0, e.score + 0.2);
      e.source = "cross-ref";
    }

    // camelCase ↔ snake_case cross-ref
    const camelVersion = snakeToCamel(e.name);
    const snakeVersion = camelToSnake(e.name);
    if (camelVersion !== e.name && nameSet.has(camelVersion)) {
      e.score = Math.min(1.0, e.score + 0.15);
    }
    if (snakeVersion !== e.name && nameSet.has(snakeVersion)) {
      e.score = Math.min(1.0, e.score + 0.15);
    }
  }
}

// ── Main detector ───────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 0.5;

export class NerDetectorV4 {
  private threshold: number;

  constructor(threshold = DEFAULT_THRESHOLD) {
    this.threshold = threshold;
  }

  detect(
    text: string,
    astHints?: Map<string, AstClassification>,
  ): NerDetectionResultV4 {
    const allEntities: NerEntityV4[] = [];
    const coveredNames = new Set<string>();

    // 1. AST (highest confidence)
    if (astHints && astHints.size > 0) {
      const astEntities = astToNerEntities(astHints);
      for (const entity of astEntities) {
        allEntities.push(entity);
        coveredNames.add(entity.name);
      }
    }

    // 2. SQL extraction (CREATE TABLE, SELECT, INSERT, etc.)
    const sqlEntities = extractSqlEntities(text);
    for (const entity of sqlEntities) {
      if (!coveredNames.has(entity.name)) {
        allEntities.push(entity);
        coveredNames.add(entity.name);
      }
    }

    // 3. Heuristic (PascalCase, camelCase, snake_case patterns)
    const heuristicEntities = heuristicDetect(text, coveredNames);
    for (const entity of heuristicEntities) {
      if (!coveredNames.has(entity.name)) {
        allEntities.push(entity);
        coveredNames.add(entity.name);
      }
    }

    // 4. Cross-reference boost
    applyCrossReferenceBoost(allEntities);

    // 5. Threshold filter
    const filtered = allEntities.filter(e => e.score >= this.threshold);

    const entityNames = new Set<string>();
    const entityKinds = new Map<string, MappingKind>();
    for (const e of filtered) {
      entityNames.add(e.name);
      entityKinds.set(e.name, e.kind);
    }

    return { entities: filtered, entityNames, entityKinds };
  }
}
