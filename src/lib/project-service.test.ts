import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectService } from "./project-service";
import { WorkspaceStore } from "./workspace-store";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true });
    }),
  );
});

async function createWorkspaceStore() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "hjdesign-project-service-"));
  tempRoots.push(tempRoot);

  return new WorkspaceStore({
    workspaceRoot: path.join(tempRoot, ".hjdesign"),
  });
}

describe("ProjectService", () => {
  it("creates a Project, auto-creates its first Conversation, and activates both", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore });

    const createdProject = await projectService.createProject({
      name: "Landing Redesign",
      description: "Marketing refresh",
    });
    const state = await projectService.getProjectState();

    expect(createdProject.name).toBe("Landing Redesign");
    expect(state.activeProjectId).toBe(createdProject.id);
    expect(state.activeConversationId).toBeDefined();
    expect(state.projects).toHaveLength(1);

    const conversationJson = JSON.parse(
      await readFile(
        path.join(
          workspaceStore.getWorkspaceRoot(),
          "projects",
          createdProject.id,
          "conversations",
          `${state.activeConversationId}.json`,
        ),
        "utf8",
      ),
    );

    expect(conversationJson.projectId).toBe(createdProject.id);
    expect(conversationJson.title).toBe("New conversation");
    expect(conversationJson.messages).toEqual([]);
  });

  it("renames a Project and updates Project Updated Time", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore, now: () => "2026-05-14T10:00:00.000Z" });

    const createdProject = await projectService.createProject({
      name: "Old Name",
    });

    const renamedService = new ProjectService({
      workspaceStore,
      now: () => "2026-05-14T11:00:00.000Z",
    });
    const renamedProject = await renamedService.renameProject(createdProject.id, {
      name: "New Name",
      description: "Sharper summary",
    });

    expect(renamedProject.name).toBe("New Name");
    expect(renamedProject.description).toBe("Sharper summary");
    expect(renamedProject.updatedAt).toBe("2026-05-14T11:00:00.000Z");

    await expect(workspaceStore.listProjects()).resolves.toEqual([renamedProject]);
  });

  it("switches the active Project and restores that state after reload", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore });
    const firstProject = await projectService.createProject({ name: "First Project" });
    const secondProject = await projectService.createProject({ name: "Second Project" });

    await projectService.switchProject(firstProject.id);

    const reloadedService = new ProjectService({ workspaceStore });
    const state = await reloadedService.getProjectState();

    expect(state.activeProjectId).toBe(firstProject.id);
    expect(state.activeConversationId).toBeDefined();
    expect(state.projects.map((project) => project.id)).toEqual([
      secondProject.id,
      firstProject.id,
    ]);
  });

  it("deletes the active Project and falls back to the next available Project", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore });
    const firstProject = await projectService.createProject({ name: "First Project" });
    const secondProject = await projectService.createProject({ name: "Second Project" });

    await projectService.switchProject(firstProject.id);
    await projectService.deleteProject(firstProject.id);

    const state = await projectService.getProjectState();

    expect(state.activeProjectId).toBe(secondProject.id);
    expect(state.activeConversationId).toBeDefined();
    expect(state.projects.map((project) => project.id)).toEqual([secondProject.id]);
  });
});
