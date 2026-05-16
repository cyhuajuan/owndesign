import { createAgentUIStreamResponse, type InferAgentUIMessage } from "ai";

import { normalizeConversationMessages } from "@/lib/chat-messages";
import { createConversationService, createWorkspaceStore } from "@/lib/hjdesign";
import {
  buildLanguageModel,
  createDesignPageAgent,
} from "@/lib/design-page-agent";
import { createSettingsService } from "@/lib/settings-service";

type ChatRequestBody = {
  conversationId?: unknown;
  messages?: unknown;
  modelConfigurationId?: unknown;
  projectId?: unknown;
};

type DesignPageUIMessage = InferAgentUIMessage<
  ReturnType<typeof createDesignPageAgent>
>;

export async function POST(request: Request) {
  const body = (await request.json()) as ChatRequestBody;
  const projectId = asNonEmptyString(body.projectId);
  const conversationId = asNonEmptyString(body.conversationId);

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
  let modelConfiguration;

  try {
    modelConfiguration = await createSettingsService().resolveModelConfiguration(
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
    projectId,
    workspaceStore,
  });

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
    originalMessages: messages,
    sendReasoning: true,
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
