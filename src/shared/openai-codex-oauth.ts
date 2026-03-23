import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { dirname } from "node:path";

export const OPENAI_CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_CODEX_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const OPENAI_CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const OPENAI_CODEX_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const OPENAI_CODEX_OAUTH_SCOPE = "openid profile email offline_access";

const OPENAI_AUTH_JWT_CLAIM_PATH = "https://api.openai.com/auth";
const CALLBACK_SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Authentication successful</title>
</head>
<body>
  <p>Authentication successful. Return to your terminal to continue.</p>
</body>
</html>`;

export type OpenAiCodexTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string | null;
};

export type OpenAiCodexStoredToken = OpenAiCodexTokenSet & {
  version: 1;
  provider: "openai-codex";
  updatedAt: string;
};

export type ParsedAuthorizationInput = {
  code?: string;
  state?: string;
};

export function generateOpenAiCodexPkce(): { verifier: string; challenge: string } {
  const verifier = toBase64Url(randomBytes(32));
  const challenge = toBase64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createOpenAiCodexState(): string {
  return randomBytes(16).toString("hex");
}

export function buildOpenAiCodexAuthorizeUrl(params: {
  state: string;
  codeChallenge: string;
  redirectUri?: string;
  originator?: string;
}): string {
  const redirectUri = params.redirectUri ?? OPENAI_CODEX_OAUTH_REDIRECT_URI;
  const originator = params.originator ?? "llmask";

  const url = new URL(OPENAI_CODEX_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_CODEX_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", OPENAI_CODEX_OAUTH_SCOPE);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", originator);
  return url.toString();
}

export function parseOpenAiCodexAuthorizationInput(input: string): ParsedAuthorizationInput {
  const value = input.trim();
  if (!value) {
    return {};
  }

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined
    };
  } catch {
    // Accept raw code or querystring-like input
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code: code || undefined, state: state || undefined };
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined
    };
  }

  return { code: value };
}

export async function exchangeOpenAiCodexAuthorizationCode(params: {
  code: string;
  codeVerifier: string;
  redirectUri?: string;
}): Promise<OpenAiCodexTokenSet> {
  const response = await fetch(OPENAI_CODEX_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_CODEX_OAUTH_CLIENT_ID,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri ?? OPENAI_CODEX_OAUTH_REDIRECT_URI
    })
  });

  const payload = await parseTokenEndpointResponse(response, "authorization_code");
  return normalizeTokenEndpointPayload(payload);
}

export async function refreshOpenAiCodexToken(refreshToken: string): Promise<OpenAiCodexTokenSet> {
  const response = await fetch(OPENAI_CODEX_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OPENAI_CODEX_OAUTH_CLIENT_ID
    })
  });

  const payload = await parseTokenEndpointResponse(response, "refresh_token");
  return normalizeTokenEndpointPayload(payload);
}

export function extractOpenAiChatGptAccountId(accessToken: string): string | null {
  const payload = decodeJwtPayload(accessToken);
  const auth = payload?.[OPENAI_AUTH_JWT_CLAIM_PATH];
  const accountId =
    auth && typeof auth === "object"
      ? (auth as Record<string, unknown>).chatgpt_account_id
      : undefined;
  return typeof accountId === "string" && accountId.trim().length > 0 ? accountId : null;
}

export function writeOpenAiCodexTokenFile(filePath: string, tokenSet: OpenAiCodexTokenSet) {
  const record: OpenAiCodexStoredToken = {
    version: 1,
    provider: "openai-codex",
    accessToken: tokenSet.accessToken,
    refreshToken: tokenSet.refreshToken,
    expiresAt: tokenSet.expiresAt,
    accountId: tokenSet.accountId,
    updatedAt: new Date().toISOString()
  };

  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  renameSync(tmpPath, filePath);
}

export type OpenAiCodexCallbackServer = {
  isListening: boolean;
  close: () => Promise<void>;
  cancelWait: () => void;
  waitForCode: (timeoutMs?: number) => Promise<string | null>;
};

export async function startOpenAiCodexCallbackServer(expectedState: string): Promise<OpenAiCodexCallbackServer> {
  let lastCode: string | null = null;
  let cancelled = false;
  let server: Server | null = null;
  const sockets = new Set<Socket>();
  let waitResolve: (() => void) | null = null;

  const wake = () => {
    if (!waitResolve) return;
    const resolve = waitResolve;
    waitResolve = null;
    resolve();
  };

  await new Promise<void>((resolve) => {
    const created = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "", "http://localhost");

        if (url.pathname !== "/auth/callback") {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        if (url.searchParams.get("state") !== expectedState) {
          res.statusCode = 400;
          res.end("State mismatch");
          return;
        }

        const code = url.searchParams.get("code");
        if (!code) {
          res.statusCode = 400;
          res.end("Missing authorization code");
          return;
        }

        lastCode = code;
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Connection", "close");
        res.end(CALLBACK_SUCCESS_HTML);
        wake();
      } catch {
        res.statusCode = 500;
        res.end("Internal error");
      }
    });

    created.listen(1455, "127.0.0.1", () => {
      created.keepAliveTimeout = 1;
      created.headersTimeout = 5_000;
      created.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => {
          sockets.delete(socket);
        });
      });
      server = created;
      resolve();
    });

    created.on("error", () => {
      server = null;
      resolve();
    });
  });

  return {
    isListening: Boolean(server),
    close: async () => {
      if (!server) return;
      const closingServer = server;
      server = null;
      try {
        closingServer.closeIdleConnections?.();
      } catch {
        // ignore
      }
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        const forceTimer = setTimeout(() => {
          for (const socket of sockets) {
            try {
              socket.destroy();
            } catch {
              // ignore
            }
          }
          finish();
        }, 1000);

        closingServer.close(() => {
          clearTimeout(forceTimer);
          finish();
        });
      });
    },
    cancelWait: () => {
      cancelled = true;
      wake();
    },
    waitForCode: async (timeoutMs = 60_000) => {
      if (lastCode) return lastCode;
      if (cancelled) return null;

      const expiresAt = Date.now() + timeoutMs;
      while (!cancelled && !lastCode && Date.now() < expiresAt) {
        await new Promise<void>((resolve) => {
          waitResolve = resolve;
          setTimeout(resolve, 150);
        });
      }

      return lastCode;
    }
  };
}

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const payload = parts[1];
    if (!payload) {
      return null;
    }

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const json = JSON.parse(decoded) as unknown;
    return json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function parseTokenEndpointResponse(
  response: Response,
  grantType: "authorization_code" | "refresh_token"
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI OAuth ${grantType} failed (${response.status}): ${text || response.statusText}`);
  }

  const json = (await response.json()) as unknown;
  if (!json || typeof json !== "object") {
    throw new Error("OpenAI OAuth token endpoint returned invalid JSON");
  }

  return json as Record<string, unknown>;
}

function normalizeTokenEndpointPayload(payload: Record<string, unknown>): OpenAiCodexTokenSet {
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : NaN;

  if (!accessToken || !refreshToken || !Number.isFinite(expiresIn)) {
    throw new Error("OpenAI OAuth token response missing required fields");
  }

  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    accountId: extractOpenAiChatGptAccountId(accessToken)
  };
}
