"use client";

import type { UIMessage } from "ai";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  isToolPart,
  ToolPartView,
} from "@/features/conversation/components/tool-part-view";

export function MessageParts({
  isLastMessage = false,
  isStreaming = false,
  message,
}: {
  isLastMessage?: boolean;
  isStreaming?: boolean;
  message: UIMessage;
}) {
  const lastPart = message.parts.at(-1);
  const streamingReasoningPartIndex =
    isLastMessage && isStreaming && lastPart?.type === "reasoning"
      ? message.parts.length - 1
      : -1;
  const useStreamingText =
    isLastMessage && isStreaming && message.role === "assistant";

  return (
    <>
      {message.parts.map((part, index) => (
        <MessagePart
          key={`${message.id}-${index}-${part.type}`}
          isReasoningStreaming={index === streamingReasoningPartIndex}
          useStreamingText={useStreamingText}
          part={part}
        />
      ))}
    </>
  );
}

function MessagePart({
  isReasoningStreaming,
  part,
  useStreamingText,
}: {
  isReasoningStreaming: boolean;
  part: UIMessage["parts"][number];
  useStreamingText: boolean;
}) {
  if (part.type === "text") {
    if (useStreamingText) {
      return <StreamingTextResponse>{part.text}</StreamingTextResponse>;
    }

    return <MessageResponse>{part.text}</MessageResponse>;
  }

  if (part.type === "reasoning") {
    return isReasoningStreaming ? <ReasoningPendingIndicator /> : null;
  }

  if (isToolPart(part)) {
    return <ToolPartView part={part} />;
  }

  return null;
}

function ReasoningPendingIndicator() {
  return (
    <div className="w-full rounded-md border border-border bg-background px-3 py-2 font-medium text-muted-foreground text-sm">
      <Shimmer as="span">正在思考</Shimmer>
    </div>
  );
}

function StreamingTextResponse({ children }: { children: string }) {
  return (
    <div
      className="size-full whitespace-pre-wrap break-words"
      data-streaming-text="true"
    >
      {children}
    </div>
  );
}
