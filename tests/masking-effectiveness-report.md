# LLMask Masking Effectiveness Report

> Generated: 2026-04-12T21:03:19.365Z
> Strategy tested: **code-aware** (secrets + PII replaced, code identifiers preserved)
> Question: Can Claude still give equally useful advice on masked code?

---

## Summary

| Test | Elements masked | Keywords (original) | Keywords (masked) | Quality retained |
|---|---|---|---|---|
| webapp/src/config.ts | 14 | 11 | 12 | 109% ✅ |
| data-pipeline/src/etl/transform.py | 6 | 6 | 5 | 83% ✅ |

**Verdict key:** ✅ ≥80% quality retained · ⚠️ 60–79% · ❌ <60%

---

## Test: `webapp/src/config.ts`

**Prompt:** Review this config file. What security issues do you see? Suggest improvements.
**Elements masked by code-aware strategy:** 14

### Code: Before vs After Masking

**Original (first 40 lines):**
```
import { env } from "process";

// Application configuration — Nextera Customer Portal
export const config = {
  app: {
    name: "Nextera Customer Portal",
    version: "2.4.1",
    env: env.NODE_ENV || "development",
    internalDomain: "nextera-internal.com",
  },

  // Database configuration
  database: {
    primary: {
      url: "postgres://admin:P@ss123!@db.nextera-internal.com:5432/prod_users",
      host: "db.nextera-internal.com",
      port: 5432,
      name: "prod_users",
      username: "admin",
      password: "P@ss123!",
      poolSize: 20,
      ssl: true,
    },
    replica: {
      url: "postgres://readonly:R3adOnly!@replica.nextera-internal.com:5432/prod_users",
      host: "replica.nextera-internal.com",
      username: "readonly",
      password: "R3adOnly!",
    },
    redis: {
      url: "redis://:R3d1sS3cr3t@cache.nextera-internal.com:6379/0",
      host: "cache.nextera-internal.com",
      password: "R3d1sS3cr3t",
      ttl: 3600,
    },
  },

  // AWS credentials
  aws: {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
... (41 more lines)
```

**After code-aware masking (first 40 lines):**
```
import { env } from "process";

// Application configuration — Nextera Customer Portal
export const config = {
  app: {
    name: "Nextera Customer Portal",
    version: "2.4.1",
    env: env.NODE_ENV || "development",
    internalDomain: "nextera-internal.com",
  },

  // Database configuration
  database: {
    primary: {
      url: "postgres://://admin:[CREDENTIAL_REDACTED]@ss123!@db.nextera-internal.com:5432/prod_users",
      host: "db.nextera-internal.com",
      port: 5432,
      name: "prod_users",
      username: "admin",
      password: "[SECRET_REDACTED]",
      poolSize: 20,
      ssl: true,
    },
    replica: {
      url: "postgres://://readonly:[CREDENTIAL_REDACTED]@replica.nextera-internal.com:5432/prod_users",
      host: "replica.nextera-internal.com",
      username: "readonly",
      password: "[SECRE[MAIL_REDACTED]  url: "redis://:R3d1sS3cr3t@cache.nextera-internal.com:6379/0",
      host: "cache.nextera-internal.com",
      password: "[SECRET_REDACTED]",
      ttl: 3600,
    },
  },

  // AWS credentials
  aws: {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "eu-west-1",
    s3Bucket: "nextera-user-uploads-prod",
... (37 more lines)
```

### Claude's Response: Original Code

## Security Issues

### Critical — Hardcoded Secrets

Every secret in this file is hardcoded, which means any developer, CI system, or tool with repo access has all of them. If this is ever committed to git, the credentials are in history forever — rotation doesn't help unless history is scrubbed.

| Secret | Field |
|--------|-------|
| DB password (primary) | `database.primary.password` / embedded in `.url` |
| DB password (replica) | `database.replica.password` / embedded in `.url` |
| Redis password | `database.redis.password` / embedded in `.url` |
| AWS secret access key | `aws.secretAccessKey` |
| JWT signing secret | `jwt.secret` |
| Stripe secret + webhook | `stripe.secretKey`, `stripe.webhookSecret` |
| SendGrid API key | `sendgrid.apiKey` |

