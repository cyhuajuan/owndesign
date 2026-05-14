import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { ChatShell } from "./chat-shell";

describe("ChatShell", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
      screen.queryAllByRole("region", { name: "会话工作流" }),
    ).toHaveLength(0);

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
      screen.queryAllByRole("region", { name: "会话工作流" }),
    ).toHaveLength(0);

    firstRender.unmount();
    render(<ChatShell />);

    expect(
      screen.queryAllByRole("region", { name: "会话工作流" }),
    ).toHaveLength(0);
    expect(
      screen.getAllByRole("button", { name: "展开会话面板" }),
    ).not.toHaveLength(0);
  });
});
