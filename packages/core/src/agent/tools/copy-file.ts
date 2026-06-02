import { assertCopyFileAllowed } from "@owndesign/core/agent/page-edit-mode";
import { z } from "zod";

import {
  normalizeToolPath,
  readProjectWorkspaceFileIfExists,
  writeProjectWorkspaceFileWithCdnGuard,
} from "./cdn-guard";
import type { WorkspaceToolDefinition } from "./core";
import type { CopyFileInput } from "./types";

export function createCopyFileToolDefinition(): WorkspaceToolDefinition<
  CopyFileInput,
  Awaited<ReturnType<typeof writeProjectWorkspaceFileWithCdnGuard>>
> {
  return {
    description:
      "Copy one UTF-8 text file inside the current Project Workspace to a new path. Never overwrites existing files.",
    inputSchema: z.object({
      sourcePath: z.string().describe("Relative source file path inside the Project Workspace."),
      targetPath: z
        .string()
        .describe("Relative destination file path inside the Project Workspace. Must not already exist."),
    }).strict(),
    name: "copyFile",
    parallelSafe: false,
    execute: async (
      { sourcePath, targetPath },
      { approvedCdnUrls, pageEditModePolicy, projectId, workspaceStore },
    ) => {
      const normalizedSourcePath = normalizeToolPath(sourcePath);
      const normalizedTargetPath = normalizeToolPath(targetPath);

      assertCopyFileAllowed(
        pageEditModePolicy,
        normalizedSourcePath,
        normalizedTargetPath,
      );

      const existingTarget = await readProjectWorkspaceFileIfExists(
        workspaceStore,
        projectId,
        normalizedTargetPath,
      );

      if (existingTarget !== undefined) {
        throw new Error(
          `Project Workspace file already exists: ${normalizedTargetPath}`,
        );
      }

      const sourceContent = await workspaceStore.readProjectWorkspaceFile(
        projectId,
        normalizedSourcePath,
      );

      return writeProjectWorkspaceFileWithCdnGuard(
        workspaceStore,
        projectId,
        normalizedTargetPath,
        sourceContent,
        approvedCdnUrls,
      );
    },
  };
}
