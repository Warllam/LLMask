/**
 * Common programming words that should NOT be pseudonymized
 * when splitting compound identifiers.
 *
 * A word is considered generic if its lowercase form is in this set.
 * Examples: "get", "Service", "VARIABLES" are all generic.
 */
export const GENERIC_WORDS = new Set([
  // Action verbs
  "get", "set", "create", "update", "delete", "remove", "find", "fetch",
  "load", "save", "init", "start", "stop", "run", "execute", "process",
  "handle", "build", "make", "parse", "format", "validate", "check",
  "is", "has", "can", "should", "will", "do", "on", "before", "after",
  "add", "put", "post", "patch", "send", "receive", "read", "write",
  "open", "close", "begin", "finish", "reset", "clear", "flush",
  "enable", "disable", "register", "unregister", "subscribe", "unsubscribe",
  "encode", "decode", "encrypt", "decrypt", "compress", "decompress",
  "serialize", "deserialize", "marshal", "unmarshal",
  "map", "reduce", "filter", "sort", "merge", "split", "join", "concat",
  "push", "pop", "shift", "unshift", "insert", "append", "prepend",
  "emit", "dispatch", "trigger", "notify", "publish", "broadcast",
  "resolve", "reject", "await", "then", "catch", "throw",
  "log", "print", "dump", "render", "display", "show", "hide",
  "connect", "disconnect", "bind", "unbind", "attach", "detach",
  "mount", "unmount", "install", "uninstall",
  "lock", "unlock", "acquire", "release",
  "copy", "clone", "move", "swap", "replace", "transform", "convert",

  // Descriptive nouns — architecture/patterns
  "service", "controller", "handler", "manager", "factory", "builder",
  "helper", "util", "utils", "utility", "provider", "adapter", "wrapper",
  "repository", "repo", "store", "cache", "pool", "queue", "stack",
  "engine", "processor", "worker", "runner", "executor", "scheduler",
  "dispatcher", "emitter", "listener", "observer", "watcher",
  "middleware", "interceptor", "guard", "filter", "pipe", "chain",
  "registry", "container", "injector", "resolver", "locator",
  "proxy", "delegate", "bridge", "facade", "gateway", "router",
  "strategy", "policy", "rule", "validator", "sanitizer", "formatter",
  "parser", "serializer", "transformer", "converter", "mapper",
  "loader", "fetcher", "reader", "writer", "logger", "tracer",
  "client", "server", "connection", "socket", "channel",

  // Descriptive nouns — data structures
  "model", "entity", "dto", "schema", "type", "interface", "class",
  "config", "configuration", "settings", "options", "params", "args",
  "request", "response", "result", "error", "exception", "fault",
  "list", "array", "map", "set", "collection", "group", "batch",
  "item", "entry", "record", "row", "node", "element", "member",
  "pair", "tuple", "struct", "object", "instance", "ref", "reference",
  "tree", "graph", "linked", "hash", "heap", "ring", "buffer",

  // Descriptive nouns — fields/properties
  "id", "key", "value", "name", "title", "label", "description",
  "index", "count", "total", "size", "length", "limit", "offset",
  "status", "state", "flag", "mode", "level", "priority", "weight",
  "data", "info", "meta", "context", "scope", "session", "token",
  "input", "output", "source", "target", "origin", "destination",
  "start", "end", "begin", "finish", "from", "to", "min", "max",
  "first", "last", "next", "prev", "previous", "current", "default",
  "new", "old", "temp", "tmp", "base", "root", "parent", "child",
  "created", "updated", "deleted", "modified", "at", "by", "date", "time",
  "timestamp", "version", "revision", "sequence", "number", "num",
  "enabled", "disabled", "active", "inactive", "visible", "hidden",
  "public", "private", "internal", "external", "local", "remote", "global",
  "primary", "secondary", "fallback", "backup", "main", "master", "slave",
  "async", "sync", "parallel", "sequential", "lazy", "eager",

  // SQL / DB
  "table", "column", "field", "row", "record", "view", "index",
  "query", "select", "insert", "update", "delete", "where", "join",
  "left", "right", "inner", "outer", "cross", "on", "and", "or",
  "order", "group", "having", "limit", "offset", "distinct",
  "primary", "foreign", "unique", "null", "not", "exists",
  "seq", "idx", "fk", "pk", "rel",
  "combat", "mission", "force", "membre", "victoire",

  // Common suffixes/prefixes
  "template", "templates", "variables", "variable", "vars",
  "file", "files", "path", "paths", "dir", "directory",
  "url", "uri", "link", "href", "endpoint", "route",
  "test", "tests", "spec", "specs", "mock", "mocks", "stub", "fixture",
  "debug", "trace", "warn", "warning", "info", "error", "fatal",
  "event", "events", "callback", "hook", "hooks", "signal",
  "api", "rest", "http", "https", "web", "ws", "grpc", "rpc",
  "auth", "user", "users", "role", "roles", "permission", "admin",
  "page", "pages", "view", "views", "component", "components",
  "module", "modules", "plugin", "plugins", "extension", "extensions",
  "all", "any", "each", "every", "some", "none", "many", "one",
  "with", "without", "like", "between", "in", "out", "up", "down",
]);

/**
 * Check if a word is generic (case-insensitive).
 */
export function isGenericWord(word: string): boolean {
  return GENERIC_WORDS.has(word.toLowerCase());
}
