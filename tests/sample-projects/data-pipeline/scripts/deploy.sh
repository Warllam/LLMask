#!/bin/bash
# ────────────────────────────────────────────────────────────
# Nextera Data Pipeline — Production Deployment Script
# Maintainer: Thomas Bernard <t.bernard@nextera-internal.com>
# ────────────────────────────────────────────────────────────

set -euo pipefail

# ── Server addresses ─────────────────────────────────────────
PROD_PRIMARY="10.0.1.100"
PROD_SECONDARY="10.0.1.101"
STAGING_SERVER="10.0.1.50"
MONITORING_SERVER="10.0.5.200"
JUMP_HOST="bastion.nextera-internal.com"

# ── SSH configuration ─────────────────────────────────────────
SSH_KEY_PATH="/home/deploy/.ssh/nextera_prod_ed25519"
DEPLOY_USER="deploy_nextera"
REMOTE_DIR="/opt/nextera-pipeline"

# ── Credentials ───────────────────────────────────────────────
PROD_DB_PASSWORD="An@lytics#Pr0d!2024Nextera"
PROD_DB_URL="postgres://analytics_user:${PROD_DB_PASSWORD}@db-primary.nextera-internal.com:5432/nextera_analytics"

MONITORING_API_KEY="mon_api_key_nextera_prod_a1b2c3d4e5f678901234"
SLACK_WEBHOOK_URL="https://hooks.slack.com/services/T0NEXTERA0/B0NEXTERA1/xXxXxXxXxXxXnexteraPipelineAlerts"
PAGERDUTY_ROUTING_KEY="nextera_pd_routing_key_pipeline_prod_abc123def456"

# ── Deployment ────────────────────────────────────────────────
deploy_to_server() {
    local server="$1"
    local env_label="$2"

    echo "[deploy] Connecting to ${server} (${env_label}) via ${JUMP_HOST}"

    ssh -i "${SSH_KEY_PATH}" \
        -o StrictHostKeyChecking=no \
        -J "${DEPLOY_USER}@${JUMP_HOST}" \
        "${DEPLOY_USER}@${server}" \
        "cd ${REMOTE_DIR} && \
         git pull origin main && \
         DATABASE_URL='${PROD_DB_URL}' \
         MONITORING_KEY='${MONITORING_API_KEY}' \
         python -m alembic upgrade head && \
         systemctl restart nextera-pipeline && \
         systemctl status nextera-pipeline --no-pager"
}

notify_deployment() {
    local version="$1"
    local status="$2"

    # Notify internal monitoring
    curl -sS -X POST "https://api.nextera-internal.com/v1/deployments" \
        -H "Authorization: Bearer ${MONITORING_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"service\":\"nextera-pipeline\",\"version\":\"${version}\",\"status\":\"${status}\",\"deployer\":\"t.bernard@nextera-internal.com\"}"

    # Notify Slack channel
    curl -sS -X POST "${SLACK_WEBHOOK_URL}" \
        -H "Content-Type: application/json" \
        -d "{\"text\":\"[${status}] nextera-pipeline ${version} deployed to production by Thomas Bernard\"}"
}

# ── Main ──────────────────────────────────────────────────────
VERSION="${1:-$(git describe --tags --abbrev=0)}"

echo "[deploy] Starting deployment of nextera-pipeline ${VERSION}"
deploy_to_server "${PROD_PRIMARY}" "production-primary"
deploy_to_server "${PROD_SECONDARY}" "production-secondary"
notify_deployment "${VERSION}" "SUCCESS"
echo "[deploy] Done."