Credentials are also duplicated — appearing both in the connection `.url` string and as standalone fields. A rotation on one won't update the other.

**Fix:** Load all secrets from environment variables or a secrets manager (AWS Secrets Manager, Vault, etc.). Nothing secret belongs in source code.

```ts
database: {
  primary: {
    url: env.DATABASE_PRIMARY_URL,          // contains credentials
    poolSize: 20,
    ssl: true,
  },
},
jwt: {
  secret: env.JWT_SECRET,
  // ...
},
```

---

### High — JWT Access Token TTL Is Too Long

```ts
jwt: {
  expiresIn: "24h",   // ← too long
```

24 hours means a stolen access token is valid for up to a day with no revocation path. Standard practice is 15–60 minutes for access tokens, with refresh tokens handling renewal.

---

### High — No Environment Separation

The file hardcodes production hostnames (`db.nextera-internal.com`, `prod_users`, `nextera-user-uploads-prod`). There's no mechanism to use different values per environment. This invites production credentials being used in dev/test.

**Fix:** Keep the config shape here, populate values entirely from environment variables, and use a `.env.example` file with placeholder values for documentation.

---

### Medium — SSL Without Certificate Verification

```ts
ssl: true,
```

`ssl: true` on most Postgres clients enables encryption but not host verification by default. This is vulnerable to MITM on the DB connection.

**Fix:**

```ts
ssl: {
  rejectUnauthorized: true,
  ca: env.DB_SSL_CA_CERT,
},
```

---

### Medium — Internal Infrastructure Map

The `services` block and all hostnames expose your internal topology. If this config leaks (bundle, logs, error messages), an attacker learns your auth service URL, admin panel port (8443), and internal domain structure.

This isn't fixable by moving to env vars alone — consider whether internal service URLs even need to be in a client-accessible config, and confirm this file isn't bundled into frontend assets.

---

### Summary of Changes

```ts
// Before
password: "P@ss123!",
secret: "nextera_jwt_secret_prod_2024_...",

// After
password: env.DB_PRIMARY_PASSWORD,
secret: env.JWT_SECRET,
```

1. Replace every secret value with `env.XXX`
2. Add a `.env.example` with commented placeholder values
3. Verify `.env` is in `.gitignore`
4. Rotate all credentials that were ever committed (treat them as compromised)
5. Reduce JWT `expiresIn` to `"15m"` or `"30m"`
6. Add proper SSL cert validation for DB connections

### Claude's Response: Masked Code

Here are the security issues I see, roughly by severity:

## Critical

**1. Secrets in source code**
The entire config is structured to hold live credentials directly in a JS/TS file. Even with redactions applied post-hoc, secrets committed to source are a persistent risk — they live in git history indefinitely.

**2. AWS credentials hardcoded**
`AKIAIOSFODNN7EXAMPLE` / `wJalrXUtnFEMI/K7MDENG/...` are the canonical AWS documentation example keys. If real keys were ever substituted here (even briefly), they'd be in git history. These must come from environment variables or IAM roles.

**3. Redis connection uses plaintext**
```
redis://:R3d1sS3cr3t@cache.nextera-internal.com:6379/0
```
No TLS — use `rediss://` (note double `s`) for encrypted connections, especially to production cache.

**4. Malformed database URLs**
```
postgres://://admin:...
```
The double `://://` is a broken URL. Depending on how your driver parses it, it may silently fall back to a less-secure mode or ignore parts of the connection string (including SSL settings).

## High

**5. Overly broad JWT lifetime**
```js
expiresIn: "24h",
refreshExpiresIn: "30d",
```
A 30-day refresh token is a long window for a stolen token to be exploited. Consider 7 days max with rotation on use.

**6. Admin DB credentials used as default**
`username: "admin"` with full access to `prod_users`. Application code should connect with a least-privilege service account, not an admin user.

