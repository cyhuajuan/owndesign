import {
  createAgentUIStreamResponse,
  type InferAgentUIMessage,
  type LanguageModelUsage,
} from "ai";

import { normalizeConversationMessages } from "@/lib/chat-messages";
import { createConversationService, createWorkspaceStore } from "@/lib/hjdesign";
import {
  buildProviderOptions,
  buildLanguageModel,
  createDesignPageAgent,
} from "@/lib/design-page-agent";
import {
  createSettingsService,
  parseDeepSeekThinkingMode,
} from "@/lib/settings-service";

type ChatRequestBody = {
  conversationId?: unknown;
  messages?: unknown;
  modelConfigurationId?: unknown;
  previewPath?: unknown;
  projectId?: unknown;
  providerOptionsSelection?: unknown;
};

type DesignPageUIMessage = InferAgentUIMessage<
  ReturnType<typeof createDesignPageAgent>
>;

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequestBody;
  const projectId = asNonEmptyString(body.projectId);
  const conversationId = asNonEmptyString(body.conversationId);
  const previewPath = asNonEmptyString(body.previewPath);

  if (!projectId || !conversationId || !Array.isArray(body.messages)) {
    return new Response("Invalid chat request.", { status: 400 });
  }

  const workspaceStore = createWorkspaceStore();
  const project = await workspaceStore.getProject(projectId);

  if (project.outputType !== "html") {
    return new Response(`Unsupported Project Output Type: ${project.outputType}`, {
      status: 400,
    });
  }

  const messages = normalizeConversationMessages(
    body.messages,
  ) as DesignPageUIMessage[];
  const settingsService = createSettingsService();
  let modelConfiguration;
  let resources;

  try {
    resources = (await settingsService.getSettings()).resources;
    modelConfiguration = await settingsService.resolveModelConfiguration(
      asNonEmptyString(body.modelConfigurationId),
    );
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Invalid model configuration.",
      { status: 400 },
    );
  }
  const agent = createDesignPageAgent({
    model: buildLanguageModel(modelConfiguration),
    outputType: project.outputType,
    providerOptions: buildProviderOptions(
      modelConfiguration,
      parseDeepSeekProviderOptionsSelection(body.providerOptionsSelection),
    ),
    currentPreviewPath: previewPath,
    projectId,
    resources,
    workspaceStore,
  });
  let latestStepUsage: LanguageModelUsage | undefined;

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
    originalMessages: messages,
    sendReasoning: true,
    onStepFinish: (step) => {
      latestStepUsage = step.usage;
    },
    messageMetadata: ({ part }) => {
      if (part.type !== "finish" || !latestStepUsage) {
        return undefined;
      }

      return {
        contextUsage: {
          inputTokens: latestStepUsage.inputTokens,
          outputTokens: latestStepUsage.outputTokens,
          totalTokens: latestStepUsage.totalTokens,
          reasoningTokens:
            latestStepUsage.outputTokenDetails?.reasoningTokens ??
            latestStepUsage.reasoningTokens,
          cachedInputTokens:
            latestStepUsage.inputTokenDetails?.cacheReadTokens ??
            latestStepUsage.cachedInputTokens,
        },
      };
    },
    onError: (error) =>
      error instanceof Error ? `生成失败：${error.message}` : "生成失败：Unknown error",
    onFinish: async ({ messages: finishedMessages }) => {
      await createConversationService().saveUIMessageStream(
        projectId,
        conversationId,
        finishedMessages,
      );
    },
  });
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseDeepSeekProviderOptionsSelection(value: unknown) {
  if (!value || typeof value !== "object" || !("deepseek" in value)) {
    return undefined;
  }

  return parseDeepSeekThinkingMode(value.deepseek);
}
