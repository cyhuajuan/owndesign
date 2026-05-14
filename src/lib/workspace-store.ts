import {
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
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

export type ConversationRecord = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  messages: unknown[];
};

export type WorkspaceState = {
  activeProjectId?: string;
  activeConversationId?: string;
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
    await mkdir(path.join(projectDirectory, "conversations"), {
      recursive: true,
    });
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

  async getProject(projectId: string) {
    const projectJson = await readFile(
      path.join(this.getProjectDirectory(projectId), "project.json"),
      "utf8",
    );

    return JSON.parse(projectJson) as ProjectRecord;
  }

  async updateProject(projectId: string, project: ProjectRecord) {
    await writeFile(
      path.join(this.getProjectDirectory(projectId), "project.json"),
      JSON.stringify(project, null, 2),
      "utf8",
    );

    return project;
  }

  async createConversation(conversation: ConversationRecord) {
    await mkdir(this.getConversationsDirectory(conversation.projectId), {
      recursive: true,
    });
    await writeFile(
      this.getConversationFilePath(conversation.projectId, conversation.id),
      JSON.stringify(conversation, null, 2),
      "utf8",
    );

    return conversation;
  }

  async listConversations(projectId: string) {
    const conversationsDirectory = this.getConversationsDirectory(projectId);

    try {
      const conversationEntries = await readdir(conversationsDirectory, {
        withFileTypes: true,
      });
      const conversations = await Promise.all(
        conversationEntries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            const conversationJson = await readFile(
              path.join(conversationsDirectory, entry.name),
              "utf8",
            );

            return JSON.parse(conversationJson) as ConversationRecord;
          }),
      );

      return conversations.sort((left, right) => {
        const leftTime = left.lastMessageAt ?? left.createdAt;
        const rightTime = right.lastMessageAt ?? right.createdAt;

        return new Date(rightTime).getTime() - new Date(leftTime).getTime();
      });
    } catch (error) {
      if (isMissingPathError(error)) {
        return [];
      }

      throw error;
    }
  }

  async writeWorkspaceState(state: WorkspaceState) {
    await mkdir(this.workspaceRoot, { recursive: true });
    await writeFile(
      path.join(this.workspaceRoot, "state.json"),
      JSON.stringify(state, null, 2),
      "utf8",
    );
  }

  async readWorkspaceState() {
    try {
      const stateJson = await readFile(
        path.join(this.workspaceRoot, "state.json"),
        "utf8",
      );

      return JSON.parse(stateJson) as WorkspaceState;
    } catch (error) {
      if (isMissingPathError(error)) {
        return {};
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

  private getConversationsDirectory(projectId: string) {
    return path.join(this.getProjectDirectory(projectId), "conversations");
  }

  private getConversationFilePath(projectId: string, conversationId: string) {
    return path.join(
      this.getConversationsDirectory(projectId),
      `${conversationId}.json`,
    );
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
