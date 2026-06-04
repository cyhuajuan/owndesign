import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import type { ReadInput } from './types';

export function createReadToolDefinition(): WorkspaceToolDefinition<
  ReadInput,
  Awaited<
    ReturnType<
      import('@owndesign/core/workspace-store').WorkspaceStore['readProjectWorkspaceEntry']
    >
  >
> {
  return {
    description:
      'Read one UTF-8 file or directory from the current Project Workspace. Files are returned with 1-indexed line numbers.',
    inputSchema: z
      .object({
        limit: z
          .number()
          .describe('Maximum number of lines or directory entries to read. Defaults to 2000.')
          .optional(),
        offset: z
          .number()
          .describe(
            '1-indexed line or directory-entry offset to start reading from. Defaults to 1.',
          )
          .optional(),
        path: z.string().describe('Relative file or directory path inside the Project Workspace.'),
      })
      .strict(),
    name: 'read',
    parallelSafe: true,
    execute: async ({ limit, offset, path }, { projectId, workspaceStore }) => {
      return workspaceStore.readProjectWorkspaceEntry(projectId, path, {
        limit,
        offset,
      });
    },
  };
}
