'use client';

import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from '@/components/ai-elements/context';
import type { ContextUsageMetadata, PublicModelConfiguration } from '@/features/conversation/types';
import { getModelContextSizeK, getUsedTokens } from '@/features/conversation/utils/context-usage';

export function ModelContextUsage({
  configuration,
  usage,
}: {
  configuration?: PublicModelConfiguration;
  usage?: ContextUsageMetadata;
}) {
  if (!configuration) {
    return null;
  }

  const maxTokens = getModelContextSizeK(configuration) * 1000;
  const usedTokens = getUsedTokens(usage);

  return (
    <Context
      maxTokens={maxTokens}
      usage={{
        cachedInputTokens: usage?.cachedInputTokens,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        reasoningTokens: usage?.reasoningTokens,
        totalTokens: usage?.totalTokens,
      }}
      usedTokens={usedTokens}
    >
      <ContextTrigger />
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBody>
          <ContextInputUsage />
          <ContextOutputUsage />
          <ContextReasoningUsage />
          <ContextCacheUsage />
        </ContextContentBody>
        <ContextContentFooter />
      </ContextContent>
    </Context>
  );
}
