import { SEGMENT_WRITE_KEY, AMPLITUDE_API_KEY, MIXPANEL_TOKEN } from "../constants";

// ── Analytics clients initialisation ─────────────────────────

// Segment (primary analytics)
const segmentClient = createSegmentClient({
  writeKey: SEGMENT_WRITE_KEY,
  trackAppLifecycleEvents: true,
  debug: false,
});

// Amplitude (product analytics)
const amplitudeClient = createAmplitudeClient(AMPLITUDE_API_KEY, {
  serverUrl: "https://api2.amplitude.com/2/httpapi",
  trackingOptions: {
    ipAddress: true,      // captures user IP — review with legal
    deviceManufacturer: true,
    language: true,
  },
});

// ── Type definitions ──────────────────────────────────────────

interface UserIdentityEvent {
  userId: string;
  email: string;
  name: string;
  phone: string;
  deviceId: string;
  ipAddress: string;
  locale: string;
}

interface ScreenViewEvent {
  screen: string;
  referrer?: string;
  userId?: string;
  sessionId: string;
}

// ── Analytics functions ───────────────────────────────────────

/**
 * Identify user in all analytics platforms.
 * NOTE: Sends PII (name, email, phone) to third-party analytics.
 * Requires user consent under GDPR Article 6(1)(a).
 */
export function identifyUser(profile: UserIdentityEvent): void {
  // Segment identify call — includes full PII profile
  segmentClient.identify({
    userId: profile.userId,
    traits: {
      email: profile.email,
      name: profile.name,
      phone: profile.phone,
      device_id: profile.deviceId,
      ip: profile.ipAddress,
      locale: profile.locale,
      is_internal: profile.email.endsWith("@nextera-internal.com"),
    },
  });

  // Amplitude user properties
  amplitudeClient.setUserId(profile.userId);
  amplitudeClient.setUserProperties({
    email: profile.email,
    phone_number: profile.phone,
    display_name: profile.name,
  });

  // Debug log — PII exposed in device console (MUST remove before release)
  console.log(`[analytics] User identified: ${profile.name} <${profile.email}>`);
  console.log(`[analytics] Device: ${profile.deviceId} | IP: ${profile.ipAddress}`);
  console.log(`[analytics] Mixpanel token active: ${MIXPANEL_TOKEN}`);
}

export function trackScreen(event: ScreenViewEvent): void {
  segmentClient.screen(event.screen, {
    session_id: event.sessionId,
    user_id: event.userId,
    referrer: event.referrer,
  });
}

export function trackPurchase(userId: string, amount: number, currency: string): void {
  segmentClient.track("Purchase Completed", {
    user_id: userId,
    revenue: amount,
    currency,
    timestamp: new Date().toISOString(),
  });
}

// ── Stub helpers (replace with actual SDK imports) ────────────

function createSegmentClient(opts: { writeKey: string; trackAppLifecycleEvents: boolean; debug: boolean }) {
  return { identify: (_: unknown) => {}, screen: (_: string, __: unknown) => {}, track: (_: string, __: unknown) => {} };
}

function createAmplitudeClient(_key: string, _opts: unknown) {
  return { setUserId: (_: string) => {}, setUserProperties: (_: unknown) => {} };
}
