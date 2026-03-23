import type { LanguageRegistry, SupportedLanguage, SyntaxNode } from "./language-registry";

// ── Public types ──────────────────────────────────────────────────────────────

export type AstRole =
  | "class_name"
  | "function_name"
  | "variable_name"
  | "parameter_name"
  | "property_name"
  | "import_source"
  | "import_symbol"
  | "type_name"
  | "string_literal"
  | "comment"
  | "decorator";

export type AstClassification = {
  role: AstRole;
  language: SupportedLanguage;
};

type CodeBlock = {
  language: SupportedLanguage | null;
  code: string;
};

// ── Classifier ────────────────────────────────────────────────────────────────

export class AstClassifier {
  constructor(private readonly registry: LanguageRegistry) {}

  /**
   * Build a token → AstClassification map from all parseable code blocks
   * found in a text string (fenced markdown code blocks).
   */
  async classifyTokens(text: string): Promise<Map<string, AstClassification>> {
    const result = new Map<string, AstClassification>();
    const blocks = this.extractCodeBlocks(text);

    for (const block of blocks) {
      if (!block.language) continue;
      if (!this.registry.isAvailable(block.language)) continue;

      try {
        const parser = await this.registry.getParser(block.language);
        const tree = parser.parse(block.code);
        this.walkTree(tree.rootNode, block.language, result);
      } catch {
        // Grammar unavailable or parse failure → skip this block
      }
    }

    return result;
  }

  /** Extract fenced code blocks (```lang ... ```) from markdown-like text. */
  private extractCodeBlocks(text: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const fenceRe = /```(\w+)?\s*\n([\s\S]*?)```/g;

    for (const match of text.matchAll(fenceRe)) {
      const langHint = match[1] ?? "";
      const language = this.registry.resolveLanguage(langHint);
      blocks.push({ language, code: match[2] });
    }

    return blocks;
  }

  /** Recursively walk the AST and classify identifier nodes. */
  private walkTree(
    node: SyntaxNode,
    language: SupportedLanguage,
    result: Map<string, AstClassification>
  ): void {
    const role = this.classifyNode(node, language);

    // Only classify tokens that are long enough to be candidates (4+ chars)
    if (role && node.text.length >= 4) {
      // First occurrence wins (higher in tree = more context)
      if (!result.has(node.text)) {
        result.set(node.text, { role, language });
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.walkTree(child, language, result);
      }
    }
  }

  /** Classify a single AST node based on its type and parent context. */
  private classifyNode(
    node: SyntaxNode,
    lang: SupportedLanguage
  ): AstRole | null {
    if (lang === "typescript" || lang === "javascript") {
      return this.classifyTsJsNode(node);
    }
    if (lang === "python") {
      return this.classifyPythonNode(node);
    }
    if (lang === "java") {
      return this.classifyJavaNode(node);
    }
    return null;
  }

  // ── TypeScript / JavaScript ───────────────────────────────────────────

  private classifyTsJsNode(node: SyntaxNode): AstRole | null {
    const { type: nodeType } = node;
    const parent = node.parent;
    if (!parent) return null;
    const parentType = parent.type;

    // Import sources (package paths) → always skip
    if (nodeType === "string" || nodeType === "string_fragment") {
      if (
        parentType === "import_statement" ||
        parentType === "import_clause" ||
        parentType === "export_statement" ||
        parentType === "call_expression" // require("...")
      ) {
        return "import_source";
      }
      return "string_literal";
    }

    // Template strings
    if (nodeType === "template_string") return "string_literal";

    // Comments
    if (nodeType === "comment") return "comment";

    // Identifiers — classify by parent context
    if (nodeType === "identifier" || nodeType === "type_identifier" || nodeType === "property_identifier") {
      // Class / interface declaration name
      if (
        parentType === "class_declaration" ||
        parentType === "interface_declaration" ||
        parentType === "abstract_class_declaration"
      ) {
        if (parent.childForFieldName("name") === node) return "class_name";
      }

      // Function / method declaration name
      if (
        parentType === "function_declaration" ||
        parentType === "method_definition" ||
        parentType === "arrow_function" ||
        parentType === "generator_function_declaration"
      ) {
        if (parent.childForFieldName("name") === node) return "function_name";
      }

      // Variable declaration
      if (parentType === "variable_declarator") {
        if (parent.childForFieldName("name") === node) return "variable_name";
      }

      // Function parameters
      if (
        parentType === "formal_parameters" ||
        parentType === "required_parameter" ||
        parentType === "optional_parameter" ||
        parentType === "rest_pattern"
      ) {
        return "parameter_name";
      }

      // Import specifier (imported symbol name)
      if (parentType === "import_specifier" || parentType === "namespace_import") {
        return "import_symbol";
      }

      // Type annotations
      if (
        parentType === "type_annotation" ||
        parentType === "type_alias_declaration" ||
        parentType === "generic_type" ||
        parentType === "type_arguments"
      ) {
        return "type_name";
      }

      // Decorator
      if (parentType === "decorator") return "decorator";

      // Property identifier in object / member expression
      if (nodeType === "property_identifier") return "property_name";

      return null;
    }

    return null;
  }

