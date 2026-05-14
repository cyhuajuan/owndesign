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

    expect(screen.getByRole("region", { name: "Conversation workflow" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Preview pane" })).toBeInTheDocument();
  });

  it("collapses and re-expands the conversation workflow from the preview header toggle", async () => {
    const user = userEvent.setup();

    render(<ChatShell />);
    const [previewPane] = screen.getAllByRole("region", { name: "Preview pane" });

    await user.click(
      within(previewPane).getByRole("button", {
        name: "Collapse conversation pane",
      }),
    );

    expect(
      screen.queryAllByRole("region", { name: "Conversation workflow" }),
    ).toHaveLength(0);

    await user.click(
      within(previewPane).getByRole("button", { name: "Expand conversation pane" }),
    );

    expect(
      screen.getAllByRole("region", { name: "Conversation workflow" }),
    ).not.toHaveLength(0);
  });

  it("remembers collapsed state across remounts", async () => {
    const user = userEvent.setup();
    const firstRender = render(<ChatShell />);
    const [previewPane] = screen.getAllByRole("region", { name: "Preview pane" });

    await user.click(
      within(previewPane).getByRole("button", {
        name: "Collapse conversation pane",
      }),
    );

    expect(
      screen.queryAllByRole("region", { name: "Conversation workflow" }),
    ).toHaveLength(0);

    firstRender.unmount();
    render(<ChatShell />);

    expect(
      screen.queryAllByRole("region", { name: "Conversation workflow" }),
    ).toHaveLength(0);
    expect(
      screen.getAllByRole("button", { name: "Expand conversation pane" }),
    ).not.toHaveLength(0);
  });
});
