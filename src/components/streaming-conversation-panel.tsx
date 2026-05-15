"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  DefaultChatTransport,
  getToolName as getAIMessageToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type DynamicToolUIPart,
  type ToolUIPart,
} from "ai";
import { AlertCircleIcon, CheckIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";

import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
  ConfirmationTitle,
} from "@/components/ai-elements/confirmation";
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
  const {
    addToolApprovalResponse,
    error,
    messages,
    sendMessage,
    status,
  } = useChat({
    id: conversationId,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
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
                    onToolApprovalResponse={addToolApprovalResponse}
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
  onToolApprovalResponse,
}: {
  isLastMessage?: boolean;
  isStreaming?: boolean;
  message: UIMessage;
  onToolApprovalResponse?: ToolApprovalResponseHandler;
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
          onToolApprovalResponse={onToolApprovalResponse}
          part={part}
        />
      ))}
    </>
  );
}

function MessagePart({
  isReasoningStreaming,
  onToolApprovalResponse,
  part,
}: {
  isReasoningStreaming: boolean;
  onToolApprovalResponse?: ToolApprovalResponseHandler;
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
    return (
      <ToolPartView
        onToolApprovalResponse={onToolApprovalResponse}
        part={part}
      />
    );
  }

  return null;
}

function getReasoningLabel(): ReactNode {
  return <span>思考过程</span>;
}

function ToolPartView({
  onToolApprovalResponse,
  part,
}: {
  onToolApprovalResponse?: ToolApprovalResponseHandler;
  part: ToolLikePart;
}) {
  const approval = getToolApproval(part);

  return (
    <div className="space-y-2">
      {approval ? (
        <CdnApprovalConfirmation
          onToolApprovalResponse={onToolApprovalResponse}
          part={part}
        />
      ) : null}
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
    </div>
  );
}

function CdnApprovalConfirmation({
  onToolApprovalResponse,
  part,
}: {
  onToolApprovalResponse?: ToolApprovalResponseHandler;
  part: ToolLikePart;
}) {
  const approval = getToolApproval(part);

  if (!approval || getToolName(part) !== "addCdnResource") {
    return null;
  }

  const input = getCdnResourceInput(part.input);

  return (
    <Confirmation approval={approval} state={part.state}>
      <ConfirmationTitle>需要批准 CDN 资源</ConfirmationTitle>
      <ConfirmationRequest>
        <span>Agent 想向 index.html 添加外部 CDN。</span>
        <span className="break-all">
          {input.resourceType ?? "resource"}: {input.url ?? "未知 URL"}
        </span>
      </ConfirmationRequest>
      <ConfirmationAccepted className="flex-row items-center text-foreground">
        <CheckIcon className="size-4 text-green-600" />
        <span>已批准 CDN 添加。</span>
      </ConfirmationAccepted>
      <ConfirmationRejected className="flex-row items-center text-foreground">
        <XIcon className="size-4 text-orange-600" />
        <span>已拒绝 CDN 添加。</span>
      </ConfirmationRejected>
      <ConfirmationActions>
        <ConfirmationAction
          disabled={!onToolApprovalResponse}
          onClick={() =>
            onToolApprovalResponse?.({
              approved: false,
              id: approval.id,
              reason: "User denied CDN resource",
            })
          }
          variant="outline"
        >
          拒绝
        </ConfirmationAction>
        <ConfirmationAction
          disabled={!onToolApprovalResponse}
          onClick={() =>
            onToolApprovalResponse?.({
              approved: true,
              id: approval.id,
            })
          }
        >
          批准
        </ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  );
}

function isProjectWorkspaceMutationToolPart(part: unknown): part is ToolLikePart {
  return (
    isToolPart(part) &&
    ["addCdnResource", "deletePath", "editFile", "writeFile"].includes(
      getToolName(part),
    )
  );
}

function isToolPart(part: unknown): part is ToolLikePart {
  return isToolUIPart(part as UIMessage["parts"][number]);
}

function getToolName(part: ToolLikePart) {
  return getAIMessageToolName(part);
}

function getToolApproval(part: ToolLikePart) {
  return "approval" in part ? part.approval : undefined;
}

function getCdnResourceInput(input: ToolLikePart["input"]) {
  if (!input || typeof input !== "object") {
    return {};
  }

  return input as {
    resourceType?: string;
    url?: string;
  };
}

type ToolLikePart = ToolUIPart | DynamicToolUIPart;

type ToolApprovalResponseHandler = (response: {
  approved: boolean;
  id: string;
  reason?: string;
}) => void | PromiseLike<void>;
