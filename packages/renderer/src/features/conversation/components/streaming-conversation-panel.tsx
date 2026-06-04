'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type FileUIPart, type UIMessage } from 'ai';
import { AlertCircleIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';
import { MessageParts } from '@/features/conversation/components/message-parts';
import { ModelContextUsage } from '@/features/conversation/components/model-context-usage';
import { ModelSelect } from '@/features/conversation/components/model-select';
import { PromptAttachmentControls } from '@/features/conversation/components/prompt-attachment-controls';
import { useConversationSettings } from '@/features/conversation/hooks/use-conversation-settings';
import { getLatestContextUsage } from '@/features/conversation/utils/context-usage';
import { deriveConversationTitle } from '@/features/conversation/utils/conversation-title';
import {
  anthropicEfforts,
  getDeepSeekThinkingMode,
} from '@/features/conversation/utils/model-selection';
import { FRONTEND_TAB_ID } from '@/features/preview/components/frontend-capability-bridge';
import { useApiClient } from '@/api/context';
import { useI18n } from '@/features/i18n/context';
import { useCurrentPreviewPath } from '@/features/preview/preview-path';
import type { ActiveRun, ActiveRunSnapshot } from '@/api/client';
import type { AnthropicEffort } from '@/features/conversation/types';
import type { PageEditMode } from '@owndesign/core/agent/page-edit-mode';

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

const PAGE_EDIT_MODE_OPTIONS = [
  { labelKey: 'conversation.pageModeAuto', value: 'auto' },
  { labelKey: 'conversation.pageModeNewPage', value: 'new_page' },
  { labelKey: 'conversation.pageModeDirectEdit', value: 'direct_edit' },
  { labelKey: 'conversation.pageModeDuplicateEdit', value: 'duplicate_edit' },
] satisfies Array<{
  labelKey:
    | 'conversation.pageModeAuto'
    | 'conversation.pageModeNewPage'
    | 'conversation.pageModeDirectEdit'
    | 'conversation.pageModeDuplicateEdit';
  value: PageEditMode;
}>;

const ANTHROPIC_EFFORT_STORAGE_KEY = 'owndesign:anthropic-efforts';

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
  const { t } = useI18n();
  const { handleModelSelect, selectedModel, selectedModelId, settings } = useConversationSettings();
  const previousStatusRef = useRef('ready');
  const reconnectState = useMemo(() => ({ afterChunkIndex: 0 }), []);
  const [localSubmitStarted, setLocalSubmitStarted] = useState(false);
  const [pageEditMode, setPageEditMode] = useState<PageEditMode>('auto');
  const [selectedAnthropicEffort, setSelectedAnthropicEffort] = useState<AnthropicEffort>('high');
  const [resumeSnapshot, setResumeSnapshot] = useState<
    | {
        nextChunkIndex: number;
        runId: string;
      }
    | undefined
  >();
  const selectedDeepSeekThinkingMode =
    selectedModel?.provider === 'deepseek' ? getDeepSeekThinkingMode(selectedModel) : undefined;
  const handleAnthropicEffortSelect = useCallback((modelId: string, effort: AnthropicEffort) => {
    setSelectedAnthropicEffort(effort);
    saveStoredAnthropicEffort(modelId, effort);
  }, []);
  const selectedProviderOptionsSelection = useMemo(() => {
    if (selectedModel?.provider === 'anthropic') {
      return { anthropic: selectedAnthropicEffort };
    }

    if (selectedDeepSeekThinkingMode) {
      return { deepseek: selectedDeepSeekThinkingMode };
    }

    return undefined;
  }, [selectedAnthropicEffort, selectedDeepSeekThinkingMode, selectedModel?.provider]);
  const currentPreviewPath = useCurrentPreviewPath();
  const hasProjectActiveRun = projectActiveRun?.status === 'running';
  const activeRunId = projectActiveRun?.runId;
  const activeRunBelongsToConversation =
    hasProjectActiveRun && projectActiveRun.conversationId === conversationId;
  const shouldResumeFromSnapshot =
    activeRunBelongsToConversation && !localSubmitStarted && resumeSnapshot?.runId === activeRunId;
  const buildChatRequestBody = useCallback(
    () => ({
      conversationId,
      frontendTabId: FRONTEND_TAB_ID,
      modelConfigurationId: selectedModelId,
      pageEditMode,
      projectId,
      ...(currentPreviewPath ? { previewPath: currentPreviewPath } : {}),
      ...(selectedProviderOptionsSelection
        ? { providerOptionsSelection: selectedProviderOptionsSelection }
        : {}),
    }),
    [
      conversationId,
      currentPreviewPath,
      pageEditMode,
      projectId,
      selectedProviderOptionsSelection,
      selectedModelId,
    ],
  );
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: api.streamChatUrl(),
        prepareSendMessagesRequest: ({
          api: requestApi,
          body,
          credentials,
          headers,
          messages: requestMessages,
        }) => ({
          api: requestApi,
          body: {
            ...buildChatRequestBody(),
            ...body,
            message: createCurrentChatRequestMessage(requestMessages),
          },
          credentials,
          headers,
        }),
        prepareReconnectToStreamRequest: () => ({
          api: api.streamConversationRunUrl(projectId, conversationId, {
            after: reconnectState.afterChunkIndex,
          }),
        }),
      }),
    [conversationId, api, buildChatRequestBody, projectId, reconnectState],
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
      window.dispatchEvent(new Event('owndesign:workspace-refresh'));
    },
  });
  const contextUsage = useMemo(() => getLatestContextUsage(messages), [messages]);
  const isGenerating = status === 'submitted' || status === 'streaming';
  const isProjectBusy = Boolean(hasProjectActiveRun);
  const canSend = Boolean(selectedModel) && !isGenerating && !isProjectBusy;
  const submitStatus = isProjectBusy && !isGenerating ? 'streaming' : status;
  const busyMessage = t('conversation.busyMessage');
  const requiresCurrentPreview =
    pageEditMode === 'direct_edit' || pageEditMode === 'duplicate_edit';
  const handleStop = useCallback(() => {
    void api.cancelActiveRun(projectId).finally(() => {
      stop();
      setLocalSubmitStarted(false);
      setResumeSnapshot(undefined);
      onProjectRunChange?.(undefined);
      window.dispatchEvent(new Event('owndesign:workspace-refresh'));
    });
  }, [api, onProjectRunChange, projectId, setResumeSnapshot, stop]);

  useEffect(() => {
    if (selectedModel?.provider !== 'anthropic') {
      return;
    }

    setSelectedAnthropicEffort(getStoredAnthropicEffort(selectedModel.id) ?? 'high');
  }, [selectedModel?.id, selectedModel?.provider]);

  useEffect(() => {
    if (!activeRunBelongsToConversation || !activeRunId || localSubmitStarted) {
      return;
    }

    let isActive = true;

    void api.getActiveConversationRunSnapshot(projectId, conversationId).then(async (response) => {
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
    const wasGenerating = previousStatus === 'submitted' || previousStatus === 'streaming';

    if (wasGenerating && status === 'ready') {
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
      window.dispatchEvent(new Event('owndesign:workspace-refresh'));
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
              description={t('conversation.titleHint')}
              title={t('conversation.emptyTitle')}
            />
          ) : (
            messages.map((message, index) => {
              const isLastMessage = index === messages.length - 1;

              return (
                <ConversationMessageItem
                  isLastMessage={isLastMessage}
                  isStreaming={status === 'streaming' && isLastMessage}
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
                  <span>{t('conversation.generationFailed', { message: error.message })}</span>
                </div>
              </MessageContent>
            </Message>
          ) : null}
        </ConversationContent>
      </Conversation>

      <div className="border-t border-border bg-card px-3 pb-3">
        {isProjectBusy && !activeRunBelongsToConversation ? (
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

            if (
              (!trimmedText && files.length === 0) ||
              !canSend ||
              (requiresCurrentPreview && !currentPreviewPath)
            ) {
              return;
            }

            setLocalSubmitStarted(true);
            onProjectRunChange?.({
              chunkCount: 0,
              conversationId,
              createdAt: new Date().toISOString(),
              projectId,
              runId: 'pending',
              status: 'running',
            });
            await sendMessage({ files, text: trimmedText }, { body: buildChatRequestBody() });
          }}
        >
          <PromptInputHeader>
            <PromptInputAttachments />
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea
              className="min-h-13 text-[13px]"
              disabled={isGenerating || isProjectBusy}
              placeholder={t('conversation.placeholder')}
            />
          </PromptInputBody>
          <PromptInputFooter className="px-2 pb-1">
            <div className="flex min-w-0 items-center gap-1">
              <PromptAttachmentControls selectedModel={selectedModel} />
              <PageEditModeSelect
                disabled={isGenerating || isProjectBusy}
                hasCurrentPreview={Boolean(currentPreviewPath)}
                onValueChange={setPageEditMode}
                value={pageEditMode}
              />
            </div>
            <div className="flex min-w-0 items-center gap-1">
              <ModelContextUsage configuration={selectedModel} usage={contextUsage} />
              <ModelSelect
                onAnthropicEffortSelect={handleAnthropicEffortSelect}
                onSelect={handleModelSelect}
                selectedAnthropicEffort={selectedAnthropicEffort}
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

function createCurrentChatRequestMessage(messages: UIMessage[]) {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');

  return {
    files: lastUserMessage?.parts.filter(isFilePart) ?? [],
    id: lastUserMessage?.id,
    text:
      lastUserMessage?.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('') ?? '',
  };
}

function isFilePart(part: UIMessage['parts'][number]): part is FileUIPart {
  return part.type === 'file';
}

function PageEditModeSelect({
  disabled,
  hasCurrentPreview,
  onValueChange,
  value,
}: {
  disabled: boolean;
  hasCurrentPreview: boolean;
  onValueChange: (value: PageEditMode) => void;
  value: PageEditMode;
}) {
  const { t } = useI18n();

  return (
    <PromptInputSelect
      onValueChange={(nextValue) => onValueChange(nextValue as PageEditMode)}
      value={value}
    >
      <PromptInputSelectTrigger
        aria-label={t('conversation.pageMode')}
        className="h-7 max-w-24 px-2 text-xs"
        disabled={disabled}
        size="sm"
      >
        <PromptInputSelectValue>{getPageEditModeLabel(value, t)}</PromptInputSelectValue>
      </PromptInputSelectTrigger>
      <PromptInputSelectContent side="top" sideOffset={6}>
        {PAGE_EDIT_MODE_OPTIONS.map((option) => {
          const optionRequiresPreview =
            option.value === 'direct_edit' || option.value === 'duplicate_edit';

          return (
            <PromptInputSelectItem
              disabled={optionRequiresPreview && !hasCurrentPreview}
              key={option.value}
              value={option.value}
            >
              {t(option.labelKey)}
            </PromptInputSelectItem>
          );
        })}
      </PromptInputSelectContent>
    </PromptInputSelect>
  );
}

function getPageEditModeLabel(value: PageEditMode, t: ReturnType<typeof useI18n>['t']) {
  const option = PAGE_EDIT_MODE_OPTIONS.find((item) => item.value === value);

  return option ? t(option.labelKey) : t('conversation.pageModeAuto');
}

function getStoredAnthropicEffort(modelId: string): AnthropicEffort | undefined {
  try {
    const stored = window.localStorage.getItem(ANTHROPIC_EFFORT_STORAGE_KEY);
    const value = stored ? JSON.parse(stored)[modelId] : undefined;

    return isAnthropicEffort(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function saveStoredAnthropicEffort(modelId: string, effort: AnthropicEffort) {
  try {
    const stored = window.localStorage.getItem(ANTHROPIC_EFFORT_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : {};
    const next =
      parsed && typeof parsed === 'object'
        ? { ...parsed, [modelId]: effort }
        : { [modelId]: effort };

    window.localStorage.setItem(ANTHROPIC_EFFORT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures; runtime selection still works for this session.
  }
}

function isAnthropicEffort(value: unknown): value is AnthropicEffort {
  return anthropicEfforts.includes(value as AnthropicEffort);
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
        <MessageContent className={message.role === 'assistant' ? 'w-full' : undefined}>
          <MessageParts isLastMessage={isLastMessage} isStreaming={isStreaming} message={message} />
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

export { MessageParts } from '@/features/conversation/components/message-parts';