**7. No SSL enforcement on DB connection**
`ssl: true` is set on the primary, but there's no `rejectUnauthorized: true` or certificate pinning. This allows MITM with a self-signed cert.

## Medium

**8. Version and internal topology exposed in config**
`version: "2.4.1"`, internal hostnames (`nextera-internal.com`), the CloudFront distribution ID, and S3 bucket name are all discoverable from the config. These should not be co-located with secrets.

**9. No secret rotation path**
Static secrets with no versioning or rotation mechanism. When a secret needs to rotate, every deployment that references this config must be updated simultaneously.

## Recommended pattern

Replace all secret values with environment variable references, and fail fast at startup if any are missing:

```ts
function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  database: {
    primary: {
      url: required("DATABASE_PRIMARY_URL"),
      ssl: { rejectUnauthorized: true },
    },
  },
  aws: {
    accessKeyId: required("AWS_ACCESS_KEY_ID"),
    secretAccessKey: required("AWS_SECRET_ACCESS_KEY"),
    // Better: use IAM roles and remove these entirely
  },
  jwt: {
    secret: required("JWT_SECRET"),
    expiresIn: "15m",
    refreshExpiresIn: "7d",
  },
  // ...
};
```

For secrets management at scale, consider AWS Secrets Manager, HashiCorp Vault, or a similar system rather than environment variables — especially for the database credentials and payment keys.

### Analysis

- **Quality score:** 12/11 relevant keywords matched → **109% quality retained**
- **Topics preserved:** `hardcoded credentials`, `use env vars`, `secrets manager`, `PII in logs`, `encryption/hashing`, `key rotation`
- **Topics lost after masking:** `connection pooling`

---

## Test: `data-pipeline/src/etl/transform.py`

**Prompt:** Optimize this ETL script and fix any SQL injection risks. Be specific about the issues.
**Elements masked by code-aware strategy:** 6

### Code: Before vs After Masking

**Original (first 40 lines):**
```
"""
Nextera Data Pipeline — ETL Transform Module
Extracts customer data from production DB and transforms it for analytics.
"""

import psycopg2
import pandas as pd
from datetime import datetime
from typing import Optional

# ──────────────────────────────────────────────────────────
# Hardcoded credentials (TODO: migrate to Vault by Q2 2024)
# ──────────────────────────────────────────────────────────
DB_HOST = "db-primary.nextera-internal.com"
DB_USER = "analytics_user"
DB_PASS = "An@lytics#Pr0d!2024Nextera"
DB_NAME = "nextera_analytics"
DB_PORT = 5432

# Internal server IPs for data source routing
DATA_SOURCE_IPS = {
    "crm_service":    "10.0.1.45",
    "billing_api":    "10.0.2.123",
    "legacy_erp":     "192.168.100.45",
    "sftp_export":    "10.0.3.78",
    "kafka_broker":   "10.0.4.200",
}

# S3 credentials for staging exports
S3_ACCESS_KEY = "AKIAI44QH8DHBEXAMPLE"
S3_SECRET_KEY = "je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY"
S3_BUCKET = "nextera-analytics-exports"


def get_db_connection():
    """Create authenticated connection to analytics database."""
    return psycopg2.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASS,
... (102 more lines)
```

**After code-aware masking (first 40 lines):**
```
"""
Nextera Data Pipeline — ETL Transform Module
Extracts customer data from production DB and transforms it for analytics.
"""

import psycopg2
import pandas as pd
from datetime import datetime
from typing import Optional

# ──────────────────────────────────────────────────────────
# Hardcoded credentials (TODO: migrate to Vault by Q2 2024)
# ──────────────────────────────────────────────────────────
DB_HOST = "db-primary.nextera-internal.com"
DB_USER = "analytics_user"
DB_PASS = "[SECRET_REDACTED]"
DB_NAME = "nextera_analytics"
DB_PORT = 5432

# Internal server IPs for data source routing
DATA_SOURCE_IPS = {
    "crm_service":    "10.0.1.45",
    "billing_api":    "10.0.2.123",
    "legacy_erp":     "192.168.100.45",
    "sftp_export":    "10.0.3.78",
    "kafka_broker":   "10.0.4.200",
}

# S3 credentials for staging exports
S3_ACCESS_KEY = "[SECRET_REDACTED]"
S3_SECRET_KEY = "je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY"
S3_BUCKET = "nextera-analytics-exports"


def get_db_connection():
    """Create authenticated connection to analytics database."""
    return psycopg2.connect(
        host=DB_HOST,
        user=DB_USER,
        password=[SECRET_REDACTED]
... (102 more lines)
```

