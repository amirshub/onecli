import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@onecli/db";
import { resolveApiAuth } from "@/lib/api-auth";
import { unauthorized } from "@/lib/api-utils";
import { GATEWAY_BASE_URL } from "@/lib/env";
import { loadCaCertificate } from "@/lib/gateway-ca";
import { cryptoService } from "@/lib/crypto";
import { parseAnthropicMetadata } from "@/lib/validations/secret";
import { DEFAULT_AGENT_NAME } from "@/lib/constants";
import { generateAccessToken } from "@/lib/services/agent-service";
import { logger } from "@/lib/logger";

const CA_CONTAINER_PATH = "/tmp/onecli-gateway-ca.pem";

/**
 * GET /api/container-config
 *
 * Returns the configuration an agent orchestrator needs to set up containers
 * for the gateway. The server controls all env var names, values, and paths —
 * the SDK just applies them without domain knowledge.
 *
 * Auth: `Authorization: Bearer oc_...` (user API key) or JWT session.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await resolveApiAuth(request);
    if (!auth) return unauthorized();

    // Look up agent: by identifier if provided, otherwise default.
    // Auto-creates the default agent on first call so `docker run` works
    // without needing to open the dashboard first.
    const agentIdentifier = request.nextUrl.searchParams.get("agent");

    let agent = agentIdentifier
      ? await db.agent.findFirst({
          where: { accountId: auth.accountId, identifier: agentIdentifier },
          select: { id: true, accessToken: true, secretMode: true },
        })
      : await db.agent.findFirst({
          where: { accountId: auth.accountId, isDefault: true },
          select: { id: true, accessToken: true, secretMode: true },
        });

    if (!agent && agentIdentifier) {
      return NextResponse.json(
        { error: "Agent with the given identifier not found." },
        { status: 404 },
      );
    }

    if (!agent) {
      agent = await db.agent.create({
        data: {
          name: DEFAULT_AGENT_NAME,
          accessToken: generateAccessToken(),
          isDefault: true,
          accountId: auth.accountId,
        },
        select: { id: true, accessToken: true, secretMode: true },
      });
    }

    const gatewayUrl = `http://x:${agent.accessToken}@${GATEWAY_BASE_URL}`;

    const caCertificate = loadCaCertificate();
    if (!caCertificate) {
      return NextResponse.json(
        {
          error:
            "CA certificate not available. Start the gateway first to generate it.",
        },
        { status: 503 },
      );
    }

    // Detect auth mode from the agent's Anthropic secret metadata.
    // In selective mode, only check secrets assigned to this agent.
    // OAuth tokens need CLAUDE_CODE_OAUTH_TOKEN so the SDK does the token
    // exchange. API keys need ANTHROPIC_API_KEY. Defaults to api-key for
    // legacy secrets without metadata.
    const anthropicSecret =
      agent.secretMode === "selective"
        ? await db.secret.findFirst({
            where: {
              type: "anthropic",
              agentSecrets: { some: { agentId: agent.id } },
            },
            select: { metadata: true },
          })
        : await db.secret.findFirst({
            where: { accountId: auth.accountId, type: "anthropic" },
            select: { metadata: true },
          });

    const bedrockConnection =
      agent.secretMode === "selective"
        ? await db.appConnection.findFirst({
            where: {
              accountId: auth.accountId,
              provider: "bedrock",
              status: "connected",
              agentAppConnections: { some: { agentId: agent.id } },
            },
            select: { id: true, credentials: true },
          })
        : await db.appConnection.findFirst({
            where: {
              accountId: auth.accountId,
              provider: "bedrock",
              status: "connected",
            },
            select: { id: true, credentials: true },
          });

    const authEnv: Record<string, string> = {};

    // Mutual exclusivity: if Bedrock is connected, emit only Bedrock env vars.
    if (bedrockConnection) {
      authEnv.CLAUDE_CODE_USE_BEDROCK = "1";
      authEnv.AWS_BEARER_TOKEN_BEDROCK = "placeholder";

      const encrypted = bedrockConnection.credentials;
      if (encrypted) {
        try {
          const decrypted = await cryptoService.decrypt(encrypted);
          const json = JSON.parse(decrypted) as Record<string, unknown>;
          const region = json.region;
          if (typeof region === "string" && region.trim()) {
            authEnv.AWS_REGION = region.trim();
          }
        } catch (err) {
          logger.warn(
            { err, connectionId: bedrockConnection.id },
            "failed to decrypt bedrock connection credentials",
          );
        }
      }
    } else {
      const meta = parseAnthropicMetadata(anthropicSecret?.metadata);

      // Only emit Anthropic placeholders when an Anthropic secret exists.
      if (anthropicSecret) {
        if (meta?.authMode === "oauth") {
          authEnv.CLAUDE_CODE_OAUTH_TOKEN = "placeholder";
        } else {
          authEnv.ANTHROPIC_API_KEY = "placeholder";
        }
      } else {
        // Legacy fallback: preserve previous default behavior
        authEnv.ANTHROPIC_API_KEY = "placeholder";
      }
    }

    // Mark agent as connected after the response is sent
    after(() => markAgentConnected(auth.accountId));

    return NextResponse.json({
      env: {
        // Proxy — uppercase + lowercase (some tools only check one)
        HTTPS_PROXY: gatewayUrl,
        HTTP_PROXY: gatewayUrl,
        https_proxy: gatewayUrl,
        http_proxy: gatewayUrl,
        // Node.js
        NODE_EXTRA_CA_CERTS: CA_CONTAINER_PATH,
        NODE_USE_ENV_PROXY: "1",
        // Git
        GIT_TERMINAL_PROMPT: "0",
        GIT_HTTP_PROXY_AUTHMETHOD: "basic",
        ...authEnv,
      },
      caCertificate,
      caCertificateContainerPath: CA_CONTAINER_PATH,
    });
  } catch (err) {
    logger.error(
      { err, route: "GET /api/container-config" },
      "container config failed",
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * Update the onboarding survey to record that the agent container is up.
 * Skips the write if already marked to avoid repeated DB calls.
 */
const markAgentConnected = async (accountId: string) => {
  const survey = await db.onboardingSurvey.findUnique({
    where: { accountId },
    select: { setupState: true },
  });

  if (!survey) return; // no onboarding in progress

  const state =
    survey.setupState && typeof survey.setupState === "object"
      ? (survey.setupState as Record<string, unknown>)
      : {};

  if (state.connectedAt) return; // already marked

  await db.onboardingSurvey.update({
    where: { accountId },
    data: {
      setupState: {
        ...state,
        connectedAt: new Date().toISOString(),
      },
    },
  });
};
