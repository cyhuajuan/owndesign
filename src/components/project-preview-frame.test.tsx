import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectPreviewFrame } from "./project-preview-frame";

const navigationMocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigationMocks.searchParams,
}));

describe("ProjectPreviewFrame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationMocks.searchParams = new URLSearchParams();
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

  it("requests a preview session with the selected preview path", async () => {
    navigationMocks.searchParams = new URLSearchParams(
      "previewPath=dashboard.html",
    );
    const fetchMock = mockPreviewFetch();

    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await waitFor(() => {
      expect(getSessionPosts(fetchMock)).toHaveLength(1);
    });

    expect(parseBody(getSessionPosts(fetchMock)[0])).toMatchObject({
      previewPath: "dashboard.html",
    });
  });

  it("does not release the preview session when only the preview path changes", async () => {
    navigationMocks.searchParams = new URLSearchParams(
      "previewPath=index.html",
    );
    const fetchMock = mockPreviewFetch();

    const { rerender } = render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await waitFor(() => {
      expect(getSessionPosts(fetchMock)).toHaveLength(1);
    });

    navigationMocks.searchParams = new URLSearchParams(
      "previewPath=dashboard.html",
    );
    rerender(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await waitFor(() => {
      expect(getSessionPosts(fetchMock)).toHaveLength(2);
    });

    expect(getDeletes(fetchMock)).toHaveLength(0);
    expect(parseBody(getSessionPosts(fetchMock)[1])).toMatchObject({
      previewPath: "dashboard.html",
    });
  });

  it("releases the preview session when the frame unmounts", async () => {
    const fetchMock = mockPreviewFetch();

    const { unmount } = render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await waitFor(() => {
      expect(getSessionPosts(fetchMock)).toHaveLength(1);
    });

    unmount();

    expect(getDeletes(fetchMock)).toHaveLength(1);
    expect(getCallUrl(getDeletes(fetchMock)[0])).toBe(
      "/api/projects/project-1/preview-session",
    );
    expect(parseBody(getDeletes(fetchMock)[0])).toEqual({
      clientId: expect.any(String),
    });
  });

  it("releases the old project and acquires the new one when projectId changes", async () => {
    const fetchMock = mockPreviewFetch();

    const { rerender } = render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await waitFor(() => {
      expect(getSessionPosts(fetchMock)).toHaveLength(1);
    });

    rerender(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-2"
        projectName="Project Two"
      />,
    );

    await waitFor(() => {
      expect(getSessionPosts(fetchMock)).toHaveLength(2);
      expect(getDeletes(fetchMock)).toHaveLength(1);
    });

    expect(getCallUrl(getDeletes(fetchMock)[0])).toBe(
      "/api/projects/project-1/preview-session",
    );
    expect(getCallUrl(getSessionPosts(fetchMock)[1])).toBe(
      "/api/projects/project-2/preview-session",
    );
  });
});

function mockPreviewFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      previewPath?: string;
    };
    const activePath = body.previewPath ?? "index.html";

    return Response.json({
      activePath,
      files: ["index.html", "dashboard.html"],
      url: `http://127.0.0.1:3000/${activePath}`,
    });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function getSessionPosts(fetchMock: ReturnType<typeof mockPreviewFetch>) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      init?.method === "POST" && getCallUrl([input, init]).endsWith("/preview-session"),
  );
}

function getDeletes(fetchMock: ReturnType<typeof mockPreviewFetch>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");
}

function getCallUrl(call: unknown[]) {
  return String(call[0]);
}

function parseBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit | undefined)?.body ?? "{}"));
}
