import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import { assertAgentWorkspaceMutationPathAllowed } from './protected-paths';
import type { EditInput } from './types';
import { buildUnifiedDiff } from '@owndesign/core/workspace-store/diff';
import { normalizeWorkspaceRelativePath } from '@owndesign/core/workspace-store/paths';
import { applyTextEdit } from '@owndesign/core/workspace-store/text';
import {
  assertOwnDesignRuntimeScript,
  isProtectedSingleHtmlPath,
} from '@owndesign/core/templates/owndesign-runtime';

const DESCRIPTION = [
  'Performs exact string replacements in Project Workspace files.',
  '',
  'Usage:',
  '- You must use the read tool before editing an existing file so you can match the current contents exactly.',
  '- The path parameter must be a relative file path inside the Project Workspace.',
  '- When editing text from read tool output, preserve the exact indentation after the line number prefix.',
  '- The line number prefix format is `<line>: `. Everything after that prefix is the actual file content to match.',
  '- Never include any part of the line number prefix in oldString or newString.',
  '- Provide oldString as the literal file content. Do not add backslash escapes to quotes or backticks (\\" \\\' \\`), even when the text is inside a JavaScript template literal or string.',
  '- Prefer editing existing files. Only create new files when the user request explicitly requires it.',
  '- For index.html, preserve the OwnDesign protected runtime script unchanged, exactly once, as the last element inside <body>.',
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
    execute: async ({ newString, oldString, path, replaceAll }, { projectId, workspaceStore }) => {
      assertAgentWorkspaceMutationPathAllowed(path);

      const content = await workspaceStore.readProjectWorkspaceFile(projectId, path);
      const { content: updatedContent, replacements } = applyTextEdit(
        content,
        oldString,
        newString,
        replaceAll,
        path,
      );

      if (isProtectedSingleHtmlPath(path)) {
        assertOwnDesignRuntimeScript(updatedContent);
      }

      await workspaceStore.writeProjectWorkspaceFile(projectId, path, updatedContent);

      return {
        diff: buildUnifiedDiff(content, updatedContent, normalizeWorkspaceRelativePath(path)),
        path: normalizeWorkspaceRelativePath(path),
        replacements: replaceAll ? replacements : 1,
      };
    },
  };
}
