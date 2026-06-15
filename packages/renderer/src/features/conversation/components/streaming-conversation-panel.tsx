'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type FileUIPart, type UIMessage } from 'ai';
import { AlertCircleIcon, Clock3Icon, RotateCcwIcon } from 'lucide-react';
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
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import type { CheckpointRecord, CheckpointRestoreMode } from '@owndesign/core/workspace-store';
import { normalizeConversationMessages } from '@owndesign/core/conversations/chat-messages';

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
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  const [restoringCheckpointId, setRestoringCheckpointId] = useState<string>();
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
      projectId,
      ...(currentPreviewPath ? { previewPath: currentPreviewPath } : {}),
      ...(selectedProviderOptionsSelection
        ? { providerOptionsSelection: selectedProviderOptionsSelection }
        : {}),
    }),
    [
      conversationId,
      currentPreviewPath,
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
  const activeRunElapsedDuration = useRunElapsedDuration(projectActiveRun);
  const lastAssistantMessageIndex = getLastAssistantMessageIndex(messages);
  const checkpointByUserMessageId = useMemo(() => {
    const map = new Map<string, CheckpointRecord>();

    for (const checkpoint of checkpoints) {
      if (checkpoint.conversationId === conversationId) {
        map.set(checkpoint.userMessageId, checkpoint);
      }
    }

    return map;
  }, [checkpoints, conversationId]);
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
    let isActive = true;

    void api
      .listCheckpoints(projectId)
      .then((nextCheckpoints) => {
        if (isActive) {
          setCheckpoints(Array.isArray(nextCheckpoints) ? nextCheckpoints : []);
        }
      })
      .catch(() => {
        if (isActive) {
          setCheckpoints([]);
        }
      });

    return () => {
      isActive = false;
    };
  }, [api, conversationId, messages.length, projectId, status]);

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

      if (!isActive || snapshot.activeRun?.runId !== activeRunId) {
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
              const isActiveRunMessage =
                activeRunBelongsToConversation &&
                message.role === 'assistant' &&
                index === lastAssistantMessageIndex;

              return (
                <ConversationMessageItem
                  activeElapsedMs={isActiveRunMessage ? activeRunElapsedDuration : undefined}
                  isLastMessage={isLastMessage}
                  isStreaming={status === 'streaming' && isLastMessage}
                  key={getMessageKey(message, index)}
                  message={message}
                  checkpoint={
                    message.role === 'user' ? checkpointByUserMessageId.get(message.id) : undefined
                  }
                  isRestoreDisabled={
                    isGenerating || isProjectBusy || Boolean(restoringCheckpointId)
                  }
                  onRestore={handleCheckpointRestore}
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

            if ((!trimmedText && files.length === 0) || !canSend) {
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

  async function handleCheckpointRestore(
    checkpoint: CheckpointRecord,
    mode: CheckpointRestoreMode,
  ) {
    setRestoringCheckpointId(checkpoint.id);

    try {
      await api.restoreCheckpoint(projectId, checkpoint.id, mode);

      if (mode !== 'files') {
        const workspace = await api.loadWorkspace(projectId, checkpoint.conversationId);
        const restoredConversation = workspace.conversations.find(
          (conversation) => conversation.id === checkpoint.conversationId,
        );

        if (restoredConversation) {
          const restoredMessages = normalizeConversationMessages(restoredConversation.messages);

          setMessages(restoredMessages);
          onConversationUpdate?.({
            id: restoredConversation.id,
            lastMessageAt: restoredConversation.lastMessageAt ?? restoredConversation.updatedAt,
            messages: restoredMessages,
            title: restoredConversation.title,
            updatedAt: restoredConversation.updatedAt,
          });
        }
      }

      const nextCheckpoints = await api.listCheckpoints(projectId);

      setCheckpoints(Array.isArray(nextCheckpoints) ? nextCheckpoints : []);
      window.dispatchEvent(new Event('owndesign:workspace-refresh'));
      window.dispatchEvent(new Event('owndesign:preview-refresh'));
    } finally {
      setRestoringCheckpointId(undefined);
    }
  }
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
    activeElapsedMs,
    checkpoint,
    isRestoreDisabled,
    isLastMessage,
    isStreaming,
    message,
    onRestore,
  }: {
    activeElapsedMs?: number;
    checkpoint?: CheckpointRecord;
    isRestoreDisabled: boolean;
    isLastMessage: boolean;
    isStreaming: boolean;
    message: UIMessage;
    onRestore: (checkpoint: CheckpointRecord, mode: CheckpointRestoreMode) => void;
  }) {
    const taskTiming = getMessageTaskTiming(message);
    const elapsedMs = activeElapsedMs ?? taskTiming?.elapsedMs;
    const isTimingVisible = activeElapsedMs !== undefined;

    return (
      <div className="group/message">
        <Message from={message.role}>
          <MessageContent className={message.role === 'assistant' ? 'w-full' : undefined}>
            <MessageParts
              isLastMessage={isLastMessage}
              isStreaming={isStreaming}
              message={message}
            />
          </MessageContent>
        </Message>
        {message.role === 'assistant' && elapsedMs !== undefined ? (
          <div
            className={
              isTimingVisible
                ? 'mt-1 flex justify-start pl-0'
                : 'mt-1 flex justify-start pl-0 opacity-0 transition-opacity duration-150 group-focus-within/message:opacity-100 group-hover/message:opacity-100'
            }
          >
            <TaskElapsedBadge elapsedMs={elapsedMs} />
          </div>
        ) : null}
        {checkpoint ? (
          <CheckpointRestoreMenu
            checkpoint={checkpoint}
            disabled={isRestoreDisabled}
            onRestore={onRestore}
          />
        ) : null}
      </div>
    );
  },
  (previousProps, nextProps) =>
    previousProps.activeElapsedMs === nextProps.activeElapsedMs &&
    previousProps.message === nextProps.message &&
    previousProps.checkpoint === nextProps.checkpoint &&
    previousProps.isRestoreDisabled === nextProps.isRestoreDisabled &&
    previousProps.isLastMessage === nextProps.isLastMessage &&
    previousProps.isStreaming === nextProps.isStreaming &&
    previousProps.onRestore === nextProps.onRestore,
);

