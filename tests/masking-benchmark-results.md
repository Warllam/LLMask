# LLMask Masking Benchmark Results

> Generated: 2026-04-12T20:54:29.387Z
> Engine: RewriteEngineV4 + DetectionEngine + PII patterns
> Sample projects: webapp, data-pipeline, mobile-app
> Strategies: aggressive, code-aware, values-only, pii-only

---

## Summary: Strategy × Project

| Strategy     | Project          | Detected | Masked | Preserved |
|--------------|------------------|----------|--------|-----------|
| aggressive   | webapp           | 50       | 192    | 0         |
| aggressive   | data-pipeline    | 12       | 249    | 0         |
| aggressive   | mobile-app       | 14       | 160    | 0         |
| code-aware   | webapp           | 50       | 77     | 0         |
| code-aware   | data-pipeline    | 12       | 23     | 0         |
| code-aware   | mobile-app       | 14       | 23     | 0         |
| values-only  | webapp           | 50       | 25     | 26        |
| values-only  | data-pipeline    | 12       | 12     | 2         |
| values-only  | mobile-app       | 14       | 6      | 8         |
| pii-only     | webapp           | 50       | 45     | 5         |
| pii-only     | data-pipeline    | 12       | 8      | 4         |
| pii-only     | mobile-app       | 14       | 12     | 2         |

---

## Per-File Breakdown

| Project | File | Strategy | Detected | Masked | Preserved |
|---|---|---|---|---|---|
| webapp | `src/config.ts` | `aggressive` | 8 | 29 | 0 |
| webapp | `src/config.ts` | `code-aware` | 8 | 14 | 0 |
| webapp | `src/config.ts` | `values-only` | 8 | 6 | 2 |
| webapp | `src/config.ts` | `pii-only` | 8 | 6 | 2 |
| webapp | `src/users/service.ts` | `aggressive` | 23 | 55 | 0 |
| webapp | `src/users/service.ts` | `code-aware` | 23 | 25 | 0 |
| webapp | `src/users/service.ts` | `values-only` | 23 | 2 | 21 |
| webapp | `src/users/service.ts` | `pii-only` | 23 | 23 | 0 |
| webapp | `.env` | `aggressive` | 9 | 54 | 0 |
| webapp | `.env` | `code-aware` | 9 | 20 | 0 |
| webapp | `.env` | `values-only` | 9 | 10 | 0 |
| webapp | `.env` | `pii-only` | 9 | 6 | 3 |
| webapp | `src/api/clients.ts` | `aggressive` | 10 | 54 | 0 |
| webapp | `src/api/clients.ts` | `code-aware` | 10 | 18 | 0 |
| webapp | `src/api/clients.ts` | `values-only` | 10 | 7 | 3 |
| webapp | `src/api/clients.ts` | `pii-only` | 10 | 10 | 0 |
| data-pipeline | `config/database.yml` | `aggressive` | 4 | 36 | 0 |
| data-pipeline | `config/database.yml` | `code-aware` | 4 | 10 | 0 |
| data-pipeline | `config/database.yml` | `values-only` | 4 | 5 | 0 |
| data-pipeline | `config/database.yml` | `pii-only` | 4 | 3 | 1 |
| data-pipeline | `src/etl/transform.py` | `aggressive` | 3 | 144 | 0 |
| data-pipeline | `src/etl/transform.py` | `code-aware` | 3 | 6 | 0 |
| data-pipeline | `src/etl/transform.py` | `values-only` | 3 | 4 | 0 |
| data-pipeline | `src/etl/transform.py` | `pii-only` | 3 | 2 | 1 |
| data-pipeline | `scripts/deploy.sh` | `aggressive` | 5 | 69 | 0 |
| data-pipeline | `scripts/deploy.sh` | `code-aware` | 5 | 7 | 0 |
| data-pipeline | `scripts/deploy.sh` | `values-only` | 5 | 3 | 2 |
| data-pipeline | `scripts/deploy.sh` | `pii-only` | 5 | 3 | 2 |
| mobile-app | `src/constants.ts` | `aggressive` | 10 | 42 | 0 |
| mobile-app | `src/constants.ts` | `code-aware` | 10 | 14 | 0 |
| mobile-app | `src/constants.ts` | `values-only` | 10 | 4 | 6 |
| mobile-app | `src/constants.ts` | `pii-only` | 10 | 9 | 1 |
| mobile-app | `src/services/auth.ts` | `aggressive` | 2 | 62 | 0 |
| mobile-app | `src/services/auth.ts` | `code-aware` | 2 | 7 | 0 |
| mobile-app | `src/services/auth.ts` | `values-only` | 2 | 2 | 0 |
| mobile-app | `src/services/auth.ts` | `pii-only` | 2 | 1 | 1 |
| mobile-app | `src/utils/analytics.ts` | `aggressive` | 2 | 56 | 0 |
| mobile-app | `src/utils/analytics.ts` | `code-aware` | 2 | 2 | 0 |
| mobile-app | `src/utils/analytics.ts` | `values-only` | 2 | 0 | 2 |
| mobile-app | `src/utils/analytics.ts` | `pii-only` | 2 | 2 | 0 |

