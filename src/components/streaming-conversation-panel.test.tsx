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

vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(),
}));

beforeEach(() => {
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
            hasApiKey: true,
            id: "model-1",
            model: "deepseek-chat",
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

  it("truncates long tool error text", async () => {
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
    expect(screen.queryAllByText(hasTextContent("-error-tail"))).toHaveLength(
      0,
    );
  });

  it("renders CDN approval requests and responds to approval decisions", async () => {
    const user = userEvent.setup();
    const onToolApprovalResponse = vi.fn();

    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              approval: { id: "approval-1" },
              input: {
                resourceType: "script",
                url: "https://cdn.example.com/app.js",
              },
              state: "approval-requested",
              toolCallId: "call-1",
              type: "tool-addCdnResource",
            },
          ],
          role: "assistant",
        }}
        onToolApprovalResponse={onToolApprovalResponse}
      />,
    );

    expect(screen.getByText("需要批准 CDN 资源")).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/cdn\.example\.com\/app\.js/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(onToolApprovalResponse).toHaveBeenCalledWith({
      approved: true,
      id: "approval-1",
    });

    await user.click(screen.getByRole("button", { name: "拒绝" }));
    expect(onToolApprovalResponse).toHaveBeenCalledWith({
      approved: false,
      id: "approval-1",
      reason: "User denied CDN resource",
    });
  });

  it("renders CDN approval outcomes", () => {
    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              approval: { approved: false, id: "approval-1" },
              input: {
                resourceType: "stylesheet",
                url: "https://cdn.example.com/app.css",
              },
              state: "output-denied",
              toolCallId: "call-1",
              type: "tool-addCdnResource",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("已拒绝 CDN 添加。")).toBeInTheDocument();
  });

  it("dispatches preview refresh after mutation tool output completes", () => {
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
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "hjdesign:project-output-updated",
      }),
    );
    dispatchEventSpy.mockRestore();
  });

  it("dispatches preview refresh after CDN resource output completes", () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    vi.mocked(useChat).mockReturnValue({
      addToolApprovalResponse: vi.fn(),
      error: undefined,
      messages: [
        {
          id: "assistant-1",
          parts: [
            {
              approval: { approved: true, id: "approval-1" },
              input: {
                resourceType: "stylesheet",
                url: "https://cdn.example.com/app.css",
              },
              output: {
                added: true,
                path: "index.html",
                resourceType: "stylesheet",
                url: "https://cdn.example.com/app.css",
              },
              state: "output-available",
              toolCallId: "call-1",
              type: "tool-addCdnResource",
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
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(dispatchEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "hjdesign:project-output-updated",
      }),
    );
    dispatchEventSpy.mockRestore();
  });

  it("configures chat to continue after tool approval responses", () => {
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
        initialMessages={[]}
        projectId="project-1"
      />,
    );

    expect(useChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sendAutomaticallyWhen: expect.any(Function),
      }),
    );
  });
});
