import { AUTH_BASE_URL } from "../constants";

// ── OAuth2 Configuration (production) ──────────────────────────
const OAUTH_CONFIG = {
  clientId: "nextera_mobile_oauth_client_id_prod_abc123def456ghi",
  clientSecret: "nextera_oauth_client_secret_prod_xK9fMpQ2rT5vW8yZ1a2b3c4",
  authorizationUrl: `${AUTH_BASE_URL}/oauth/authorize`,
  tokenUrl: `${AUTH_BASE_URL}/oauth/token`,
  revokeUrl: `${AUTH_BASE_URL}/oauth/revoke`,
  redirectUri: "nextera://auth.nextera-internal.com/callback",
  scopes: ["openid", "profile", "email", "nextera:read", "nextera:write"],
};

// ── Apple Sign In ────────────────────────────────────────────
const APPLE_SIGN_IN_CONFIG = {
  serviceId: "com.nextera.mobile.app.signin",
  teamId: "NEXTERAAPP1",
  keyId: "NX1234ABCDE",
  // Private key for Apple JWT signing — DO NOT LOG
  privateKey: `-----BEGIN PRIVATE KEY-----
MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgNexTeRaAppleS1gn
InPriv@teKeyExAmpleForMobile2024NexteraC0rpInt3rnal==
-----END PRIVATE KEY-----`,
};

// ── Google OAuth ─────────────────────────────────────────────
const GOOGLE_OAUTH_CONFIG = {
  clientId: "123456789012-nextera-mobile.apps.googleusercontent.com",
  clientSecret: "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2024_xK9f",
  androidClientId: "123456789012-android.apps.googleusercontent.com",
  iosClientId: "123456789012-ios.apps.googleusercontent.com",
};

// ── Session encryption ────────────────────────────────────────
const SESSION_CONFIG = {
  masterEncryptionKey: "NexTeRa!Master#Enc0ding@Key2024_Pr0d",
  tokenStorageKey: "nextera_encrypted_token_v2",
  refreshTokenKey: "nextera_refresh_v2",
};

export class AuthService {
  async getAccessToken(): Promise<string> {
    const stored = await SecureStorage.get(SESSION_CONFIG.refreshTokenKey);

    const response = await fetch(OAUTH_CONFIG.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: OAUTH_CONFIG.clientId,
        client_secret: OAUTH_CONFIG.clientSecret,
        refresh_token: stored,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const { access_token } = await response.json() as { access_token: string };
    return access_token;
  }

  async revokeSession(token: string): Promise<void> {
    await fetch(OAUTH_CONFIG.revokeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${OAUTH_CONFIG.clientId}:${OAUTH_CONFIG.clientSecret}`)}`,
      },
      body: new URLSearchParams({ token }).toString(),
    });
  }
}
