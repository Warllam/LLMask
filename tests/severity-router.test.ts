import { describe, it, expect } from "vitest";
import { SeverityRouter, parseSeverityRouting } from "../../src/modules/alerts/severity-router";

describe("SeverityRouter", () => {
  it("uses default routing when no config provided", () => {
    const router = new SeverityRouter();
    expect(router.getChannelsForSeverity("info")).toEqual(["dashboard", "log"]);
    expect(router.getChannelsForSeverity("critical")).toContain("discord");
    expect(router.getChannelsForSeverity("critical")).toContain("slack");
  });

  it("accepts custom routing", () => {
    const router = new SeverityRouter({
      info: ["dashboard"],
      warning: ["dashboard", "console"],
      critical: ["discord", "email"],
    });
    expect(router.getChannelsForSeverity("critical")).toEqual(["discord", "email"]);
  });

  it("filters channels by severity", () => {
    const router = new SeverityRouter({ info: ["dashboard"] });
    const filtered = router.filterChannels("info", ["dashboard", "discord", "slack"]);
    expect(filtered).toEqual(["dashboard"]);
  });

  it("setRouting updates a severity level", () => {
    const router = new SeverityRouter();
    router.setRouting("info", ["discord"]);
    expect(router.getChannelsForSeverity("info")).toEqual(["discord"]);
  });
});

describe("parseSeverityRouting", () => {
  it("parses env string correctly", () => {
    const result = parseSeverityRouting("critical=discord,slack;warning=console;info=dashboard");
    expect(result?.critical).toEqual(["discord", "slack"]);
    expect(result?.warning).toEqual(["console"]);
    expect(result?.info).toEqual(["dashboard"]);
  });

  it("returns undefined for empty input", () => {
    expect(parseSeverityRouting("")).toBeUndefined();
    expect(parseSeverityRouting(undefined)).toBeUndefined();
  });

  it("ignores invalid severity levels", () => {
    const result = parseSeverityRouting("invalid=discord;critical=slack");
    expect(result).toEqual({ critical: ["slack"] });
  });
});
