#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { buildServer } from "./server";
import { loadConfig } from "./shared/config";
import { getHardenedTlsOptions } from "./shared/security-middleware";

loadDotenv();

async function main() {
  const config = loadConfig(process.env);

  // TLS support with hardened options
  const tlsEnabled = !!(config.tlsCert && config.tlsKey);
  const https = tlsEnabled
    ? {
        cert: fs.readFileSync(config.tlsCert),
        key: fs.readFileSync(config.tlsKey),
        ...getHardenedTlsOptions(),
      }
    : undefined;

  const server = await buildServer(config);

  try {
    await server.listen({ host: config.host, port: config.port, ...(https ? { https } : {}) });
  } catch (error) {
    server.log.error({ err: error }, "failed to start server");
    process.exit(1);
  }

  // ── Startup summary ────────────────────────────────────────────────
  const pkgVersion = (() => {
    try {
      return (JSON.parse(
        fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")
      ) as { version: string }).version;
    } catch {
      return "unknown";
    }
  })();

  const protocol = tlsEnabled ? "https" : "http";
  const displayHost = config.host === "0.0.0.0" ? "localhost" : config.host;
  const baseUrl = `${protocol}://${displayHost}:${config.port}`;

  const configuredProviders: string[] = [];
  if (config.openaiApiKey || config.openaiAuthMode === "oauth_codex") configuredProviders.push("openai");
  if (config.anthropicApiKey || config.anthropicAuthMode === "oauth_claude_code") configuredProviders.push("anthropic");
  if (config.litellmBaseUrl) configuredProviders.push("litellm");
  if (config.azureOpenaiApiKey && config.azureOpenaiBaseUrl) configuredProviders.push("azure-openai");
  if (config.geminiApiKey) configuredProviders.push("gemini");
  if (config.mistralApiKey) configuredProviders.push("mistral");

  console.log(`\n🛡️  LLMask v${pkgVersion} started`);
  console.log(`📡 Proxy:      ${baseUrl}`);
  console.log(`🎯 Strategy:   ${config.llmaskMode}`);
  console.log(`🔌 Providers:  ${configuredProviders.length > 0 ? configuredProviders.join(", ") : "(none configured)"}`);
  console.log(`📊 Dashboard:  ${baseUrl}/dashboard\n`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    server.log.info({ signal }, "shutting down gracefully");
    await server.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
