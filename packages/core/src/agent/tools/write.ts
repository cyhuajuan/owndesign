import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import type { WriteInput } from './types';

export function createWriteToolDefinition(): WorkspaceToolDefinition<
  WriteInput,
  Awaited<ReturnType<import('@owndesign/core/workspace-store').WorkspaceStore['writeProjectWorkspaceFile']>>
> {
  return {
    description: 'Create or overwrite one UTF-8 text file in the current Project Workspace.',
    inputSchema: z
      .object({
        content: z.string().describe('Complete UTF-8 text file content.'),
        path: z.string().describe('Relative file path inside the Project Workspace.'),
      })
      .strict(),
    name: 'write',
    parallelSafe: false,
    execute: async ({ content, path }, { projectId, workspaceStore }) =>
      workspaceStore.writeProjectWorkspaceFile(projectId, path, content),
  };
}
