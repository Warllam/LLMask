/**
 * Enterprise features stub for OSS version
 */

import type { FastifyInstance } from "fastify";

export type EnterpriseServices = {
  authService?: unknown;
  oidcProvider?: unknown;
  rateLimiter?: unknown;
};

export function registerEnterprise(_app: FastifyInstance, _config: unknown): EnterpriseServices {
  // No enterprise features in OSS version
  return {};
}

export async function registerEnterpriseFeatures(_app: FastifyInstance): Promise<void> {
  // No enterprise features in OSS version
}

export function initializeEnterpriseModules(): void {
  // No-op in OSS version
}
