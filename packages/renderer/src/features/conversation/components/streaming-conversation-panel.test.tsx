import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useChat } from "@ai-sdk/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MessageParts,
  StreamingConversationPanel,
} from "./streaming-conversation-panel";
import { setCurrentPreviewPath } from "@/features/preview/preview-path";

function getProjectOutputUpdatedEvents(dispatchEventSpy: ReturnType<typeof vi.spyOn>) {
  return dispatchEventSpy.mock.calls.filter(
    ([event]: [Event]) => event.type === "owndesign:project-output-updated",
  );
}

vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(),
}));

vi.mock("@/features/preview/components/frontend-capability-bridge", () => ({
  FRONTEND_TAB_ID: "tab-1",
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");

  class MockDefaultChatTransport {
    api: string;
    body: Record<string, unknown> | (() => Record<string, unknown>);
    prepareReconnectToStreamRequest?: () => { api: string };

    constructor(options: {
      api: string;
      body: Record<string, unknown> | (() => Record<string, unknown>);
      prepareReconnectToStreamRequest?: () => { api: string };
    }) {
      this.api = options.api;
      this.body = options.body;
      this.prepareReconnectToStreamRequest =
        options.prepareReconnectToStreamRequest;
    }
  }

  return {
    ...actual,
    DefaultChatTransport: MockDefaultChatTransport,
    getToolName: (part: { toolName?: string; type: string }) =>
      part.type === "dynamic-tool"
        ? part.toolName
        : part.type.replace(/^tool-/, ""),
    isToolUIPart: (part: unknown) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      typeof part.type === "string" &&
      (part.type.startsWith("tool-") || part.type === "dynamic-tool"),
  };
});

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  setCurrentPreviewPath(undefined);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((file: File) => `blob:${file.name}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        defaultModelId: "model-1",
        interfaceLanguage: "zh-CN",
        modelConfigurations: [
          {
            apiKey: "",
            baseUrl: "",
            contextSizeK: 1000,
            hasApiKey: true,
            id: "model-1",
            model: "deepseek-v4-flash",
            provider: "deepseek",
          },
        ],
      }),
    ),
  );
});

afterEach(() => {
  vi.mocked(useChat).mockReset();
  vi.unstubAllGlobals();
});

function stubOpenAICompatibleSettings() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        defaultModelId: "model-1",
        interfaceLanguage: "zh-CN",
        modelConfigurations: [
          {
            apiKey: "",
            baseUrl: "https://example.test/v1",
            contextSizeK: 200,
            hasApiKey: true,
            id: "model-1",
            model: "gpt-4o",
            provider: "openai-compatible",
          },
        ],
      }),
    ),
  );
}

function stubAnthropicSettings() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        defaultModelId: "model-anthropic",
        interfaceLanguage: "zh-CN",
        modelConfigurations: [
          {
            apiKey: "",
            baseUrl: "",
            contextSizeK: 200,
            hasApiKey: true,
            id: "model-anthropic",
            model: "claude-sonnet-4-5",
            provider: "anthropic",
          },
        ],
      }),
    ),
  );
}

describe("MessageParts", () => {
  it("hides completed reasoning parts", () => {
    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              state: "done",
              text: "需要先判断信息架构。",
              type: "reasoning",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.queryByText("思考过程")).not.toBeInTheDocument();
    expect(screen.queryByText("需要先判断信息架构。")).not.toBeInTheDocument();
  });

  it("shows only a pending label for streaming reasoning", () => {
    render(
      <MessageParts
        isLastMessage
        isStreaming
        message={{
          id: "assistant-1",
          parts: [
            {
              state: "streaming",
              text: "需要先判断信息架构。",
              type: "reasoning",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("正在思考")).toBeInTheDocument();
    expect(screen.queryByText("需要先判断信息架构。")).not.toBeInTheDocument();
  });

  it("does not show reasoning content while streaming", () => {
    render(
      <MessageParts
        isLastMessage
        isStreaming
        message={{
          id: "assistant-1",
          parts: [
            {
              state: "streaming",
              text: "还在分析布局。",
              type: "reasoning",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("正在思考")).toBeInTheDocument();
    expect(screen.queryByText("还在分析布局。")).not.toBeInTheDocument();
  });

  it("renders the streaming assistant text part without markdown parsing", () => {
    const { container } = render(
      <MessageParts
        isLastMessage
        isStreaming
        message={{
          id: "assistant-1",
          parts: [{ text: "第一行\n第二行", type: "text" }],
          role: "assistant",
        }}
      />,
    );

    const streamingText = container.querySelector('[data-streaming-text="true"]');

    expect(streamingText?.textContent).toBe("第一行\n第二行");
    expect(streamingText).toHaveClass("whitespace-pre-wrap");
  });

  it("uses full markdown rendering after assistant streaming finishes", () => {
    const { container } = render(
      <MessageParts
        isLastMessage
        isStreaming={false}
        message={{
          id: "assistant-1",
          parts: [{ text: "**完成**", type: "text" }],
          role: "assistant",
        }}
      />,
    );

    expect(
      container.querySelector('[data-streaming-text="true"]'),
    ).not.toBeInTheDocument();
  });

  it("does not render streaming reasoning text", () => {
    const { container } = render(
      <MessageParts
        isLastMessage
        isStreaming
        message={{
          id: "assistant-1",
          parts: [
            {
              state: "streaming",
              text: "分析中\n继续分析",
              type: "reasoning",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    const streamingText = container.querySelector('[data-streaming-text="true"]');

    expect(screen.getByText("正在思考")).toBeInTheDocument();
    expect(streamingText).not.toBeInTheDocument();
    expect(screen.queryByText("分析中\n继续分析")).not.toBeInTheDocument();
  });

  it("hides reasoning indicator after streaming finishes", () => {
    const message = {
      id: "assistant-1",
      parts: [
            {
              state: "streaming" as const,
              text: "还在分析布局。",
              type: "reasoning" as const,
            },
      ],
      role: "assistant" as const,
    };

    const { rerender } = render(
      <MessageParts isLastMessage isStreaming message={message} />,
    );

    expect(screen.getByText("正在思考")).toBeInTheDocument();

    rerender(<MessageParts isLastMessage isStreaming={false} message={message} />);

    expect(screen.queryByText("正在思考")).not.toBeInTheDocument();
  });

  it("shows only the latest streaming reasoning indicator", () => {
    render(
      <MessageParts
        isLastMessage
        isStreaming
        message={{
          id: "assistant-1",
          parts: [
            {
              state: "done",
              text: "第一段思考已完成。",
              type: "reasoning",
            },
            {
              state: "streaming",
              text: "第二段思考还在输出。",
              type: "reasoning",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getAllByText("正在思考")).toHaveLength(1);
    expect(screen.queryByText("第一段思考已完成。")).not.toBeInTheDocument();
    expect(screen.queryByText("第二段思考还在输出。")).not.toBeInTheDocument();
  });

  it("hides multiple completed reasoning parts", () => {
    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              state: "done",
              text: "第一步：判断信息架构。",
              type: "reasoning",
            },
            {
              state: "done",
              text: "第二步：组织首屏层级。",
              type: "reasoning",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.queryByText("思考过程")).not.toBeInTheDocument();
    expect(screen.queryByText("正在思考")).not.toBeInTheDocument();
    expect(screen.queryByText("第一步：判断信息架构。")).not.toBeInTheDocument();
    expect(screen.queryByText("第二步：组织首屏层级。")).not.toBeInTheDocument();
  });

  it("renders a simple completed edit tool description", () => {
    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              input: { path: "index.html", search: "old", replace: "new" },
              output: { path: "index.html", replacements: 1 },
              state: "output-available",
              toolCallId: "call-1",
              type: "tool-edit",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("已编辑index.html")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("参数")).not.toBeInTheDocument();
    expect(screen.queryByText("结果")).not.toBeInTheDocument();
    expect(screen.queryByText("old")).not.toBeInTheDocument();
    expect(screen.queryByText("new")).not.toBeInTheDocument();
  });

  it("renders a simple running edit tool description", () => {
    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              input: { path: "index.html", search: "old", replace: "new" },
              state: "input-available",
              toolCallId: "call-1",
              type: "tool-edit",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("正在编辑index.html")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("参数")).not.toBeInTheDocument();
  });

  it("renders simple read tool descriptions without output content", () => {
    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              input: { path: "pending.html" },
              state: "input-available",
              toolCallId: "call-1",
              type: "tool-read",
            },
            {
              input: { path: "done.html" },
              output: { content: "Secret Detail", path: "done.html" },
              state: "output-available",
              toolCallId: "call-2",
              type: "tool-read",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("正在查看pending.html")).toBeInTheDocument();
    expect(screen.getByText("已查看done.html")).toBeInTheDocument();
    expect(screen.queryByText("Secret Detail")).not.toBeInTheDocument();
    expect(screen.queryByText("参数")).not.toBeInTheDocument();
    expect(screen.queryByText("结果")).not.toBeInTheDocument();
  });

  it("renders preview update tools without a file fallback suffix", () => {
    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              input: {},
              output: {},
              state: "output-available",
              toolCallId: "call-1",
              type: "tool-callFrontendCapability",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("已更新预览")).toBeInTheDocument();
    expect(screen.queryByText("已更新预览文件")).not.toBeInTheDocument();
  });

  it("renders simple tool error descriptions without error details", () => {
    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              errorText: "权限不足",
              input: { path: "index.html" },
              output: undefined,
              state: "output-error",
              toolCallId: "call-1",
              type: "tool-write",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("写入index.html失败")).toBeInTheDocument();
    expect(screen.queryByText("权限不足")).not.toBeInTheDocument();
    expect(screen.queryByText("错误")).not.toBeInTheDocument();
  });

  it("renders failed workspace tool results as failures", () => {
    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              input: { path: "index.html" },
              output: { ok: false },
              state: "output-available",
              toolCallId: "call-1",
              type: "tool-write",
            },
            {
              input: { path: "missing.txt" },
              output: { ok: false },
              state: "output-available",
              toolCallId: "call-2",
              type: "tool-read",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("写入index.html失败")).toBeInTheDocument();
    expect(screen.getByText("查看missing.txt失败")).toBeInTheDocument();
    expect(screen.queryByText("已写入index.html")).not.toBeInTheDocument();
    expect(screen.queryByText("已查看missing.txt")).not.toBeInTheDocument();
  });

  it("uses sanitized output paths before tool input paths", () => {
    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              input: { path: "index.html" },
              output: { ok: true, path: "index.copy.html" },
              state: "output-available",
              toolCallId: "call-1",
              type: "tool-read",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("已查看index.copy.html")).toBeInTheDocument();
    expect(screen.queryByText("已查看index.html")).not.toBeInTheDocument();
  });

  it("does not dispatch preview refresh after mutation tool output completes", () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    vi.mocked(useChat).mockReturnValue({
      error: undefined,
      messages: [
        {
          id: "assistant-1",
          parts: [
            {
              input: { path: "index.html" },
              output: { path: "index.html", replacements: 1 },
              state: "output-available",
              toolCallId: "call-1",
              type: "tool-edit",
            },
          ],
          role: "assistant",
        },
      ],
      addToolApprovalResponse: vi.fn(),
      sendMessage: vi.fn(),
      status: "ready",
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(getProjectOutputUpdatedEvents(dispatchEventSpy)).toHaveLength(0);
    dispatchEventSpy.mockRestore();
  });

  it("emits conversation update after generation completes", () => {
    const useChatMock = vi.mocked(useChat);
    const onConversationUpdate = vi.fn();

    useChatMock.mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: "user-1",
          parts: [{ text: "设计一个 CRM 仪表盘", type: "text" }],
          role: "user",
        },
      ],
      sendMessage: vi.fn(),
      status: "streaming",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    const { rerender } = render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        onConversationUpdate={onConversationUpdate}
        projectId="project-1"
      />,
    );

    expect(onConversationUpdate).not.toHaveBeenCalled();

    useChatMock.mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: "user-1",
          parts: [{ text: "设计一个 CRM 仪表盘", type: "text" }],
          role: "user",
        },
        {
          id: "assistant-1",
          parts: [{ text: "已完成。", type: "text" }],
          role: "assistant",
        },
      ],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    rerender(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        onConversationUpdate={onConversationUpdate}
        projectId="project-1"
      />,
    );

    expect(onConversationUpdate).toHaveBeenCalledTimes(1);
    expect(onConversationUpdate.mock.calls[0]?.[0]).toMatchObject({
      id: "conversation-1",
      messages: [
        {
          id: "user-1",
          parts: [{ text: "设计一个 CRM 仪表盘", type: "text" }],
          role: "user",
        },
        {
          id: "assistant-1",
          parts: [{ text: "已完成。", type: "text" }],
          role: "assistant",
        },
      ],
      title: "设计一个 CRM 仪表盘",
    });
  });

  it("shows only the last message reasoning indicator while chat streams", () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: "assistant-1",
          parts: [
            {
              state: "streaming",
              text: "第一条思考不应因全局 streaming 显示。",
              type: "reasoning",
            },
          ],
          role: "assistant",
        },
        {
          id: "assistant-2",
          parts: [
            {
              state: "streaming",
              text: "最后一条思考应显示。",
              type: "reasoning",
            },
          ],
          role: "assistant",
        },
      ],
      sendMessage: vi.fn(),
      status: "streaming",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(screen.getAllByText("正在思考")).toHaveLength(1);
    expect(
      screen.queryByText("第一条思考不应因全局 streaming 显示。"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("最后一条思考应显示。")).not.toBeInTheDocument();
  });

  it("hides earlier reasoning when a later non-reasoning message streams", () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: "assistant-1",
          parts: [
            {
              state: "streaming",
              text: "历史思考不应显示。",
              type: "reasoning",
            },
          ],
          role: "assistant",
        },
        {
          id: "assistant-2",
          parts: [{ text: "正在写页面。", type: "text" }],
          role: "assistant",
        },
      ],
      sendMessage: vi.fn(),
      status: "streaming",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(screen.queryByText("正在思考")).not.toBeInTheDocument();
    expect(screen.queryByText("历史思考不应显示。")).not.toBeInTheDocument();
  });

  it("does not dispatch preview refresh after createHtml output completes", () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: "assistant-1",
          parts: [
            {
              input: { path: "index.html" },
              output: {
                path: "index.html",
                title: "OwnDesign Preview",
              },
              state: "output-available",
              toolCallId: "call-1",
              type: "tool-createHtml",
            },
          ],
          role: "assistant",
        },
      ],
      sendMessage: vi.fn(),
      status: "ready",
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(getProjectOutputUpdatedEvents(dispatchEventSpy)).toHaveLength(0);
    dispatchEventSpy.mockRestore();
  });

  it("includes current preview path in the chat transport body", () => {
    setCurrentPreviewPath("dashboard.html");
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | { transport: { api: string; body: () => Record<string, unknown> } }
      | undefined;
    const transport = useChatOptions?.transport;

    expect(transport).toBeDefined();
    expect(transport?.api).toBe("/api/chat");
    expect(transport?.body()).toEqual(
      expect.objectContaining({
        conversationId: "conversation-1",
        frontendTabId: "tab-1",
        pageEditMode: "auto",
        previewPath: "dashboard.html",
        projectId: "project-1",
      }),
    );
  });

  it("omits preview path from the chat transport body when no real preview file is published", () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | { transport: { body: () => Record<string, unknown> } }
      | undefined;

    expect(useChatOptions?.transport.body()).not.toHaveProperty("previewPath");
  });

  it("sends Anthropic effort selection in the chat transport body", async () => {
    const user = userEvent.setup();
    stubAnthropicSettings();
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "claude-sonnet-4-5 · high" }),
    );
    await user.hover(
      await screen.findByRole("menuitem", { name: "claude-sonnet-4-5" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "xhigh" }));

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | { transport: { body: () => Record<string, unknown> } }
      | undefined;

    expect(useChatOptions?.transport.body()).toEqual(
      expect.objectContaining({
        providerOptionsSelection: {
          anthropic: "xhigh",
        },
      }),
    );
  });

  it("renders the page edit mode select in the composer tool area", () => {
    stubOpenAICompatibleSettings();
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(screen.getByRole("combobox", { name: "页面模式" })).toHaveTextContent(
      "自动",
    );
  });

  it("sends the selected page edit mode in the chat transport body", async () => {
    const user = userEvent.setup();
    setCurrentPreviewPath("index.html");
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "页面模式" }));
    await user.click(await screen.findByRole("option", { name: "直接编辑" }));

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | { transport: { body: () => Record<string, unknown> } }
      | undefined;

    expect(useChatOptions?.transport.body()).toEqual(
      expect.objectContaining({
        pageEditMode: "direct_edit",
      }),
    );
  });

  it("submits the selected page edit mode in the send request body", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn();
    setCurrentPreviewPath("index.html");
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage,
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "页面模式" }));
    await user.click(await screen.findByRole("option", { name: "副本编辑" }));
    await user.type(screen.getByPlaceholderText(/输入消息/), "移除标题");
    await user.click(screen.getByRole("button", { name: "提交" }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(sendMessage.mock.calls[0]?.[1]).toEqual({
      body: expect.objectContaining({
        pageEditMode: "duplicate_edit",
        previewPath: "index.html",
      }),
    });
  });

  it("enables duplicate edit when the current preview path is published after render", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn();
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage,
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    act(() => {
      setCurrentPreviewPath("generated.html");
    });

    await user.click(screen.getByRole("combobox", { name: "页面模式" }));
    await user.click(await screen.findByRole("option", { name: "副本编辑" }));
    await user.type(screen.getByPlaceholderText(/输入消息/), "移除标题");
    await user.click(screen.getByRole("button", { name: "提交" }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(sendMessage.mock.calls[0]?.[1]).toEqual({
      body: expect.objectContaining({
        pageEditMode: "duplicate_edit",
        previewPath: "generated.html",
      }),
    });
  });

  it("configures stream resume for the current conversation active run", async () => {
    const setMessages = vi.fn();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.includes("/runs/active/snapshot")) {
          return Response.json({
            activeRun: {
              chunkCount: 2,
              conversationId: "conversation-1",
              createdAt: "2026-01-01T00:00:00.000Z",
              projectId: "project-1",
              runId: "run-1",
              status: "running",
            },
            messages: [
              {
                id: "user-1",
                parts: [{ text: "生成页面", type: "text" }],
                role: "user",
              },
            ],
            nextChunkIndex: 2,
          });
        }

        return Response.json({
          defaultModelId: "model-1",
          interfaceLanguage: "zh-CN",
          modelConfigurations: [],
        });
      }),
    );

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      setMessages,
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectActiveRun={{
          chunkCount: 1,
          conversationId: "conversation-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          projectId: "project-1",
          runId: "run-1",
          status: "running",
        }}
        projectId="project-1"
      />,
    );

    const useChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
      | {
          resume: boolean;
          transport: {
            prepareReconnectToStreamRequest?: () => { api: string };
          };
        }
      | undefined;

    expect(useChatOptions?.resume).toBe(false);
    expect(screen.queryByText("运行中")).not.toBeInTheDocument();
    expect(
      screen.queryByText("当前会话正在生成，刷新或切换回来会继续显示进度。"),
    ).not.toBeInTheDocument();

    await waitFor(() => {
      const latestUseChatOptions = vi.mocked(useChat).mock.calls.at(-1)?.[0] as
        | {
            resume: boolean;
            transport: {
              prepareReconnectToStreamRequest?: () => { api: string };
            };
          }
        | undefined;

      expect(latestUseChatOptions?.resume).toBe(true);
      expect(
        latestUseChatOptions?.transport.prepareReconnectToStreamRequest?.().api,
      ).toBe(
        "/api/projects/project-1/conversations/conversation-1/runs/active/stream?after=2",
      );
    });
    expect(setMessages).toHaveBeenCalledWith([
      {
        id: "user-1",
        parts: [{ text: "生成页面", type: "text" }],
        role: "user",
      },
    ]);
  });

  it("disables input when another conversation in the project is running", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage,
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-2"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectActiveRun={{
          chunkCount: 1,
          conversationId: "conversation-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          projectId: "project-1",
          runId: "run-1",
          status: "running",
        }}
        projectId="project-1"
      />,
    );

    expect(screen.getByPlaceholderText(/输入消息/)).toBeDisabled();
    expect(
      screen.getByText("当前项目已有任务正在执行，完成或停止后才能继续输入。"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "停止" }));

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stops streaming generation from the composer submit button", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn();
    const stop = vi.fn();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage,
      status: "streaming",
      stop,
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const stopButton = await screen.findByRole("button", { name: "停止" });

    expect(stopButton).not.toBeDisabled();

    await user.click(stopButton);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stops submitted generation from the composer submit button", async () => {
    const user = userEvent.setup();
    const stop = vi.fn();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "submitted",
      stop,
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const stopButton = await screen.findByRole("button", { name: "停止" });

    expect(stopButton).not.toBeDisabled();

    await user.click(stopButton);

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the ready submit button disabled when no model is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          defaultModelId: null,
          interfaceLanguage: "zh-CN",
          modelConfigurations: [],
        }),
      ),
    );
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(await screen.findByRole("button", { name: "提交" })).toBeDisabled();
  });

  it("renders the attachment action menu", async () => {
    const user = userEvent.setup();
    const inputClickSpy = vi.spyOn(HTMLInputElement.prototype, "click");
    stubOpenAICompatibleSettings();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "添加附件" }));

    const addItem = await screen.findByText("添加图片或文件");
    expect(addItem).toBeInTheDocument();

    await user.click(addItem);

    expect(inputClickSpy).toHaveBeenCalled();
    inputClickSpy.mockRestore();
  });

  it("hides attachment controls for DeepSeek models", async () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(screen.queryByRole("button", { name: "添加附件" })).not.toBeInTheDocument();
  });

  it("clears attachments after switching to a DeepSeek model", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          defaultModelId: "model-openai",
          interfaceLanguage: "zh-CN",
          modelConfigurations: [
            {
              apiKey: "",
              baseUrl: "https://example.test/v1",
              contextSizeK: 200,
              hasApiKey: true,
              id: "model-openai",
              model: "gpt-4o",
              provider: "openai-compatible",
            },
            {
              apiKey: "",
              baseUrl: "",
              contextSizeK: 1000,
              hasApiKey: true,
              id: "model-deepseek",
              model: "deepseek-v4-flash",
              provider: "deepseek",
            },
          ],
        }),
      ),
    );

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    await user.upload(
      screen.getByLabelText("上传文件"),
      new File([new Uint8Array(1024)], "reference.png", {
        type: "image/png",
      }),
    );

    expect(screen.getByText("reference.png")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "gpt-4o" }));
    await user.click(await screen.findByText("deepseek-v4-flash"));

    expect(screen.queryByText("reference.png")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加附件" })).not.toBeInTheDocument();
  });

  it("shows image attachment previews", async () => {
    const user = userEvent.setup();
    stubOpenAICompatibleSettings();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const input = screen.getByLabelText("上传文件");
    const file = new File([new Uint8Array(1024)], "hero.png", {
      type: "image/png",
    });

    await user.upload(input, file);

    expect(screen.getByText("hero.png")).toBeInTheDocument();
    expect(screen.getByText("1 KB")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "hero.png" })).toHaveAttribute(
      "src",
      "blob:hero.png",
    );
  });

  it("shows file attachment previews and removes them", async () => {
    const user = userEvent.setup();
    stubOpenAICompatibleSettings();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const input = screen.getByLabelText("上传文件");
    const file = new File([new Uint8Array(2048)], "brief.pdf", {
      type: "application/pdf",
    });

    await user.upload(input, file);

    expect(screen.getByText("brief.pdf")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "brief.pdf" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "移除 brief.pdf" }));

    expect(screen.queryByText("brief.pdf")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:brief.pdf");
  });

  it("sends attachment-only messages with files", async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn();
    stubOpenAICompatibleSettings();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage,
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const input = screen.getByLabelText("上传文件");
    const file = new File([new Uint8Array(1024)], "reference.png", {
      type: "image/png",
    });

    await user.upload(input, file);
    await user.click(await screen.findByRole("button", { name: "提交" }));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(
        {
          files: [
            expect.objectContaining({
              filename: "reference.png",
              mediaType: "image/png",
              type: "file",
            }),
          ],
          text: "",
        },
        {
          body: expect.objectContaining({
            pageEditMode: "auto",
          }),
        },
      );
    });
  });

  it("limits attachment count and size", async () => {
    const user = userEvent.setup();
    stubOpenAICompatibleSettings();

    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    const input = screen.getByLabelText("上传文件");
    const files = Array.from({ length: 9 }, (_, index) =>
      new File([new Uint8Array(1024)], `asset-${index + 1}.txt`, {
        type: "text/plain",
      }),
    );

    await user.upload(input, files);

    expect(screen.getByText("asset-8.txt")).toBeInTheDocument();
    expect(screen.queryByText("asset-9.txt")).not.toBeInTheDocument();

    const oversized = new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "large.zip",
      { type: "application/zip" },
    );

    await user.upload(input, oversized);

    expect(screen.queryByText("large.zip")).not.toBeInTheDocument();
  });

  it("renders context usage next to model selection", async () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(await screen.findByRole("button", { name: "上下文 0%" })).toBeInTheDocument();
  });

  it("updates context usage from latest assistant message metadata", async () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: "assistant-1",
          metadata: {
            contextUsage: {
              inputTokens: 8000,
              outputTokens: 2000,
              totalTokens: 10000,
            },
          },
          parts: [{ text: "完成。", type: "text" }],
          role: "assistant",
        },
      ],
      sendMessage: vi.fn(),
      status: "ready",
      stop: vi.fn(),
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(await screen.findByRole("button", { name: "上下文 1%" })).toBeInTheDocument();
  });

  it("does not configure chat approval continuation", () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [],
      sendMessage: vi.fn(),
      status: "ready",
    } as unknown as ReturnType<typeof useChat>);

    render(
      <StreamingConversationPanel
        conversationId="conversation-1"
        conversationTitle="新建会话"
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(useChat).toHaveBeenCalledWith(
      expect.not.objectContaining({
        sendAutomaticallyWhen: expect.anything(),
      }),
    );
  });
});