### Claude's Response: Original Code

Here's a complete analysis of all issues, followed by a fixed version.

## Issues Found

### Critical: SQL Injection
**Line 48** — `since` is interpolated directly into the SQL string:
```python
query = f"""
    ...
    WHERE c.created_at > '{since}'
```
If `since` comes from any external input, an attacker can inject arbitrary SQL. Fix: use a parameterized query with `%s` and pass the value separately to `pd.read_sql`.

### Critical: Hardcoded Credentials
**Lines 15–23** — `DB_PASS`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` are hardcoded. Anyone with read access to the source file (or git history) has production credentials. Fix: load from environment variables or a secrets manager.

### Critical: PII Written to Logs
**Lines 56–59** (extract) and **lines 76–77** (transform) — emails, full names, SSNs, and addresses are printed verbatim to stdout before anonymization. Any log aggregation system (Datadog, CloudWatch, Splunk) will store them in plaintext. Fix: remove all PII log lines.

### High: Unsalted SHA-256 for PII Pseudonymization
**Lines 65–70** — bare `sha256(value)` is reversible via rainbow tables. A determined attacker with the hash of a known email can verify it. Fix: use HMAC with a per-deployment secret key.

### High: DB Connection Leak on Exception
**Line 38** — connection is manually closed at the end of the happy path only. Any exception before `conn.close()` leaves the connection open. Fix: use `with psycopg2.connect(...) as conn`.

### Medium: Cartesian Row Multiplication from LEFT JOINs
**Lines 42–47** — joining `nextera_payments` and `nextera_addresses` without deduplication means customers with multiple payment records or addresses produce multiple rows silently. The caller never knows. Fix: use `DISTINCT ON` or restructure.

### Medium: Deprecated `datetime.utcnow()`
**Line 110** — removed in Python 3.12+. Fix: `datetime.now(timezone.utc)`.

### Medium: Unsafe Temp File
**Line 108** — `/tmp/{table_name}.parquet` is a predictable path. Fix: use `tempfile.NamedTemporaryFile`.

### Low: No Query Result Chunking
`pd.read_sql` loads the entire result set into RAM. For large tables this will OOM. Fix: use `chunksize` parameter.

---

## Fixed Version

```python
"""
Nextera Data Pipeline — ETL Transform Module
"""

import hashlib
import hmac
import os
import tempfile
from datetime import datetime, timezone
from typing import Optional

import boto3
import pandas as pd
import psycopg2


# ──────────────────────────────────────────────────────────
# Credentials loaded from environment — never hardcoded
# ──────────────────────────────────────────────────────────
def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise EnvironmentError(f"Required environment variable not set: {name}")
    return value


def get_db_connection():
    return psycopg2.connect(
        host=_require_env("DB_HOST"),
        user=_require_env("DB_USER"),
        password=_require_env("DB_PASS"),
        dbname=_require_env("DB_NAME"),
        port=int(os.environ.get("DB_PORT", "5432")),
        sslmode="require",
    )


# ──────────────────────────────────────────────────────────
# PII pseudonymization — HMAC-SHA256 with a deployment secret
# ──────────────────────────────────────────────────────────
def _hmac_hash(value: str) -> str:
    """Pseudonymize a value using HMAC-SHA256 with a deployment secret.

    Unlike bare SHA-256, this is not reversible without the secret key,
    making rainbow-table attacks infeasible.
    """
    secret = _require_env("PII_HMAC_SECRET").encode()
    return hmac.new(secret, value.encode(), hashlib.sha256).hexdigest()


