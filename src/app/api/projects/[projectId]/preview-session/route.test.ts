import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  release: vi.fn(),
  createWorkspaceStore: vi.fn(() => ({ kind: "store" })),
  getPreviewServerManager: vi.fn(),
}));

vi.mock("@/server/owndesign", () => ({
  createWorkspaceStore: routeMocks.createWorkspaceStore,
}));

vi.mock("@/server/preview/preview-server-manager", () => ({
  getPreviewServerManager: routeMocks.getPreviewServerManager,
}));

import { POST } from "./route";

describe("/api/projects/[projectId]/preview-session", () => {
  beforeEach(() => {
    routeMocks.ensure.mockReset();
    routeMocks.release.mockReset();
    routeMocks.createWorkspaceStore.mockClear();
    routeMocks.getPreviewServerManager.mockReturnValue({
      ensure: routeMocks.ensure,
      release: routeMocks.release,
    });
    routeMocks.ensure.mockResolvedValue({
      activePath: "dashboard.html",
      files: ["index.html", "dashboard.html"],
      url: "http://127.0.0.1:1234/dashboard.html",
    });
  });

  it("passes previewPath to the preview manager and returns session metadata", async () => {
    const response = await POST(
      new Request("http://localhost/api/projects/project-1/preview-session", {
        body: JSON.stringify({
          clientId: "client-1",
          previewPath: "dashboard.html",
        }),
        method: "POST",
      }),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    await expect(response.json()).resolves.toEqual({
      activePath: "dashboard.html",
      files: ["index.html", "dashboard.html"],
      url: "http://127.0.0.1:1234/dashboard.html",
    });
    expect(routeMocks.ensure).toHaveBeenCalledWith(
      "project-1",
      "client-1",
      "dashboard.html",
    );
  });
});