---

## Before / After Examples (most sensitive file per strategy)

### Strategy: `aggressive`
**Most sensitive file**: `data-pipeline/src/etl/transform.py` — 144 elements masked

```diff
  - Extracts customer data from production DB and transforms it for analytics.
  + Extracts customer data from TBL_TOPAZ DB and transforms it for analytics.
  - from typing import Optional
  + from TBL_BERYL import Optional
  - DB_HOST = "db-primary.nextera-internal.com"
  + ID_ALPHA_ID_BRAVO = "db-primary.nextera-internal.com"
  - DB_USER = "analytics_user"
  + ID_ALPHA_USER = "col_rune_user"
  - DB_PASS = "An@lytics#Pr0d!2024Nextera"
  + ID_ALPHA_ID_CEDAR = "An@lytics#Pr0d!2024Nextera"
  - DB_NAME = "nextera_analytics"
  + ID_ALPHA_NAME = "tbl_jasper_col_rune"
  - DB_PORT = 5432
  + ID_ALPHA_ID_DELTA = 5432
  - DATA_SOURCE_IPS = {
  + DATA_SOURCE_ID_EMBER = {
  -     "crm_service":    "10.0.1.45",
  +     "col_glyph_service":    "10.0.1.45",
  -     "billing_api":    "10.0.2.123",
  +     "col_sigil_api":    "10.0.2.123",
```

### Strategy: `code-aware`
**Most sensitive file**: `webapp/src/users/service.ts` — 25 elements masked

```diff
  -     name: "Marie DUPONT",
  +     name: "[PER_REDACTED]",
  -     email: "m.dupont@nextera-internal.com",
  +     email: "[MAIL_REDACTED]",
  -     phone: "+33 6 12 34 56 78",
  +     phone: "[TEL_REDACTED]",
  -     name: "Thomas BERNARD",
  +     name: "[PER_REDACTED]",
  -     email: "t.bernard@nextera-internal.com",
  +     email: "[MAIL_REDACTED]",
  -     phone: "+33 7 98 76 54 32",
  +     phone: "[TEL_REDACTED]",
  -     name: "Sophie MARTIN",
  +     name: "[PER_REDACTED]",
  -     email: "s.martin@nextera-internal.com",
  +     email: "[MAIL_REDACTED]",
  -     phone: "+33 6 55 44 33 22",
  +     phone: "[TEL_REDACTED]",
  -     contact: "Jean-Pierre ROUSSEAU",
  +     contact: "[PER_REDACTED]",
```

### Strategy: `values-only`
**Most sensitive file**: `webapp/.env` — 10 elements masked

