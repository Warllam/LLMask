/**
 * Simple in-memory sliding-window rate limiter per tenant.
 * Tracks request timestamps and enforces a max requests/minute limit.
 */
export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly windowMs = 60_000; // 1 minute

  /** Check if a request is allowed. Returns { allowed, remaining, resetMs }. */
  check(tenantId: string, limit: number): { allowed: boolean; remaining: number; resetMs: number } {
    if (limit <= 0) {
      return { allowed: true, remaining: -1, resetMs: 0 };
    }

    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(tenantId);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(tenantId, timestamps);
    }

    // Remove expired entries
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= limit) {
      const resetMs = timestamps[0] + this.windowMs - now;
      return { allowed: false, remaining: 0, resetMs };
    }

    timestamps.push(now);
    return { allowed: true, remaining: limit - timestamps.length, resetMs: 0 };
  }

  /** Periodic cleanup of stale entries (call every few minutes). */
  cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.windows) {
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }
}
