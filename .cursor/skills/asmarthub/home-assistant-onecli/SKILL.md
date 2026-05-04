---
name: asmarthub-home-assistant-onecli
description: >-
  Re-implements or audits the OneCLI Home Assistant app connection (REST API
  Bearer token, connection-domain hostname matching, gateway injection).
  Use when the user mentions Home Assistant, HA REST, Asmarthub, NanoClaw
  dynamic hosts, or reconnecting HA after refactors; when paths like
  apps/web/src/lib/apps or apps/gateway/src/connect.rs moved; or when adding
  similar self-hosted Bearer apps with configurable DNS suffix matching.
disable-model-invocation: true
---

# Asmarthub — Home Assistant connection (OneCLI)

Portable design notes for this repo (paths may drift — search before editing).

## Goal

- Dashboard: connect **Home Assistant** using the [REST API](https://developers.home-assistant.io/docs/api/rest/) (`Authorization: Bearer <long-lived token>`, JSON).
- Gateway: inject Bearer for requests whose **CONNECT hostname** is the configured **connection domain** or a **DNS subdomain** of it (dynamic hosts from NanoClaw / agents through the gateway; see `docs/nanoclaw-integration.md`).

## Domain matching rule

Store normalized `connection_domain` in `AppConnection.metadata` (e.g. `ha.myorg.com`).

Match request host `h` when:

- `eq_ignore_ascii_case(h, domain)`, or
- `h` ends with `.{domain}` (dot boundary — **not** substring).

Reject trivially bad values in the connect API (e.g. require at least two labels).

## Where to implement (rediscover if missing)

| Concern | Typical locations |
|--------|-------------------|
| App list / OAuth vs API key | `apps/web/src/lib/apps/registry.ts`, `apps/web/src/lib/apps/types.ts` |
| New provider module | `apps/web/src/lib/apps/<provider>.ts` |
| API key POST body | `apps/web/src/app/api/apps/[provider]/connect/route.ts` (see Bedrock-style `access_token` field selection) |
| Encrypted creds + metadata | `apps/web/src/lib/services/connection-service.ts` (`createConnection`, `extractLabel`) |
| CONNECT policy / injection | `apps/gateway/src/connect.rs` (`resolve_app_connections`, `has_account_credentials`, `resolve_connection_injections`) |
| Host → provider registry | `apps/gateway/src/apps.rs` (`APP_PROVIDERS`, `build_app_injection_rules`, `providers_for_host`) |
| Prisma model | `packages/db/prisma/schema.prisma` — `AppConnection` |

## Gateway pattern (self-hosted, no fixed API host)

1. Register provider `home-assistant` with **empty** `host_rules` so `providers_for_host` does not wildcard-match every host.
2. In `resolve_app_connections` (and `has_account_credentials`), **also** include rows where `provider == "home-assistant"` and `host_under_connection_domain(request_host, metadata.connection_domain)`.
3. In `build_app_injection_rules`, branch on `home-assistant`: return one rule — path `*`, `Authorization: Bearer {token}`.

Token resolution already uses `access_token` from decrypted credentials JSON (`resolve_access_token` in `connect.rs`).

## Web / connect API

- Form fields: **connection domain** (hostname only), **long-lived token**; optional **origin URL** for `GET /api/` validation only when the server can reach the host (skip RFC1918 / `.local` — Next.js often cannot see user LAN).
- Persist `metadata.connection_domain` (normalized). Map token into `credentials.access_token` plus any extra fields spread from the form.

## Tests to preserve behavior

- Rust: suffix matcher edge cases; `build_app_injection_rules("home-assistant", ...)`.
- If `apps.rs` tests exist for other providers, mirror the pattern.

## Known limitations

- `provider_for_host_and_path` may still not know HA for 401 copy; failures can fall through to generic `credential_not_found` in `apps/gateway/src/gateway/response.rs`.
- Multiple connections with overlapping domains → use `x-onecli-connection-id` (existing gateway behavior).

## Deeper reference

See [reference.md](reference.md) for checklist and credential shapes.
