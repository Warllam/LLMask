// ────────────────────────────────────────────────────────────────
// Nextera Mobile App — Runtime Constants
// DO NOT commit changes to API keys without security review
// ────────────────────────────────────────────────────────────────

// Internal API base URLs
export const API_BASE_URL = "https://api.nextera-internal.com/v3";
export const AUTH_BASE_URL = "https://auth.nextera-internal.com";
export const CDN_BASE_URL = "https://cdn.nextera-internal.com/assets";
export const WEBSOCKET_URL = "wss://ws.nextera-internal.com/realtime";
export const SUPPORT_API_URL = "https://support.nextera-internal.com/api";

// ── Firebase (production) — key below is fictional for benchmark/demo only ───
export const FIREBASE_CONFIG = {
  apiKey: "demo_firebase_api_key_AbCdEfGhIjKlMnOpQrStUvWxYz12345678",
  authDomain: "nextera-mobile-prod.firebaseapp.com",
  projectId: "nextera-mobile-prod",
  storageBucket: "nextera-mobile-prod.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:ios:abc123def456ghi789jkl",
  measurementId: "G-NEXTERA1234",
};

// ── Error tracking ────────────────────────────────────────────
export const SENTRY_DSN =
  "https://demo_token_abc123def456@o123456.ingest.example.com/7654321";

// ── Push notifications ────────────────────────────────────────
export const ONESIGNAL_APP_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
export const ONESIGNAL_REST_API_KEY =
  "os_v2_app_nextera_prod_ApiKey_AbCdEfGhIjKlMnOpQrStUvWx";

// ── Feature flags ─────────────────────────────────────────────
export const LAUNCHDARKLY_SDK_KEY = "sdk-nextera-mobile-prod-a1b2c3d4e5f6g7h8i9";
export const FEATURE_FLAGS_URL =
  "https://flags.nextera-internal.com/api/client/nextera_ff_prod_key_2024";

// ── Analytics ─────────────────────────────────────────────────
export const SEGMENT_WRITE_KEY = "nextera_segment_write_key_prod_Abc123DefGhi456";
export const AMPLITUDE_API_KEY = "nextera_amplitude_prod_abc123def456ghi789jkl";
export const MIXPANEL_TOKEN = "nextera_mixpanel_prod_1a2b3c4d5e6f78901234";

// ── App versioning ────────────────────────────────────────────
export const APP_VERSION = "3.2.1";
export const BUILD_NUMBER = "3210";
export const MIN_SUPPORTED_VERSION = "2.0.0";
export const UPDATE_CHECK_URL = "https://update.nextera-internal.com/mobile/latest";
