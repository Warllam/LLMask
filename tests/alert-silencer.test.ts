import { describe, it, expect, beforeEach } from "vitest";
import { AlertSilencer } from "../../src/modules/alerts/alert-silencer";
import type { AlertEvent, SilenceWindow } from "../../src/modules/alerts/alert-types";

function makeEvent(overrides: Partial<AlertEvent> = {}): AlertEvent {
  return {
    id: 1,
    ruleId: "leak-threshold",
    ruleName: "Fuite détectée",
    severity: "critical",
    status: "firing",
    message: "test",
    value: 5,
    threshold: 1,
    firedAt: new Date().toISOString(),
    resolvedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    ...overrides,
  };
}

function makeWindow(overrides: Partial<SilenceWindow> = {}): SilenceWindow {
  const now = Date.now();
  return {
    id: "mw-1",
    label: "Test maintenance",
    matchers: {},
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 3600_000).toISOString(),
    createdBy: "admin",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("AlertSilencer", () => {
  let silencer: AlertSilencer;

  beforeEach(() => {
    silencer = new AlertSilencer();
  });

  it("returns null when no windows exist", () => {
    expect(silencer.isSilenced(makeEvent())).toBeNull();
  });

  it("silences all alerts with a catch-all window", () => {
    silencer.addWindow(makeWindow());
    expect(silencer.isSilenced(makeEvent())).toBe("mw-1");
  });

  it("does not silence when window has expired", () => {
    const now = Date.now();
    silencer.addWindow(makeWindow({
      startsAt: new Date(now - 7200_000).toISOString(),
      endsAt: new Date(now - 3600_000).toISOString(),
    }));
    expect(silencer.isSilenced(makeEvent())).toBeNull();
  });

  it("does not silence when window has not started", () => {
    const now = Date.now();
    silencer.addWindow(makeWindow({
      startsAt: new Date(now + 3600_000).toISOString(),
      endsAt: new Date(now + 7200_000).toISOString(),
    }));
    expect(silencer.isSilenced(makeEvent())).toBeNull();
  });

  it("matches by ruleId", () => {
    silencer.addWindow(makeWindow({ matchers: { ruleIds: ["leak-threshold"] } }));
    expect(silencer.isSilenced(makeEvent())).toBe("mw-1");
    expect(silencer.isSilenced(makeEvent({ ruleId: "other-rule" }))).toBeNull();
  });

  it("matches by ruleId glob", () => {
    silencer.addWindow(makeWindow({ matchers: { ruleIds: ["leak-*"] } }));
    expect(silencer.isSilenced(makeEvent({ ruleId: "leak-threshold" }))).toBe("mw-1");
    expect(silencer.isSilenced(makeEvent({ ruleId: "leak-high" }))).toBe("mw-1");
    expect(silencer.isSilenced(makeEvent({ ruleId: "other" }))).toBeNull();
  });

  it("matches by severity", () => {
    silencer.addWindow(makeWindow({ matchers: { severities: ["warning", "info"] } }));
    expect(silencer.isSilenced(makeEvent({ severity: "warning" }))).toBe("mw-1");
    expect(silencer.isSilenced(makeEvent({ severity: "critical" }))).toBeNull();
  });

  it("matches with both ruleId and severity (AND logic)", () => {
    silencer.addWindow(makeWindow({ matchers: { ruleIds: ["leak-*"], severities: ["critical"] } }));
    expect(silencer.isSilenced(makeEvent({ ruleId: "leak-threshold", severity: "critical" }))).toBe("mw-1");
    expect(silencer.isSilenced(makeEvent({ ruleId: "leak-threshold", severity: "warning" }))).toBeNull();
    expect(silencer.isSilenced(makeEvent({ ruleId: "other", severity: "critical" }))).toBeNull();
  });

  it("removes a window", () => {
    silencer.addWindow(makeWindow());
    expect(silencer.removeWindow("mw-1")).toBe(true);
    expect(silencer.isSilenced(makeEvent())).toBeNull();
  });

  it("lists active windows only", () => {
    const now = Date.now();
    silencer.addWindow(makeWindow({ id: "active" }));
    silencer.addWindow(makeWindow({
      id: "expired",
      startsAt: new Date(now - 7200_000).toISOString(),
      endsAt: new Date(now - 3600_000).toISOString(),
    }));
    expect(silencer.listActiveWindows()).toHaveLength(1);
    expect(silencer.listActiveWindows()[0].id).toBe("active");
  });

  it("purges expired windows", () => {
    const now = Date.now();
    silencer.addWindow(makeWindow({ id: "active" }));
    silencer.addWindow(makeWindow({
      id: "expired",
      startsAt: new Date(now - 7200_000).toISOString(),
      endsAt: new Date(now - 3600_000).toISOString(),
    }));
    expect(silencer.purgeExpired()).toBe(1);
    expect(silencer.listWindows()).toHaveLength(1);
  });
});
