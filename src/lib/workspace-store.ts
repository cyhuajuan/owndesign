import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import trash from "trash";

export type ProjectRecord = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

type WorkspaceStoreOptions = {
  workspaceRoot?: string;
  moveToTrash?: (targetPath: string) => Promise<void>;
};

export class WorkspaceStore {
  private readonly workspaceRoot: string;
  private readonly moveToTrash: (targetPath: string) => Promise<void>;

  constructor(options: WorkspaceStoreOptions = {}) {
    this.workspaceRoot =
      options.workspaceRoot ?? path.join(os.homedir(), ".hjdesign");
    this.moveToTrash =
      options.moveToTrash ??
      (async (targetPath: string) => {
        await trash([targetPath]);
      });
  }

  getWorkspaceRoot() {
    return this.workspaceRoot;
  }

  async createProject(project: ProjectRecord) {
    const projectDirectory = this.getProjectDirectory(project.id);

    await mkdir(path.join(projectDirectory, "workspace"), { recursive: true });
    await writeFile(
      path.join(projectDirectory, "project.json"),
      JSON.stringify(project, null, 2),
      "utf8",
    );

    return project;
  }

  async listProjects() {
    const projectsRoot = this.getProjectsRoot();

    try {
      const projectEntries = await readdir(projectsRoot, { withFileTypes: true });
      const projects = await Promise.all(
        projectEntries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const projectJson = await readFile(
              path.join(projectsRoot, entry.name, "project.json"),
              "utf8",
            );

            return JSON.parse(projectJson) as ProjectRecord;
          }),
      );

      return projects.sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      );
    } catch (error) {
      if (isMissingPathError(error)) {
        return [];
      }

      throw error;
    }
  }

  async deleteProject(projectId: string) {
    await this.moveToTrash(this.getProjectDirectory(projectId));
  }

  private getProjectsRoot() {
    return path.join(this.workspaceRoot, "projects");
  }

  private getProjectDirectory(projectId: string) {
    return path.join(this.getProjectsRoot(), projectId);
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
