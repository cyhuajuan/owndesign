import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatShell } from "./chat-shell";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({
    replace: replaceMock,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("ChatShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
    replaceMock.mockClear();
  });

  it("renders conversation workflow and preview regions", () => {
    render(<ChatShell />);

    expect(screen.getByRole("region", { name: "会话工作流" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "预览面板" })).toBeInTheDocument();
  });

  it("collapses and re-expands the conversation workflow from the preview header toggle", async () => {
    const user = userEvent.setup();

    render(<ChatShell />);
    const [previewPane] = screen.getAllByRole("region", { name: "预览面板" });

    await user.click(
      within(previewPane).getByRole("button", {
        name: "收起会话面板",
      }),
    );

    expect(
      within(previewPane).getByRole("button", { name: "展开会话面板" }),
    ).toBeInTheDocument();

    await user.click(
      within(previewPane).getByRole("button", { name: "展开会话面板" }),
    );

    expect(
      screen.getAllByRole("region", { name: "会话工作流" }),
    ).not.toHaveLength(0);
  });

  it("remembers collapsed state across remounts", async () => {
    const user = userEvent.setup();
    const firstRender = render(<ChatShell />);
    const [previewPane] = screen.getAllByRole("region", { name: "预览面板" });

    await user.click(
      within(previewPane).getByRole("button", {
        name: "收起会话面板",
      }),
    );

    expect(
      within(previewPane).getByRole("button", { name: "展开会话面板" }),
    ).toBeInTheDocument();

    firstRender.unmount();
    render(<ChatShell />);

    expect(
      screen.getAllByRole("button", { name: "展开会话面板" }),
    ).not.toHaveLength(0);
  });

  it("renders preview HTML selector from preview file events", async () => {
    const user = userEvent.setup();

    render(<ChatShell />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("hjdesign:preview-files-updated", {
          detail: {
            activePath: "index.html",
            files: ["index.html", "dashboard.html", "pages/detail.html"],
          },
        }),
      );
    });

    await user.click(screen.getByRole("combobox", { name: "切换预览 HTML" }));
    await user.click(screen.getByRole("option", { name: "dashboard.html" }));

    expect(replaceMock).toHaveBeenCalledWith("/?previewPath=dashboard.html", {
      scroll: false,
    });
  });
});