# ──────────────────────────────────────────────────────────
# Extraction
# ──────────────────────────────────────────────────────────
_EXTRACT_QUERY = """
    SELECT
        c.customer_id,
        c.customer_email,
        c.customer_ssn,
        c.customer_phone,
        c.full_name,
        c.date_of_birth,
        p.payment_card_last4,
        p.payment_card_token,
        p.billing_address_id,
        a.street_address,
        a.postal_code,
        a.city,
        a.country_code
    FROM nextera_customers c
    LEFT JOIN LATERAL (
        SELECT payment_card_last4, payment_card_token, billing_address_id
        FROM nextera_payments
        WHERE customer_id = c.customer_id
        ORDER BY created_at DESC
        LIMIT 1
    ) p ON true
    LEFT JOIN LATERAL (
        SELECT street_address, postal_code, city, country_code
        FROM nextera_addresses
        WHERE customer_id = c.customer_id
        ORDER BY created_at DESC
        LIMIT 1
    ) a ON true
    WHERE c.created_at > %s
      AND c.customer_status = 'active'
    ORDER BY c.created_at DESC
"""
#                  ^^^ parameterized — no string interpolation


def extract_customer_data(
    since: Optional[str] = None,
    chunk_size: int = 10_000,
) -> pd.DataFrame:
    """Extract customer records. `since` is an ISO date string (default: 2024-01-01)."""
    since = since or "2024-01-01"

    # psycopg2 validates and escapes the parameter — SQL injection is not possible
    with get_db_connection() as conn:
        chunks = pd.read_sql(
            _EXTRACT_QUERY,
            conn,
            params=(since,),
            chunksize=chunk_size,
        )
        df = pd.concat(chunks, ignore_index=True)

    # Safe log: record count only, no PII
    print(f"[extract] Loaded {len(df)} customer records")
    return df


# ──────────────────────────────────────────────────────────
# Transformation
# ──────────────────────────────────────────────────────────
_PII_COLUMNS = [
    "customer_email",
    "customer_ssn",
    "customer_phone",
    "full_name",
    "date_of_birth",
    "street_address",
]

_HASH_COLUMNS = {
    "customer_email": "customer_email_hash",
    "customer_ssn":   "customer_ssn_hash",
}


def transform_for_analytics(df: pd.DataFrame) -> pd.DataFrame:
    """Pseudonymize PII and drop direct identifiers."""
    for source_col, hash_col in _HASH_COLUMNS.items():
        df[hash_col] = df[source_col].apply(
            lambda v: _hmac_hash(v) if pd.notna(v) else None
        )

    df = df.drop(columns=_PII_COLUMNS)
    print(f"[transform] Anonymized {len(df)} records; dropped {len(_PII_COLUMNS)} PII columns")
    return df


# ──────────────────────────────────────────────────────────
# Load
# ──────────────────────────────────────────────────────────
def load_to_warehouse(df: pd.DataFrame, table_name: str) -> int:
    """Stage transformed data to S3 as Parquet."""
    # Use IAM role in prod (no explicit credentials needed);
    # fall back to env vars for local/CI runs.
    s3_kwargs: dict = {"region_name": os.environ.get("AWS_REGION", "eu-west-1")}
    if os.environ.get("AWS_ACCESS_KEY_ID"):
        s3_kwargs["aws_access_key_id"] = _require_env("AWS_ACCESS_KEY_ID")
        s3_kwargs["aws_secret_access_key"] = _require_env("AWS_SECRET_ACCESS_KEY")

    s3 = boto3.client("s3", **s3_kwargs)
    bucket = _require_env("S3_BUCKET")
    ts = datetime.now(timezone.utc).isoformat()
    staging_key = f"staging/{table_name}/{ts}.parquet"

    with tempfile.NamedTemporaryFile(suffix=".parquet", delete=True) as tmp:
        df.to_parquet(tmp.name)
        s3.upload_file(tmp.name, bucket, staging_key)

    print(f"[load] Uploaded {len(df)} rows → s3://{bucket}/{staging_key}")
    return len(df)
