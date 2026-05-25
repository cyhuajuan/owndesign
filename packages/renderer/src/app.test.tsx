import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OwnDesignApp } from "./app";

vi.mock("@/features/workspace/components/workspace-shell", async () => {
  const { useNavigate } =
    await vi.importActual<typeof import("react-router")>("react-router");

  return {
    WorkspaceShell({
      activeConversationId,
      activeProject,
    }: {
      activeConversationId?: string;
      activeProject?: { id: string };
    }) {
      const navigate = useNavigate();

      return (
        <div>
          <div>
            {activeProject?.id}:{activeConversationId}
          </div>
          <button
            onClick={() =>
              navigate(
                `${window.location.pathname}?previewPath=dashboard.html`,
                { replace: true },
              )
            }
            type="button"
          >
            Switch preview
          </button>
          <button
            onClick={() =>
              navigate(
                "/projects/project-1/conversations/conversation-2?previewPath=dashboard.html",
              )
            }
            type="button"
          >
            Switch conversation
          </button>
        </div>
      );
    },
  };
});

describe("OwnDesignApp routing", () => {
  const workspaceRequests: string[] = [];

  beforeEach(() => {
    workspaceRequests.length = 0;
    window.history.replaceState(
      null,
      "",
      "/projects/project-1/conversations/conversation-1",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.origin);

        if (url.pathname === "/api/workspace") {
          workspaceRequests.push(`${url.pathname}${url.search}`);

          const projectId = url.searchParams.get("projectId") ?? "project-1";
          const conversationId =
            url.searchParams.get("conversationId") ?? "conversation-1";

          return Response.json({
            activeConversationId: conversationId,
            activeProject: {
              createdAt: "2026-05-24T00:00:00.000Z",
              id: projectId,
              name: "Project",
              outputType: "html",
              updatedAt: "2026-05-24T00:00:00.000Z",
            },
            conversations: [
              {
                createdAt: "2026-05-24T00:00:00.000Z",
                id: conversationId,
                messages: [],
                projectId,
                title: "Conversation",
                updatedAt: "2026-05-24T00:00:00.000Z",
              },
            ],
            projects: [
              {
                createdAt: "2026-05-24T00:00:00.000Z",
                id: "project-1",
                name: "Project",
                outputType: "html",
                updatedAt: "2026-05-24T00:00:00.000Z",
              },
            ],
            settings: {
              defaultModelId: null,
              interfaceLanguage: "zh-CN",
              modelConfigurations: [{ id: "model-1" }],
              resources: { fontLibraries: [], iconLibraries: [] },
            },
          });
        }

        return Response.json({});
      }),
    );
  });

  it("does not reload workspace when only previewPath changes", async () => {
    const user = userEvent.setup();

    render(<OwnDesignApp />);

    expect(
      await screen.findByText("project-1:conversation-1"),
    ).toBeInTheDocument();
    expect(workspaceRequests).toEqual([
      "/api/workspace?projectId=project-1&conversationId=conversation-1",
    ]);

    await user.click(screen.getByRole("button", { name: "Switch preview" }));
    await waitFor(() =>
      expect(window.location.search).toBe("?previewPath=dashboard.html"),
    );

    expect(workspaceRequests).toHaveLength(1);

    await user.click(
      screen.getByRole("button", { name: "Switch conversation" }),
    );

    expect(
      await screen.findByText("project-1:conversation-2"),
    ).toBeInTheDocument();
    expect(workspaceRequests).toEqual([
      "/api/workspace?projectId=project-1&conversationId=conversation-1",
      "/api/workspace?projectId=project-1&conversationId=conversation-2",
    ]);
  });
});
