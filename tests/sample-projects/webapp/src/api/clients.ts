// ─────────────────────────────────────────────────────────────────────────────
// Nextera Client Registry
// Maps internal project codenames to client contract configurations
//
// Active projects:
//   ATLAS   → Société Générale migration (Phase 3)
//   HERMES  → BNP Paribas integration (live)
//   ZEUS    → Crédit Agricole digital transformation (pilot)
// ─────────────────────────────────────────────────────────────────────────────

interface ClientConfig {
  legalName: string;
  codename: string;
  apiEndpoint: string;
  apiKey: string;
  webhookSecret: string;
  technicalContact: string;
  billingContact: string;
  contractRef: string;
  goLiveDate: string;
}

export const CLIENT_REGISTRY: Record<string, ClientConfig> = {
  SG: {
    legalName: "Société Générale Corporate & Investment Banking",
    codename: "ATLAS",
    apiEndpoint: "https://sgcib-api.nextera-internal.com/v2",
    apiKey: "sg_prod_api_key_4f3e2d1c0b9a8765432109876",
    webhookSecret: "wh_sg_secret_8f7e6d5c4b3a21900987654321",
    technicalContact: "nextera-integration@sgcib.com",
    billingContact: "it-procurement@sgcib.com",
    contractRef: "SG-2024-001-NEXTERA-ATLAS",
    goLiveDate: "2024-03-15",
  },

  BNP: {
    legalName: "BNP Paribas S.A.",
    codename: "HERMES",
    apiEndpoint: "https://bnpp-api.nextera-internal.com/v2",
    apiKey: "bnp_prod_api_key_a1b2c3d4e5f678901234567890",
    webhookSecret: "wh_bnp_secret_1a2b3c4d5e6f7890abcdef",
    technicalContact: "nextera-ops@bnpparibas.com",
    billingContact: "tech-billing@bnpparibas.com",
    contractRef: "BNP-2024-037-NEXTERA-HERMES",
    goLiveDate: "2024-01-08",
  },

  CA: {
    legalName: "Crédit Agricole S.A.",
    codename: "ZEUS",
    apiEndpoint: "https://ca-api.nextera-internal.com/v2",
    apiKey: "ca_prod_api_key_f0e9d8c7b6a543210fedcba9876",
    webhookSecret: "wh_ca_secret_9z8y7x6w5v4u3t2s1r0q",
    technicalContact: "digital-ops@credit-agricole-sa.fr",
    billingContact: "achats-it@credit-agricole-sa.fr",
    contractRef: "CA-2024-012-NEXTERA-ZEUS",
    goLiveDate: "2024-06-01",
  },
};

// Shared signing secret for inter-service communication
export const INTER_SERVICE_HMAC_SECRET = "nextera_iss_hmac_xK9fMpQ2rT5vW8yZ1a2b3c4d5e6f7g8";

export function getClientByCodename(codename: string): ClientConfig | undefined {
  return Object.values(CLIENT_REGISTRY).find((c) => c.codename === codename);
}
