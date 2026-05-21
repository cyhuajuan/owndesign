"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useSearchParams } from "next/navigation";
import {
  DefaultChatTransport,
  isToolUIPart,
  type DynamicToolUIPart,
  type ToolUIPart,
} from "ai";
import {
  AlertCircleIcon,
  CheckIcon,
  ChevronDownIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from "@/components/ai-elements/context";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { FRONTEND_TAB_ID } from "@/components/frontend-capability-bridge";
import { SETTINGS_UPDATED_EVENT } from "@/components/settings-control";
import { cn } from "@/lib/utils";

type StreamingConversationPanelProps = {
  conversationId: string;
  initialMessages: UIMessage[];
  projectId: string;
};

type PublicSettings = {
  defaultModelId: string | null;
  interfaceLanguage: "zh-CN" | "en-US";
  modelConfigurations: Array<{
    id: string;
    provider: "deepseek" | "openai-compatible";
    model: string;
    baseUrl: string;
    contextSizeK: number;
    apiKey: "";
    hasApiKey: boolean;
    providerOptions?: ModelProviderOptions;
  }>;
};

type DeepSeekThinkingMode = "disabled" | "high" | "max";

type ModelProviderOptions = {
  deepseek?: {
    thinkingMode: DeepSeekThinkingMode;
  };
};

type ContextUsageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
};

