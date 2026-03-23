import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  buildOpenAiCodexAuthorizeUrl,
  createOpenAiCodexState,
  exchangeOpenAiCodexAuthorizationCode,
  generateOpenAiCodexPkce,
  parseOpenAiCodexAuthorizationInput,
  startOpenAiCodexCallbackServer,
  writeOpenAiCodexTokenFile
} from "../src/shared/openai-codex-oauth";
import {
  findClaudeCredentialsPath,
  readClaudeCredentials,
  spawnClaudeLogin
} from "../src/shared/anthropic-claude-oauth";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "..", ".env");
const DEFAULT_OPENAI_OAUTH_TOKEN_PATH = "./data/auth/openai-codex-oauth.json";
const DEFAULT_OPENAI_OAUTH_TOKEN_ABS_PATH = resolve(__dirname, "..", "data", "auth", "openai-codex-oauth.json");

type OpenAiAuthConfig =
  | { mode: "api_key"; apiKey: string; oauthTokenPath: string }
  | { mode: "oauth_codex"; apiKey: string; oauthTokenPath: string };

type AnthropicAuthConfig =
  | { mode: "api_key"; apiKey: string; oauthTokenPath: string }
  | { mode: "oauth_claude_code"; apiKey: string; oauthTokenPath: string };

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log("");
  console.log("  ========================================");
  console.log("    LLMask POC-V1 - Setup Wizard");
  console.log("  ========================================");
  console.log("");

  // --- Primary provider ---
  console.log("  Providers disponibles:");
  console.log("    1. OpenAI (ChatGPT / Codex)");
  console.log("    2. Claude (Anthropic)");
  console.log("");

  let primaryChoice = "";
  while (primaryChoice !== "1" && primaryChoice !== "2") {
    primaryChoice = (await rl.question("  Choisis ton provider principal (1 ou 2): ")).trim();
  }

  const primaryProvider = primaryChoice === "1" ? "openai" : "anthropic";
  const primaryLabel = primaryChoice === "1" ? "OpenAI" : "Claude (Anthropic)";

  console.log(`  -> Provider principal: ${primaryLabel}`);
  console.log("");

  let openAiConfig: OpenAiAuthConfig = {
    mode: "api_key",
    apiKey: "",
    oauthTokenPath: ""
  };

  let anthropicConfig: AnthropicAuthConfig = {
    mode: "api_key",
    apiKey: "",
    oauthTokenPath: ""
  };

  if (primaryProvider === "openai") {
    openAiConfig = await promptOpenAiAuthConfig(rl, "principal");
  } else {
    anthropicConfig = await promptAnthropicAuthConfig(rl, "principal");
  }

  // --- Fallback provider ---
  console.log("");
  const fallbackAnswer = (await rl.question("  Configurer un provider de fallback ? (o/n): "))
    .trim()
    .toLowerCase();

  let fallbackProvider = "";

  if (isYes(fallbackAnswer)) {
    fallbackProvider = primaryProvider === "openai" ? "anthropic" : "openai";
    const fallbackLabel = fallbackProvider === "openai" ? "OpenAI" : "Claude (Anthropic)";
    console.log(`  -> Fallback: ${fallbackLabel}`);

    if (fallbackProvider === "openai") {
      openAiConfig = await promptOpenAiAuthConfig(rl, "fallback");
    } else {
      anthropicConfig = await promptAnthropicAuthConfig(rl, "fallback");
    }
  }

  // --- Build .env content ---
  const openAiAuthMode = openAiConfig.mode;
  const openAiKey = openAiConfig.apiKey;
  const openAiOauthTokenPath = openAiConfig.oauthTokenPath;
  const openAiBaseUrl =
    openAiAuthMode === "oauth_codex" ? "https://chatgpt.com/backend-api" : "https://api.openai.com";

  const envContent = `# LLMask POC-V1 - Configuration generee par setup
# Date: ${new Date().toISOString()}

PORT=8787
HOST=0.0.0.0
LOG_LEVEL=info

# Provider principal
PRIMARY_PROVIDER=${primaryProvider}

# OpenAI
OPENAI_AUTH_MODE=${openAiAuthMode}
OPENAI_API_KEY=${openAiKey}
OPENAI_BASE_URL=${openAiBaseUrl}
OPENAI_OAUTH_TOKEN_PATH=${openAiOauthTokenPath}

# Anthropic (Claude)
ANTHROPIC_AUTH_MODE=${anthropicConfig.mode}
ANTHROPIC_API_KEY=${anthropicConfig.apiKey}
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_VERSION=2023-06-01
ANTHROPIC_OAUTH_TOKEN_PATH=${anthropicConfig.oauthTokenPath}

# Fallback (vide = pas de fallback)
FALLBACK_PROVIDER=${fallbackProvider}

# Timeout requete upstream
REQUEST_TIMEOUT_MS=60000

# Mode LLMask (trust = rewrite silencieux, review = logs detailles)
LLMASK_MODE=trust

# Fail-safe: bloquer si erreur pipeline
FAIL_SAFE_BLOCK_ON_ERROR=true

# Donnees locales
DATA_DIR=./data
SQLITE_PATH=./data/llmask.db
`;

  // --- Write .env ---
  console.log("");

  if (existsSync(ENV_PATH)) {
    const overwrite = (await rl.question("  Le fichier .env existe deja. Ecraser ? (o/n): "))
      .trim()
      .toLowerCase();

    if (!isYes(overwrite)) {
      console.log("  -> Abandon. Le fichier .env n'a pas ete modifie.");
      rl.close();
      return;
    }
  }

  writeFileSync(ENV_PATH, envContent, "utf-8");

  console.log("  -> Fichier .env ecrit avec succes !");
  console.log("");
  console.log("  ----------------------------------------");
  console.log(`  Provider principal : ${primaryLabel}`);
  if (primaryProvider === "openai") {
    console.log(`  OpenAI auth        : ${describeOpenAiAuthMode(openAiConfig.mode)}`);
  } else {
    console.log(`  Anthropic auth     : ${describeAnthropicAuthMode(anthropicConfig.mode)}`);
  }
  if (fallbackProvider) {
    console.log(`  Fallback           : ${fallbackProvider === "openai" ? "OpenAI" : "Claude (Anthropic)"}`);
    if (fallbackProvider === "openai") {
      console.log(`  OpenAI auth (fb)   : ${describeOpenAiAuthMode(openAiConfig.mode)}`);
    } else {
      console.log(`  Anthropic auth (fb): ${describeAnthropicAuthMode(anthropicConfig.mode)}`);
    }
  } else {
    console.log("  Fallback           : aucun");
  }
  if (openAiConfig.mode === "oauth_codex") {
    console.log(`  OAuth token (OAI)  : ${openAiConfig.oauthTokenPath}`);
  }
  if (anthropicConfig.mode === "oauth_claude_code") {
    console.log(`  OAuth token (Claude): ${anthropicConfig.oauthTokenPath}`);
  }
  console.log("  ----------------------------------------");
  console.log("");
  console.log("  Lance LLMask avec: npm run dev");
  console.log("");

  rl.close();
}

