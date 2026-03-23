#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
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

  const server = buildServer(config);

  try {
    await server.listen({ host: config.host, port: config.port, ...(https ? { https } : {}) });
  } catch (error) {
    server.log.error({ err: error }, "failed to start server");
    process.exit(1);
  }

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
