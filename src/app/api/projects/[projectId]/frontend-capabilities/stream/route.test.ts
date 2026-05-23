import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  getProject: vi.fn(),
  registerFrontendConnection: vi.fn(() => new ReadableStream()),
}));

vi.mock("@/server/owndesign", () => ({
  createWorkspaceStore: () => ({
    getProject: routeMocks.getProject,
  }),
}));

vi.mock("@/server/realtime/frontend-command-bus", () => ({
  registerFrontendConnection: routeMocks.registerFrontendConnection,
}));

import { GET } from "./route";

describe("/api/projects/[projectId]/frontend-capabilities/stream", () => {
  beforeEach(() => {
    routeMocks.getProject.mockReset();
    routeMocks.getProject.mockResolvedValue({
      id: "project-1",
      name: "Project One",
      outputType: "html",
    });
    routeMocks.registerFrontendConnection.mockClear();
  });

  it("rejects requests without tabId", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/projects/project-1/frontend-capabilities/stream",
      ),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    expect(response.status).toBe(400);
    expect(routeMocks.registerFrontendConnection).not.toHaveBeenCalled();
  });

  it("registers a frontend capability stream", async () => {
    const request = new Request(
      "http://localhost/api/projects/project-1/frontend-capabilities/stream?tabId=tab-1",
    );

    const response = await GET(request, {
      params: Promise.resolve({ projectId: "project-1" }),
    });

    expect(response.headers.get("Content-Type")).toBe(
      "text/event-stream; charset=utf-8",
    );
    expect(routeMocks.getProject).toHaveBeenCalledWith("project-1");
    expect(routeMocks.registerFrontendConnection).toHaveBeenCalledWith({
      frontendTabId: "tab-1",
      projectId: "project-1",
      signal: request.signal,
    });
  });
});
