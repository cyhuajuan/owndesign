import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InitialSetupGuide } from "./initial-setup-guide";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => "model-1"),
  });
  push.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InitialSetupGuide", () => {
  it("defaults to simplified Chinese", () => {
    render(<InitialSetupGuide onComplete={vi.fn()} />);

    expect(screen.getByText("选择界面语言")).toBeInTheDocument();
    expect(screen.getByText("简体中文")).toBeInTheDocument();
    expect(screen.getByText("Chinese (Simplified)")).toBeInTheDocument();
  });

  it("switches language and summarizes configured model", async () => {
    const user = userEvent.setup();

    render(<InitialSetupGuide onComplete={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /English English \(US\)/ }));
    await user.click(screen.getByRole("button", { name: /继续/ }));
    await user.click(screen.getByRole("button", { name: /继续/ }));

    expect(screen.getByText("确认你的初始设置，随时可以进入主界面开始设计。")).toBeInTheDocument();
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(
      screen.getByText((content) =>
        content.includes("OpenAI Compatible") && content.includes("gpt-4o"),
      ),
    ).toBeInTheDocument();
  });

  it("completes setup and navigates to returned href", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue({
      href: "/?projectId=project-1&conversationId=conversation-1",
    });

    render(<InitialSetupGuide onComplete={onComplete} />);

    await user.click(screen.getByRole("button", { name: /继续/ }));
    await user.click(screen.getByRole("button", { name: /继续/ }));
    await user.click(screen.getByRole("button", { name: /进入主界面/ }));

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        interfaceLanguage: "zh-CN",
        modelConfigurations: [
          expect.objectContaining({
            apiKey: "sk-...",
            baseUrl: "https://api.openai.com/v1",
            contextSizeK: 200,
            id: "model-1",
            model: "gpt-4o",
            provider: "openai-compatible",
          }),
        ],
      }),
    );

    await waitFor(
      () =>
        expect(push).toHaveBeenCalledWith(
          "/?projectId=project-1&conversationId=conversation-1",
        ),
      { timeout: 2000 },
    );
  });
});
