"use client";

import type { UIMessage } from "ai";
import type { ReactNode } from "react";

import { MessageResponse } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
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

  return (
    <>
      {message.parts.map((part, index) => (
        <MessagePart
          key={`${message.id}-${index}-${part.type}`}
          isReasoningStreaming={index === streamingReasoningPartIndex}
          part={part}
        />
      ))}
    </>
  );
}

function MessagePart({
  isReasoningStreaming,
  part,
}: {
  isReasoningStreaming: boolean;
  part: UIMessage["parts"][number];
}) {
  if (part.type === "text") {
    return <MessageResponse>{part.text}</MessageResponse>;
  }

  if (part.type === "reasoning") {
    return (
      <Reasoning
        className="w-full rounded-md border border-border bg-background px-3 py-2"
        isStreaming={isReasoningStreaming}
      >
        <ReasoningTrigger
          className="font-medium"
          getThinkingMessage={getReasoningLabel}
        />
        <ReasoningContent className="mt-2">{part.text}</ReasoningContent>
      </Reasoning>
    );
  }

  if (isToolPart(part)) {
    return <ToolPartView part={part} />;
  }

  return null;
}

function getReasoningLabel(): ReactNode {
  return <span>思考过程</span>;
}