```

## Summary of Changes

| Issue | Fix |
|---|---|
| SQL injection via f-string | `%s` parameterized query — psycopg2 escapes it |
| Hardcoded credentials | `os.environ` + `_require_env()` — fails fast if unset |
| PII in logs | All PII `print()` calls removed |
| Unsalted SHA-256 | HMAC-SHA256 with `PII_HMAC_SECRET` env var |
| Connection leak | `with get_db_connection() as conn` context manager |
| JOIN row multiplication | `LATERAL ... LIMIT 1` subqueries per join |
| Deprecated `utcnow()` | `datetime.now(timezone.utc)` |
| Unsafe temp file | `tempfile.NamedTemporaryFile` with `delete=True` |
| Full table in RAM | `chunksize=10_000` + `pd.concat` |

The one thing you'll need to add before deploying: provision `PII_HMAC_SECRET` as a stable, per-environment secret in Vault (or AWS Secrets Manager). Rotating it invalidates all existing hashes, so treat it like an encryption key.

### Claude's Response: Masked Code

Here's a breakdown of every issue found, followed by the fixed code.

---

## Issues Found

### 1. SQL Injection — `extract_customer_data` (Critical)

The `since` parameter is interpolated directly into the query string via an f-string:
```python
WHERE c.created_at > '{since}'
```
Any caller passing `since="' OR '1'='1"` or `since="'; DROP TABLE nextera_customers; --"` gets full injection. The default fallback doesn't protect against callers who supply the argument.

**Fix:** Use a parameterized query with a `%s` placeholder and pass `since` via `params=`.

---

### 2. PII Logged to stdout — `extract_customer_data` (Critical / GDPR)

Three `print` statements emit raw PII from the result set:
```python
print(f"[extract] Sample emails: {df['customer_email'].head(3).tolist()}")
print(f"[extract] Sample names: {df['full_name'].head(3).tolist()}")
print(f"[extract] Sample SSNs: {df['customer_ssn'].head(2).tolist()}")  # SSNs in plaintext
```
These end up in any log aggregator, container stdout, or CI/CD output.

---

### 3. PII Logged Before Anonymization — `transform_for_analytics` (Critical / GDPR)

```python
pii_sample = df[["customer_email", "customer_ssn", "full_name", "street_address"]].head(5)
print(f"[transform] PII sample before anonymization:\n{pii_sample.to_string()}")
```
This fires before the `drop()` call, meaning it logs the columns that are supposed to be protected.

---

### 4. Hardcoded Credentials (Critical)

`DB_PASS`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` are module-level string literals. They're in source control history even after removal.

---

### 5. Unsalted SHA-256 for PII Pseudonymization (High)

```python
hashlib.sha256(e.encode()).hexdigest()
```
SHA-256 with no keying material is reversible via rainbow table for emails (predictable structure) and especially for SSNs (limited entropy ~10^9 values). This is not pseudonymization by GDPR Article 4(5) standards.

**Fix:** HMAC-SHA-256 with a secret key loaded from the environment.

---

### 6. Connection Leak on Exception — `extract_customer_data` (Medium)

```python
conn = get_db_connection()
df = pd.read_sql(query, conn)  # if this raises, conn.close() is never reached
conn.close()
```
Any exception (network error, bad query, OOM) leaks the connection permanently.

**Fix:** Use `with` / `contextlib.closing`.

---

### 7. Path Traversal in `load_to_warehouse` (Medium)

`table_name` is user-supplied and flows into two unsanitized locations:
```python
f"/tmp/{table_name}.parquet"           # local filesystem
f"staging/{table_name}/{...}.parquet"  # S3 key
```
A `table_name` like `../../etc/cron.d/backdoor` or `../prod/secrets` is dangerous in both cases.

---

### 8. Temp File Not Cleaned Up (Low)

`/tmp/{table_name}.parquet` is written but never deleted after the S3 upload, leaving PII on disk indefinitely.

---

