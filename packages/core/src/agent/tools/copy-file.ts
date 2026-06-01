import { assertCopyFileAllowed } from "@owndesign/core/agent/page-edit-mode";

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
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: {
          type: "string",
          description: "Relative source file path inside the Project Workspace.",
        },
        targetPath: {
          type: "string",
          description:
            "Relative destination file path inside the Project Workspace. Must not already exist.",
        },
      },
      required: ["sourcePath", "targetPath"],
      additionalProperties: false,
    },
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
