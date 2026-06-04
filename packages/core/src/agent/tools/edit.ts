import { resolveHtmlOperationPathForPageEditModePolicy } from '@owndesign/core/agent/page-edit-mode';
import { z } from 'zod';

import { editProjectWorkspaceFileWithCdnGuard } from './cdn-guard';
import type { WorkspaceToolDefinition } from './core';
import type { EditInput } from './types';

export function createEditToolDefinition(): WorkspaceToolDefinition<
  EditInput,
  Awaited<ReturnType<typeof editProjectWorkspaceFileWithCdnGuard>>
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
    execute: async (
      { newString, oldString, path, replaceAll },
      { approvedCdnUrls, pageEditModePolicy, projectId, workspaceStore },
    ) => {
      const editPath = resolveHtmlOperationPathForPageEditModePolicy(
        pageEditModePolicy,
        'mutate',
        path,
      );

      return editProjectWorkspaceFileWithCdnGuard(
        workspaceStore,
        projectId,
        editPath,
        oldString,
        newString,
        replaceAll,
        approvedCdnUrls,
      );
    },
  };
}
