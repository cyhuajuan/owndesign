import { resolveHtmlOperationPathForPageEditModePolicy } from '@owndesign/core/agent/page-edit-mode';
import { z } from 'zod';

import { writeProjectWorkspaceFileWithCdnGuard } from './cdn-guard';
import type { WorkspaceToolDefinition } from './core';
import type { WriteInput } from './types';

export function createWriteToolDefinition(): WorkspaceToolDefinition<
  WriteInput,
  Awaited<ReturnType<typeof writeProjectWorkspaceFileWithCdnGuard>>
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
    execute: async (
      { content, path },
      { approvedCdnUrls, pageEditModePolicy, projectId, workspaceStore },
    ) => {
      const writePath = resolveHtmlOperationPathForPageEditModePolicy(
        pageEditModePolicy,
        'mutate',
        path,
      );

      return writeProjectWorkspaceFileWithCdnGuard(
        workspaceStore,
        projectId,
        writePath,
        content,
        approvedCdnUrls,
      );
    },
  };
}
