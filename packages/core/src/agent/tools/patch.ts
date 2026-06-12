import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import type { PatchInput } from './types';

export function createPatchToolDefinition(): WorkspaceToolDefinition<
  PatchInput,
  Awaited<ReturnType<import('@owndesign/core/workspace-store').WorkspaceStore['applyProjectWorkspacePatch']>>
> {
  return {
    description:
      'Apply coordinated UTF-8 file changes inside the current Project Workspace. Supports add/write, edit, and delete changes.',
    inputSchema: z
      .object({
        changes: z
          .array(
            z.discriminatedUnion('operation', [
              z
                .object({
                  content: z.string().describe('Complete file content for add operations.'),
                  operation: z.literal('add'),
                  path: z
                    .string()
                    .describe('Relative file or directory path inside the Project Workspace.'),
                })
                .strict(),
              z
                .object({
                  content: z.string().describe('Complete file content for write operations.'),
                  operation: z.literal('write'),
                  path: z
                    .string()
                    .describe('Relative file or directory path inside the Project Workspace.'),
                })
                .strict(),
              z
                .object({
                  newString: z.string().describe('Replacement text for edit operations.'),
                  oldString: z.string().describe('Text to replace for edit operations.'),
                  operation: z.literal('edit'),
                  path: z
                    .string()
                    .describe('Relative file or directory path inside the Project Workspace.'),
                  replaceAll: z
                    .boolean()
                    .describe('For edit operations, replace every occurrence of oldString.')
                    .optional(),
                })
                .strict(),
              z
                .object({
                  operation: z.literal('delete'),
                  path: z
                    .string()
                    .describe('Relative file or directory path inside the Project Workspace.'),
                })
                .strict(),
            ]),
          )
          .min(1),
      })
      .strict(),
    name: 'patch',
    parallelSafe: false,
    execute: async ({ changes }, { projectId, workspaceStore }) =>
      workspaceStore.applyProjectWorkspacePatch(projectId, changes),
  };
}
