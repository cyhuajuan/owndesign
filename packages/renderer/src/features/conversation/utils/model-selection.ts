import type {
  AnthropicEffort,
  DeepSeekThinkingMode,
  PublicModelConfiguration,
  PublicSettings,
} from '@/features/conversation/types';

export const deepSeekThinkingModes = ['disabled', 'high', 'max'] as const;
export const anthropicEfforts = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export function getDeepSeekThinkingMode(configuration: {
  providerOptions?: PublicModelConfiguration['providerOptions'];
}) {
  return configuration.providerOptions?.deepseek?.thinkingMode ?? 'high';
}

export function getSelectedModelLabel(
  configuration: PublicModelConfiguration | undefined,
  anthropicEffort?: AnthropicEffort,
  fallback = '',
) {
  if (!configuration) {
    return fallback;
  }

  if (configuration.provider === 'anthropic') {
    return `${configuration.model} · ${anthropicEffort ?? 'high'}`;
  }

  if (configuration.provider !== 'deepseek') {
    return configuration.model;
  }

  return `${configuration.model} · ${getDeepSeekThinkingMode(configuration)}`;
}

export function updateDefaultModel(
  settings: PublicSettings,
  defaultModelId: string,
  thinkingMode?: DeepSeekThinkingMode,
): PublicSettings {
  return {
    ...settings,
    defaultModelId,
    modelConfigurations: settings.modelConfigurations.map((configuration) =>
      configuration.id === defaultModelId && configuration.provider === 'deepseek' && thinkingMode
        ? {
            ...configuration,
            providerOptions: {
              deepseek: { thinkingMode },
            },
          }
        : configuration,
    ),
  };
}
