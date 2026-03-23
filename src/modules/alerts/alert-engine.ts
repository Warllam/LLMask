/**
 * Stub AlertEngine for OSS version
 */

export class AlertEngine {
  checkConditions(): void {
    // No-op in OSS version
  }

  async evaluateRule(_rule: unknown): Promise<void> {
    // No-op in OSS version
  }
}
