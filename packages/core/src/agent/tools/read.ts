import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import type { ReadInput } from './types';

const DESCRIPTION = [
  'Read a file or directory from the current Project Workspace. If the path does not exist, an error is returned.',
  '',
  'Usage:',
  '- The path parameter must be a relative file or directory path inside the Project Workspace.',
  '- By default, this tool returns up to 2000 lines or directory entries from the start of the target.',
  '- The offset parameter is the line number or directory-entry number to start from (1-indexed).',
  '- To read later sections, call this tool again with a larger offset.',
  '- Use the grep tool to find specific content in large files or files with long lines.',
  '- If you are unsure of the correct path, use the glob tool to look up filenames by glob pattern.',
  '- File contents are returned with each line prefixed by its line number as `<line>: <content>`.',
  '- Directory entries are returned as Project Workspace relative paths.',
  '- Long lines and large files may be truncated. Use offset and limit to inspect the needed section.',
  '- Call this tool in parallel when you know there are multiple files you want to read.',
  '- Avoid tiny repeated slices. If you need more context, read a larger window.',
].join('\n');

export function createReadToolDefinition(): WorkspaceToolDefinition<
  ReadInput,
  Awaited<
    ReturnType<
      import('@owndesign/core/workspace-store').WorkspaceStore['readProjectWorkspaceEntry']
    >
  >
> {
  return {
    description: DESCRIPTION,
    inputSchema: z
      .object({
        limit: z
          .number()
          .describe('Maximum number of lines or directory entries to read. Defaults to 2000.')
          .optional(),
        offset: z
          .number()
          .describe(
            '1-indexed line or directory-entry offset to start reading from. Defaults to 1.',
          )
          .optional(),
        path: z
          .string()
          .describe('Relative file or directory path inside the Project Workspace.'),
      })
      .strict(),
    name: 'read',
    parallelSafe: true,
    execute: async ({ limit, offset, path }, { projectId, workspaceStore }) => {
      return workspaceStore.readProjectWorkspaceEntry(projectId, path, {
        limit,
        offset,
      });
    },
  };
}
