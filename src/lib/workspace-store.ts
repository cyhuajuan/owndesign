import { execFile } from "node:child_process";
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
import process from "node:process";
import { promisify } from "node:util";

import trash from "trash";

const DEFAULT_READ_LIMIT = 2000;
const MAX_READ_BYTES = 50 * 1024;
const MAX_LINE_LENGTH = 2000;
const MAX_TOOL_RESULTS = 100;

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

export type WorkspaceGrepMatch = {
  path: string;
  line: number;
  preview: string;
};

export type WorkspaceGlobMatch = {
  path: string;
  type: "directory" | "file";
  updatedAt: string;
};

export type WorkspaceReadEntryResult =
  | {
      content: string;
      endLine: number;
      lineCount: number;
      path: string;
      startLine: number;
      truncated: boolean;
      type: "file";
    }
  | {
      entries: Array<{
        path: string;
        type: "directory" | "file";
      }>;
      path: string;
      totalEntries: number;
      truncated: boolean;
      type: "directory";
    };

export type WorkspacePatchChange =
  | {
      content: string;
      operation: "add" | "write";
      path: string;
    }
  | {
      newString: string;
      oldString: string;
      operation: "edit";
      path: string;
      replaceAll?: boolean;
    }
  | {
      operation: "delete";
      path: string;
    };

type WorkspaceStoreOptions = {
  workspaceRoot?: string;
  moveToTrash?: (targetPath: string) => Promise<void>;
  platform?: NodeJS.Platform;
  runWindowsRecycleCommand?: (targetPath: string) => Promise<void>;
};

const execFileAsync = promisify(execFile);

export class WorkspaceStore {
  private readonly workspaceRoot: string;
  private readonly moveToTrash: (targetPath: string) => Promise<void>;

