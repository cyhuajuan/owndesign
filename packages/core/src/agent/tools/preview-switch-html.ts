import { resolveHtmlOperationPathForPageEditModePolicy } from '@owndesign/core/agent/page-edit-mode';
import { sendFrontendCommand } from '@owndesign/core/realtime/frontend-command-bus';
import { z } from 'zod';

import { isHtmlPath, normalizeToolPath } from './cdn-guard';
import type { WorkspaceToolDefinition } from './core';

type PreviewSwitchHtmlInput = {
  path: string;
};

export function createPreviewSwitchHtmlToolDefinition(): WorkspaceToolDefinition<
  PreviewSwitchHtmlInput,
  {
    capability: 'preview.switchHtml';
    delivered: boolean;
    payload: { path: string };
  }
> {
  return {
    description:
      'Switch the Preview Pane to an existing HTML file after successful previewable HTML changes.',
    inputSchema: z
      .object({
        path: z
          .string()
          .describe(
            'Relative HTML file path inside the Project Workspace to show in the Preview Pane.',
          ),
      })
      .strict(),
    name: 'previewSwitchHtml',
    parallelSafe: false,
    execute: async ({ path }, context) => {
      if (!context.frontendTabId) {
        throw new Error('Frontend tab id is required to switch the preview.');
      }

      const targetPath = normalizeToolPath(path);

      if (!targetPath || targetPath === '.') {
        throw new Error('Preview switch target path must not be empty.');
      }

      if (!isHtmlPath(targetPath)) {
        throw new Error(`Preview switch target must end with .html: ${targetPath}`);
      }

      const previewPath = resolveHtmlOperationPathForPageEditModePolicy(
        context.pageEditModePolicy,
        'preview',
        targetPath,
      );
      const htmlFiles = await context.workspaceStore.listProjectHtmlFiles(context.projectId);

      if (!htmlFiles.includes(previewPath)) {
        throw new Error(`Project Workspace HTML file was not found: ${previewPath}`);
      }

      const payload = { path: previewPath };
      const result = sendFrontendCommand({
        capability: 'preview.switchHtml',
        frontendTabId: context.frontendTabId,
        payload,
        projectId: context.projectId,
      });

      return {
        capability: 'preview.switchHtml',
        delivered: result?.delivered ?? false,
        payload,
      };
    },
  };
}
