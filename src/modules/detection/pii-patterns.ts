import type { MappingKind } from "../mapping-store/mapping-store";

export type PiiMatch = {
  value: string;
  kind: MappingKind;
  index: number;
};

// ── Person name patterns ────────────────────────────────────────────────────
// French style: "Marie ALBERT", "Jean-Pierre DUPONT", "François DE LA TOUR"
// Also catches "Marie Albert" and "MARIE ALBERT"
const FRENCH_NAME_RE =
  /\b([A-ZÀ-Ü][a-zà-ÿ]+(?:-[A-ZÀ-Ü][a-zà-ÿ]+)?)\s+((?:(?:DE|DU|LE|LA|DES|VAN|VON|DI|EL|AL|BEN)\s+)*[A-ZÀ-Ü][A-ZÀ-Ü]{1,})\b/g;

// ── Email pattern ───────────────────────────────────────────────────────────
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

// ── Corporate email patterns (specific domains) ─────────────────────────────
// Detect corporate emails from specific internal/company domains
// Format: user@company.internal, user@company.local, user@company.corp
const CORPORATE_EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.(?:internal|local|corp|intranet|lan)\b/gi;

// ── French administrative identifiers ───────────────────────────────────────

// SIRET (14 digits): Système d'Identification du Répertoire des Établissements
// Format: XXX XXX XXX XXXXX or XXXXXXXXXXXXXX
const SIRET_RE = /\b\d{3}[\s]?\d{3}[\s]?\d{3}[\s]?\d{5}\b/g;

// French Social Security Number (Numéro de Sécurité Sociale)
// Format: 1 YY MM DD DDD CCC KK (15 digits)
// 1=sex, YY=year, MM=month, DD=department, DDD=commune, CCC=order, KK=key
// Example: 1 85 12 75 120 001 83 or 185127512000183
const FRENCH_SOCIAL_SECURITY_RE = /\b[12][\s]?\d{2}[\s]?\d{2}[\s]?\d{2}[\s]?\d{3}[\s]?\d{3}[\s]?\d{2}\b/g;

// IBAN France: FR + 2 digits (check) + 23 alphanumeric characters
// Format: FR76 3000 6000 0112 3456 7890 189
const FRENCH_IBAN_RE = /\bFR\d{2}[\s]?(?:\d{4}[\s]?){5}\d{3}\b/gi;

// ── Phone patterns ──────────────────────────────────────────────────────────
// French mobile: 06/07 XX XX XX XX or +33 6/7 XX XX XX XX
// French landline: 01-05/09 XX XX XX XX or +33 1-5/9 XX XX XX XX
const FRENCH_PHONE_RE =
  /(?:\+33[\s.-]?|0)[1-9](?:[\s.-]?\d{2}){4}\b/g;

