import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MessageParts } from "./streaming-conversation-panel";

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

  it("summarizes writeHtmlFile tool calls without rendering full HTML", () => {
    const html = "<!doctype html><html><body><main>Secret Detail</main></body></html>";

    render(
      <MessageParts
        message={{
          id: "assistant-1",
          parts: [
            {
              input: { html },
              output: {
                outputPath: "C:/tmp/project/workspace/index.html",
                outputType: "html",
              },
              state: "output-available",
              toolCallId: "call-1",
              type: "tool-writeHtmlFile",
            },
          ],
          role: "assistant",
        }}
      />,
    );

    expect(screen.getByText("writeHtmlFile")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText(String(html.length))).toBeInTheDocument();
    expect(screen.getByText("C:/tmp/project/workspace/index.html")).toBeInTheDocument();
    expect(screen.queryByText("Secret Detail")).not.toBeInTheDocument();
  });
});
