"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  DefaultChatTransport,
  getToolName as getAIMessageToolName,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
} from "ai";
import { AlertCircleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";

type StreamingConversationPanelProps = {
  conversationId: string;
  initialMessages: UIMessage[];
  projectId: string;
};

export function StreamingConversationPanel({
  conversationId,
  initialMessages,
  projectId,
}: StreamingConversationPanelProps) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          conversationId,
          projectId,
        },
      }),
    [conversationId, projectId],
  );
  const { error, messages, sendMessage, status } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
  });
  const announcedToolOutputs = useRef(new Set<string>());
  const isGenerating = status === "submitted" || status === "streaming";

  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          !isProjectWorkspaceMutationToolPart(part) ||
          part.state !== "output-available"
        ) {
          continue;
        }

        if (announcedToolOutputs.current.has(part.toolCallId)) {
          continue;
        }

        announcedToolOutputs.current.add(part.toolCallId);
        window.dispatchEvent(
          new CustomEvent("hjdesign:project-output-updated", {
            detail: { projectId },
          }),
        );
      }
    }
  }, [messages, projectId]);

  return (
    <>
      <Conversation className="min-h-0">
        <ConversationContent className="gap-2 p-4">
          {messages.length === 0 ? (
            <ConversationEmptyState
              description="发送第一条消息后，会自动生成会话标题。"
              title="暂无消息"
            />
          ) : (
            messages.map((message, index) => (
              <Message from={message.role} key={`${message.id || "message"}-${index}`}>
                <MessageContent>
                  <MessageParts
                    isLastMessage={index === messages.length - 1}
                    isStreaming={status === "streaming"}
                    message={message}
                  />
                </MessageContent>
              </Message>
            ))
          )}
          {error ? (
            <Message from="assistant">
              <MessageContent>
                <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
                  <AlertCircleIcon className="size-4 shrink-0" />
                  <span>生成失败：{error.message}</span>
                </div>
              </MessageContent>
            </Message>
          ) : null}
        </ConversationContent>
      </Conversation>

      <div className="border-t border-border bg-card px-3 pb-3">
        <PromptInput
          className="pt-3"
          onSubmit={async ({ text }) => {
            const trimmedText = text.trim();

            if (!trimmedText || isGenerating) {
              return;
            }

            await sendMessage({ text: trimmedText });
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              className="min-h-13 text-[13px]"
              disabled={isGenerating}
              placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            />
          </PromptInputBody>
          <PromptInputFooter className="justify-end px-2 pb-1">
            <PromptInputTools />
            <PromptInputSubmit
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={isGenerating}
              status={status}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  );
}

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

function ToolPartView({ part }: { part: ToolLikePart }) {
  return (
    <Tool className="mb-0 bg-background text-sm" defaultOpen={false}>
      {part.type === "dynamic-tool" ? (
        <ToolHeader
          state={part.state}
          toolName={part.toolName}
          type={part.type}
        />
      ) : (
        <ToolHeader state={part.state} type={part.type} />
      )}
      <ToolContent>
        <ToolInput input={part.input} />
        {part.output !== undefined || part.errorText ? (
          <ToolOutput errorText={part.errorText} output={part.output} />
        ) : null}
      </ToolContent>
    </Tool>
  );
}

function isProjectWorkspaceMutationToolPart(part: unknown): part is ToolLikePart {
  return isToolPart(part) && ["deletePath", "editFile", "writeFile"].includes(getToolName(part));
}

function isToolPart(part: unknown): part is ToolLikePart {
  return isToolUIPart(part as UIMessage["parts"][number]);
}

function getToolName(part: ToolLikePart) {
  return getAIMessageToolName(part);
}

type ToolLikePart = ToolUIPart | DynamicToolUIPart;