export function StreamingConversationPanel({
  conversationId,
  initialMessages,
  projectId,
}: StreamingConversationPanelProps) {
  const searchParams = useSearchParams();
  const selectedPreviewPath = searchParams.get("previewPath") ?? undefined;
  const [settings, setSettings] = useState<PublicSettings>();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const selectedModel = settings?.modelConfigurations.find(
    (configuration) => configuration.id === selectedModelId,
  );
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
  const handleModelSelect = useCallback(
    async (modelId: string, thinkingMode?: DeepSeekThinkingMode) => {
      if (!settings) {
        return;
      }

      const nextSettings = updateDefaultModel(settings, modelId, thinkingMode);

      setSelectedModelId(modelId);
      setSettings(nextSettings);
      await saveSettings(nextSettings);
    },
    [settings],
  );

  useEffect(() => {
    let isMounted = true;
    const loadSettings = async () => {
      const response = await fetch("/api/settings");
      const nextSettings = (await response.json()) as PublicSettings;

      if (!isMounted) {
        return;
      }

      setSettings(nextSettings);
      setSelectedModelId(
        nextSettings.defaultModelId ??
          nextSettings.modelConfigurations[0]?.id ??
          null,
      );
    };

    void loadSettings();
    window.addEventListener(SETTINGS_UPDATED_EVENT, loadSettings);

    return () => {
      isMounted = false;
      window.removeEventListener(SETTINGS_UPDATED_EVENT, loadSettings);
    };
  }, []);

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
          onSubmit={async ({ text }) => {
            const trimmedText = text.trim();

            if (!trimmedText || !canSend) {
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
            </div>
            <PromptInputTools />
            <PromptInputSubmit
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={!selectedModel}
              onStop={stop}
              status={status}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </>
  );
}

function ModelSelect({
  onSelect,
  selectedModelId,
  settings,
}: {
  onSelect: (
    modelId: string,
    thinkingMode?: DeepSeekThinkingMode,
  ) => void | Promise<void>;
  selectedModelId: string | null;
  settings?: PublicSettings;
}) {
  const selectedModel = settings?.modelConfigurations.find(
    (configuration) => configuration.id === selectedModelId,
  );
  const disabled = !settings || settings.modelConfigurations.length === 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <button
            className="flex h-7 cursor-pointer items-center gap-[5px] rounded-[6px] bg-transparent px-2 text-xs text-[#a0a0ab] transition-all duration-150 hover:bg-[#252528] hover:text-[#f0f0f2] disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:[&_.chev]:rotate-180 [&_svg]:size-[13px]"
            type="button"
          >
            <span className="whitespace-nowrap">
              {getSelectedModelLabel(selectedModel)}
            </span>
            <ChevronDownIcon className="chev !size-2.5 opacity-50 transition-transform duration-150" />
          </button>
        }
      />
      <DropdownMenuContent
        align="end"
        className="min-w-[200px] max-w-[320px] rounded-[8px] border border-[#2a2a2e] bg-[#1c1c1f] p-1 text-[#a0a0ab] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
        side="top"
        sideOffset={6}
      >
        <DropdownMenuGroup className="max-h-[calc(60vh-8px)] overflow-y-auto overflow-x-hidden">
          {settings?.modelConfigurations.length ? (
            settings.modelConfigurations.map((configuration) =>
              configuration.provider === "deepseek" ? (
                <DropdownMenuSub key={configuration.id}>
                  <DropdownMenuSubTrigger
                    className={modelMenuItemClass(
                      configuration.id === selectedModelId,
                    )}
                    onClick={() => {
                      void onSelect(configuration.id);
                    }}
                  >
                    <ModelSelectCheck
                      active={configuration.id === selectedModelId}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {configuration.model}
                    </span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    align="end"
                    className="min-w-[120px] rounded-[8px] border border-[#2a2a2e] bg-[#1c1c1f] p-1 text-[#a0a0ab] shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                    side="right"
                    sideOffset={6}
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="px-2.5 py-1.5 text-[11px] text-[#6b6b76]">
                        思考模式
                      </DropdownMenuLabel>
                      {deepSeekThinkingModes.map((thinkingMode) => (
                        <DropdownMenuItem
                          className={modelMenuItemClass(
                            configuration.id === selectedModelId &&
                              getDeepSeekThinkingMode(configuration) ===
                                thinkingMode,
                          )}
                          key={thinkingMode}
                          onClick={() => {
                            void onSelect(configuration.id, thinkingMode);
                          }}
                        >
                          <ModelSelectCheck
                            active={
                              configuration.id === selectedModelId &&
                              getDeepSeekThinkingMode(configuration) ===
                                thinkingMode
                            }
                          />
                          <span>{thinkingMode}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : (
                <DropdownMenuItem
                  className={modelMenuItemClass(
                    configuration.id === selectedModelId,
                  )}
                key={configuration.id}
                onClick={() => {
                  void onSelect(configuration.id);
                }}
              >
                <ModelSelectCheck active={configuration.id === selectedModelId} />
                <span className="min-w-0 flex-1 truncate">
                  {configuration.model}
                </span>
              </DropdownMenuItem>
              ),
            )
          ) : (
            <DropdownMenuItem
              className="justify-center px-4 py-6 text-center text-xs text-[#6b6b76] focus:bg-transparent focus:text-[#6b6b76]"
              disabled
            >
              暂无模型配置
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelSelectCheck({ active }: { active: boolean }) {
  return (
    <CheckIcon
      className={cn(
        "size-3.5 shrink-0 opacity-0",
        active && "text-[#6c5ce7] opacity-100",
      )}
    />
  );
}

function modelMenuItemClass(active: boolean) {
  return cn(
    "relative flex cursor-pointer items-center gap-2 rounded-[6px] px-2.5 py-[7px] text-[13px] text-[#a0a0ab] transition-colors duration-100 focus:bg-[#252528] focus:text-[#f0f0f2]",
    active &&
      "bg-[rgba(108,92,231,0.15)] text-[#6c5ce7] focus:bg-[rgba(108,92,231,0.15)] focus:text-[#6c5ce7]",
  );
}

const deepSeekThinkingModes = ["disabled", "high", "max"] as const;

function getDeepSeekThinkingMode(configuration: {
  providerOptions?: ModelProviderOptions;
}) {
  return configuration.providerOptions?.deepseek?.thinkingMode ?? "high";
}

function getSelectedModelLabel(
  configuration: PublicSettings["modelConfigurations"][number] | undefined,
) {
  if (!configuration) {
    return "未配置模型";
  }

  if (configuration.provider !== "deepseek") {
    return configuration.model;
  }

  return `${configuration.model} · ${getDeepSeekThinkingMode(configuration)}`;
}

function updateDefaultModel(
  settings: PublicSettings,
  defaultModelId: string,
  thinkingMode?: DeepSeekThinkingMode,
): PublicSettings {
  return {
    ...settings,
    defaultModelId,
    modelConfigurations: settings.modelConfigurations.map((configuration) =>
      configuration.id === defaultModelId &&
      configuration.provider === "deepseek" &&
      thinkingMode
        ? {
            ...configuration,
            providerOptions: {
              deepseek: { thinkingMode },
            },
          }
        : configuration,
    ),
  };
}

async function saveSettings(settings: PublicSettings) {
  await fetch("/api/settings", {
    body: JSON.stringify({
      ...settings,
      modelConfigurations: settings.modelConfigurations.map((configuration) => ({
        id: configuration.id,
        provider: configuration.provider,
        model: configuration.model,
        baseUrl: configuration.baseUrl,
        contextSizeK: configuration.contextSizeK,
        providerOptions: configuration.providerOptions,
        apiKey: "",
      })),
    }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
}

function ModelContextUsage({
  configuration,
  usage,
}: {
  configuration?: PublicSettings["modelConfigurations"][number];
  usage?: ContextUsageMetadata;
}) {
  if (!configuration) {
    return null;
  }

  const maxTokens = getModelContextSizeK(configuration) * 1000;
  const usedTokens = getUsedTokens(usage);

  return (
    <Context
      maxTokens={maxTokens}
      usage={{
        cachedInputTokens: usage?.cachedInputTokens,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        reasoningTokens: usage?.reasoningTokens,
        totalTokens: usage?.totalTokens,
      }}
      usedTokens={usedTokens}
    >
      <ContextTrigger />
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBody>
          <ContextInputUsage />
          <ContextOutputUsage />
          <ContextReasoningUsage />
          <ContextCacheUsage />
        </ContextContentBody>
        <ContextContentFooter />
      </ContextContent>
    </Context>
  );
}

function getModelContextSizeK(
  configuration: PublicSettings["modelConfigurations"][number],
) {
  if (typeof configuration.contextSizeK === "number") {
    return configuration.contextSizeK;
  }

  return configuration.provider === "deepseek" ? 1000 : 200;
}

function getLatestContextUsage(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== "assistant") {
      continue;
    }

    const usage = getContextUsageFromMetadata(message.metadata);

    if (usage) {
      return usage;
    }
  }

  return undefined;
}

function getContextUsageFromMetadata(
  metadata: UIMessage["metadata"],
): ContextUsageMetadata | undefined {
  if (!isRecord(metadata) || !isRecord(metadata.contextUsage)) {
    return undefined;
  }

  return {
    cachedInputTokens: asOptionalNumber(metadata.contextUsage.cachedInputTokens),
    inputTokens: asOptionalNumber(metadata.contextUsage.inputTokens),
    outputTokens: asOptionalNumber(metadata.contextUsage.outputTokens),
    reasoningTokens: asOptionalNumber(metadata.contextUsage.reasoningTokens),
    totalTokens: asOptionalNumber(metadata.contextUsage.totalTokens),
  };
}

function getUsedTokens(usage: ContextUsageMetadata | undefined) {
  if (!usage) {
    return 0;
  }

  return (
    usage.totalTokens ??
    addOptionalNumbers(usage.inputTokens, usage.outputTokens) ??
    0
  );
}

function addOptionalNumbers(
  first: number | undefined,
  second: number | undefined,
) {
  return first === undefined && second === undefined
    ? undefined
    : (first ?? 0) + (second ?? 0);
}

function asOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function ToolPartView({
  part,
}: {
  part: ToolLikePart;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="w-full space-y-2">
      <Tool
        className="mb-0 w-full bg-background text-sm"
        onOpenChange={setIsOpen}
        open={isOpen}
      >
        {part.type === "dynamic-tool" ? (
          <ToolHeader
            state={part.state}
            toolName={part.toolName}
            type={part.type}
          />
        ) : (
          <ToolHeader state={part.state} type={part.type} />
        )}
        {isOpen ? (
          <ToolContent>
            <ToolInput input={part.input} />
            {part.output !== undefined || part.errorText ? (
              <ToolOutput errorText={part.errorText} output={part.output} />
            ) : null}
          </ToolContent>
        ) : null}
      </Tool>
    </div>
  );
}

function isToolPart(part: unknown): part is ToolLikePart {
  return isToolUIPart(part as UIMessage["parts"][number]);
}

type ToolLikePart = ToolUIPart | DynamicToolUIPart;
