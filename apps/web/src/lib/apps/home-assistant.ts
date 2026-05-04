import type { AppDefinition } from "./types";

export const homeAssistant: AppDefinition = {
  id: "home-assistant",
  name: "Home Assistant",
  icon: "/icons/home-assistant.svg",
  description:
    "Control and query Home Assistant via its REST API using a long-lived access token. Requests must use a hostname under your configured connection domain (for dynamic agent/gateway hosts).",
  connectionMethod: {
    type: "api_key",
    fields: [
      {
        name: "connectionDomain",
        label: "Connection domain",
        description:
          "DNS name you control (e.g. ha.example.com). The gateway injects credentials when the request host equals this domain or is a subdomain of it.",
        placeholder: "ha.example.com",
      },
      {
        name: "accessToken",
        label: "Long-lived access token",
        description:
          "From Home Assistant: Profile → Security → Long-lived access tokens. See Home Assistant REST API docs.",
        placeholder: "Your token",
      },
      {
        name: "originUrl",
        label: "Origin URL (optional)",
        description:
          "Full base URL (e.g. https://ha.example.com:8123) used only to verify the token when this server can reach your instance. Skipped for .local and private IPs.",
        placeholder: "https://…",
      },
    ],
  },
  available: true,
};