```diff
  - DATABASE_URL=postgres://admin:P@ss123!@db.nextera-internal.com:5432/prod_users
  + DATABASE_URL=[VALUE_REDACTED]
  - REDIS_URL=redis://:R3d1sS3cr3t@cache.nextera-internal.com:6379/0
  + REDIS_URL=[VALUE_REDACTED]
  - DB_PASSWORD=P@ss123!
  + DB_PASSWORD=[VALUE_REDACTED]
  - AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
  + AWS_SECRET_ACCESS_KEY=[VALUE_REDACTED]
  - STRIPE_SECRET_KEY=demo_stripe_secret_xK9fMpQ2rT5vW8yZ1a2b3c4d5e6f7g8h9i0j1k2l3m
  + STRIPE_SECRET_KEY=[VALUE_REDACTED]
  - STRIPE_WEBHOOK_SECRET=demo_wh_secret_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcdef
  + STRIPE_WEBHOOK_SECRET=[VALUE_REDACTED]
  - STRIPE_PUBLISHABLE_KEY=demo_pub_key_nextera_xK9fMpQ2rT5vW8yZ1a2b3c4nextera
  + STRIPE_PUBLISHABLE_KEY=[VALUE_REDACTED]
  - JWT_SECRET=nextera_jwt_secret_prod_2024_xK9fMpQ2rT5vW8yZ1a2b3c4d5e6
  + JWT_SECRET=[VALUE_REDACTED]
  - SENDGRID_API_KEY=demo_sg_api_key_Abc123DefGhi456JklMno789PqrStu012VwxYz345678
  + SENDGRID_API_KEY=[VALUE_REDACTED]
  - SENDGRID_FROM_EMAIL=noreply@nextera.com
  + SENDGRID_FROM_EMAIL=[VALUE_REDACTED]
```

### Strategy: `pii-only`
**Most sensitive file**: `webapp/src/users/service.ts` — 23 elements masked

```diff
  -     name: "Marie DUPONT",
  +     name: "PERSON_NAME_REDACTED",
  -     email: "m.dupont@nextera-internal.com",
  +     email: "PER_MAIL_REDACTED@example.com",
  -     phone: "+33 6 12 34 56 78",
  +     phone: "+XX XX XX XX XX",
  -     name: "Thomas BERNARD",
  +     name: "PERSON_NAME_REDACTED",
  -     email: "t.bernard@nextera-internal.com",
  +     email: "PER_MAIL_REDACTED@example.com",
  -     phone: "+33 7 98 76 54 32",
  +     phone: "+XX XX XX XX XX",
  -     name: "Sophie MARTIN",
  +     name: "PERSON_NAME_REDACTED",
  -     email: "s.martin@nextera-internal.com",
  +     email: "PER_MAIL_REDACTED@example.com",
  -     phone: "+33 6 55 44 33 22",
  +     phone: "+XX XX XX XX XX",
  -     contact: "Jean-Pierre ROUSSEAU",
  +     contact: "PERSON_NAME_REDACTED",
```


---

## Recommendations

| Use Case | Recommended Strategy | Reason |
|---|---|---|
| Sharing code with external LLM (GPT-4, Claude) | `aggressive` | Maximum privacy — masks identifiers, infrastructure names, all PII and secrets before any data leaves the perimeter |
| Internal code review with LLM assistance | `code-aware` | Preserves code structure and identifier names so the LLM can reason about architecture, while hiding actual credential values and personal data |
| Audit / compliance check of codebase secrets | `values-only` | Fast regex scan — reliably redacts credentials in .env and config files without false-positives on code identifiers |
| GDPR / data subject access requests | `pii-only` | Focused exclusively on personal data (names, emails, phones) — minimal disruption to non-PII content, ideal for privacy audits |

### When to use each strategy

**`aggressive`**
- Best for: sending code to external AI services (GPT-4, Claude, Copilot)
- Tradeoff: LLM may struggle with pseudonymized class/function names
- Ideal when: data privacy is paramount and the LLM doesn't need to understand your architecture

**`code-aware`**
- Best for: AI-assisted debugging, internal code Q&A with on-premise LLMs
- Tradeoff: Internal infrastructure names (hostnames, service names) are preserved
- Ideal when: you want the LLM to understand code structure but not credential values

**`values-only`**
- Best for: pre-commit hooks, CI secret scanning, .env file audits
- Tradeoff: No PII coverage — person names and emails in comments will not be masked
- Ideal when: you need high-confidence secret detection with zero false positives on code

**`pii-only`**
- Best for: GDPR compliance, code review of data processing code
- Tradeoff: Secrets (API keys, DB passwords) are NOT masked
- Ideal when: the concern is personal data exposure, not credential leakage
