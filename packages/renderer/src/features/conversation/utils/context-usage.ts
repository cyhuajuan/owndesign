import type { UIMessage } from "ai";

import type {
  ContextUsageMetadata,
  PublicModelConfiguration,
} from "@/features/conversation/types";

export function getModelContextSizeK(configuration: PublicModelConfiguration) {
  if (typeof configuration.contextSizeK === "number") {
    return configuration.contextSizeK;
  }

  return configuration.provider === "deepseek" ? 1000 : 200;
}

export function getLatestContextUsage(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== "assistant") {
      continue;
    }

    const usage = getContextUsageFromMetadata(message.metadata);

    if (usage) {
      return usage;
    }
  }

  return undefined;
}

export function getContextUsageFromMetadata(
  metadata: UIMessage["metadata"],
): ContextUsageMetadata | undefined {
  if (!isRecord(metadata) || !isRecord(metadata.contextUsage)) {
    return undefined;
  }

  return {
    cachedInputTokens: asOptionalNumber(metadata.contextUsage.cachedInputTokens),
    inputTokens: asOptionalNumber(metadata.contextUsage.inputTokens),
    outputTokens: asOptionalNumber(metadata.contextUsage.outputTokens),
    reasoningTokens: asOptionalNumber(metadata.contextUsage.reasoningTokens),
    totalTokens: asOptionalNumber(metadata.contextUsage.totalTokens),
  };
}

export function getUsedTokens(usage: ContextUsageMetadata | undefined) {
  if (!usage) {
    return 0;
  }

  return (
    usage.totalTokens ??
    addOptionalNumbers(usage.inputTokens, usage.outputTokens) ??
    0
  );
}

function addOptionalNumbers(
  first: number | undefined,
  second: number | undefined,
) {
  return first === undefined && second === undefined
    ? undefined
    : (first ?? 0) + (second ?? 0);
}

function asOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
