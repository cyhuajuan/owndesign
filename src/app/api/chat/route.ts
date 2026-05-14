import { createAgentUIStreamResponse, type InferAgentUIMessage } from "ai";

import { normalizeConversationMessages } from "@/lib/chat-messages";
import { createConversationService, createWorkspaceStore } from "@/lib/hjdesign";
import { createDesignPageAgent } from "@/lib/design-page-agent";

type ChatRequestBody = {
  conversationId?: unknown;
  messages?: unknown;
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
  const agent = createDesignPageAgent({
    conversationId,
    projectId,
    projectName: project.name,
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
