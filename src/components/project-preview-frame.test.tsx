import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectPreviewFrame } from "./project-preview-frame";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

describe("ProjectPreviewFrame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})) as typeof fetch,
    );
  });

  it("renders styled loading empty state before preview session resolves", () => {
    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    expect(screen.getByText("预览服务启动中")).toBeInTheDocument();
    expect(
      screen.getByText(
        "正在为当前项目启动预览环境。准备完成后，这里会自动显示最新页面。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });
});
