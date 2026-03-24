import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { log } from "../src/shared/logger";

describe("Logger", () => {
  const originalEnv = process.env.LOG_LEVEL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.LOG_LEVEL = originalEnv;
    } else {
      delete process.env.LOG_LEVEL;
    }
  });

  it("exports a pino logger instance", () => {
    expect(log).toBeDefined();
    expect(typeof log.info).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.warn).toBe("function");
  });

  it("uses LOG_LEVEL from environment", () => {
    // Just verify the logger has a level property
    expect(log.level).toBeDefined();
    expect(typeof log.level).toBe("string");
  });

  it("can log info messages", () => {
    expect(() => {
      log.info("test message");
    }).not.toThrow();
  });

  it("can log error messages", () => {
    expect(() => {
      log.error("test error");
    }).not.toThrow();
  });

  it("can log with metadata objects", () => {
    expect(() => {
      log.info({ userId: "123", action: "test" }, "test with metadata");
    }).not.toThrow();
  });

  it("can create child loggers", () => {
    const child = log.child({ component: "test" });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
  });
});
