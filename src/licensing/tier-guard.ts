/**
 * Tier guard stub for OSS version
 */

import type { LicenseTier, LicenseInfo } from "./license";

export function requireTier(_minTier: LicenseTier): void {
  // Always passes in OSS version
}

export function checkTier(_minTier: LicenseTier): boolean {
  return true;
}

export function createTierGuard(_tierOrLicenseInfo: LicenseTier | LicenseInfo) {
  return async () => {
    // Always passes in OSS version
  };
}
