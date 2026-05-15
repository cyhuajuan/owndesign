import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useChat } from "@ai-sdk/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MessageParts,
  StreamingConversationPanel,
} from "./streaming-conversation-panel";

vi.mock("@ai-sdk/react", () => ({
  useChat: vi.fn(),
}));

afterEach(() => {
  vi.mocked(useChat).mockReset();
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
          state: "streaming",
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

  it("summarizes file tool calls without rendering full file content", () => {
    const content = "<!doctype html><html><body><main>Secret Detail</main></body></html>";

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
              type: "tool-writeFile",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("writeFile")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("index.html")).toBeInTheDocument();
    expect(screen.queryByText("Secret Detail")).not.toBeInTheDocument();
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
              type: "tool-editFile",
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
});
