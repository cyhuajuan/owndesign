import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  heartbeat: vi.fn(),
  createWorkspaceStore: vi.fn(() => ({ kind: "store" })),
  getPreviewServerManager: vi.fn(),
}));

vi.mock("@/lib/owndesign", () => ({
  createWorkspaceStore: routeMocks.createWorkspaceStore,
}));

vi.mock("@/lib/preview-server-manager", () => ({
  getPreviewServerManager: routeMocks.getPreviewServerManager,
}));

import { POST } from "./route";

describe("/api/projects/[projectId]/preview-session/heartbeat", () => {
  beforeEach(() => {
    routeMocks.heartbeat.mockReset();
    routeMocks.createWorkspaceStore.mockClear();
    routeMocks.getPreviewServerManager.mockReturnValue({
      heartbeat: routeMocks.heartbeat,
    });
    routeMocks.heartbeat.mockResolvedValue({
      activePath: "pages/detail.html",
      files: ["index.html", "pages/detail.html"],
      url: "http://127.0.0.1:1234/pages/detail.html",
    });
  });

  it("passes previewPath to the preview manager and returns session metadata", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/projects/project-1/preview-session/heartbeat",
        {
          body: JSON.stringify({
            clientId: "client-1",
            previewPath: "pages/detail.html",
          }),
          method: "POST",
        },
      ),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    await expect(response.json()).resolves.toEqual({
      activePath: "pages/detail.html",
      files: ["index.html", "pages/detail.html"],
      url: "http://127.0.0.1:1234/pages/detail.html",
    });
    expect(routeMocks.heartbeat).toHaveBeenCalledWith(
      "project-1",
      "client-1",
      "pages/detail.html",
    );
  });
});