async function promptOpenAiAuthConfig(
  rl: ReturnType<typeof createInterface>,
  roleLabel: "principal" | "fallback"
): Promise<OpenAiAuthConfig> {
  console.log("");
  console.log(`  Auth OpenAI (${roleLabel}):`);
  console.log("    1. API key (platform.openai.com)");
  console.log("    2. OAuth ChatGPT/Codex (style OpenClaw)");
  console.log("    3. Aucun (LLMask attendra un header Authorization entrant)");

  let authChoice = "";
  while (!["1", "2", "3"].includes(authChoice)) {
    authChoice = (await rl.question("  Choisis le mode d'auth OpenAI (1, 2 ou 3): ")).trim();
  }

  if (authChoice === "1") {
    const apiKey = (await rl.question("  Cle API OpenAI (sk-...): ")).trim();
    return { mode: "api_key", apiKey, oauthTokenPath: "" };
  }

  if (authChoice === "3") {
    console.log("  -> Aucun secret OpenAI localement (pass-through des headers entrants).");
    return { mode: "api_key", apiKey: "", oauthTokenPath: "" };
  }

  console.log("");
  console.log("  OpenAI OAuth (PKCE) va ouvrir une page de connexion.");
  console.log("  Si le callback local ne marche pas, colle l'URL de redirection ici.");
  console.log("");

  await runOpenAiOAuthLogin(rl, DEFAULT_OPENAI_OAUTH_TOKEN_ABS_PATH);
  console.log(`  -> Token OAuth OpenAI enregistre dans ${DEFAULT_OPENAI_OAUTH_TOKEN_PATH}`);

  return {
    mode: "oauth_codex",
    apiKey: "",
    oauthTokenPath: DEFAULT_OPENAI_OAUTH_TOKEN_PATH
  };
}

