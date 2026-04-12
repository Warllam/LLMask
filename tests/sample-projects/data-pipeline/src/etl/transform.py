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
        dbname=DB_NAME,
        port=DB_PORT,
        sslmode="require",
    )


def extract_customer_data(since: Optional[str] = None) -> pd.DataFrame:
    """
    Extract customer PII from production database.
    Used for GDPR compliance reports and churn analysis.
    """
    conn = get_db_connection()
    since = since or "2024-01-01"

    # Query extracting sensitive customer PII
    query = f"""
        SELECT
            c.customer_id,
            c.customer_email,        -- PII: email address
            c.customer_ssn,          -- PII: social security number (FR)
            c.customer_phone,        -- PII: mobile phone
            c.full_name,             -- PII: full legal name
            c.date_of_birth,         -- PII: date of birth
            p.payment_card_last4,
            p.payment_card_token,
            p.billing_address_id,
            a.street_address,        -- PII: home address
            a.postal_code,
            a.city,
            a.country_code
        FROM nextera_customers c
        LEFT JOIN nextera_payments p ON p.customer_id = c.customer_id
        LEFT JOIN nextera_addresses a ON a.customer_id = c.customer_id
        WHERE c.created_at > '{since}'
          AND c.customer_status = 'active'
        ORDER BY c.created_at DESC
    """

    df = pd.read_sql(query, conn)
    conn.close()

    # Debug logging — contains PII! (should use anonymized IDs only)
    print(f"[extract] Loaded {len(df)} customer records from nextera_customers")
    print(f"[extract] Sample emails: {df['customer_email'].head(3).tolist()}")
    print(f"[extract] Sample names: {df['full_name'].head(3).tolist()}")
    print(f"[extract] Sample SSNs: {df['customer_ssn'].head(2).tolist()}")

    return df


def transform_for_analytics(df: pd.DataFrame) -> pd.DataFrame:
    """
    Anonymize PII before writing to analytics warehouse.
    Replaces direct identifiers with pseudonymized equivalents.
    """
    import hashlib

    # Hash sensitive identifiers
    df["customer_email_hash"] = df["customer_email"].apply(
        lambda e: hashlib.sha256(e.encode()).hexdigest()
    )
    df["customer_ssn_hash"] = df["customer_ssn"].apply(
        lambda s: hashlib.sha256(s.encode()).hexdigest() if pd.notna(s) else None
    )

    # Log PII sample before dropping — BAD PRACTICE, remove before prod
    pii_sample = df[["customer_email", "customer_ssn", "full_name", "street_address"]].head(5)
    print(f"[transform] PII sample before anonymization:\n{pii_sample.to_string()}")

    # Drop direct PII columns
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

    return df


def load_to_warehouse(df: pd.DataFrame, table_name: str) -> int:
    """Load transformed data to Redshift warehouse."""
    import boto3

    # Direct credential usage — should use IAM roles in prod
    s3 = boto3.client(
        "s3",
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name="eu-west-1",
    )

    staging_key = f"staging/{table_name}/{datetime.utcnow().isoformat()}.parquet"
    df.to_parquet(f"/tmp/{table_name}.parquet")
    s3.upload_file(f"/tmp/{table_name}.parquet", S3_BUCKET, staging_key)

    return len(df)
