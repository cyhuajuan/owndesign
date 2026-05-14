import { mkdtemp, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceStore } from "./workspace-store";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true });
    }),
  );
});

async function createTempWorkspaceRoot() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "hjdesign-workspace-store-"));
  tempRoots.push(tempRoot);
  return tempRoot;
}

function buildProject(overrides: Partial<{
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}> = {}) {
  return {
    id: overrides.id ?? "project-alpha",
    name: overrides.name ?? "Project Alpha",
    description: overrides.description,
    outputType: "html" as const,
    createdAt: overrides.createdAt ?? "2026-05-14T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-14T10:00:00.000Z",
  };
}

describe("WorkspaceStore", () => {
  it("creates the Workspace lazily when first Project is persisted", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".hjdesign");
    const store = new WorkspaceStore({ workspaceRoot });

    await expect(stat(workspaceRoot)).rejects.toThrow();

    await store.createProject(buildProject());

    await expect(stat(workspaceRoot)).resolves.toBeDefined();
    await expect(stat(path.join(workspaceRoot, "projects"))).resolves.toBeDefined();
  });

  it("persists each Project in its own Project Directory with project metadata and workspace directory", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".hjdesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-bravo", name: "Project Bravo" });

    await store.createProject(project);

    const projectDirectory = path.join(workspaceRoot, "projects", project.id);
    const projectJson = JSON.parse(
      await readFile(path.join(projectDirectory, "project.json"), "utf8"),
    );

    await expect(stat(projectDirectory)).resolves.toBeDefined();
    await expect(stat(path.join(projectDirectory, "workspace"))).resolves.toBeDefined();
    expect(projectJson).toEqual(project);
  });

  it("writes and reads Project Output from the Project Workspace", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".hjdesign");
    const store = new WorkspaceStore({ workspaceRoot });
    const project = buildProject({ id: "project-output" });
    const html = "<!doctype html><html><body>Preview</body></html>";

    await store.createProject(project);
    const outputPath = await store.writeProjectOutput(project.id, "html", html);

    expect(outputPath).toBe(
      path.join(workspaceRoot, "projects", project.id, "workspace", "index.html"),
    );
    await expect(store.readProjectOutput(project.id, "html")).resolves.toBe(html);
  });

  it("discovers persisted Projects after reload and returns them in Project Updated Time descending order", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".hjdesign");
    const firstStore = new WorkspaceStore({ workspaceRoot });

    await firstStore.createProject(
      buildProject({
        id: "project-older",
        name: "Older Project",
        updatedAt: "2026-05-14T09:00:00.000Z",
      }),
    );
    await firstStore.createProject(
      buildProject({
        id: "project-newer",
        name: "Newer Project",
        updatedAt: "2026-05-14T11:00:00.000Z",
      }),
    );

    const secondStore = new WorkspaceStore({ workspaceRoot });

    await expect(secondStore.listProjects()).resolves.toEqual([
      buildProject({
        id: "project-newer",
        name: "Newer Project",
        updatedAt: "2026-05-14T11:00:00.000Z",
      }),
      buildProject({
        id: "project-older",
        name: "Older Project",
        updatedAt: "2026-05-14T09:00:00.000Z",
      }),
    ]);
  });

  it("moves a Project Directory to the recycle bin adapter instead of deleting it directly", async () => {
    const workspaceRoot = path.join(await createTempWorkspaceRoot(), ".hjdesign");
    const recycleBinRoot = path.join(await createTempWorkspaceRoot(), "recycle-bin");
    const movedPaths: string[] = [];
    const store = new WorkspaceStore({
      workspaceRoot,
      moveToTrash: async (targetPath) => {
        movedPaths.push(targetPath);
        await mkdir(recycleBinRoot, { recursive: true });
        await rename(targetPath, path.join(recycleBinRoot, path.basename(targetPath)));
      },
    });
    const project = buildProject({ id: "project-delete-me" });

    await store.createProject(project);
    await store.deleteProject(project.id);

    expect(movedPaths).toEqual([path.join(workspaceRoot, "projects", project.id)]);
    await expect(stat(path.join(workspaceRoot, "projects", project.id))).rejects.toThrow();
    await expect(
      stat(path.join(recycleBinRoot, project.id, "project.json")),
    ).resolves.toBeDefined();
  });
});