  // ── Python ────────────────────────────────────────────────────────────

  private classifyPythonNode(node: SyntaxNode): AstRole | null {
    const { type: nodeType } = node;
    const parent = node.parent;
    if (!parent) return null;
    const parentType = parent.type;

    if (nodeType === "comment") return "comment";

    if (nodeType === "string" || nodeType === "string_content") {
      if (parentType === "import_from_statement" || parentType === "import_statement") {
        return "import_source";
      }
      return "string_literal";
    }

    if (nodeType === "identifier") {
      // Class definition name
      if (parentType === "class_definition") {
        if (parent.childForFieldName("name") === node) return "class_name";
      }

      // Function definition name
      if (parentType === "function_definition") {
        if (parent.childForFieldName("name") === node) return "function_name";
      }

      // Parameters
      if (parentType === "parameters" || parentType === "default_parameter" || parentType === "typed_parameter") {
        return "parameter_name";
      }

      // Import names
      if (parentType === "import_from_statement" || parentType === "import_statement") {
        return "import_symbol";
      }
      if (parentType === "aliased_import") return "import_symbol";

      // Decorator
      if (parentType === "decorator") return "decorator";

      // Assignment target
      if (parentType === "assignment") {
        if (parent.childForFieldName("left") === node) return "variable_name";
      }

      return null;
    }

    // Dotted name in imports
    if (nodeType === "dotted_name") {
      if (parentType === "import_from_statement" || parentType === "import_statement") {
        return "import_source";
      }
    }

    return null;
  }

  // ── Java ──────────────────────────────────────────────────────────────

  private classifyJavaNode(node: SyntaxNode): AstRole | null {
    const { type: nodeType } = node;
    const parent = node.parent;
    if (!parent) return null;
    const parentType = parent.type;

    if (nodeType === "line_comment" || nodeType === "block_comment") return "comment";

    if (nodeType === "string_literal") return "string_literal";

    if (nodeType === "identifier" || nodeType === "type_identifier") {
      // Class / interface / enum declaration
      if (
        parentType === "class_declaration" ||
        parentType === "interface_declaration" ||
        parentType === "enum_declaration" ||
        parentType === "annotation_type_declaration"
      ) {
        if (parent.childForFieldName("name") === node) return "class_name";
      }

      // Method declaration
      if (parentType === "method_declaration" || parentType === "constructor_declaration") {
        if (parent.childForFieldName("name") === node) return "function_name";
      }

      // Parameters
      if (parentType === "formal_parameter" || parentType === "spread_parameter") {
        if (parent.childForFieldName("name") === node) return "parameter_name";
      }

      // Variable declarations
      if (parentType === "variable_declarator") {
        if (parent.childForFieldName("name") === node) return "variable_name";
      }

      // Annotations
      if (parentType === "annotation" || parentType === "marker_annotation") {
        return "decorator";
      }

      // Type usage in generic, extends, etc.
      if (
        parentType === "generic_type" ||
        parentType === "type_arguments" ||
        parentType === "superclass" ||
        parentType === "super_interfaces"
      ) {
        return "type_name";
      }

      return null;
    }

    // Import declarations
    if (nodeType === "scoped_identifier" || nodeType === "scoped_type_identifier") {
      if (parentType === "import_declaration") return "import_source";
    }

    return null;
  }
}
