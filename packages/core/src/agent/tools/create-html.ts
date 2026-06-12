import { loadTemplate } from '@owndesign/core/templates';
import { z } from 'zod';

import { isHtmlPath, normalizeToolPath, readProjectWorkspaceFileIfExists } from './cdn-guard';
import type { WorkspaceToolDefinition } from './core';
import type { CreateHtmlInput } from './types';

const DEFAULT_TITLE = 'OwnDesign Preview';
const SINGLE_HTML_PATH = 'index.html';

export function createCreateHtmlToolDefinition(): WorkspaceToolDefinition<
  CreateHtmlInput,
  {
    path: string;
    title: string;
  }
> {
  return {
    description:
      'Create the single previewable index.html file from the configured template before designing a missing Single HTML project. Never overwrites existing files.',
    inputSchema: z
      .object({
        path: z
          .string()
          .describe('Relative HTML file path inside the Project Workspace. Must be index.html.'),
        title: z
          .string()
          .describe('Optional document title. Defaults to OwnDesign Preview.')
          .optional(),
      })
      .strict(),
    name: 'createHtml',
    parallelSafe: false,
    execute: async (input, { projectId, workspaceStore }) => {
      const targetPath = normalizeToolPath(input.path);

      if (!isHtmlPath(targetPath)) {
        throw new Error(`HTML initialization target must end with .html: ${targetPath}`);
      }

      if (targetPath !== SINGLE_HTML_PATH) {
        throw new Error(`Single HTML projects can only create ${SINGLE_HTML_PATH}: ${targetPath}`);
      }

      const existingHtml = await readProjectWorkspaceFileIfExists(
        workspaceStore,
        projectId,
        targetPath,
      );

      if (existingHtml !== undefined) {
        throw new Error(`Project Workspace HTML file already exists: ${targetPath}`);
      }

      const title = input.title?.trim() || DEFAULT_TITLE;

      await workspaceStore.writeProjectWorkspaceFile(
        projectId,
        targetPath,
        buildSingleHtmlTemplate({ title }),
      );

      return {
        path: targetPath,
        title,
      };
    },
  };
}

export function buildSingleHtmlTemplate({ title }: { title: string }) {
  return renderTemplate(loadTemplate('html/page-shell'), {
    lang: 'zh-CN',
    title: escapeHtmlText(title),
  });
}

function renderTemplate(template: string, values: Record<string, string>) {
  return `${template.replace(/\{\{([a-zA-Z0-9]+)\}\}/g, (_match, key: string) => values[key] ?? '')}\n`;
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
