import { describe, it, expect } from "vitest";
import { renderTemplate, renderAlertForChannel, setCustomTemplate, getTemplate, getAllTemplates } from "../../src/modules/alerts/alert-templates";
import type { AlertEvent } from "../../src/modules/alerts/alert-types";

function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 42,
    ruleId: "leak-threshold",
    ruleName: "Fuite de données",
    severity: "critical",
    status: "firing",
    message: "3 fuites détectées (seuil: 1)",
    value: 3,
    threshold: 1,
    firedAt: "2024-01-15T10:30:00Z",
    resolvedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    ...overrides,
  };
}

describe("renderTemplate", () => {
  it("replaces all placeholders", () => {
    const result = renderTemplate("{{emoji}} [{{severityUpper}}] {{ruleName}}: {{message}}", makeEvent());
    expect(result).toBe("🔴 [CRITICAL] Fuite de données: 3 fuites détectées (seuil: 1)");
  });

  it("handles unknown placeholders gracefully", () => {
    const result = renderTemplate("{{unknown}} {{ruleName}}", makeEvent());
    expect(result).toBe(" Fuite de données");
  });

  it("renders severity emojis correctly", () => {
    expect(renderTemplate("{{emoji}}", makeEvent({ severity: "critical" }))).toBe("🔴");
    expect(renderTemplate("{{emoji}}", makeEvent({ severity: "warning" }))).toBe("🟠");
    expect(renderTemplate("{{emoji}}", makeEvent({ severity: "info" }))).toBe("🟢");
  });

  it("renders slack emojis", () => {
    expect(renderTemplate("{{slackEmoji}}", makeEvent({ severity: "critical" }))).toBe(":red_circle:");
  });
});

describe("renderAlertForChannel", () => {
  it("renders with default discord template", () => {
    const { title, body } = renderAlertForChannel("discord", makeEvent());
    expect(title).toBe("🔴 Fuite de données");
    expect(body).toBe("3 fuites détectées (seuil: 1)");
  });

  it("renders with default slack template", () => {
    const { title } = renderAlertForChannel("slack", makeEvent());
    expect(title).toBe(":red_circle: Fuite de données");
  });
});

describe("custom templates", () => {
  it("overrides default template", () => {
    setCustomTemplate({
      channelType: "discord",
      titleTemplate: "CUSTOM: {{ruleName}}",
      bodyTemplate: "Value={{value}}",
    });
    const tpl = getTemplate("discord");
    expect(tpl.titleTemplate).toBe("CUSTOM: {{ruleName}}");

    const { title, body } = renderAlertForChannel("discord", makeEvent());
    expect(title).toBe("CUSTOM: Fuite de données");
    expect(body).toBe("Value=3");
  });

  it("getAllTemplates includes custom overrides", () => {
    const all = getAllTemplates();
    const discord = all.find(t => t.channelType === "discord");
    expect(discord?.titleTemplate).toBe("CUSTOM: {{ruleName}}");
  });
});
