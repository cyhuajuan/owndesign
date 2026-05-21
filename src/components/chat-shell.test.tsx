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

vi.mock("@/components/frontend-capability-bridge", () => ({
  FrontendCapabilityBridge: () => null,
}));

describe("ChatShell", () => {
  const anchorClicks: string[] = [];

  beforeEach(() => {
    window.localStorage.clear();
    replaceMock.mockClear();
    anchorClicks.length = 0;
    vi.restoreAllMocks();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string, options?: ElementCreationOptions) => {
        const element = originalCreateElement(tagName, options);

        if (tagName.toLowerCase() === "a") {
          Object.defineProperty(element, "click", {
            configurable: true,
            value() {
              anchorClicks.push((element as HTMLAnchorElement).href);
            },
          });
        }

        return element;
      }) as typeof document.createElement,
    );
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

  it("renders icon-only download menu before refresh button and shows both download actions", async () => {
    const user = userEvent.setup();

    render(<ChatShell previewProjectId="project-1" />);

    const previewPane = screen.getByRole("region", { name: "预览面板" });
    const downloadButton = within(previewPane).getByRole("button", { name: "下载" });
    const refreshButton = within(previewPane).getByRole("button", {
      name: "刷新预览",
    });
    const headerButtons = within(previewPane).getAllByRole("button");

    expect(headerButtons.indexOf(downloadButton)).toBeLessThan(
      headerButtons.indexOf(refreshButton),
    );
    expect(downloadButton).toHaveAccessibleName("下载");
    expect(downloadButton).not.toHaveTextContent("下载");

    await user.click(downloadButton);

    expect(await screen.findByText("下载当前HTML")).toBeInTheDocument();
    expect(await screen.findByText("下载全部打包成ZIP")).toBeInTheDocument();
  });

  it("disables the download trigger when no active project exists", () => {
    render(<ChatShell />);

    expect(screen.getByRole("button", { name: "下载" })).toBeDisabled();
  });

  it("downloads current preview html using the active preview path", async () => {
    const user = userEvent.setup();

    render(<ChatShell previewProjectId="project-1" />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("hjdesign:preview-files-updated", {
          detail: {
            activePath: "pages/detail.html",
            files: ["index.html", "pages/detail.html"],
          },
        }),
      );
    });

    await user.click(screen.getByRole("button", { name: "下载" }));
    await user.click(await screen.findByText("下载当前HTML"));

    expect(anchorClicks).toEqual([
      "http://localhost:3000/api/projects/project-1/download?kind=current-html&previewPath=pages%2Fdetail.html",
    ]);
  });
});
