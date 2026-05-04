# Reference — Home Assistant × OneCLI

## Credential / metadata shape (illustrative)

**metadata (non-secret):**

```json
{
  "connection_domain": "ha.example.com"
}
```

**credentials (encrypted JSON):**

```json
{
  "access_token": "<long-lived token>",
  "connectionDomain": "<optional duplicate for debugging; prefer metadata>"
}
```

Prefer single source of truth: `connection_domain` only in metadata for gateway matching.

## Implementation checklist

- [ ] `AppDefinition` `id: "home-assistant"`, `connectionMethod.type: "api_key"`, fields for domain + token
- [ ] Icon `apps/web/public/icons/home-assistant.svg`
- [ ] `registry.ts` export
- [ ] `connect/route.ts`: validation, `access_token` mapping, `createConnection`/`reconnectConnection` with metadata
- [ ] Gateway `apps.rs`: provider + `build_app_injection_rules`
- [ ] Gateway `connect.rs`: domain suffix filter + tests
- [ ] Optional: audit on API connect per project rules

## HA REST (summary)

- Base: `https://<host>:8123/api/`
- Health: `GET /api/` (trailing slash required per docs)
- Auth: `Authorization: Bearer <token>`, `Content-Type: application/json`

Official: https://developers.home-assistant.io/docs/api/rest/
