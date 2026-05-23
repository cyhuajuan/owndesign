"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { AlertCircleIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { MessageParts } from "@/features/conversation/components/message-parts";
import { ModelContextUsage } from "@/features/conversation/components/model-context-usage";
import { ModelSelect } from "@/features/conversation/components/model-select";
import { PromptAttachmentControls } from "@/features/conversation/components/prompt-attachment-controls";
import { useConversationSettings } from "@/features/conversation/hooks/use-conversation-settings";
import { getLatestContextUsage } from "@/features/conversation/utils/context-usage";
import { deriveConversationTitle } from "@/features/conversation/utils/conversation-title";
import { getDeepSeekThinkingMode } from "@/features/conversation/utils/model-selection";
import { FRONTEND_TAB_ID } from "@/features/preview/components/frontend-capability-bridge";

type StreamingConversationPanelProps = {
  conversationId: string;
  conversationTitle: string;
  initialMessages: UIMessage[];
  onConversationUpdate?: (update: ConversationPanelUpdate) => void;
  projectId: string;
  titleManuallySet?: boolean;
};

export type ConversationPanelUpdate = {
  id: string;
  lastMessageAt: string;
  messages: UIMessage[];
  title: string;
  updatedAt: string;
};


export function StreamingConversationPanel({
  conversationId,
  conversationTitle,
  initialMessages,
  onConversationUpdate,
  projectId,
  titleManuallySet = false,
}: StreamingConversationPanelProps) {
  const searchParams = useSearchParams();
  const selectedPreviewPath = searchParams.get("previewPath") ?? undefined;
  const { handleModelSelect, selectedModel, selectedModelId, settings } =
    useConversationSettings();
  const previousStatusRef = useRef("ready");
  const selectedDeepSeekThinkingMode =
    selectedModel?.provider === "deepseek"
      ? getDeepSeekThinkingMode(selectedModel)
      : undefined;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: {
          conversationId,
          frontendTabId: FRONTEND_TAB_ID,
          modelConfigurationId: selectedModelId,
          previewPath: selectedPreviewPath,
          projectId,
          ...(selectedDeepSeekThinkingMode
            ? {
                providerOptionsSelection: {
                  deepseek: selectedDeepSeekThinkingMode,
                },
              }
            : {}),
        },
      }),
    [
      conversationId,
      projectId,
      selectedDeepSeekThinkingMode,
      selectedModelId,
      selectedPreviewPath,
    ],
  );
  const { error, messages, sendMessage, status, stop } = useChat({
    id: conversationId,
    messages: initialMessages,
    transport,
  });
  const contextUsage = useMemo(() => getLatestContextUsage(messages), [messages]);
  const isGenerating = status === "submitted" || status === "streaming";
  const canSend = Boolean(selectedModel) && !isGenerating;

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    const wasGenerating =
      previousStatus === "submitted" || previousStatus === "streaming";

    if (wasGenerating && status === "ready") {
      const timestamp = new Date().toISOString();

      onConversationUpdate?.({
        id: conversationId,
        lastMessageAt: timestamp,
        messages,
        title: deriveConversationTitle({
          conversationTitle,
          initialMessages,
          messages,
          titleManuallySet,
        }),
        updatedAt: timestamp,
      });
    }

    previousStatusRef.current = status;
  }, [
    conversationId,
    conversationTitle,
    initialMessages,
    messages,
    onConversationUpdate,
    status,
    titleManuallySet,
  ]);

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
                <MessageContent
                  className={message.role === "assistant" ? "w-full" : undefined}
                >
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
              <MessageContent className="w-full">
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
          maxFileSize={10 * 1024 * 1024}
          maxFiles={8}
          multiple
          onSubmit={async ({ files, text }) => {
            const trimmedText = text.trim();

            if ((!trimmedText && files.length === 0) || !canSend) {
              return;
            }

            await sendMessage({ files, text: trimmedText });
          }}
        >
          <PromptInputHeader>
            <PromptInputAttachments />
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea
              className="min-h-13 text-[13px]"
              disabled={isGenerating}
              placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            />
          </PromptInputBody>
          <PromptInputFooter className="px-2 pb-1">
            <PromptAttachmentControls selectedModel={selectedModel} />
            <div className="flex min-w-0 items-center gap-1">
              <ModelContextUsage
                configuration={selectedModel}
                usage={contextUsage}
              />
              <ModelSelect
                onSelect={handleModelSelect}
                selectedModelId={selectedModelId}
                settings={settings}
              />
              <PromptInputSubmit
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={!selectedModel}
                onStop={stop}
                status={status}
              />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  );
}

export { MessageParts } from "@/features/conversation/components/message-parts";
