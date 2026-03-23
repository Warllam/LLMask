import { describe, it, expect, beforeEach } from "vitest";
import { NotificationRateLimiter } from "../../src/modules/alerts/notification-rate-limiter";

const mockLogger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

describe("NotificationRateLimiter", () => {
  it("allows notifications when disabled", () => {
    const limiter = new NotificationRateLimiter(
      { enabled: false, maxPerWindow: 1, windowMinutes: 1 },
      mockLogger
    );
    expect(limiter.tryAcquire("discord")).toBe(true);
    expect(limiter.tryAcquire("discord")).toBe(true);
  });

  it("allows up to maxPerWindow notifications", () => {
    const limiter = new NotificationRateLimiter(
      { enabled: true, maxPerWindow: 3, windowMinutes: 60 },
      mockLogger
    );
    expect(limiter.tryAcquire("discord")).toBe(true);
    expect(limiter.tryAcquire("discord")).toBe(true);
    expect(limiter.tryAcquire("discord")).toBe(true);
    expect(limiter.tryAcquire("discord")).toBe(false);
  });

  it("tracks channels independently", () => {
    const limiter = new NotificationRateLimiter(
      { enabled: true, maxPerWindow: 1, windowMinutes: 60 },
      mockLogger
    );
    expect(limiter.tryAcquire("discord")).toBe(true);
    expect(limiter.tryAcquire("slack")).toBe(true);
    expect(limiter.tryAcquire("discord")).toBe(false);
    expect(limiter.tryAcquire("slack")).toBe(false);
  });

  it("reports usage correctly", () => {
    const limiter = new NotificationRateLimiter(
      { enabled: true, maxPerWindow: 5, windowMinutes: 10 },
      mockLogger
    );
    limiter.tryAcquire("discord");
    limiter.tryAcquire("discord");
    const usage = limiter.getUsage("discord");
    expect(usage.current).toBe(2);
    expect(usage.max).toBe(5);
  });

  it("counts dropped notifications", () => {
    const limiter = new NotificationRateLimiter(
      { enabled: true, maxPerWindow: 1, windowMinutes: 60 },
      mockLogger
    );
    limiter.tryAcquire("discord");
    limiter.tryAcquire("discord");
    limiter.tryAcquire("discord");
    expect(limiter.getDroppedCount()).toBe(2);
  });

  it("resets all state", () => {
    const limiter = new NotificationRateLimiter(
      { enabled: true, maxPerWindow: 1, windowMinutes: 60 },
      mockLogger
    );
    limiter.tryAcquire("discord");
    limiter.tryAcquire("discord"); // dropped
    limiter.reset();
    expect(limiter.tryAcquire("discord")).toBe(true);
    expect(limiter.getDroppedCount()).toBe(0);
  });
});
