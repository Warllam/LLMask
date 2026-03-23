# ============================================================================
# LLMask — Multi-Stage Dockerfile
# ============================================================================

FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

# ── Build proxy ──────────────────────────────────────────────────
FROM deps AS build-proxy

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

# ── Build dashboard ──────────────────────────────────────────────
FROM node:22-alpine AS build-dashboard

WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# ── Production runtime ──────────────────────────────────────────────
FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.title="LLMask"
LABEL org.opencontainers.image.description="Mask sensitive data before it reaches any LLM"
LABEL org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

RUN apk add --no-cache curl
RUN addgroup -S llmask && adduser -S -G llmask -h /app llmask

WORKDIR /app

COPY --from=build-proxy --chown=llmask:llmask /app/dist ./dist
COPY --from=build-proxy --chown=llmask:llmask /app/node_modules ./node_modules
COPY --from=build-proxy --chown=llmask:llmask /app/package.json ./
COPY --from=build-dashboard --chown=llmask:llmask /app/dashboard/dist ./dashboard/dist

RUN mkdir -p /app/data && chown llmask:llmask /app/data

USER llmask

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/app/data \
    SQLITE_PATH=/app/data/llmask.db

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:8787/health || exit 1

CMD ["node", "dist/index.js"]
