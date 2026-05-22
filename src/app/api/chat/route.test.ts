import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => {
  const createAgentUIStreamResponse =
    vi.fn<(options: unknown) => Response>();
  createAgentUIStreamResponse.mockReturnValue(new Response("stream"));

  return {
    createAgentUIStreamResponse,
    createConversationService: vi.fn(),
    createDesignPageAgent: vi.fn(() => ({ name: "agent" })),
    createDesignPageAgentContext: vi.fn(async (input: unknown) => ({
      ...(input as object),
      model: { provider: "test" },
      providerOptions: { thinkingMode: "max" },
      resources: {
        fontLibraries: [
          {
            id: "font-1",
            name: "Configured Font",
            cdn: "https://cdn.example.com/font.css",
            isDefault: true,
          },
        ],
        iconLibraries: [],
      },
    })),
    createWorkspaceStore: vi.fn(),
    saveUIMessageStream: vi.fn(),
  };
});

vi.mock("ai", () => ({
  createAgentUIStreamResponse: routeMocks.createAgentUIStreamResponse,
}));

vi.mock("@/lib/design-page-agent", () => ({
  createDesignPageAgent: routeMocks.createDesignPageAgent,
  createDesignPageAgentContext: routeMocks.createDesignPageAgentContext,
}));

vi.mock("@/lib/settings-service", () => ({
  parseDeepSeekThinkingMode: (value: unknown) =>
    value === "disabled" || value === "high" || value === "max"
      ? value
      : undefined,
}));

vi.mock("@/lib/owndesign", () => ({
  createConversationService: routeMocks.createConversationService,
  createWorkspaceStore: routeMocks.createWorkspaceStore,
}));

import { POST } from "./route";

describe("/api/chat", () => {
  beforeEach(() => {
    routeMocks.createAgentUIStreamResponse.mockClear();
    routeMocks.createConversationService.mockReset();
    routeMocks.createDesignPageAgent.mockClear();
    routeMocks.createDesignPageAgentContext.mockClear();
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
          frontendTabId: "tab-1",
          messages,
          modelConfigurationId: "model-1",
          previewPath: "dashboard.html",
          projectId: "project-1",
          providerOptionsSelection: { deepseek: "max" },
        }),
        method: "POST",
      }),
    );

    expect(await response.text()).toBe("stream");
    expect(routeMocks.createDesignPageAgentContext).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPreviewPath: "dashboard.html",
        frontendTabId: "tab-1",
        modelConfigurationId: "model-1",
        outputType: "html",
        projectId: "project-1",
        providerOptionsSelection: "max",
      }),
    );
    expect(routeMocks.createDesignPageAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPreviewPath: "dashboard.html",
        frontendTabId: "tab-1",
        model: expect.objectContaining({ provider: "test" }),
        providerOptions: expect.objectContaining({ thinkingMode: "max" }),
        resources: expect.objectContaining({
          fontLibraries: expect.any(Array),
        }),
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
      messageMetadata: (input: { part: { type: string } }) => unknown;
      onFinish: (input: { messages: typeof messages }) => Promise<void>;
      onStepFinish: (step: { usage: unknown }) => void;
    };
    streamOptions.onStepFinish({
      usage: {
        inputTokens: 8000,
        inputTokenDetails: { cacheReadTokens: 1000 },
        outputTokens: 2000,
        outputTokenDetails: { reasoningTokens: 500 },
        totalTokens: 10000,
      },
    });
    expect(streamOptions.messageMetadata({ part: { type: "finish" } })).toEqual({
      contextUsage: {
        cachedInputTokens: 1000,
        inputTokens: 8000,
        outputTokens: 2000,
        reasoningTokens: 500,
        totalTokens: 10000,
      },
    });
    await streamOptions.onFinish({ messages });

    expect(routeMocks.saveUIMessageStream).toHaveBeenCalledWith(
      "project-1",
      "conversation-1",
      messages,
    );
  });
});
