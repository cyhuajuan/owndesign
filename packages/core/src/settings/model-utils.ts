export type ModelProvider = 'deepseek' | 'openai-compatible' | 'anthropic';
export type DeepSeekThinkingMode = 'disabled' | 'high' | 'max';
export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const DEEPSEEK_CONTEXT_SIZE_K = 1000;
export const DEFAULT_OPENAI_COMPATIBLE_CONTEXT_SIZE_K = 200;
export const DEEPSEEK_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'] as const;
export const DEFAULT_DEEPSEEK_MODEL = DEEPSEEK_MODELS[0];
