import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import type { EditInput } from './types';

export function createEditToolDefinition(): WorkspaceToolDefinition<
  EditInput,
  Awaited<ReturnType<import('@owndesign/core/workspace-store').WorkspaceStore['editProjectWorkspaceFile']>>
> {
  return {
    description:
      'Edit one UTF-8 text file by replacing oldString with newString. By default oldString must occur exactly once; set replaceAll to replace every occurrence.',
    inputSchema: z
      .object({
        newString: z.string().describe('Replacement text.'),
        oldString: z.string().describe('Text to replace.'),
        path: z.string().describe('Relative file path inside the Project Workspace.'),
        replaceAll: z
          .boolean()
          .describe('Replace every occurrence of oldString instead of requiring exactly one match.')
          .optional(),
      })
      .strict(),
    name: 'edit',
    parallelSafe: false,
    execute: async ({ newString, oldString, path, replaceAll }, { projectId, workspaceStore }) =>
      workspaceStore.editProjectWorkspaceFile(projectId, path, oldString, newString, replaceAll),
  };
}
