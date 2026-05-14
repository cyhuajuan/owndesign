import { useState } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ControlBar } from "./control-bar";

describe("ControlBar", () => {
  it("switches Project through searchable switcher", async () => {
    const user = userEvent.setup();

    render(<ControlBarHarness />);

    await user.click(
      screen.getByRole("button", {
        name: "Project switcher Alpha Website",
      }),
    );

    await user.type(
      screen.getByPlaceholderText("Search projects..."),
      "mobile",
    );
    await user.click(
      screen.getByRole("option", { name: "Mobile App Refresh" }),
    );

    expect(
      screen.getByRole("button", {
        name: "Project switcher Mobile App Refresh",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Conversation switcher Navigation audit",
      }),
    ).toBeInTheDocument();
  });

  it("switches Conversation through searchable switcher", async () => {
    const user = userEvent.setup();

    render(<ControlBarHarness />);

    await user.click(
      screen.getByRole("button", {
        name: "Conversation switcher Landing page polish",
      }),
    );

    await user.click(screen.getByRole("option", { name: "Hero messaging" }));

    expect(
      screen.getByRole("button", {
        name: "Conversation switcher Hero messaging",
      }),
    ).toBeInTheDocument();
  });

  it("creates Project from Project switcher action", async () => {
    const user = userEvent.setup();

    render(<ControlBarHarness />);

    await user.click(
      screen.getByRole("button", {
        name: "Project switcher Alpha Website",
      }),
    );
    await user.click(screen.getByRole("option", { name: "New Project" }));
    await user.type(screen.getByLabelText("Project name"), "Control Bar Launch");
    await user.type(
      screen.getByLabelText("Project description"),
      "Created from switcher",
    );
    await user.click(screen.getByRole("button", { name: "Create Project" }));

    expect(
      screen.getByRole("button", {
        name: "Project switcher Control Bar Launch",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Conversation switcher New conversation",
      }),
    ).toBeInTheDocument();
  });

  it("creates Conversation from Conversation switcher action", async () => {
    const user = userEvent.setup();

    render(<ControlBarHarness />);

    await user.click(
      screen.getByRole("button", {
        name: "Conversation switcher Landing page polish",
      }),
    );
    await user.click(screen.getByRole("option", { name: "New Conversation" }));

    expect(
      screen.getByRole("button", {
        name: "Conversation switcher New conversation 3",
      }),
    ).toBeInTheDocument();
  });
});

function ControlBarHarness() {
  const [projects, setProjects] = useState([
    {
      id: "project-alpha",
      name: "Alpha Website",
      createdAt: "2026-05-14T10:00:00.000Z",
      updatedAt: "2026-05-14T10:00:00.000Z",
    },
    {
      id: "project-beta",
      name: "Mobile App Refresh",
      createdAt: "2026-05-14T11:00:00.000Z",
      updatedAt: "2026-05-14T11:00:00.000Z",
    },
  ]);
  const [activeProjectId, setActiveProjectId] = useState("project-alpha");
  const [conversationsByProject, setConversationsByProject] = useState<
    Record<
      string,
      Array<{
        id: string;
        projectId: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        messages: never[];
      }>
    >
  >({
    "project-alpha": [
      {
        id: "conversation-alpha-1",
        projectId: "project-alpha",
        title: "Landing page polish",
        createdAt: "2026-05-14T10:00:00.000Z",
        updatedAt: "2026-05-14T10:00:00.000Z",
        messages: [],
      },
      {
        id: "conversation-alpha-2",
        projectId: "project-alpha",
        title: "Hero messaging",
        createdAt: "2026-05-14T10:30:00.000Z",
        updatedAt: "2026-05-14T10:30:00.000Z",
        messages: [],
      },
    ],
    "project-beta": [
      {
        id: "conversation-beta-1",
        projectId: "project-beta",
        title: "Navigation audit",
        createdAt: "2026-05-14T11:00:00.000Z",
        updatedAt: "2026-05-14T11:00:00.000Z",
        messages: [],
      },
    ],
  });
  const [activeConversationIds, setActiveConversationIds] = useState<
    Record<string, string>
  >({
    "project-alpha": "conversation-alpha-1",
    "project-beta": "conversation-beta-1",
  });

  return (
    <ControlBar
      activeConversationId={activeConversationIds[activeProjectId]}
      activeProjectId={activeProjectId}
      conversations={conversationsByProject[activeProjectId]}
      onCreateConversation={async () => {
        const nextCount = conversationsByProject[activeProjectId].length + 1;
        const nextConversationId = `conversation-${activeProjectId}-${nextCount}`;
        const nextConversation = {
          id: nextConversationId,
          projectId: activeProjectId,
          title: `New conversation ${nextCount}`,
          createdAt: "2026-05-14T12:30:00.000Z",
          updatedAt: "2026-05-14T12:30:00.000Z",
          messages: [],
        };

        setConversationsByProject((current) => ({
          ...current,
          [activeProjectId]: [nextConversation, ...current[activeProjectId]],
        }));
        setActiveConversationIds((current) => ({
          ...current,
          [activeProjectId]: nextConversationId,
        }));
      }}
      onCreateProject={async (name, description) => {
        const nextProjectNumber = projects.length + 1;
        const nextProjectId = `project-${nextProjectNumber}`;
        const nextConversationId = `conversation-${nextProjectNumber}-1`;

        setProjects((current) => [
          ...current,
          {
            id: nextProjectId,
            name,
            description,
            createdAt: "2026-05-14T12:00:00.000Z",
            updatedAt: "2026-05-14T12:00:00.000Z",
          },
        ]);
        setConversationsByProject((current) => ({
          ...current,
          [nextProjectId]: [
            {
              id: nextConversationId,
              projectId: nextProjectId,
              title: "New conversation",
              createdAt: "2026-05-14T12:00:00.000Z",
              updatedAt: "2026-05-14T12:00:00.000Z",
              messages: [],
            },
          ],
        }));
        setActiveConversationIds((current) => ({
          ...current,
          [nextProjectId]: nextConversationId,
        }));
        setActiveProjectId(nextProjectId);
      }}
      onSelectConversation={async (conversationId) => {
        setActiveConversationIds((current) => ({
          ...current,
          [activeProjectId]: conversationId,
        }));
      }}
      onSelectProject={async (projectId) => {
        setActiveProjectId(projectId);
      }}
      projects={projects}
    />
  );
}
