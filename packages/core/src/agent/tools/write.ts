import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import type { WriteInput } from './types';
import {
  assertOwnDesignRuntimeScript,
  isProtectedSingleHtmlPath,
} from '@owndesign/core/templates/owndesign-runtime';

const DESCRIPTION = [
  'Writes a file in the current Project Workspace.',
  '',
  'Usage:',
  '- This tool will overwrite the existing file if there is one at the provided path.',
  '- The path parameter must be a relative file path inside the Project Workspace.',
  '- If this is an existing file, you must use the read tool first to read the file contents.',
  '- Prefer editing existing files with the edit tool. Only write full files when intentional.',
  '- Use write to create index.html only when it is missing and the file content is complete.',
  '- For index.html, preserve the OwnDesign protected runtime script unchanged, exactly once, as the last element inside <body>.',
  '- Never proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the user.',
  '- Only use emojis if the user explicitly requests them.',
].join('\n');

export function createWriteToolDefinition(): WorkspaceToolDefinition<
  WriteInput,
  Awaited<ReturnType<import('@owndesign/core/workspace-store').WorkspaceStore['writeProjectWorkspaceFile']>>
> {
  return {
    description: DESCRIPTION,
    inputSchema: z
      .object({
        content: z.string().describe('Complete UTF-8 text file content to write.'),
        path: z
          .string()
          .describe('Relative file path inside the Project Workspace to create or overwrite.'),
      })
      .strict(),
    name: 'write',
    parallelSafe: false,
    execute: async ({ content, path }, { projectId, workspaceStore }) => {
      if (isProtectedSingleHtmlPath(path)) {
        assertOwnDesignRuntimeScript(content);
      }

      return workspaceStore.writeProjectWorkspaceFile(projectId, path, content);
    },
  };
}
