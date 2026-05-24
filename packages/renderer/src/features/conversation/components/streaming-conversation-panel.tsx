"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { AlertCircleIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { useApiClient } from "@/api/context";
import { getCurrentPreviewPath } from "@/features/preview/preview-path";
import type { ActiveRun, ActiveRunSnapshot } from "@/api/client";

type StreamingConversationPanelProps = {
  conversationId: string;
  conversationTitle: string;
  initialMessages: UIMessage[];
  onConversationUpdate?: (update: ConversationPanelUpdate) => void;
  onProjectRunChange?: (run: ActiveRun | undefined) => void;
  projectActiveRun?: ActiveRun;
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
  onProjectRunChange,
  projectActiveRun,
  projectId,
  titleManuallySet = false,
}: StreamingConversationPanelProps) {
  const api = useApiClient();
  const { handleModelSelect, selectedModel, selectedModelId, settings } =
    useConversationSettings();
  const previousStatusRef = useRef("ready");
  const reconnectState = useMemo(() => ({ afterChunkIndex: 0 }), []);
  const [localSubmitStarted, setLocalSubmitStarted] = useState(false);
  const [resumeSnapshot, setResumeSnapshot] = useState<
    | {
        nextChunkIndex: number;
        runId: string;
      }
    | undefined
  >();
  const selectedDeepSeekThinkingMode =
    selectedModel?.provider === "deepseek"
      ? getDeepSeekThinkingMode(selectedModel)
      : undefined;
  const hasProjectActiveRun = projectActiveRun?.status === "running";
  const activeRunId = projectActiveRun?.runId;
  const activeRunBelongsToConversation =
    hasProjectActiveRun && projectActiveRun.conversationId === conversationId;
  const shouldResumeFromSnapshot =
    activeRunBelongsToConversation &&
    !localSubmitStarted &&
    resumeSnapshot?.runId === activeRunId;
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: api.streamChatUrl(),
        body: () => ({
          conversationId,
          frontendTabId: FRONTEND_TAB_ID,
          modelConfigurationId: selectedModelId,
          previewPath: getCurrentPreviewPath(),
          projectId,
          ...(selectedDeepSeekThinkingMode
            ? {
                providerOptionsSelection: {
                  deepseek: selectedDeepSeekThinkingMode,
                },
              }
            : {}),
        }),
        prepareReconnectToStreamRequest: () => ({
          api: api.streamConversationRunUrl(projectId, conversationId, {
            after: reconnectState.afterChunkIndex,
          }),
        }),
      }),
    [
      conversationId,
      api,
      projectId,
      reconnectState,
      selectedDeepSeekThinkingMode,
      selectedModelId,
    ],
  );
  const { error, messages, sendMessage, setMessages, status, stop } = useChat({
    id: conversationId,
    messages: initialMessages,
    resume: shouldResumeFromSnapshot,
    transport,
    onError: () => {
      void api.getActiveRun(projectId).then(async (response) => {
        if (response.status === 204) {
          onProjectRunChange?.(undefined);
          return;
        }

        if (response.ok) {
          onProjectRunChange?.((await response.json()) as ActiveRun);
        }
      });
      window.dispatchEvent(new Event("owndesign:workspace-refresh"));
    },
  });
  const contextUsage = useMemo(() => getLatestContextUsage(messages), [messages]);
  const isGenerating = status === "submitted" || status === "streaming";
  const isProjectBusy = Boolean(hasProjectActiveRun);
  const canSend = Boolean(selectedModel) && !isGenerating && !isProjectBusy;
  const submitStatus = isProjectBusy && !isGenerating ? "streaming" : status;
  const busyMessage = activeRunBelongsToConversation
    ? "当前会话正在生成，刷新或切换回来会继续显示进度。"
    : "当前项目已有任务正在执行，完成或停止后才能继续输入。";
  const handleStop = useCallback(() => {
    void api.cancelActiveRun(projectId).finally(() => {
      stop();
      setLocalSubmitStarted(false);
      setResumeSnapshot(undefined);
      onProjectRunChange?.(undefined);
      window.dispatchEvent(new Event("owndesign:workspace-refresh"));
    });
  }, [api, onProjectRunChange, projectId, setResumeSnapshot, stop]);

  useEffect(() => {
    if (
      !activeRunBelongsToConversation ||
      !activeRunId ||
      localSubmitStarted
    ) {
      return;
    }

    let isActive = true;

    void api
      .getActiveConversationRunSnapshot(projectId, conversationId)
      .then(async (response) => {
        if (!isActive) {
          return;
        }

        if (response.status === 204) {
          onProjectRunChange?.(undefined);
          return;
        }

        if (!response.ok) {
          return;
        }

        const snapshot = (await response.json()) as ActiveRunSnapshot;

        if (!isActive || snapshot.activeRun.runId !== activeRunId) {
          return;
        }

        reconnectState.afterChunkIndex = snapshot.nextChunkIndex;
        setMessages(snapshot.messages);
        setResumeSnapshot({
          nextChunkIndex: snapshot.nextChunkIndex,
          runId: snapshot.activeRun.runId,
        });
        onProjectRunChange?.(snapshot.activeRun);
      });

    return () => {
      isActive = false;
    };
  }, [
    activeRunBelongsToConversation,
    activeRunId,
    api,
    conversationId,
    localSubmitStarted,
    onProjectRunChange,
    projectId,
    reconnectState,
    setMessages,
  ]);

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
      setLocalSubmitStarted(false);
      setResumeSnapshot(undefined);
      onProjectRunChange?.(undefined);
      window.dispatchEvent(new Event("owndesign:workspace-refresh"));
    }

    previousStatusRef.current = status;
  }, [
    conversationId,
    conversationTitle,
    initialMessages,
    messages,
    onConversationUpdate,
    onProjectRunChange,
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
            messages.map((message, index) => {
              const isLastMessage = index === messages.length - 1;

              return (
                <ConversationMessageItem
                  isLastMessage={isLastMessage}
                  isStreaming={status === "streaming" && isLastMessage}
                  key={getMessageKey(message, index)}
                  message={message}
                />
              );
            })
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
        {isProjectBusy ? (
          <div className="mt-3 rounded-md border border-border bg-muted px-3 py-2 text-muted-foreground text-sm">
            {busyMessage}
          </div>
        ) : null}
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

            setLocalSubmitStarted(true);
            onProjectRunChange?.({
              chunkCount: 0,
              conversationId,
              createdAt: new Date().toISOString(),
              projectId,
              runId: "pending",
              status: "running",
            });
            await sendMessage({ files, text: trimmedText });
          }}
        >
          <PromptInputHeader>
            <PromptInputAttachments />
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea
              className="min-h-13 text-[13px]"
              disabled={isGenerating || isProjectBusy}
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
                onStop={handleStop}
                status={submitStatus}
              />
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  );
}

const ConversationMessageItem = memo(
  function ConversationMessageItem({
    isLastMessage,
    isStreaming,
    message,
  }: {
    isLastMessage: boolean;
    isStreaming: boolean;
    message: UIMessage;
  }) {
    return (
      <Message from={message.role}>
        <MessageContent
          className={message.role === "assistant" ? "w-full" : undefined}
        >
          <MessageParts
            isLastMessage={isLastMessage}
            isStreaming={isStreaming}
            message={message}
          />
        </MessageContent>
      </Message>
    );
  },
  (previousProps, nextProps) =>
    previousProps.message === nextProps.message &&
    previousProps.isLastMessage === nextProps.isLastMessage &&
    previousProps.isStreaming === nextProps.isStreaming,
);

function getMessageKey(message: UIMessage, index: number) {
  return message.id || `message-${index}`;
}

export { MessageParts } from "@/features/conversation/components/message-parts";
