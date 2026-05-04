import { NextRequest, NextResponse } from "next/server";
import { resolveApiAuth } from "@/lib/api-auth";
import { handleServiceError, unauthorized } from "@/lib/api-utils";
import { invalidateGatewayCache } from "@/lib/gateway-invalidate";
import { getApp } from "@/lib/apps/registry";
import { db } from "@onecli/db";
import {
  createConnection,
  listConnectionsByProvider,
  reconnectConnection,
} from "@/lib/services/connection-service";

type Params = { params: Promise<{ provider: string }> };

/** Strip trailing dot, lowercase ASCII hostname label. */
const normalizeConnectionDomain = (
  raw: string,
):
  | { ok: true; domain: string }
  | { ok: false; error: string } => {
  const trimmed = raw.trim().replace(/\.$/, "");
  if (!trimmed) {
    return { ok: false, error: "Connection domain is required" };
  }

  let host = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      host = new URL(trimmed).hostname;
    } catch {
      return { ok: false, error: "Invalid connection domain URL" };
    }
  } else if (trimmed.includes("/") || trimmed.includes(":")) {
    return {
      ok: false,
      error:
        "Connection domain must be a hostname (e.g. ha.example.com) or https URL without path",
    };
  }

  const domain = host.toLowerCase();
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) {
    return {
      ok: false,
      error:
        "Connection domain must have at least two labels (e.g. ha.example.com)",
    };
  }
  return { ok: true, domain };
};

const isNonPublicRoutableHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".localhost")) {
    return true;
  }
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const octets = [m[1], m[2], m[3], m[4]].map((x) => Number(x));
  if (octets.some((n) => n > 255)) return true;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

/**
 * POST /api/apps/{provider}/connect
 *
 * Submit API key credentials for an api_key type connection.
 * Stores the first field value as `access_token` so the gateway picks it up
 * (except Bedrock / Home Assistant, which use a named token field).
 */
export const POST = async (request: NextRequest, { params }: Params) => {
  try {
    const auth = await resolveApiAuth(request);
    if (!auth) return unauthorized();

    const { provider } = await params;
    const app = getApp(provider);

    if (!app || !app.available || app.connectionMethod.type !== "api_key") {
      return NextResponse.json(
        {
          error: `Provider "${provider}" does not support API key connections`,
        },
        { status: 400 },
      );
    }

    const body = (await request.json()) as {
      fields?: Record<string, string>;
      connectionId?: string;
    };
    if (!body.fields) {
      return NextResponse.json(
        { error: "Missing fields in request body" },
        { status: 400 },
      );
    }

    const isOptionalField = (name: string) =>
      (provider === "bedrock" &&
        (name === "anthropicDefaultSonnetModel" ||
          name === "anthropicDefaultOpusModel" ||
          name === "anthropicDefaultHaikuModel")) ||
      (provider === "home-assistant" && name === "originUrl");

    for (const field of app.connectionMethod.fields) {
      if (isOptionalField(field.name)) continue;
      if (!body.fields[field.name]?.trim()) {
        return NextResponse.json(
          { error: `${field.label} is required` },
          { status: 400 },
        );
      }
    }

    if (provider === "bedrock") {
      const anthropicSecret = await db.secret.findFirst({
        where: { accountId: auth.accountId, type: "anthropic" },
        select: { id: true },
      });
      if (anthropicSecret) {
        return NextResponse.json(
          {
            error:
              "Bedrock and Anthropic are mutually exclusive. Remove your Anthropic secret before connecting Bedrock.",
          },
          { status: 400 },
        );
      }
    }

    let connectionMetadata: Record<string, unknown> | undefined;
    let credentials: Record<string, unknown>;
    const connectionOptions =
      (): { metadata?: Record<string, unknown> } | undefined =>
        connectionMetadata !== undefined
          ? { metadata: connectionMetadata }
          : undefined;

    if (provider === "home-assistant") {
      const domainResult = normalizeConnectionDomain(
        body.fields.connectionDomain ?? "",
      );
      if (!domainResult.ok) {
        return NextResponse.json({ error: domainResult.error }, { status: 400 });
      }
      const accessToken = body.fields.accessToken!.trim();
      connectionMetadata = {
        connection_domain: domainResult.domain,
      };

      const originRaw = body.fields.originUrl?.trim();
      if (originRaw) {
        let origin: URL;
        try {
          origin = new URL(originRaw);
        } catch {
          return NextResponse.json(
            { error: "Origin URL must be a valid http(s) URL" },
            { status: 400 },
          );
        }
        if (origin.protocol !== "http:" && origin.protocol !== "https:") {
          return NextResponse.json(
            { error: "Origin URL must use http or https" },
            { status: 400 },
          );
        }
        if (!isNonPublicRoutableHost(origin.hostname)) {
          const probe = new URL("/api/", origin);
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 12_000);
          try {
            const probeRes = await fetch(probe, {
              method: "GET",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              signal: ctrl.signal,
            });
            if (!probeRes.ok) {
              return NextResponse.json(
                {
                  error: `Home Assistant did not accept the token (HTTP ${probeRes.status} from ${probe.href}).`,
                },
                { status: 400 },
              );
            }
          } catch {
            return NextResponse.json(
              {
                error:
                  "Could not reach Home Assistant at the origin URL. Skip origin URL for LAN-only instances.",
              },
              { status: 400 },
            );
          } finally {
            clearTimeout(t);
          }
        }
      }

      credentials = {
        access_token: accessToken,
        ...body.fields,
      };
    } else {
      const accessTokenField =
        provider === "bedrock"
          ? (() => {
              for (const f of app.connectionMethod.fields) {
                if (f.name === "apiKey") return f;
              }
              return app.connectionMethod.fields[0];
            })()
          : app.connectionMethod.fields[0];
      credentials = {
        access_token: body.fields[accessTokenField!.name],
        ...body.fields,
      };
    }

    if (body.connectionId) {
      await reconnectConnection(
        auth.accountId,
        body.connectionId,
        credentials,
        connectionOptions(),
      );
    } else {
      const existing = await listConnectionsByProvider(
        auth.accountId,
        provider,
      );
      if (existing.length > 0) {
        await reconnectConnection(
          auth.accountId,
          existing[0]!.id,
          credentials,
          connectionOptions(),
        );
      } else {
        await createConnection(
          auth.accountId,
          provider,
          credentials,
          connectionOptions(),
        );
      }
    }
    invalidateGatewayCache(request);

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleServiceError(err);
  }
};
