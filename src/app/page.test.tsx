import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Home from "./page";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/owndesign", () => ({
  createConversationService: () => ({
    getConversationState: vi.fn().mockResolvedValue({ conversations: [] }),
  }),
  createProjectService: () => ({
    getProjectState: vi.fn().mockResolvedValue({ projects: [] }),
  }),
}));

vi.mock("@/components/chat-shell", () => ({
  ChatShell: ({
    previewBody,
  }: {
    previewBody?: ReactNode;
  }) => (
    <div>
      <section aria-label="预览面板">{previewBody}</section>
    </div>
  ),
}));

vi.mock("@/components/control-bar", () => ({
  ControlBar: () => <div />,
}));

describe("Home page", () => {
  it("renders unified preview empty state when no active project exists", async () => {
    render(await Home({ searchParams: Promise.resolve({}) }));

    const previewPane = screen.getByRole("region", { name: "预览面板" });

    expect(
      within(previewPane).getByText("尚无预览内容"),
    ).toBeInTheDocument();
    expect(
      within(previewPane).getByText(
        "在对话中向 AI 描述你的设计需求，生成的页面将在此处实时预览。",
      ),
    ).toBeInTheDocument();
    expect(within(previewPane).getByText("Preview")).toBeInTheDocument();
  });
});
