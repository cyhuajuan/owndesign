import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectPreviewFrame } from "./project-preview-frame";
import {
  getCurrentPreviewPath,
  setCurrentPreviewPath,
} from "@/features/preview/preview-path";

describe("ProjectPreviewFrame", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/");
    setCurrentPreviewPath(undefined);
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
    window.history.replaceState(null, "", "/?previewPath=dashboard.html");
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

  it("publishes the active preview path returned by the initial preview session", async () => {
    const fetchMock = mockPreviewFetch("generated.html");

    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await screen.findByTitle("Project One HTML 预览");

    expect(getSessionPosts(fetchMock)).toHaveLength(1);
    expect(window.location.search).toBe("");
    expect(getCurrentPreviewPath()).toBe("generated.html");
  });

  it("does not release the preview session when only the preview path changes", async () => {
    window.history.replaceState(null, "", "/?previewPath=index.html");
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

    window.history.replaceState(null, "", "/?previewPath=dashboard.html");
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

  it("syncs the route when the iframe load heartbeat reports a new HTML path", async () => {
    const fetchMock = mockPreviewFetch();

    const { rerender } = render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    const iframe = await screen.findByTitle("Project One HTML 预览");
    fetchMock.mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        previewPath?: string;
      };

      return Response.json({
        activePath: body.previewPath ?? "pages/about.html",
        files: ["index.html", "pages/about.html"],
        url: `http://127.0.0.1:3000/${body.previewPath ?? "pages/about.html"}`,
      });
    });

    fireEvent.load(iframe);

    await waitFor(() => {
      expect(window.location.search).toBe("?previewPath=pages%2Fabout.html");
    });

    const heartbeatCalls = getHeartbeatPosts(fetchMock);
    expect(parseBody(heartbeatCalls.at(-1)!)).toEqual({
      clientId: expect.any(String),
    });

    window.history.replaceState(null, "", "/?previewPath=pages%2Fabout.html");
    rerender(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getSessionPosts(fetchMock)).toHaveLength(1);
    expect(screen.getByTitle("Project One HTML 预览")).toBe(iframe);
  });

  it("does not replace the route when iframe load keeps the same HTML path", async () => {
    window.history.replaceState(null, "", "/?previewPath=dashboard.html");
    const fetchMock = mockPreviewFetch();

    render(
      <ProjectPreviewFrame
        initialUpdatedAt="2026-05-15T00:00:00.000Z"
        projectId="project-1"
        projectName="Project One"
      />,
    );

    const iframe = await screen.findByTitle("Project One HTML 预览");
    fetchMock.mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        previewPath?: string;
      };

      return Response.json({
        activePath: body.previewPath ?? "dashboard.html",
        files: ["index.html", "dashboard.html"],
        url: `http://127.0.0.1:3000/${body.previewPath ?? "dashboard.html"}`,
      });
    });
    fireEvent.load(iframe);

    await waitFor(() => {
      expect(getHeartbeatPosts(fetchMock)).toHaveLength(1);
    });

    expect(window.location.search).toBe("?previewPath=dashboard.html");
  });
});

function mockPreviewFetch(defaultActivePath = "index.html") {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as {
      previewPath?: string;
    };
    const activePath = body.previewPath ?? defaultActivePath;

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

function getHeartbeatPosts(fetchMock: ReturnType<typeof mockPreviewFetch>) {
  return fetchMock.mock.calls.filter(
    ([input, init]) =>
      init?.method === "POST" &&
      getCallUrl([input, init]).endsWith("/preview-session/heartbeat"),
  );
}

function getCallUrl(call: unknown[]) {
  return String(call[0]);
}

function parseBody(call: unknown[]) {
  return JSON.parse(String((call[1] as RequestInit | undefined)?.body ?? "{}"));
}
