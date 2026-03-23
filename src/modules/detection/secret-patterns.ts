export type SecretPatternSeverity = "low" | "medium" | "high";

export type SecretPattern = {
  id: string;
  description: string;
  regex: RegExp;
  severity: SecretPatternSeverity;
  category: string;
};

export const SECRET_PATTERNS: SecretPattern[] = [
  // ── AWS ──────────────────────────────────────────────────────────────
  {
    id: "aws-access-key",
    description: "AWS Access Key ID",
    regex: /\b(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
    severity: "high",
    category: "cloud.aws"
  },
  {
    id: "aws-secret-key",
    description: "AWS Secret Access Key (in assignment context)",
    regex: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY|SecretAccessKey)\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})["']?/g,
    severity: "high",
    category: "cloud.aws"
  },
  {
    id: "aws-session-token",
    description: "AWS Session Token",
    regex: /(?:aws_session_token|AWS_SESSION_TOKEN)\s*[:=]\s*["']?([A-Za-z0-9/+=]{100,})["']?/g,
    severity: "high",
    category: "cloud.aws"
  },

  // ── GCP ──────────────────────────────────────────────────────────────
  {
    id: "gcp-api-key",
    description: "Google Cloud API Key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: "high",
    category: "cloud.gcp"
  },
  {
    id: "gcp-service-account",
    description: "GCP Service Account JSON key indicator",
    regex: /"type"\s*:\s*"service_account"/g,
    severity: "medium",
    category: "cloud.gcp"
  },

  // ── Azure ────────────────────────────────────────────────────────────
  {
    id: "azure-connection-string",
    description: "Azure Storage/Service Bus Connection String",
    regex: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[^;]+/g,
    severity: "high",
    category: "cloud.azure"
  },
  {
    id: "azure-client-secret",
    description: "Azure AD Client Secret",
    regex: /(?:client_secret|AZURE_CLIENT_SECRET)\s*[:=]\s*["']?([A-Za-z0-9~._-]{34,})["']?/g,
    severity: "high",
    category: "cloud.azure"
  },

  // ── GitHub ───────────────────────────────────────────────────────────
  {
    id: "github-pat",
    description: "GitHub Personal Access Token",
    regex: /\bghp_[A-Za-z0-9]{36,255}\b/g,
    severity: "high",
    category: "code_hosting.github"
  },
  {
    id: "github-oauth",
    description: "GitHub OAuth Access Token",
    regex: /\bgho_[A-Za-z0-9]{36,255}\b/g,
    severity: "high",
    category: "code_hosting.github"
  },
  {
    id: "github-app-token",
    description: "GitHub App Installation Token",
    regex: /\bghs_[A-Za-z0-9]{36,255}\b/g,
    severity: "high",
    category: "code_hosting.github"
  },
  {
    id: "github-fine-grained-pat",
    description: "GitHub Fine-Grained Personal Access Token",
    regex: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/g,
    severity: "high",
    category: "code_hosting.github"
  },

  // ── GitLab ───────────────────────────────────────────────────────────
  {
    id: "gitlab-pat",
    description: "GitLab Personal Access Token",
    regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    severity: "high",
    category: "code_hosting.gitlab"
  },
  {
    id: "gitlab-pipeline-token",
    description: "GitLab Pipeline Trigger Token",
    regex: /\bglptt-[A-Za-z0-9_-]{20,}\b/g,
    severity: "high",
    category: "code_hosting.gitlab"
  },

  // ── OpenAI ───────────────────────────────────────────────────────────
  {
    id: "openai-api-key",
    description: "OpenAI API Key",
    regex: /\bsk-[A-Za-z0-9]{20,}\b/g,
    severity: "high",
    category: "ai.openai"
  },
  {
    id: "openai-project-key",
    description: "OpenAI Project API Key",
    regex: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
    severity: "high",
    category: "ai.openai"
  },

  // ── Anthropic ────────────────────────────────────────────────────────
  {
    id: "anthropic-api-key",
    description: "Anthropic API Key",
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    severity: "high",
    category: "ai.anthropic"
  },

  // ── Stripe ───────────────────────────────────────────────────────────
  {
    id: "stripe-secret-key",
    description: "Stripe Secret Key (live or test)",
    regex: /\b(sk_live|sk_test)_[0-9a-zA-Z]{24,}\b/g,
    severity: "high",
    category: "payment.stripe"
  },
  {
    id: "stripe-restricted-key",
    description: "Stripe Restricted Key",
    regex: /\brk_(live|test)_[0-9a-zA-Z]{24,}\b/g,
    severity: "high",
    category: "payment.stripe"
  },

  // ── Slack ────────────────────────────────────────────────────────────
  {
    id: "slack-bot-token",
    description: "Slack Bot Token",
    regex: /\bxoxb-[0-9A-Za-z-]+\b/g,
    severity: "high",
    category: "communication.slack"
  },
  {
    id: "slack-user-token",
    description: "Slack User Token",
    regex: /\bxoxp-[0-9A-Za-z-]+\b/g,
    severity: "high",
    category: "communication.slack"
  },
  {
    id: "slack-app-token",
    description: "Slack App-Level Token",
    regex: /\bxapp-[0-9A-Za-z-]+\b/g,
    severity: "medium",
    category: "communication.slack"
  },
  {
    id: "slack-webhook",
    description: "Slack Incoming Webhook URL",
    regex: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g,
    severity: "high",
    category: "communication.slack"
  },

  // ── Twilio ───────────────────────────────────────────────────────────
  {
    id: "twilio-api-key",
    description: "Twilio API Key",
    regex: /\bSK[0-9a-fA-F]{32}\b/g,
    severity: "high",
    category: "communication.twilio"
  },

  // ── SendGrid ─────────────────────────────────────────────────────────
  {
    id: "sendgrid-api-key",
    description: "SendGrid API Key",
    regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
    severity: "high",
    category: "communication.sendgrid"
  },

  // ── JWT ──────────────────────────────────────────────────────────────
  {
    id: "jwt-token",
    description: "JSON Web Token",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g,
    severity: "medium",
    category: "auth.jwt"
  },

  // ── Private Keys ─────────────────────────────────────────────────────
  {
    id: "private-key",
    description: "Private Key (RSA, EC, DSA, OPENSSH, PGP)",
    regex: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+|PGP\s+)?PRIVATE KEY(?:\s+BLOCK)?-----/g,
    severity: "high",
    category: "crypto.private_key"
  },

  // ── Database Connection Strings ──────────────────────────────────────
  {
    id: "database-url",
    description: "Database Connection URL with credentials",
    regex: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|amqp):\/\/[^\s"'`]+:[^\s"'`]+@[^\s"'`]+/g,
    severity: "high",
    category: "database.connection_string"
  },

  // ── Mailgun ──────────────────────────────────────────────────────────
  {
    id: "mailgun-api-key",
    description: "Mailgun API Key",
    regex: /\bkey-[0-9a-zA-Z]{32}\b/g,
    severity: "high",
    category: "communication.mailgun"
  },

  // ── Heroku ───────────────────────────────────────────────────────────
  {
    id: "heroku-api-key",
    description: "Heroku API Key",
    regex: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g,
    severity: "low",
    category: "cloud.heroku"
  },

  // ── NPM ──────────────────────────────────────────────────────────────
  {
    id: "npm-token",
    description: "NPM Access Token",
    regex: /\bnpm_[A-Za-z0-9]{36}\b/g,
    severity: "high",
    category: "code_hosting.npm"
  },

  // ── PyPI ─────────────────────────────────────────────────────────────
  {
    id: "pypi-token",
    description: "PyPI API Token",
    regex: /\bpypi-[A-Za-z0-9_-]{50,}\b/g,
    severity: "high",
    category: "code_hosting.pypi"
  },

  // ── Hashicorp Vault ──────────────────────────────────────────────────
  {
    id: "vault-token",
    description: "HashiCorp Vault Token",
    regex: /\bhvs\.[A-Za-z0-9_-]{24,}\b/g,
    severity: "high",
    category: "infrastructure.vault"
  },

  // ── Discord ──────────────────────────────────────────────────────────
  {
    id: "discord-bot-token",
    description: "Discord Bot Token",
    regex: /\b[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/g,
    severity: "high",
    category: "communication.discord"
  }
];
