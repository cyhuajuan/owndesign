import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import { normalizeToolPath, readProjectWorkspaceFileIfExists } from './tool-paths';
import type { CopyFileInput } from './types';

export function createCopyFileToolDefinition(): WorkspaceToolDefinition<
  CopyFileInput,
  Awaited<
    ReturnType<
      import('@owndesign/core/workspace-store').WorkspaceStore['writeProjectWorkspaceFile']
    >
  >
> {
  return {
    description:
      'Copy one UTF-8 text file inside the current Project Workspace to a new path. Never overwrites existing files.',
    inputSchema: z
      .object({
        sourcePath: z.string().describe('Relative source file path inside the Project Workspace.'),
        targetPath: z
          .string()
          .describe(
            'Relative destination file path inside the Project Workspace. Must not already exist.',
          ),
      })
      .strict(),
    name: 'copyFile',
    parallelSafe: false,
    execute: async ({ sourcePath, targetPath }, { projectId, workspaceStore }) => {
      const normalizedSourcePath = normalizeToolPath(sourcePath);
      const normalizedTargetPath = normalizeToolPath(targetPath);

      const existingTarget = await readProjectWorkspaceFileIfExists(
        workspaceStore,
        projectId,
        normalizedTargetPath,
      );

      if (existingTarget !== undefined) {
        throw new Error(`Project Workspace file already exists: ${normalizedTargetPath}`);
      }

      const sourceContent = await workspaceStore.readProjectWorkspaceFile(
        projectId,
        normalizedSourcePath,
      );

      return workspaceStore.writeProjectWorkspaceFile(
        projectId,
        normalizedTargetPath,
        sourceContent,
      );
    },
  };
}
