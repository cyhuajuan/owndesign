export type ModelProvider = "deepseek" | "openai-compatible";
export type DeepSeekThinkingMode = "disabled" | "high" | "max";

export const DEEPSEEK_CONTEXT_SIZE_K = 1000;
export const DEFAULT_OPENAI_COMPATIBLE_CONTEXT_SIZE_K = 200;
export const DEEPSEEK_MODELS = [
  "deepseek-v4-flash",
  "deepseek-v4-pro",
] as const;
export const DEFAULT_DEEPSEEK_MODEL = DEEPSEEK_MODELS[0];

export function getProviderLabel(provider: ModelProvider | "") {
  if (provider === "deepseek") {
    return "DeepSeek";
  }

  if (provider === "openai-compatible") {
    return "OpenAI Compatible";
  }

  return "";
}

export function getBaseUrlPlaceholder(provider: ModelProvider | "") {
  if (provider === "deepseek") {
    return "https://api.deepseek.com";
  }

  return "";
}

export function isDeepSeekModel(
  model: string,
): model is (typeof DEEPSEEK_MODELS)[number] {
  return DEEPSEEK_MODELS.includes(
    model as (typeof DEEPSEEK_MODELS)[number],
  );
}
