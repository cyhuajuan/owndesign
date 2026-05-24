import {
  DEEPSEEK_MODELS,
  type ModelProvider,
} from "@owndesign/core/server/settings/model-utils";

export {
  DEEPSEEK_CONTEXT_SIZE_K,
  DEEPSEEK_MODELS,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_OPENAI_COMPATIBLE_CONTEXT_SIZE_K,
  type DeepSeekThinkingMode,
  type ModelProvider,
} from "@owndesign/core/server/settings/model-utils";

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