  constructor(options: WorkspaceStoreOptions = {}) {
    this.workspaceRoot =
      options.workspaceRoot ?? path.join(os.homedir(), ".hjdesign");
    this.moveToTrash =
      options.moveToTrash ??
      (async (targetPath: string) => {
        await movePathToTrash(targetPath, {
          platform: options.platform ?? process.platform,
          runWindowsRecycleCommand:
            options.runWindowsRecycleCommand ?? runWindowsRecycleCommand,
        });
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

  async readProjectWorkspaceEntry(
    projectId: string,
    relativePath: string,
    options: {
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<WorkspaceReadEntryResult> {
    const offset = normalizePositiveInteger(options.offset, 1, "offset");
    const limit = normalizePositiveInteger(
      options.limit,
      DEFAULT_READ_LIMIT,
      "limit",
    );
    const targetPath = relativePath === "."
      ? this.getProjectWorkspaceDirectory(projectId)
      : await this.resolveProjectWorkspacePath(
          projectId,
          relativePath,
          { checkTargetSymlink: true },
        );
    const targetStats = await lstat(targetPath);
    const normalizedPath = normalizeWorkspaceRelativePath(relativePath);

    if (targetStats.isSymbolicLink()) {
      throw new Error("Project Workspace symlinks are not supported.");
    }

    if (targetStats.isDirectory()) {
      const rootPath = this.getProjectWorkspaceDirectory(projectId);
      const entries = await readdir(targetPath, { withFileTypes: true });
      const visibleEntries = (
        await Promise.all(
          entries.map(async (entry) => {
            const absolutePath = path.join(targetPath, entry.name);
            const entryStats = await lstat(absolutePath);

            if (entryStats.isSymbolicLink()) {
              return undefined;
            }

            if (!entryStats.isDirectory() && !entryStats.isFile()) {
              return undefined;
            }

            return {
              path: normalizeWorkspaceRelativePath(
                path.relative(rootPath, absolutePath),
              ),
              type: entryStats.isDirectory() ? "directory" as const : "file" as const,
            };
          }),
        )
      )
        .filter((entry): entry is { path: string; type: "directory" | "file" } =>
          Boolean(entry),
        )
        .sort((left, right) => left.path.localeCompare(right.path));
      const start = offset - 1;
      const sliced = visibleEntries.slice(start, start + limit);

      return {
        entries: sliced,
        path: normalizedPath,
        totalEntries: visibleEntries.length,
        truncated: start + sliced.length < visibleEntries.length,
        type: "directory",
      };
    }

    if (!targetStats.isFile()) {
      throw new Error(`Project Workspace path is not a file or directory: ${relativePath}`);
    }

    const content = await readFile(targetPath, "utf8");
    const lines = content.split(/\r?\n/);
    const start = offset - 1;

    if (start >= lines.length && !(lines.length === 1 && lines[0] === "" && start === 0)) {
      throw new Error(`Offset ${offset} is out of range for this file (${lines.length} lines)`);
    }

    const selectedLines: string[] = [];
    let usedBytes = 0;
    let truncated = false;

    for (let index = start; index < lines.length; index += 1) {
      if (selectedLines.length >= limit) {
        truncated = true;
        break;
      }

      const originalLine = lines[index];
      const line =
        originalLine.length > MAX_LINE_LENGTH
          ? `${originalLine.slice(0, MAX_LINE_LENGTH)}...`
          : originalLine;
      const numberedLine = `${index + 1}: ${line}`;
      const lineBytes = Buffer.byteLength(numberedLine, "utf8") + 1;

      if (usedBytes + lineBytes > MAX_READ_BYTES) {
        truncated = true;
        break;
      }

      selectedLines.push(numberedLine);
      usedBytes += lineBytes;
    }

    return {
      content: selectedLines.join("\n"),
      endLine: offset + selectedLines.length - 1,
      lineCount: lines.length,
      path: normalizedPath,
      startLine: offset,
      truncated,
      type: "file",
    };
  }

  async globProjectWorkspace(
    projectId: string,
    pattern: string,
    relativePath = "",
  ) {
    if (!pattern.trim()) {
      throw new Error("Glob pattern must not be empty.");
    }

    const startPath = relativePath && relativePath !== "."
      ? relativePath
      : "";
    const matcher = globToRegExp(pattern);
    const matches: WorkspaceGlobMatch[] = [];

    await this.walkProjectWorkspace(
      projectId,
      startPath,
      async (entry) => {
        const pathFromStart = startPath
          ? normalizeWorkspaceRelativePath(path.relative(startPath, entry.path))
          : entry.path;

        if (matcher.test(pathFromStart) || matcher.test(path.basename(entry.path))) {
          matches.push({
            path: entry.path,
            type: entry.type,
            updatedAt: entry.updatedAt,
          });
        }
      },
    );

    return matches
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      )
      .slice(0, MAX_TOOL_RESULTS);
  }

  async grepProjectWorkspace(
    projectId: string,
    pattern: string,
    options: {
      include?: string;
      path?: string;
    } = {},
  ) {
    if (!pattern) {
      throw new Error("Grep pattern must not be empty.");
    }

    let regex: RegExp;

    try {
      regex = new RegExp(pattern);
    } catch (error) {
      throw new Error(
        `Grep pattern must be a valid JavaScript regular expression: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const includeMatcher = options.include ? globToRegExp(options.include) : undefined;
    const matches: Array<WorkspaceGrepMatch & { updatedAtTime: number }> = [];
    const startPath = options.path && options.path !== "." ? options.path : "";
    const absoluteStartPath = startPath
      ? await this.resolveProjectWorkspacePath(projectId, startPath, {
          checkTargetSymlink: true,
        })
      : this.getProjectWorkspaceDirectory(projectId);
    const startStats = await stat(absoluteStartPath);

    const visitFile = async (absolutePath: string) => {
      const relativeFilePath = normalizeWorkspaceRelativePath(
        path.relative(this.getProjectWorkspaceDirectory(projectId), absolutePath),
      );

      if (
        includeMatcher &&
        !includeMatcher.test(relativeFilePath) &&
        !includeMatcher.test(path.basename(relativeFilePath))
      ) {
        return;
      }

      const fileStats = await stat(absolutePath);
      const content = await readFile(absolutePath, "utf8");
      const lines = content.split(/\r?\n/);

      lines.forEach((lineText, index) => {
        regex.lastIndex = 0;

        if (!regex.test(lineText)) {
          return;
        }

        matches.push({
          line: index + 1,
          path: relativeFilePath,
          preview: lineText.trim().slice(0, 240),
          updatedAtTime: fileStats.mtime.getTime(),
        });
      });
    };

    if (startStats.isFile()) {
      await visitFile(absoluteStartPath);
    } else if (startStats.isDirectory()) {
      await this.walkProjectWorkspace(projectId, startPath, async (entry, absolutePath) => {
        if (entry.type === "file") {
          await visitFile(absolutePath);
        }
      });
    }

    return matches
      .sort((left, right) => right.updatedAtTime - left.updatedAtTime)
      .slice(0, MAX_TOOL_RESULTS)
      .map((match) => ({
        line: match.line,
        path: match.path,
        preview: match.preview,
      }));
  }

  async applyProjectWorkspacePatch(
    projectId: string,
    changes: WorkspacePatchChange[],
  ) {
    const results = [];

    for (const change of changes) {
      if (change.operation === "delete") {
        results.push({
          operation: change.operation,
          result: await this.deleteProjectWorkspacePath(projectId, change.path),
        });
        continue;
      }

      if (change.operation === "edit") {
        results.push({
          operation: change.operation,
          result: await this.editProjectWorkspaceFile(
            projectId,
            change.path,
            change.oldString,
            change.newString,
            change.replaceAll,
          ),
        });
        continue;
      }

      results.push({
        operation: change.operation,
        result: await this.writeProjectWorkspaceFile(
          projectId,
          change.path,
          change.content,
        ),
      });
    }

    return {
      changed: results.length,
      results,
    };
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
    replaceAll = false,
  ) {
    if (!oldText) {
      throw new Error("oldText must not be empty.");
    }

    if (oldText === newText) {
      throw new Error("No changes to apply: oldText and newText are identical.");
    }

    const content = await this.readProjectWorkspaceFile(projectId, relativePath);
    const firstIndex = content.indexOf(oldText);

    if (firstIndex === -1) {
      throw new Error(`oldText was not found in Project Workspace file: ${relativePath}`);
    }

    const replacements = countOccurrences(content, oldText);

    if (!replaceAll && replacements > 1) {
      throw new Error(
        `oldText appears more than once in Project Workspace file: ${relativePath}`,
      );
    }

    const updatedContent = replaceAll
      ? content.split(oldText).join(newText)
      : content.slice(0, firstIndex) +
        newText +
        content.slice(firstIndex + oldText.length);

    await this.writeProjectWorkspaceFile(projectId, relativePath, updatedContent);

    return {
      path: normalizeWorkspaceRelativePath(relativePath),
      replacements: replaceAll ? replacements : 1,
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

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function countOccurrences(content: string, needle: string) {
  if (!needle) {
    return 0;
  }

  return content.split(needle).length - 1;
}

function globToRegExp(glob: string) {
  const normalized = glob.replaceAll("\\", "/");
  let source = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*") {
      if (next === "*") {
        const afterGlobstar = normalized[index + 2];
        index += 1;

        if (afterGlobstar === "/") {
          source += "(?:.*\\/)?";
          index += 1;
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }

      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    if (char === "{") {
      const closeIndex = normalized.indexOf("}", index + 1);

      if (closeIndex !== -1) {
        const alternatives = normalized
          .slice(index + 1, closeIndex)
          .split(",")
          .map(escapeRegExp)
          .join("|");
        source += `(?:${alternatives})`;
        index = closeIndex;
        continue;
      }
    }

    source += escapeRegExp(char);
  }

  source += "$";

  return new RegExp(source);
}

function escapeRegExp(value: string) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

async function movePathToTrash(
  targetPath: string,
  options: {
    platform: NodeJS.Platform;
    runWindowsRecycleCommand: (targetPath: string) => Promise<void>;
  },
) {
  if (options.platform === "win32") {
    await options.runWindowsRecycleCommand(targetPath);
    return;
  }

  await trash([targetPath], { glob: false });
}

async function runWindowsRecycleCommand(targetPath: string) {
  const recycleScript = `
$targetPath = [Environment]::GetEnvironmentVariable('HJDESIGN_TRASH_TARGET')
Add-Type -AssemblyName Microsoft.VisualBasic
$item = Get-Item -LiteralPath $targetPath -Force
if ($item.PSIsContainer) {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($item.FullName, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
} else {
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($item.FullName, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
}
`;

  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      recycleScript,
    ],
    {
      env: {
        ...process.env,
        HJDESIGN_TRASH_TARGET: targetPath,
      },
      windowsHide: true,
    },
  );
}
