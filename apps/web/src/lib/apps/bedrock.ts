import type { AppDefinition } from "./types";

/**
 * Amazon Bedrock API keys use `Authorization: Bearer` on regional Bedrock Runtime
 * hosts. See https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html
 */
export const bedrock: AppDefinition = {
  id: "bedrock",
  name: "Amazon Bedrock",
  icon: "/icons/bedrock.svg",
  description:
    "Bedrock Runtime API keys for models on bedrock-runtime.<region>.amazonaws.com. Not valid for all Bedrock APIs (see AWS docs).",
  connectionMethod: {
    type: "api_key",
    fields: [
      {
        name: "region",
        label: "AWS region",
        description: "The region for Bedrock Runtime (e.g. us-east-1).",
        placeholder: "us-east-1",
      },
      {
        name: "apiKey",
        label: "Bedrock API key",
        description:
          "From the Amazon Bedrock console. Also supported via AWS_BEARER_TOKEN_BEDROCK in containers.",
        placeholder: "Your Bedrock API key",
      },
      {
        name: "anthropicDefaultSonnetModel",
        label: "Default Sonnet model",
        description:
          "Optional: controls the default Sonnet model id used by the agent.",
        placeholder: "us.anthropic.claude-sonnet-4-6",
      },
      {
        name: "anthropicDefaultOpusModel",
        label: "Default Opus model",
        description:
          "Optional: controls the default Opus model id used by the agent.",
        placeholder: "us.anthropic.claude-opus-4-7",
      },
      {
        name: "anthropicDefaultHaikuModel",
        label: "Default Haiku model",
        description:
          "Optional: controls the default Haiku model id used by the agent.",
        placeholder: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      },
    ],
  },
  available: true,
};
