import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type SupportedLanguage = "typescript" | "javascript" | "python" | "java";

/** Shape of a tree-sitter SyntaxNode (subset used by the classifier). */
export type SyntaxNode = {
  type: string;
  text: string;
  childCount: number;
  child(index: number): SyntaxNode | null;
  parent: SyntaxNode | null;
  childForFieldName(fieldName: string): SyntaxNode | null;
};

/** Shape of a tree-sitter Tree. */
type ParseTree = {
  rootNode: SyntaxNode;
};

/** Shape of the Parser class. */
type TreeSitterParser = {
  parse(input: string): ParseTree;
  setLanguage(language: unknown): void;
};

const GRAMMAR_FILES: Record<SupportedLanguage, string> = {
  typescript: "tree-sitter-typescript.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  java: "tree-sitter-java.wasm"
};

/** Map common fenced-block language hints to a SupportedLanguage. */
const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  ts: "typescript",
  typescript: "typescript",
  tsx: "typescript",
  js: "javascript",
  javascript: "javascript",
  jsx: "javascript",
  py: "python",
  python: "python",
  java: "java"
};

/**
 * Lazily loads web-tree-sitter and language grammars on demand.
 * Grammars are WASM files stored in a configurable directory.
 */
export class LanguageRegistry {
  private initPromise: Promise<void> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ParserCtor: any = null;
  private parser: TreeSitterParser | null = null;
  private languages = new Map<SupportedLanguage, unknown>();
  private availableCache: Map<SupportedLanguage, boolean> | null = null;

  constructor(private readonly grammarDir: string) {}

  /** Resolve a fenced-block language hint (e.g. "ts", "py") to a SupportedLanguage. */
  resolveLanguage(hint: string): SupportedLanguage | null {
    return LANGUAGE_ALIASES[hint.toLowerCase()] ?? null;
  }

  /** Check whether the WASM grammar file exists for the given language. */
  isAvailable(lang: SupportedLanguage): boolean {
    if (!this.availableCache) {
      this.availableCache = new Map();
      for (const [language, file] of Object.entries(GRAMMAR_FILES)) {
        const path = resolve(this.grammarDir, file);
        this.availableCache.set(language as SupportedLanguage, existsSync(path));
      }
    }
    return this.availableCache.get(lang) ?? false;
  }

  /** Get an initialized parser set to the requested language. */
  async getParser(lang: SupportedLanguage): Promise<TreeSitterParser> {
    await this.initialize();

    if (!this.languages.has(lang)) {
      const grammarPath = resolve(this.grammarDir, GRAMMAR_FILES[lang]);
      if (!existsSync(grammarPath)) {
        throw new Error(`Grammar file not found: ${grammarPath}`);
      }
      const language = await this.ParserCtor.Language.load(grammarPath);
      this.languages.set(lang, language);
    }

    this.parser!.setLanguage(this.languages.get(lang)!);
    return this.parser!;
  }

  /** Initialize the WASM runtime once. */
  private async initialize(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      const mod = await import("web-tree-sitter");
      // web-tree-sitter may export the Parser as default or as the module itself
      const Ctor = (mod as any).default ?? mod;
      await Ctor.init();
      this.ParserCtor = Ctor;
      this.parser = new Ctor() as TreeSitterParser;
    })();

    await this.initPromise;
  }
}
