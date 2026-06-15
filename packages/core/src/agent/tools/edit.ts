import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import type { EditInput } from './types';

const DESCRIPTION = [
  'Performs exact string replacements in Project Workspace files.',
  '',
  'Usage:',
  '- You must use the read tool before editing an existing file so you can match the current contents exactly.',
  '- The path parameter must be a relative file path inside the Project Workspace.',
  '- When editing text from read tool output, preserve the exact indentation after the line number prefix.',
  '- The line number prefix format is `<line>: `. Everything after that prefix is the actual file content to match.',
  '- Never include any part of the line number prefix in oldString or newString.',
  '- Prefer editing existing files. Only create new files when the user request explicitly requires it.',
  '- Only use emojis if the user explicitly requests them.',
  '- The edit will fail if oldString is not found in the file.',
  '- The edit will fail if oldString is found multiple times unless replaceAll is true.',
  '- Provide more surrounding context in oldString when you need to identify one specific match.',
  '- Use replaceAll for replacing or renaming every occurrence of a string across the file.',
].join('\n');

export function createEditToolDefinition(): WorkspaceToolDefinition<
  EditInput,
  Awaited<ReturnType<import('@owndesign/core/workspace-store').WorkspaceStore['editProjectWorkspaceFile']>>
> {
  return {
    description: DESCRIPTION,
    inputSchema: z
      .object({
        newString: z
          .string()
          .describe('Replacement text. Must be different from oldString.'),
        oldString: z
          .string()
          .describe('Exact text to replace from the current file contents.'),
        path: z.string().describe('Relative file path inside the Project Workspace to modify.'),
        replaceAll: z
          .boolean()
          .describe(
            'Replace every occurrence of oldString instead of requiring exactly one match. Default false.',
          )
          .optional(),
      })
      .strict(),
    name: 'edit',
    parallelSafe: false,
    execute: async ({ newString, oldString, path, replaceAll }, { projectId, workspaceStore }) =>
      workspaceStore.editProjectWorkspaceFile(projectId, path, oldString, newString, replaceAll),
  };
}
