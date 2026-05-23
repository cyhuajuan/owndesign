import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectService } from "./project-service";
import { WorkspaceStore } from "@/server/workspace-store";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true });
    }),
  );
});

async function createWorkspaceStore() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "owndesign-project-service-"));
  tempRoots.push(tempRoot);

  return new WorkspaceStore({
    workspaceRoot: path.join(tempRoot, ".owndesign"),
  });
}

describe("ProjectService", () => {
  it("creates a Project and auto-creates its first Conversation without global state", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore });

    const { conversation, project: createdProject } =
      await projectService.createProject({
      name: "Landing Redesign",
      description: "Marketing refresh",
    });
    const state = await projectService.getProjectState();

    expect(createdProject.name).toBe("Landing Redesign");
    expect(createdProject.outputType).toBe("html");
    expect(state.projects).toHaveLength(1);
    await expect(
      stat(path.join(workspaceStore.getWorkspaceRoot(), "state.json")),
    ).rejects.toThrow();

    const conversationJson = JSON.parse(
      await readFile(
        path.join(
          workspaceStore.getWorkspaceRoot(),
          "projects",
          createdProject.id,
          "conversations",
          `${conversation.id}.json`,
        ),
        "utf8",
      ),
    );

    expect(conversationJson.projectId).toBe(createdProject.id);
    expect(conversationJson.title).toBe("新建会话");
    expect(conversationJson.messages).toEqual([]);
  });

  it("renames a Project and updates Project Updated Time", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore, now: () => "2026-05-14T10:00:00.000Z" });

    const { project: createdProject } = await projectService.createProject({
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

  it("lists Projects without restoring global active state after reload", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore });
    const { project: firstProject } = await projectService.createProject({
      name: "First Project",
    });
    const { project: secondProject } = await projectService.createProject({
      name: "Second Project",
    });

    const reloadedService = new ProjectService({ workspaceStore });
    const state = await reloadedService.getProjectState();

    expect(state.projects.map((project) => project.id)).toEqual([
      secondProject.id,
      firstProject.id,
    ]);
  });

  it("deletes a Project without writing fallback state", async () => {
    const workspaceStore = await createWorkspaceStore();
    const projectService = new ProjectService({ workspaceStore });
    const { project: firstProject } = await projectService.createProject({
      name: "First Project",
    });
    const { project: secondProject } = await projectService.createProject({
      name: "Second Project",
    });

    await projectService.deleteProject(firstProject.id);

    const state = await projectService.getProjectState();

    expect(state.projects.map((project) => project.id)).toEqual([secondProject.id]);
    await expect(
      stat(path.join(workspaceStore.getWorkspaceRoot(), "state.json")),
    ).rejects.toThrow();
  });
});
