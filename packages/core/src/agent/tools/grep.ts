import type { WorkspaceGrepResult } from '@owndesign/core/workspace-store';
import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import type { GrepInput } from './types';

const DESCRIPTION = [
  '- Fast content search tool for UTF-8 text files in the current Project Workspace.',
  '- Searches file contents using JavaScript regular expressions.',
  '- Supports regex patterns such as "log.*Error" or "function\\s+\\w+".',
  '- Filter files by pattern with the include parameter, such as "*.html" or "**/*.{css,js}".',
  '- Returns Project Workspace relative file paths and line numbers with matching lines.',
  '- Use this tool when you need to find files containing specific patterns.',
  '- Use a more specific path or include pattern if the result is too broad or truncated.',
].join('\n');

export function createGrepToolDefinition(): WorkspaceToolDefinition<
  GrepInput,
  WorkspaceGrepResult
> {
  return {
    description: DESCRIPTION,
    inputSchema: z
      .object({
        include: z
          .string()
          .describe(
            'Optional Project Workspace file glob to include, such as "*.html" or "**/*.{css,js}".',
          )
          .optional(),
        path: z
          .string()
          .describe(
            'Optional relative file or directory path inside the Project Workspace to search. Omit this field to search the workspace root.',
          )
          .optional(),
        pattern: z
          .string()
          .describe('JavaScript regular expression pattern to search for in file contents.'),
      })
      .strict(),
    name: 'grep',
    parallelSafe: true,
    execute: async ({ include, path, pattern }, { projectId, workspaceStore }) => {
      return workspaceStore.grepProjectWorkspace(projectId, pattern, {
        include,
        path,
      });
    },
  };
}
