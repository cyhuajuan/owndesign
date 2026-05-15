import { render, screen } from "@testing-library/react";
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

    expect(screen.getByText("思考过程")).toBeInTheDocument();
    expect(screen.getByText("需要先判断信息架构。")).toBeInTheDocument();
  });

  it("consolidates multiple reasoning parts into one block", () => {
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

    expect(screen.getAllByText("思考过程")).toHaveLength(1);
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
