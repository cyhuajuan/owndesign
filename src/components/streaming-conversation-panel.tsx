"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import {
  AlertCircleIcon,
  BrainCircuitIcon,
  Loader2Icon,
  WrenchIcon,
} from "lucide-react";
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
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";

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
                  <MessageParts message={message} />
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

export function MessageParts({ message }: { message: UIMessage }) {
  return (
    <>
      {message.parts.map((part, index) => (
        <MessagePart
          key={`${message.id}-${index}-${part.type}`}
          part={part}
        />
      ))}
    </>
  );
}

function MessagePart({ part }: { part: UIMessage["parts"][number] }) {
  if (part.type === "text") {
    return <MessageResponse>{part.text}</MessageResponse>;
  }

  if (part.type === "reasoning") {
    return <ReasoningPart text={part.text} state={part.state} />;
  }

  if (isToolPart(part)) {
    return <GenericToolPart part={part} />;
  }

  return null;
}

function ReasoningPart({
  state,
  text,
}: {
  state?: "done" | "streaming";
  text: string;
}) {
  return (
    <details className="rounded-md border border-border bg-background px-3 py-2 text-sm" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-muted-foreground">
        <BrainCircuitIcon className="size-4" />
        思考过程
        {state === "streaming" ? (
          <Loader2Icon className="size-3 animate-spin" />
        ) : null}
      </summary>
      <div className="mt-2 text-muted-foreground">
        <MessageResponse>{text}</MessageResponse>
      </div>
    </details>
  );
}

function GenericToolPart({ part }: { part: ToolLikePart }) {
  const toolName = getToolName(part);
  const input = getObject(part.input);
  const output = getObject(part.output);
  const inputPath = typeof input?.path === "string" ? input.path : undefined;
  const outputPath = typeof output?.path === "string" ? output.path : undefined;
  const path = outputPath ?? inputPath;
  const entries = Array.isArray(output?.entries) ? output.entries.length : undefined;
  const matches = Array.isArray(output?.matches) ? output.matches.length : undefined;

  return (
    <div className="rounded-md border border-border bg-background p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <WrenchIcon className="size-4" />
          {toolName}
        </div>
        <Badge variant={part.state === "output-error" ? "destructive" : "outline"}>
          {getToolStateLabel(part.state)}
        </Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-muted-foreground">
        {path ? (
          <div className="grid gap-1">
            <dt>路径</dt>
            <dd className="truncate font-mono text-xs">{path}</dd>
          </div>
        ) : null}
        {entries !== undefined ? (
          <div className="flex items-center justify-between gap-3">
            <dt>条目数</dt>
            <dd className="font-mono text-xs">{entries}</dd>
          </div>
        ) : null}
        {matches !== undefined ? (
          <div className="flex items-center justify-between gap-3">
            <dt>匹配数</dt>
            <dd className="font-mono text-xs">{matches}</dd>
          </div>
        ) : null}
        {part.state === "output-error" && "errorText" in part ? (
          <div className="grid gap-1 text-destructive">
            <dt>错误</dt>
            <dd>{part.errorText}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function getToolStateLabel(state: ToolLikePart["state"]) {
  const labels: Record<ToolLikePart["state"], string> = {
    "approval-requested": "等待批准",
    "approval-responded": "已批准",
    "input-available": "准备调用",
    "input-streaming": "生成参数中",
    "output-available": "已完成",
    "output-denied": "已拒绝",
    "output-error": "失败",
  };

  return labels[state] ?? state;
}

function isProjectWorkspaceMutationToolPart(part: unknown): part is ToolLikePart {
  return (
    isToolPart(part) &&
    ["deletePath", "editFile", "writeFile"].includes(getToolName(part))
  );
}

function isToolPart(part: unknown): part is ToolLikePart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    typeof part.type === "string" &&
    (part.type.startsWith("tool-") || part.type === "dynamic-tool") &&
    "state" in part &&
    typeof part.state === "string" &&
    "toolCallId" in part &&
    typeof part.toolCallId === "string"
  );
}

function getObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function getToolName(part: ToolLikePart) {
  return typeof part.toolName === "string"
    ? part.toolName
    : part.type.replace(/^tool-/, "");
}

type ToolLikePart = {
  errorText?: string;
  input?: unknown;
  output?: unknown;
  state:
    | "approval-requested"
    | "approval-responded"
    | "input-available"
    | "input-streaming"
    | "output-available"
    | "output-denied"
    | "output-error";
  toolCallId: string;
  toolName?: string;
  type: string;
};