async function runOpenAiOAuthLogin(
  rl: ReturnType<typeof createInterface>,
  tokenFilePath: string
) {
  const { verifier, challenge } = generateOpenAiCodexPkce();
  const state = createOpenAiCodexState();
  const authUrl = buildOpenAiCodexAuthorizeUrl({
    state,
    codeChallenge: challenge,
    originator: "llmask"
  });

  const callbackServer = await startOpenAiCodexCallbackServer(state);
  let authorizationCode: string | null = null;

  try {
    console.log("  URL de connexion OpenAI:");
    console.log(`  ${authUrl}`);
    console.log("");

    const browserOpened = await tryOpenBrowser(authUrl);
    if (browserOpened) {
      console.log("  -> Navigateur ouvert (si rien ne s'affiche, ouvre l'URL manuellement).");
    } else {
      console.log("  -> Impossible d'ouvrir le navigateur automatiquement. Ouvre l'URL manuellement.");
    }

    if (callbackServer.isListening) {
      console.log("  -> Callback local actif sur http://localhost:1455/auth/callback");
      console.log("  -> Attente du callback (120s)...");
      authorizationCode = await callbackServer.waitForCode(120_000);
      if (authorizationCode) {
        console.log("  -> Callback OAuth recu.");
      }
    } else {
      console.log("  -> Port localhost:1455 indisponible, passage en mode collage d'URL.");
    }

    if (!authorizationCode) {
      const pasted = await rl.question(
        "  Colle l'URL de redirection complete (ou juste le code OAuth): "
      );
      const parsed = parseOpenAiCodexAuthorizationInput(pasted);
      if (parsed.state && parsed.state !== state) {
        throw new Error("State OAuth invalide (state mismatch)");
      }
      authorizationCode = parsed.code ?? null;
    }

    if (!authorizationCode) {
      throw new Error("Code OAuth manquant");
    }

    console.log("  -> Echange du code OAuth contre un token OpenAI...");
    const tokenSet = await exchangeOpenAiCodexAuthorizationCode({
      code: authorizationCode,
      codeVerifier: verifier
    });

    console.log("  -> Token OAuth recu, enregistrement local...");
    writeOpenAiCodexTokenFile(tokenFilePath, tokenSet);
  } finally {
    await callbackServer.close();
  }
}

async function tryOpenBrowser(url: string): Promise<boolean> {
  try {
    let child;
    if (process.platform === "win32") {
      child = spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
        detached: true,
        stdio: "ignore"
      });
    } else if (process.platform === "darwin") {
      child = spawn("open", [url], { detached: true, stdio: "ignore" });
    } else {
      child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    }

    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function promptAnthropicAuthConfig(
  rl: ReturnType<typeof createInterface>,
  roleLabel: "principal" | "fallback"
): Promise<AnthropicAuthConfig> {
  console.log("");
  console.log(`  Auth Anthropic (${roleLabel}):`);
  console.log("    1. API key (console.anthropic.com)");
  console.log("    2. OAuth Claude Code (login interactif via Claude CLI)");
  console.log("");

  let authChoice = "";
  while (!["1", "2"].includes(authChoice)) {
    authChoice = (await rl.question("  Choisis le mode d'auth Anthropic (1 ou 2): ")).trim();
  }

  if (authChoice === "1") {
    let apiKey = "";
    while (!apiKey) {
      apiKey = (await rl.question("  Cle API Anthropic (sk-ant-...): ")).trim();
      if (!apiKey) {
        console.log("  -> La cle API Anthropic est obligatoire.");
      }
    }
    return { mode: "api_key", apiKey, oauthTokenPath: "" };
  }

  // OAuth Claude Code
  const credPath = findClaudeCredentialsPath();
  const existing = readClaudeCredentials(credPath);

  if (existing) {
    console.log(`  -> Credentials Claude Code detectes dans ${credPath}`);
    console.log("  -> Token existant sera utilise par LLMask.");
  } else {
    console.log("");
    console.log("  Aucun credential Claude Code trouve.");
    console.log("  LLMask va lancer 'claude login' pour vous connecter...");
    console.log("");

    const { exitCode } = await spawnClaudeLogin();
    if (exitCode !== 0) {
      console.log("  -> Erreur lors du login Claude. Verifiez que Claude Code est installe.");
      console.log("  -> Installez-le avec: npm i -g @anthropic-ai/claude-code");
      throw new Error("Claude login echoue");
    }

    const postLogin = readClaudeCredentials(credPath);
    if (!postLogin) {
      throw new Error(`Credentials Claude introuvables apres login dans ${credPath}`);
    }
    console.log("  -> Login Claude reussi !");
  }

  return { mode: "oauth_claude_code", apiKey: "", oauthTokenPath: credPath };
}

function describeOpenAiAuthMode(mode: OpenAiAuthConfig["mode"]): string {
  if (mode === "oauth_codex") {
    return "OAuth ChatGPT/Codex";
  }
  return "API key / pass-through";
}

function describeAnthropicAuthMode(mode: AnthropicAuthConfig["mode"]): string {
  if (mode === "oauth_claude_code") {
    return "OAuth Claude Code";
  }
  return "API key";
}

function isYes(value: string): boolean {
  return value === "o" || value === "oui" || value === "y" || value === "yes";
}

main().catch((err) => {
  console.error("Erreur setup:", err);
  process.exit(1);
});
