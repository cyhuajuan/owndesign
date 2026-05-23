import type { PublicAppSettings } from "@/server/settings/settings-service";

export type PublicSettings = PublicAppSettings;

export type DeepSeekThinkingMode =
  NonNullable<
    PublicSettings["modelConfigurations"][number]["providerOptions"]
  >["deepseek"] extends { thinkingMode: infer Mode }
    ? Mode
    : "disabled" | "high" | "max";

export type PublicModelConfiguration =
  PublicSettings["modelConfigurations"][number];

export type ContextUsageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};
