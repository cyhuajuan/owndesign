"use client";

import type { UIMessage } from "ai";

import { Shimmer } from "@/components/ai-elements/shimmer";
import { MessageResponse } from "@/components/ai-elements/message";
import {
  isToolPart,
  ToolPartView,
} from "@/features/conversation/components/tool-part-view";
import { getOriginalUserPrompt } from "@owndesign/core/conversations/chat-messages";
import { useI18n } from "@/features/i18n/context";

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
  const originalUserPrompt = message.role === "user"
    ? getOriginalUserPrompt(message)
    : undefined;
  const streamingReasoningPartIndex =
    isLastMessage && isStreaming && lastPart?.type === "reasoning"
      ? message.parts.length - 1
      : -1;
  const useStreamingText =
    isLastMessage && isStreaming && message.role === "assistant";

  return (
    <>
      {originalUserPrompt ? (
        <PlainTextResponse>{originalUserPrompt}</PlainTextResponse>
      ) : null}
      {message.parts.map((part, index) => (
        originalUserPrompt && part.type === "text" ? null :
        <MessagePart
          key={`${message.id}-${index}-${part.type}`}
          isReasoningStreaming={index === streamingReasoningPartIndex}
          role={message.role}
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
  role,
  useStreamingText,
}: {
  isReasoningStreaming: boolean;
  part: UIMessage["parts"][number];
  role: UIMessage["role"];
  useStreamingText: boolean;
}) {
  if (part.type === "text") {
    if (role === "user") {
      return <PlainTextResponse>{part.text}</PlainTextResponse>;
    }

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
  const { t } = useI18n();

  return (
    <div className="w-full font-medium text-muted-foreground text-sm">
      <Shimmer as="span">{t("conversation.thinking")}</Shimmer>
    </div>
  );
}

function PlainTextResponse({ children }: { children: string }) {
  return (
    <div className="size-full whitespace-pre-wrap break-words">
      {children}
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