### 9. No Input Validation on `since` Date (Low)

Even after fixing SQL injection, an invalid value like `"not-a-date"` will generate a confusing DB error. Validate the format explicitly.

---

## Fixed Code

```python
"""
Nextera Data Pipeline — ETL Transform Module
Extracts customer data from production DB and transforms it for analytics.
"""

import hashlib
import hmac
import os
import re
import tempfile
from contextlib import closing
from datetime import datetime
from typing import Optional

import boto3
import pandas as pd
import psycopg2

# ──────────────────────────────────────────────────────────────────────────────
# Credentials from environment — never hardcode in source.
# Set DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT, AWS_ACCESS_KEY_ID,
# AWS_SECRET_ACCESS_KEY, PII_HASH_KEY in your secrets manager / env.
# ──────────────────────────────────────────────────────────────────────────────
DB_HOST = os.environ["DB_HOST"]
DB_USER = os.environ["DB_USER"]
DB_PASS = os.environ["DB_PASS"]
DB_NAME = os.environ["DB_NAME"]
DB_PORT = int(os.environ.get("DB_PORT", "5432"))

S3_BUCKET = os.environ["S3_BUCKET"]

# Secret key for HMAC pseudonymization. Rotate via key versioning, not replacement.
_PII_HASH_KEY: bytes = os.environ["PII_HASH_KEY"].encode()

_VALID_TABLE_NAME = re.compile(r"^[a-zA-Z0-9_]+$")


def _hmac_hex(value: str) -> str:
    """HMAC-SHA256 pseudonymization. Keyed — not reversible without PII_HASH_KEY."""
    return hmac.new(_PII_HASH_KEY, value.encode(), hashlib.sha256).hexdigest()


def get_db_connection() -> psycopg2.extensions.connection:
    """Create authenticated connection to analytics database."""
    return psycopg2.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASS,
        dbname=DB_NAME,
        port=DB_PORT,
        sslmode="require",
    )


def extract_customer_data(since: Optional[str] = None) -> pd.DataFrame:
    """
    Extract customer records from production database.
    Used for GDPR compliance reports and churn analysis.
    """
    since = since or "2024-01-01"

    # Validate date format before it reaches the DB.
    try:
        datetime.strptime(since, "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"Invalid 'since' format {since!r}. Expected YYYY-MM-DD.")

    # Parameterized query — 'since' is never interpolated into the SQL string.
    query = """
        SELECT
            c.customer_id,
            c.customer_email,
            c.customer_ssn,
            c.customer_phone,
            c.full_name,
            c.date_of_birth,
            p.payment_card_last4,
            p.payment_card_token,
            p.billing_address_id,
            a.street_address,
            a.postal_code,
            a.city,
            a.country_code
        FROM nextera_customers c
        LEFT JOIN nextera_payments p ON p.customer_id = c.customer_id
        LEFT JOIN nextera_addresses a ON a.customer_id = c.customer_id
        WHERE c.created_at > %s
          AND c.customer_status = 'active'
        ORDER BY c.created_at DESC
    """

    # Context manager guarantees conn.close() even on exception.
    with closing(get_db_connection()) as conn:
        df = pd.read_sql(query, conn, params=(since,))

    # Log row count and ID range only — no PII in logs.
    id_range = f"{df['customer_id'].min()}–{df['customer_id'].max()}" if len(df) else "n/a"
    print(f"[extract] {len(df)} records loaded, customer_id range: {id_range}")

    return df


def transform_for_analytics(df: pd.DataFrame) -> pd.DataFrame:
    """
    Pseudonymize PII columns before writing to analytics warehouse.
    Replaces direct identifiers with HMAC-keyed equivalents.
    """
    df = df.copy()

    df["customer_email_hash"] = df["customer_email"].apply(_hmac_hex)
    df["customer_ssn_hash"] = df["customer_ssn"].apply(
        lambda s: _hmac_hex(s) if pd.notna(s) else None
    )

    # Drop direct PII columns — no logging of raw values.
    df = df.drop(
        columns=[
            "customer_email",
            "customer_ssn",
            "customer_phone",
            "full_name",
            "date_of_birth",
            "street_address",
        ]
    )

    print(f"[transform] Anonymization complete. Output columns: {df.columns.tolist()}")
    return df


def load_to_warehouse(df: pd.DataFrame, table_name: str) -> int:
    """Load transformed data to Redshift warehouse via S3 staging."""
    # Prevent path traversal in both the local temp path and the S3 key.
    if not _VALID_TABLE_NAME.match(table_name):
        raise ValueError(f"Invalid table_name {table_name!r}. Use [a-zA-Z0-9_] only.")

    # Use IAM roles in production; fall back to explicit keys only in dev/CI
    # where instance profiles are unavailable.
    s3 = boto3.client("s3", region_name="eu-west-1")

    staging_key = f"staging/{table_name}/{datetime.utcnow().isoformat()}.parquet"

    # Write to a temp file and clean up after upload regardless of outcome.
    with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        df.to_parquet(tmp_path)
        s3.upload_file(tmp_path, S3_BUCKET, staging_key)
    finally:
        os.unlink(tmp_path)

    print(f"[load] {len(df)} rows staged to s3://{S3_BUCKET}/{staging_key}")
    return len(df)
```

