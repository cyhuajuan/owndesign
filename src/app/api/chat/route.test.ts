import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => {
  const createAgentUIStreamResponse =
    vi.fn<(options: unknown) => Response>();
  createAgentUIStreamResponse.mockReturnValue(new Response("stream"));

  return {
    createAgentUIStreamResponse,
    createConversationService: vi.fn(),
    createDesignPageAgent: vi.fn(() => ({ name: "agent" })),
    createWorkspaceStore: vi.fn(),
    saveUIMessageStream: vi.fn(),
  };
});

vi.mock("ai", () => ({
  createAgentUIStreamResponse: routeMocks.createAgentUIStreamResponse,
}));

vi.mock("@/lib/design-page-agent", () => ({
  createDesignPageAgent: routeMocks.createDesignPageAgent,
}));

vi.mock("@/lib/hjdesign", () => ({
  createConversationService: routeMocks.createConversationService,
  createWorkspaceStore: routeMocks.createWorkspaceStore,
}));

import { POST } from "./route";

describe("/api/chat", () => {
  beforeEach(() => {
    routeMocks.createAgentUIStreamResponse.mockClear();
    routeMocks.createConversationService.mockReset();
    routeMocks.createDesignPageAgent.mockClear();
    routeMocks.createWorkspaceStore.mockReset();
    routeMocks.saveUIMessageStream.mockReset();
    routeMocks.createWorkspaceStore.mockReturnValue({
      getProject: vi.fn(async () => ({
        id: "project-1",
        name: "Project One",
        outputType: "html",
      })),
    });
    routeMocks.createConversationService.mockReturnValue({
      saveUIMessageStream: routeMocks.saveUIMessageStream,
    });
  });

  it("streams through createAgentUIStreamResponse and persists finished UI messages", async () => {
    const messages = [
      {
        id: "user-1",
        parts: [{ text: "设计一个 CRM 仪表盘", type: "text" }],
        role: "user",
      },
    ];

    const response = await POST(
      new Request("http://localhost/api/chat", {
        body: JSON.stringify({
          conversationId: "conversation-1",
          messages,
          projectId: "project-1",
        }),
        method: "POST",
      }),
    );

    expect(await response.text()).toBe("stream");
    expect(routeMocks.createDesignPageAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        projectId: "project-1",
        projectName: "Project One",
      }),
    );
    expect(routeMocks.createAgentUIStreamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        sendReasoning: true,
        uiMessages: messages,
      }),
    );

    const streamOptions = routeMocks.createAgentUIStreamResponse.mock
      .calls[0]?.[0] as {
      onFinish: (input: { messages: typeof messages }) => Promise<void>;
    };
    await streamOptions.onFinish({ messages });

    expect(routeMocks.saveUIMessageStream).toHaveBeenCalledWith(
      "project-1",
      "conversation-1",
      messages,
    );
  });
});
