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
    ],
  },
  available: true,
};