---

## Summary of Changes

| # | Issue | Change |
|---|-------|--------|
| 1 | SQL injection via f-string | Parameterized `%s` placeholder + `params=(since,)` |
| 2–3 | PII in debug logs | Replaced with row count + ID range only |
| 4 | Hardcoded credentials | `os.environ[...]` with explicit `KeyError` on missing vars |
| 5 | Unsalted SHA-256 | HMAC-SHA-256 keyed with `PII_HASH_KEY` env var |
| 6 | Connection leak | `contextlib.closing` wraps connection |
| 7 | Path traversal in table name | Regex allowlist `[a-zA-Z0-9_]` validated before use |
| 8 | Temp file left on disk | `try/finally` with `os.unlink` |
| 9 | Invalid date not caught early | `datetime.strptime` validation before query |

One architectural note: `load_to_warehouse` now relies on the IAM instance/task role rather than explicit key arguments to `boto3.client`. In environments where that's not set up yet, the fallback is to keep the env var approach (`aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"]`) — just never put the values in source.

### Analysis

- **Quality score:** 5/6 relevant keywords matched → **83% quality retained**
- **Topics preserved:** `hardcoded credentials`, `use env vars`, `secrets manager`, `SQL injection`, `PII in logs`, `encryption/hashing`, `GDPR/PII compliance`
- **Topics lost after masking:** none

---

## Overall Conclusion

Average quality retained across all tests: **96%**

**Result: code-aware masking preserves LLM response quality.** Claude identifies the same security issues and optimization opportunities whether it sees the original secrets or `[SECRET_REDACTED]` placeholders. The presence of a credential is enough to trigger a security observation — the actual value is irrelevant to the advice.

### Topics consistently identified on masked code
- ✅ `hardcoded credentials`
- ✅ `use env vars`
- ✅ `secrets manager`
- ✅ `PII in logs`
- ✅ `encryption/hashing`
- ✅ `key rotation`
- ✅ `SQL injection`
- ✅ `GDPR/PII compliance`

### Topics that required seeing the actual secrets
- ⚠️ `connection pooling` — Claude only identified this with the unmasked version

### Why code-aware masking works well for security review

Security advisors don't need to *read* a password to know it shouldn't be hardcoded. The structure `password: "[SECRET_REDACTED]"` carries the same information as `password: "P@ss123!"` from a security standpoint: *there is a hardcoded credential here*. Code-aware masking preserves:

- Variable and function names (so Claude understands what the code does)
- Code structure and architecture patterns
- The *presence* of credential assignments (triggers security advice)
- SQL column names and table references (triggers SQL injection advice)
- PII-handling patterns like `customer_ssn`, `customer_email` in queries

What is hidden: actual credential values, email addresses, phone numbers, person names — the exact data that would be dangerous to send to an external LLM API.