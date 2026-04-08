import type Database from "better-sqlite3";

export type CustomRule = {
  id: number;
  name: string;
  pattern: string;
  replacementPrefix: string;
  category: string;
  enabled: boolean;
  createdAt: string;
};

type CustomRuleRow = {
  id: number;
  name: string;
  pattern: string;
  replacement_prefix: string;
  category: string;
  enabled: number;
  created_at: string;
};

export type CreateCustomRuleInput = {
  name: string;
  pattern: string;
  replacementPrefix: string;
  category: string;
};

export type UpdateCustomRuleInput = {
  name?: string;
  pattern?: string;
  replacementPrefix?: string;
  category?: string;
  enabled?: boolean;
};

export type TestRuleResult = {
  valid: boolean;
  matches: string[];
  preview: string;
  error?: string;
};

function rowToRule(row: CustomRuleRow): CustomRule {
  return {
    id: row.id,
    name: row.name,
    pattern: row.pattern,
    replacementPrefix: row.replacement_prefix,
    category: row.category,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

export class CustomRulesStore {
  constructor(private readonly db: Database.Database) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS custom_rules (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT    NOT NULL,
        pattern           TEXT    NOT NULL,
        replacement_prefix TEXT   NOT NULL DEFAULT 'CUSTOM',
        category          TEXT    NOT NULL DEFAULT 'Custom',
        enabled           INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
  }

  list(): CustomRule[] {
    return (
      this.db
        .prepare<[], CustomRuleRow>(
          "SELECT id, name, pattern, replacement_prefix, category, enabled, created_at FROM custom_rules ORDER BY id ASC"
        )
        .all()
        .map(rowToRule)
    );
  }

  getById(id: number): CustomRule | null {
    const row = this.db
      .prepare<[number], CustomRuleRow>(
        "SELECT id, name, pattern, replacement_prefix, category, enabled, created_at FROM custom_rules WHERE id = ?"
      )
      .get(id);
    return row ? rowToRule(row) : null;
  }

  getEnabledRules(): Array<Pick<CustomRule, "id" | "name" | "pattern" | "replacementPrefix" | "category">> {
    return (
      this.db
        .prepare<[], CustomRuleRow>(
          "SELECT id, name, pattern, replacement_prefix, category, enabled, created_at FROM custom_rules WHERE enabled = 1 ORDER BY id ASC"
        )
        .all()
        .map((row) => ({
          id: row.id,
          name: row.name,
          pattern: row.pattern,
          replacementPrefix: row.replacement_prefix,
          category: row.category,
        }))
    );
  }

  create(input: CreateCustomRuleInput): CustomRule {
    const result = this.db
      .prepare(
        `INSERT INTO custom_rules (name, pattern, replacement_prefix, category)
         VALUES (@name, @pattern, @replacement_prefix, @category)`
      )
      .run({
        name: input.name.trim(),
        pattern: input.pattern.trim(),
        replacement_prefix: (input.replacementPrefix || "CUSTOM").trim().toUpperCase(),
        category: (input.category || "Custom").trim(),
      });
    const id = Number(result.lastInsertRowid);
    return this.getById(id)!;
  }

  update(id: number, input: UpdateCustomRuleInput): CustomRule | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const params: Record<string, unknown> = { id };

    if (input.name !== undefined) {
      fields.push("name = @name");
      params.name = input.name.trim();
    }
    if (input.pattern !== undefined) {
      fields.push("pattern = @pattern");
      params.pattern = input.pattern.trim();
    }
    if (input.replacementPrefix !== undefined) {
      fields.push("replacement_prefix = @replacement_prefix");
      params.replacement_prefix = input.replacementPrefix.trim().toUpperCase();
    }
    if (input.category !== undefined) {
      fields.push("category = @category");
      params.category = input.category.trim();
    }
    if (input.enabled !== undefined) {
      fields.push("enabled = @enabled");
      params.enabled = input.enabled ? 1 : 0;
    }

    if (fields.length === 0) return existing;

    this.db.prepare(`UPDATE custom_rules SET ${fields.join(", ")} WHERE id = @id`).run(params);
    return this.getById(id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare("DELETE FROM custom_rules WHERE id = ?").run(id);
    return result.changes > 0;
  }

  testRule(pattern: string, text: string): TestRuleResult {
    let re: RegExp;
    try {
      re = new RegExp(pattern, "g");
    } catch (err) {
      return {
        valid: false,
        matches: [],
        preview: text,
        error: err instanceof Error ? err.message : "Invalid regex",
      };
    }

    const matches: string[] = [];
    let match: RegExpExecArray | null;

    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      matches.push(match[0]);
      if (matches.length >= 50) break;
      // Prevent infinite loops on zero-width matches
      if (match[0].length === 0) re.lastIndex++;
    }

    const preview = text.replace(new RegExp(pattern, "g"), (m) => `[MASKED: ${m}]`);

    return { valid: true, matches, preview };
  }
}