function CheckpointRestoreMenu({
  checkpoint,
  disabled,
  onRestore,
}: {
  checkpoint: CheckpointRecord;
  disabled: boolean;
  onRestore: (checkpoint: CheckpointRecord, mode: CheckpointRestoreMode) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="mt-1 flex justify-end pr-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled}
          render={
            <Button
              aria-label={t('conversation.restoreCheckpoint')}
              className="text-muted-foreground"
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcwIcon />
              {t('conversation.restoreCheckpoint')}
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem onClick={() => onRestore(checkpoint, 'both')}>
            {t('conversation.restoreFilesAndConversation')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRestore(checkpoint, 'files')}>
            {t('conversation.restoreFilesOnly')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRestore(checkpoint, 'conversation')}>
            {t('conversation.restoreConversationOnly')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function TaskElapsedBadge({ elapsedMs }: { elapsedMs: number }) {
  const { t } = useI18n();

  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
      <Clock3Icon className="size-3.5" />
      <span className="tabular-nums">
        {t('conversation.taskElapsed', { duration: formatElapsedDuration(elapsedMs) })}
      </span>
    </span>
  );
}

function useRunElapsedDuration(run: ActiveRun | undefined) {
  const [now, setNow] = useState(() => Date.now());
  const startedAt = run?.status === 'running' ? Date.parse(run.createdAt) : Number.NaN;

  useEffect(() => {
    if (!Number.isFinite(startedAt)) {
      return;
    }

    setNow(Date.now());
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [startedAt]);

  if (!Number.isFinite(startedAt)) {
    return undefined;
  }

  return Math.max(0, now - startedAt);
}

function getMessageTaskTiming(message: UIMessage) {
  const metadata = message.metadata;

  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    !('taskTiming' in metadata) ||
    typeof metadata.taskTiming !== 'object' ||
    metadata.taskTiming === null
  ) {
    return undefined;
  }

  const taskTiming = metadata.taskTiming as Record<string, unknown>;

  return typeof taskTiming.elapsedMs === 'number' && Number.isFinite(taskTiming.elapsedMs)
    ? { elapsedMs: taskTiming.elapsedMs }
    : undefined;
}

function getLastAssistantMessageIndex(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') {
      return index;
    }
  }

  return -1;
}

function formatElapsedDuration(elapsedMs: number) {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${padTime(minutes)}:${padTime(seconds)}`;
  }

  return `${minutes}:${padTime(seconds)}`;
}

function padTime(value: number) {
  return String(value).padStart(2, '0');
}

function getMessageKey(message: UIMessage, index: number) {
  return message.id || `message-${index}`;
}

export { MessageParts } from '@/features/conversation/components/message-parts';
