import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => {
  const createAgentUIStreamResponse =
    vi.fn<(options: unknown) => Response>();
  createAgentUIStreamResponse.mockReturnValue(new Response("stream"));

  return {
    createAgentUIStreamResponse,
    createConversationService: vi.fn(),
    createDesignPageAgent: vi.fn(() => ({ name: "agent" })),
    buildLanguageModel: vi.fn((configuration: unknown) => ({
      configuration,
      provider: "test",
    })),
    buildProviderOptions: vi.fn((configuration: unknown, thinkingMode: unknown) => ({
      configuration,
      thinkingMode,
    })),
    createSettingsService: vi.fn(),
    getSettings: vi.fn(),
    createWorkspaceStore: vi.fn(),
    resolveModelConfiguration: vi.fn(),
    saveUIMessageStream: vi.fn(),
  };
});

vi.mock("ai", () => ({
  createAgentUIStreamResponse: routeMocks.createAgentUIStreamResponse,
}));

vi.mock("@/lib/design-page-agent", () => ({
  buildLanguageModel: routeMocks.buildLanguageModel,
  buildProviderOptions: routeMocks.buildProviderOptions,
  createDesignPageAgent: routeMocks.createDesignPageAgent,
}));

vi.mock("@/lib/settings-service", () => ({
  createSettingsService: routeMocks.createSettingsService,
  parseDeepSeekThinkingMode: (value: unknown) =>
    value === "disabled" || value === "high" || value === "max"
      ? value
      : undefined,
}));

vi.mock("@/lib/hjdesign", () => ({
  createConversationService: routeMocks.createConversationService,
  createWorkspaceStore: routeMocks.createWorkspaceStore,
}));

import { POST } from "./route";

describe("/api/chat", () => {
  beforeEach(() => {
    routeMocks.createAgentUIStreamResponse.mockClear();
    routeMocks.buildLanguageModel.mockClear();
    routeMocks.buildProviderOptions.mockClear();
    routeMocks.createConversationService.mockReset();
    routeMocks.createDesignPageAgent.mockClear();
    routeMocks.createSettingsService.mockReset();
    routeMocks.getSettings.mockReset();
    routeMocks.createWorkspaceStore.mockReset();
    routeMocks.resolveModelConfiguration.mockReset();
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
    routeMocks.resolveModelConfiguration.mockResolvedValue({
      apiKey: "secret",
      baseUrl: "https://api.deepseek.com",
      id: "model-1",
      model: "deepseek-chat",
      provider: "deepseek",
    });
    routeMocks.getSettings.mockResolvedValue({
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
        tailwind: {
          enabled: true,
          cdnUrl: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
        },
      },
    });
    routeMocks.createSettingsService.mockReturnValue({
      getSettings: routeMocks.getSettings,
      resolveModelConfiguration: routeMocks.resolveModelConfiguration,
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
          modelConfigurationId: "model-1",
          projectId: "project-1",
          providerOptionsSelection: { deepseek: "max" },
        }),
        method: "POST",
      }),
    );

    expect(await response.text()).toBe("stream");
    expect(routeMocks.createDesignPageAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        outputType: "html",
        model: expect.objectContaining({ provider: "test" }),
        providerOptions: expect.objectContaining({ thinkingMode: "max" }),
        projectId: "project-1",
        resources: expect.objectContaining({
          tailwind: expect.objectContaining({ enabled: true }),
        }),
      }),
    );
    expect(routeMocks.buildProviderOptions).toHaveBeenCalledWith(
      expect.objectContaining({ id: "model-1" }),
      "max",
    );
    expect(routeMocks.resolveModelConfiguration).toHaveBeenCalledWith("model-1");
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
