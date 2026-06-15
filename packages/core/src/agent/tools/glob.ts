import type { WorkspaceGlobMatch } from '@owndesign/core/workspace-store';
import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import type { GlobInput } from './types';

const DESCRIPTION = [
  '- Fast file pattern matching tool for the current Project Workspace.',
  '- Supports glob patterns like "**/*.html" or "assets/*.{css,js}".',
  '- Returns matching Project Workspace relative file and directory paths.',
  '- Use this tool when you need to find files by name patterns.',
  '- The optional path parameter must be a relative directory path inside the Project Workspace.',
  '- You can call multiple read, glob, and grep tools in parallel when several searches are useful.',
].join('\n');

export function createGlobToolDefinition(): WorkspaceToolDefinition<
  GlobInput,
  { matches: WorkspaceGlobMatch[]; totalMatches: number; truncated: boolean }
> {
  return {
    description: DESCRIPTION,
    inputSchema: z
      .object({
        path: z
          .string()
          .describe(
            'Optional relative directory path inside the Project Workspace to search from. Omit this field to search from the workspace root.',
          )
          .optional(),
        pattern: z
          .string()
          .describe(
            'Glob pattern to match Project Workspace files against, such as "**/*.html", "assets/*.{css,js}", or "index.html".',
          ),
      })
      .strict(),
    name: 'glob',
    parallelSafe: true,
    execute: async ({ path, pattern }, { projectId, workspaceStore }) => {
      return workspaceStore.globProjectWorkspace(projectId, pattern, path);
    },
  };
}
