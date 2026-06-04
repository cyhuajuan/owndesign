import type { WorkspaceGlobMatch } from '@owndesign/core/workspace-store';
import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import type { GlobInput } from './types';

export function createGlobToolDefinition(): WorkspaceToolDefinition<
  GlobInput,
  { matches: WorkspaceGlobMatch[]; totalMatches: number; truncated: boolean }
> {
  return {
    description:
      'Find files and directories in the current Project Workspace by glob pattern, sorted by most recently modified first.',
    inputSchema: z
      .object({
        path: z
          .string()
          .describe('Optional relative directory path inside the Project Workspace to search from.')
          .optional(),
        pattern: z
          .string()
          .describe('Glob pattern such as "**/*.html", "assets/*.{css,js}", or "index.html".'),
      })
      .strict(),
    name: 'glob',
    parallelSafe: true,
    execute: async ({ path, pattern }, { projectId, workspaceStore }) => {
      return workspaceStore.globProjectWorkspace(projectId, pattern, path);
    },
  };
}
