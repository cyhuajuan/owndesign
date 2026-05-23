import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useChat } from "@ai-sdk/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MessageParts,
  StreamingConversationPanel,
} from "./streaming-conversation-panel";

function hasTextContent(text: string) {
  return (_: string, node: Element | null) => node?.textContent?.includes(text) ?? false;
}

const TOOL_DISPLAY_STRING_LIMIT = 100;

function buildLongString(prefix: string, tail = "-hidden-tail") {
  return prefix.repeat(TOOL_DISPLAY_STRING_LIMIT) + tail;
}

function getProjectOutputUpdatedEvents(dispatchEventSpy: ReturnType<typeof vi.spyOn>) {
  return dispatchEventSpy.mock.calls.filter(
    ([event]: [Event]) => event.type === "owndesign:project-output-updated",
  );
}

const routingMocks = vi.hoisted(() => ({
  pathname: "/",
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => routingMocks.pathname,
  useRouter: () => ({
    replace: routingMocks.replace,
  }),
  useSearchParams: () => routingMocks.searchParams,
}));

vi.mock("@/features/preview/components/frontend-capability-bridge", () => ({
  FRONTEND_TAB_ID: "tab-1",
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");

  class MockDefaultChatTransport {
    api: string;
    body: Record<string, unknown>;

    constructor(options: { api: string; body: Record<string, unknown> }) {
      this.api = options.api;
      this.body = options.body;
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
  routingMocks.pathname = "/";
  routingMocks.replace.mockReset();
  routingMocks.searchParams = new URLSearchParams();
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

describe("MessageParts", () => {
  it("renders reasoning parts", () => {
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

    expect(screen.getByRole("button", { name: /思考过程/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("shows reasoning content after expanding", async () => {
    const user = userEvent.setup();

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

    await user.click(screen.getByRole("button", { name: /思考过程/ }));

    expect(screen.getByText("需要先判断信息架构。")).toBeInTheDocument();
  });

  it("opens the currently streaming reasoning by default", () => {
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

    expect(screen.getByRole("button", { name: /思考过程/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("auto-closes reasoning after streaming finishes", () => {
    vi.useFakeTimers();

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

    const trigger = screen.getByRole("button", { name: /思考过程/ });
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    rerender(<MessageParts isLastMessage isStreaming={false} message={message} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(trigger).toHaveAttribute("aria-expanded", "false");

    vi.useRealTimers();
  });

  it("keeps earlier reasoning collapsed when a later reasoning part streams", () => {
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

    const reasoningTriggers = screen.getAllByRole("button", {
      name: /思考过程/,
    });

    expect(reasoningTriggers[0]).toHaveAttribute("aria-expanded", "false");
    expect(reasoningTriggers[1]).toHaveAttribute("aria-expanded", "true");
  });

  it("renders multiple reasoning parts as separate blocks", async () => {
    const user = userEvent.setup();

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

    expect(screen.getAllByText("思考过程")).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: /思考过程/ })[0]);
    await user.click(screen.getAllByRole("button", { name: /思考过程/ })[1]);

    expect(screen.getByText("第一步：判断信息架构。")).toBeInTheDocument();
    expect(screen.getByText("第二步：组织首屏层级。")).toBeInTheDocument();
  });

  it("renders completed tool calls collapsed by default and expands on click", async () => {
    const content = "<!doctype html><html><body><main>Secret Detail</main></body></html>";
    const user = userEvent.setup();

    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              input: {
                content,
                path: "index.html",
              },
              output: {
                bytesWritten: content.length,
                path: "index.html",
              },
              state: "output-available",
              toolCallId: "call-1",
              type: "tool-write",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: /write/ });
    expect(trigger).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.queryByText("参数")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("参数")).toBeInTheDocument();
    expect(screen.getByText("结果")).toBeInTheDocument();
    expect(
      screen.queryAllByText(hasTextContent('"path": "index.html"')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(hasTextContent("Secret Detail")).length,
    ).toBeGreaterThan(0);
  });

  it("renders tool errors collapsed by default and expands on click", async () => {
    const user = userEvent.setup();

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

    const trigger = screen.getByRole("button", { name: /write/ });
    expect(trigger).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("失败")).toBeInTheDocument();
    expect(screen.queryByText("错误")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("错误")).toBeInTheDocument();
    expect(screen.getByText("权限不足")).toBeInTheDocument();
  });

  it("renders input-only tool calls without crashing", async () => {
    const user = userEvent.setup();

    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              input: { path: "index.html", pattern: "hero" },
              state: "input-available",
              toolCallId: "call-1",
              type: "tool-grep",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: /grep/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("准备调用")).toBeInTheDocument();

    await user.click(trigger);

    expect(screen.getByText("参数")).toBeInTheDocument();
    expect(
      screen.queryAllByText(hasTextContent('"path": "index.html"')).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("结果")).not.toBeInTheDocument();
  });

  it("truncates tool input strings before rendering JSON", async () => {
    const longContent = buildLongString("a");
    const nestedContent = buildLongString("b", "-nested-tail");
    const listContent = buildLongString("c", "-list-tail");
    const user = userEvent.setup();

    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              input: {
                content: longContent,
                nested: {
                  body: nestedContent,
                  enabled: true,
                  none: null,
                  revisions: 2,
                },
                path: "index.html",
                snippets: [listContent, 7],
              },
              state: "input-available",
              toolCallId: "call-1",
              type: "tool-write",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /write/ }));

    expect(
      screen.queryAllByText(hasTextContent(`"content": "${"a".repeat(100)}`))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(hasTextContent(`"body": "${"b".repeat(100)}`))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(hasTextContent(`"${"c".repeat(100)}`)).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(hasTextContent("-hidden-tail")),
    ).toHaveLength(0);
    expect(
      screen.queryAllByText(hasTextContent("-nested-tail")),
    ).toHaveLength(0);
    expect(screen.queryAllByText(hasTextContent("-list-tail"))).toHaveLength(0);
    expect(
      screen.queryAllByText(hasTextContent('"path": "index.html"')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(hasTextContent('"enabled": true')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(hasTextContent('"none": null')).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(hasTextContent('"revisions": 2')).length,
    ).toBeGreaterThan(0);
  });

  it("truncates tool output strings before rendering", async () => {
    const longObjectOutput = buildLongString("o", "-object-output-tail");
    const longStringOutput = buildLongString("s", "-string-output-tail");
    const user = userEvent.setup();

    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              input: { path: "object-output.html" },
              output: {
                content: longObjectOutput,
                ok: true,
              },
              state: "output-available",
              toolCallId: "call-1",
              type: "tool-read",
            },
            {
              input: { path: "string-output.html" },
              output: longStringOutput,
              state: "output-available",
              toolCallId: "call-2",
              type: "tool-read",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    const triggers = screen.getAllByRole("button", { name: /read/ });
    await user.click(triggers[0]);
    await user.click(triggers[1]);

    expect(
      screen.queryAllByText(hasTextContent(`"content": "${"o".repeat(100)}`))
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(hasTextContent("s".repeat(100))).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(hasTextContent("-object-output-tail")),
    ).toHaveLength(0);
    expect(
      screen.queryAllByText(hasTextContent("-string-output-tail")),
    ).toHaveLength(0);
    expect(
      screen.queryAllByText(hasTextContent('"ok": true')).length,
    ).toBeGreaterThan(0);
  });

  it("renders long tool error text without truncation", async () => {
    const longError = buildLongString("e", "-error-tail");
    const user = userEvent.setup();

    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              errorText: longError,
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

    await user.click(screen.getByRole("button", { name: /write/ }));

    expect(
      screen.queryAllByText(hasTextContent("e".repeat(100))).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText(hasTextContent("-error-tail")).length,
    ).toBeGreaterThan(0);
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

  it("marks only the last message reasoning as streaming while chat streams", () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: "assistant-1",
          parts: [
            {
              state: "streaming",
              text: "第一条思考不应因全局 streaming 展开。",
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
              text: "最后一条思考应展开。",
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

    const reasoningTriggers = screen.getAllByRole("button", {
      name: /思考过程/,
    });

    expect(reasoningTriggers[0]).toHaveAttribute("aria-expanded", "false");
    expect(reasoningTriggers[1]).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps earlier reasoning collapsed when a later non-reasoning message streams", () => {
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: "assistant-1",
          parts: [
            {
              state: "streaming",
              text: "历史思考不应展开。",
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

    expect(screen.getByRole("button", { name: /思考过程/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
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
    routingMocks.searchParams = new URLSearchParams("previewPath=dashboard.html");
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

    expect(useChat).toHaveBeenCalledWith(
      expect.objectContaining({
        transport: expect.objectContaining({
          api: "/api/chat",
        body: expect.objectContaining({
          conversationId: "conversation-1",
          frontendTabId: "tab-1",
          previewPath: "dashboard.html",
          projectId: "project-1",
          }),
        }),
      }),
    );
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

    expect(sendMessage).toHaveBeenCalledWith({
      files: [
        expect.objectContaining({
          filename: "reference.png",
          mediaType: "image/png",
          type: "file",
        }),
      ],
      text: "",
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
