/**
 * Licensing stub for OSS version
 * Always returns community tier
 */

export type LicenseTier = "community" | "pro" | "enterprise";
export type Tier = LicenseTier; // Alias for compatibility

export type LicenseInfo = {
  tier: LicenseTier;
  valid: boolean;
  expiresAt?: number;
  features: string[];
  org?: string;
  reason?: string;
};

export function loadLicense(_keyOrConfig?: string | { licenseKey?: string; licenseFile?: string }, _file?: string): LicenseInfo {
  return {
    tier: "community",
    valid: true,
    features: ["core-proxy", "dashboard", "basic-masking"]
  };
}

export function validateLicense(_keyOrConfig?: string | { licenseKey?: string; licenseFile?: string }): LicenseInfo {
  return loadLicense();
}

export function getLicenseTier(): LicenseTier {
  return "community";
}

export function hasFeature(_feature: string): boolean {
  // OSS version has all core features
  return true;
}
