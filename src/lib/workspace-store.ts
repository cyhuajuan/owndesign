import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import trash from "trash";

export type ProjectRecord = {
  id: string;
  name: string;
  description?: string;
  outputType: ProjectOutputType;
  createdAt: string;
  updatedAt: string;
};

export type ProjectOutputType = "html";

export type ConversationRecord = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  messages: unknown[];
  titleManuallySet?: boolean;
};

export type WorkspaceState = {
  activeProjectId?: string;
  activeConversationId?: string;
};

export type WorkspaceEntry = {
  path: string;
  type: "directory" | "file";
  size: number;
  updatedAt: string;
};

export type WorkspaceSearchMatch = {
  path: string;
  line: number;
  preview: string;
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

  async getConversation(projectId: string, conversationId: string) {
    const conversationJson = await readFile(
      this.getConversationFilePath(projectId, conversationId),
      "utf8",
    );

    return JSON.parse(conversationJson) as ConversationRecord;
  }

  async updateConversation(
    projectId: string,
    conversationId: string,
    conversation: ConversationRecord,
  ) {
    await writeFile(
      this.getConversationFilePath(projectId, conversationId),
      JSON.stringify(conversation, null, 2),
      "utf8",
    );

    return conversation;
  }

  async writeProjectOutput(
    projectId: string,
    outputType: ProjectOutputType,
    content: string,
  ) {
    const outputPath = this.getProjectOutputFilePath(projectId, outputType);

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, "utf8");

    return outputPath;
  }

  async readProjectOutput(projectId: string, outputType: ProjectOutputType) {
    return readFile(this.getProjectOutputFilePath(projectId, outputType), "utf8");
  }

  getProjectWorkspaceDirectory(projectId: string) {
    return path.join(this.getProjectDirectory(projectId), "workspace");
  }

  async listProjectWorkspace(projectId: string) {
    const entries: WorkspaceEntry[] = [];

    await this.walkProjectWorkspace(projectId, "", async (entry) => {
      entries.push(entry);
    });

    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  async searchProjectWorkspace(
    projectId: string,
    query: string,
    relativePath = "",
  ) {
    if (!query) {
      throw new Error("Search query must not be empty.");
    }

    const matches: WorkspaceSearchMatch[] = [];
    const startPath = relativePath && relativePath !== "."
      ? await this.resolveProjectWorkspacePath(projectId, relativePath, {
          checkTargetSymlink: true,
        })
      : this.getProjectWorkspaceDirectory(projectId);
    const startStats = await stat(startPath);

    if (startStats.isFile()) {
      await this.searchWorkspaceFile(projectId, startPath, query, matches);
    } else if (startStats.isDirectory()) {
      await this.walkProjectWorkspace(
        projectId,
        relativePath === "." ? "" : relativePath,
        async (entry, absolutePath) => {
          if (entry.type === "file") {
            await this.searchWorkspaceFile(projectId, absolutePath, query, matches);
          }
        },
      );
    }

    return matches;
  }

  async readProjectWorkspaceFile(projectId: string, relativePath: string) {
    const filePath = await this.resolveProjectWorkspacePath(
      projectId,
      relativePath,
      { checkTargetSymlink: true },
    );
    const fileStats = await stat(filePath);

    if (!fileStats.isFile()) {
      throw new Error(`Project Workspace path is not a file: ${relativePath}`);
    }

    return readFile(filePath, "utf8");
  }

  async writeProjectWorkspaceFile(
    projectId: string,
    relativePath: string,
    content: string,
  ) {
    const filePath = await this.resolveProjectWorkspacePath(
      projectId,
      relativePath,
      { checkTargetSymlink: true, targetMayBeMissing: true },
    );

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");

    return {
      bytesWritten: Buffer.byteLength(content, "utf8"),
      path: normalizeWorkspaceRelativePath(
        path.relative(this.getProjectWorkspaceDirectory(projectId), filePath),
      ),
    };
  }

  async editProjectWorkspaceFile(
    projectId: string,
    relativePath: string,
    oldText: string,
    newText: string,
  ) {
    if (!oldText) {
      throw new Error("oldText must not be empty.");
    }

    const content = await this.readProjectWorkspaceFile(projectId, relativePath);
    const firstIndex = content.indexOf(oldText);

    if (firstIndex === -1) {
      throw new Error(`oldText was not found in Project Workspace file: ${relativePath}`);
    }

    if (content.indexOf(oldText, firstIndex + oldText.length) !== -1) {
      throw new Error(
        `oldText appears more than once in Project Workspace file: ${relativePath}`,
      );
    }

    const updatedContent =
      content.slice(0, firstIndex) + newText + content.slice(firstIndex + oldText.length);

    await this.writeProjectWorkspaceFile(projectId, relativePath, updatedContent);

    return {
      path: normalizeWorkspaceRelativePath(relativePath),
      replacements: 1,
    };
  }

  async deleteProjectWorkspacePath(projectId: string, relativePath: string) {
    const targetPath = await this.resolveProjectWorkspacePath(
      projectId,
      relativePath,
      { checkTargetSymlink: true },
    );

    await rm(targetPath, { force: false, recursive: true });

    return {
      deleted: true,
      path: normalizeWorkspaceRelativePath(relativePath),
    };
  }

  async deleteConversation(projectId: string, conversationId: string) {
    await this.moveToTrash(
      this.getConversationFilePath(projectId, conversationId),
    );
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

  private getProjectOutputFilePath(
    projectId: string,
    outputType: ProjectOutputType,
  ) {
    return path.join(
      this.getProjectWorkspaceDirectory(projectId),
      `index.${outputType}`,
    );
  }

  private getConversationFilePath(projectId: string, conversationId: string) {
    return path.join(
      this.getConversationsDirectory(projectId),
      `${conversationId}.json`,
    );
  }

  private async walkProjectWorkspace(
    projectId: string,
    relativePath: string,
    visit: (entry: WorkspaceEntry, absolutePath: string) => Promise<void>,
  ) {
    const rootPath = this.getProjectWorkspaceDirectory(projectId);
    const startPath = relativePath
      ? await this.resolveProjectWorkspacePath(projectId, relativePath, {
          checkTargetSymlink: true,
        })
      : rootPath;

    async function walk(absoluteDirectory: string) {
      const dirEntries = await readdir(absoluteDirectory, { withFileTypes: true });

      for (const dirEntry of dirEntries) {
        const absolutePath = path.join(absoluteDirectory, dirEntry.name);
        const entryStats = await lstat(absolutePath);

        if (entryStats.isSymbolicLink()) {
          continue;
        }

        const relativeEntryPath = normalizeWorkspaceRelativePath(
          path.relative(rootPath, absolutePath),
        );

        if (entryStats.isDirectory()) {
          await visit(
            {
              path: relativeEntryPath,
              size: entryStats.size,
              type: "directory",
              updatedAt: entryStats.mtime.toISOString(),
            },
            absolutePath,
          );
          await walk(absolutePath);
        } else if (entryStats.isFile()) {
          await visit(
            {
              path: relativeEntryPath,
              size: entryStats.size,
              type: "file",
              updatedAt: entryStats.mtime.toISOString(),
            },
            absolutePath,
          );
        }
      }
    }

    const startStats = await lstat(startPath);

    if (startStats.isSymbolicLink()) {
      throw new Error("Project Workspace symlinks are not supported.");
    }

    if (startStats.isDirectory()) {
      await walk(startPath);
    } else if (startStats.isFile()) {
      await visit(
        {
          path: normalizeWorkspaceRelativePath(path.relative(rootPath, startPath)),
          size: startStats.size,
          type: "file",
          updatedAt: startStats.mtime.toISOString(),
        },
        startPath,
      );
    }
  }

  private async searchWorkspaceFile(
    projectId: string,
    absolutePath: string,
    query: string,
    matches: WorkspaceSearchMatch[],
  ) {
    const content = await readFile(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);
    const relativePath = normalizeWorkspaceRelativePath(
      path.relative(this.getProjectWorkspaceDirectory(projectId), absolutePath),
    );

    lines.forEach((lineText, index) => {
      if (!lineText.includes(query)) {
        return;
      }

      matches.push({
        line: index + 1,
        path: relativePath,
        preview: lineText.trim().slice(0, 240),
      });
    });
  }

  private async resolveProjectWorkspacePath(
    projectId: string,
    relativePath: string,
    options: {
      checkTargetSymlink?: boolean;
      targetMayBeMissing?: boolean;
    } = {},
  ) {
    if (!relativePath.trim()) {
      throw new Error("Project Workspace path must not be empty.");
    }

    if (path.isAbsolute(relativePath)) {
      throw new Error(`Project Workspace path must be relative: ${relativePath}`);
    }

    const workspaceDirectory = this.getProjectWorkspaceDirectory(projectId);
    const targetPath = path.resolve(workspaceDirectory, relativePath);
    const relativeFromWorkspace = path.relative(workspaceDirectory, targetPath);

    if (
      !relativeFromWorkspace ||
      relativeFromWorkspace.startsWith("..") ||
      path.isAbsolute(relativeFromWorkspace)
    ) {
      throw new Error(`Project Workspace path escapes workspace: ${relativePath}`);
    }

    await this.assertNoWorkspaceSymlinkPath(
      workspaceDirectory,
      relativeFromWorkspace,
      options,
    );

    return targetPath;
  }

  private async assertNoWorkspaceSymlinkPath(
    workspaceDirectory: string,
    relativeFromWorkspace: string,
    options: {
      checkTargetSymlink?: boolean;
      targetMayBeMissing?: boolean;
    },
  ) {
    const segments = relativeFromWorkspace
      .split(path.sep)
      .filter((segment) => segment && segment !== ".");
    const lastIndex = segments.length - 1;
    let currentPath = workspaceDirectory;

    for (const [index, segment] of segments.entries()) {
      currentPath = path.join(currentPath, segment);

      try {
        const pathStats = await lstat(currentPath);
        const isTarget = index === lastIndex;

        if (pathStats.isSymbolicLink() && (!isTarget || options.checkTargetSymlink)) {
          throw new Error("Project Workspace symlinks are not supported.");
        }
      } catch (error) {
        if (isMissingPathError(error) && options.targetMayBeMissing) {
          return;
        }

        throw error;
      }
    }
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function normalizeWorkspaceRelativePath(relativePath: string) {
  return relativePath.split(path.sep).join("/");
}