// International phone (generic, kept for non-FR numbers)
const PHONE_RE =
  /(?:\+\d{1,3}[\s.-]?)?\(?\d{1,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,4}\b/g;

// ── URL pattern ─────────────────────────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s"'`<>)\]]+/gi;

// ── Internal domain patterns ────────────────────────────────────────────────
// Detect internal domain names (non-public TLDs or internal subdomains)
// .local, .internal, .corp, .lan, .intranet, or dev/staging/preprod subdomains
const INTERNAL_DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+(?:local|internal|corp|lan|intranet)\b/gi;
const DEV_SUBDOMAIN_RE = /\b(?:dev|staging|preprod|test|uat|demo|beta|alpha)(?:[.-][a-z0-9-]+)*\.[a-z0-9.-]+\.[a-z]{2,}\b/gi;

// ── Commonly safe domains to NOT mask ───────────────────────────────────────
const SAFE_DOMAINS = new Set([
  "github.com", "gitlab.com", "bitbucket.org",
  "npmjs.com", "pypi.org", "crates.io",
  "stackoverflow.com", "developer.mozilla.org", "mdn.io",
  "w3.org", "schema.org", "json-schema.org",
  "google.com", "googleapis.com",
  "fontawesome.com", "fonts.googleapis.com",
  "cloudflare.com", "cdn.jsdelivr.net",
  "example.com", "example.org", "localhost",
]);

function isSafeDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return SAFE_DOMAINS.has(hostname) || hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

// ── Validate phone numbers (reduce false positives) ─────────────────────────
function isLikelyPhone(match: string): boolean {
  // Must have at least 8 digits
  const digits = match.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  // Starts with + or 0 (most phone numbers)
  if (/^\+/.test(match.trim()) || /^0/.test(match.trim())) return true;
  // Has separators (spaces, dots, dashes) between digit groups
  if (/\d[\s.-]\d/.test(match)) return true;
  return false;
}

// ── Validate French administrative identifiers ──────────────────────────────
function isValidSiret(match: string): boolean {
  const digits = match.replace(/\s/g, "");
  if (digits.length !== 14) return false;
  // Basic validation: should be all digits
  return /^\d{14}$/.test(digits);
}

function isValidFrenchSSN(match: string): boolean {
  const clean = match.replace(/\s/g, "");
  if (clean.length !== 15) return false;
  // First digit must be 1 or 2 (sex), rest are digits
  return /^[12]\d{14}$/.test(clean);
}

function isValidFrenchIBAN(match: string): boolean {
  const clean = match.replace(/\s/g, "");
  // FR + 2 check digits + 23 alphanumeric
  if (clean.length !== 27) return false;
  return /^FR\d{25}$/i.test(clean);
}

// ── Extract all PII matches from text ───────────────────────────────────────

export function detectPii(text: string): PiiMatch[] {
  const matches: PiiMatch[] = [];
  const seen = new Set<string>();

  // French administrative identifiers (high priority - check first)
  
  // SIRET numbers
  for (const m of text.matchAll(SIRET_RE)) {
    if (seen.has(m[0])) continue;
    if (!isValidSiret(m[0])) continue;
    seen.add(m[0]);
    matches.push({ value: m[0], kind: "idn", index: m.index! });
  }

  // French Social Security Numbers
  for (const m of text.matchAll(FRENCH_SOCIAL_SECURITY_RE)) {
    if (seen.has(m[0])) continue;
    if (!isValidFrenchSSN(m[0])) continue;
    seen.add(m[0]);
    matches.push({ value: m[0], kind: "idn", index: m.index! });
  }

  // French IBAN
  for (const m of text.matchAll(FRENCH_IBAN_RE)) {
    if (seen.has(m[0])) continue;
    if (!isValidFrenchIBAN(m[0])) continue;
    seen.add(m[0]);
    matches.push({ value: m[0], kind: "idn", index: m.index! });
  }

  // Person names (French style: Prénom NOM)
  for (const m of text.matchAll(FRENCH_NAME_RE)) {
    const fullName = m[0];
    if (seen.has(fullName)) continue;
    seen.add(fullName);
    matches.push({ value: fullName, kind: "per", index: m.index! });
  }

  // Corporate emails (internal domains) - priority over generic emails
  for (const m of text.matchAll(CORPORATE_EMAIL_RE)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    matches.push({ value: m[0], kind: "email", index: m.index! });
  }

  // Generic emails
  for (const m of text.matchAll(EMAIL_RE)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    matches.push({ value: m[0], kind: "email", index: m.index! });
  }

  // Internal domains (standalone, not in URLs)
  for (const m of text.matchAll(INTERNAL_DOMAIN_RE)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    matches.push({ value: m[0], kind: "url", index: m.index! });
  }

  // Dev/staging subdomains
  for (const m of text.matchAll(DEV_SUBDOMAIN_RE)) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    matches.push({ value: m[0], kind: "url", index: m.index! });
  }

  // URLs (skip safe/public domains)
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0];
    if (seen.has(url)) continue;
    if (isSafeDomain(url)) continue;
    seen.add(url);
    matches.push({ value: url, kind: "url", index: m.index! });
  }

  // French phone numbers
  for (const m of text.matchAll(FRENCH_PHONE_RE)) {
    if (seen.has(m[0])) continue;
    if (!isLikelyPhone(m[0])) continue;
    seen.add(m[0]);
    matches.push({ value: m[0], kind: "phone", index: m.index! });
  }

  // Sort by position (longest first for overlapping matches)
  matches.sort((a, b) => a.index - b.index || b.value.length - a.value.length);

  return matches;
}

// ── Extract unique domains from detected URLs ───────────────────────────────

export function extractDomains(urls: string[]): Array<{ domain: string; fullDomain: string }> {
  const domains: Array<{ domain: string; fullDomain: string }> = [];
  const seen = new Set<string>();

  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;
      if (seen.has(hostname)) continue;
      seen.add(hostname);

      // Extract base domain (e.g. "i-run.fr" from "vision.prp.i-run.si")
      const parts = hostname.split(".");
      const baseDomain = parts.length >= 2
        ? parts.slice(-2).join(".")
        : hostname;

      domains.push({ domain: baseDomain, fullDomain: hostname });
    } catch { /* ignore invalid URLs */ }
  }

  return domains;
}
