import type { PublicAppSettings } from '@owndesign/core/settings/settings-service';
import type { AnthropicEffort as CoreAnthropicEffort } from '@owndesign/core/settings/model-utils';

export type PublicSettings = PublicAppSettings;

export type DeepSeekThinkingMode = NonNullable<
  PublicSettings['modelConfigurations'][number]['providerOptions']
>['deepseek'] extends { thinkingMode: infer Mode }
  ? Mode
  : 'disabled' | 'high' | 'max';

export type PublicModelConfiguration = PublicSettings['modelConfigurations'][number];

export type AnthropicEffort = CoreAnthropicEffort;

export type ContextUsageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};
