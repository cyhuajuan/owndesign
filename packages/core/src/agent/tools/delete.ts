import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import type { DeleteInput } from './types';

export function createDeleteToolDefinition(): WorkspaceToolDefinition<
  DeleteInput,
  Awaited<
    ReturnType<
      import('@owndesign/core/workspace-store').WorkspaceStore['deleteProjectWorkspacePath']
    >
  >
> {
  return {
    description: 'Recursively delete a file or directory from the current Project Workspace.',
    inputSchema: z
      .object({
        path: z.string().describe('Relative file or directory path inside the Project Workspace.'),
      })
      .strict(),
    name: 'delete',
    parallelSafe: false,
    execute: async ({ path }, { projectId, workspaceStore }) =>
      workspaceStore.deleteProjectWorkspacePath(projectId, path),
  };
}
