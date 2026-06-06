import {
  HTML_SHARED_COMPONENTS_MANIFEST_PATH,
  parseHtmlSharedComponentsManifest,
  replaceHtmlSharedComponentMarkerContent,
  renderNavigationSharedComponentContent,
  serializeHtmlSharedComponentsManifest,
  type HtmlSharedComponentsManifest,
  type HtmlSharedComponentSyncMode,
} from '@owndesign/core/html-shared-components';
import type { WorkspacePatchChange, WorkspaceStore } from '@owndesign/core/workspace-store';
import { z } from 'zod';

import {
  applyProjectWorkspacePatchWithCdnGuard,
  readProjectWorkspaceFileIfExists,
} from './cdn-guard';
import type { WorkspaceToolDefinition } from './core';
import type { SyncSharedComponentInput } from './types';

type SyncSharedComponentOutput = {
  manifestUpdated: boolean;
  skippedPages: string[];
  source: string;
  updatedPages: string[];
};

const COMPONENT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function createSyncSharedComponentToolDefinition(): WorkspaceToolDefinition<
  SyncSharedComponentInput,
  SyncSharedComponentOutput
> {
  return {
    description:
      'Create or update a shared HTML component fragment and sync it into existing marker blocks across HTML pages.',
    inputSchema: z
      .object({
        content: z
          .string()
          .describe(
            'Complete shared component HTML fragment. Omit to reuse the current source file.',
          )
          .optional(),
        description: z
          .string()
          .describe('Short natural-language description of the shared component.')
          .optional(),
        name: z
          .string()
          .describe(
            'Shared component slug, such as nav. Use lowercase letters, digits, and hyphens.',
          ),
        syncMode: z
          .enum(['exact', 'navigation', 'pattern'])
          .describe(
            'Sync behavior: exact copies markup, navigation injects active state per page, pattern only updates the template.',
          )
          .optional(),
        usedBy: z
          .array(
            z.string().describe('Relative HTML page path that already contains the marker block.'),
          )
          .optional(),
      })
      .strict(),
    name: 'syncSharedComponent',
    parallelSafe: false,
    execute: async (
      { content, description, name, syncMode, usedBy },
      { approvedCdnUrls, projectId, workspaceStore },
    ) => {
      const componentName = name.trim();

      if (!COMPONENT_NAME_PATTERN.test(componentName)) {
        throw new Error(`Shared component name must be a lowercase slug: ${name}`);
      }

      const source = `components/${componentName}.html`;
      const manifest = parseHtmlSharedComponentsManifest(
        await readProjectWorkspaceFileIfExists(
          workspaceStore,
          projectId,
          HTML_SHARED_COMPONENTS_MANIFEST_PATH,
        ),
      );
      const rawComponentContent =
        content ?? (await readProjectWorkspaceFileIfExists(workspaceStore, projectId, source));

      if (rawComponentContent === undefined) {
        throw new Error(`Shared component source was not found: ${source}`);
      }

      const existingComponent = manifest.components.find(
        (component) => component.name === componentName,
      );
      const resolvedSyncMode = syncMode ?? existingComponent?.syncMode ?? 'exact';
      const componentContent =
        resolvedSyncMode === 'navigation'
          ? renderNavigationSharedComponentContent(rawComponentContent, '')
          : rawComponentContent;
      const targetPages =
        resolvedSyncMode === 'pattern'
          ? []
          : await resolveTargetPages({
              componentName,
              manifest,
              projectId,
              usedBy,
              workspaceStore,
            });
      const changes: WorkspacePatchChange[] = [];
      const skippedPages: string[] = [];
      const updatedPages: string[] = [];

      for (const pagePath of targetPages) {
        if (!pagePath.toLowerCase().endsWith('.html')) {
          skippedPages.push(pagePath);
          continue;
        }

        const html = await readProjectWorkspaceFileIfExists(workspaceStore, projectId, pagePath);

        if (html === undefined) {
          skippedPages.push(pagePath);
          continue;
        }

        const pageComponentContent = renderSharedComponentContentForPage(
          componentContent,
          resolvedSyncMode,
          pagePath,
        );
        const updatedHtml = replaceHtmlSharedComponentMarkerContent(
          html,
          componentName,
          pageComponentContent,
        );

        if (updatedHtml === undefined) {
          skippedPages.push(pagePath);
          continue;
        }

        updatedPages.push(pagePath);
        changes.push({
          content: updatedHtml,
          operation: 'write',
          path: pagePath,
        });
      }

      if (changes.length) {
        await applyProjectWorkspacePatchWithCdnGuard(
          workspaceStore,
          projectId,
          changes,
          approvedCdnUrls,
        );
      }

      await workspaceStore.writeProjectWorkspaceFile(projectId, source, componentContent);
      await workspaceStore.writeProjectWorkspaceFile(
        projectId,
        HTML_SHARED_COMPONENTS_MANIFEST_PATH,
        serializeHtmlSharedComponentsManifest(
          upsertSharedComponent(manifest, {
            description: description?.trim() || existingComponent?.description,
            name: componentName,
            source,
            syncMode: resolvedSyncMode,
            usedBy:
              resolvedSyncMode === 'pattern'
                ? uniquePaths(usedBy ?? existingComponent?.usedBy ?? [])
                : updatedPages,
          }),
        ),
      );

      return {
        manifestUpdated: true,
        skippedPages,
        source,
        updatedPages,
      };
    },
  };
}

async function resolveTargetPages({
  componentName,
  manifest,
  projectId,
  usedBy,
  workspaceStore,
}: {
  componentName: string;
  manifest: HtmlSharedComponentsManifest;
  projectId: string;
  usedBy?: string[];
  workspaceStore: WorkspaceStore;
}) {
  if (usedBy) {
    return uniquePaths(usedBy);
  }

  const manifestPages =
    manifest.components.find((component) => component.name === componentName)?.usedBy ?? [];
  const htmlFiles = await workspaceStore.listProjectHtmlFiles(projectId);
  const marker = `<!-- owndesign:component ${componentName} start -->`;
  const markerPages: string[] = [];

  for (const htmlFile of htmlFiles) {
    const html = await readProjectWorkspaceFileIfExists(workspaceStore, projectId, htmlFile);

    if (html?.includes(marker)) {
      markerPages.push(htmlFile);
    }
  }

  return uniquePaths([...manifestPages, ...markerPages]);
}

function renderSharedComponentContentForPage(
  content: string,
  syncMode: HtmlSharedComponentSyncMode,
  pagePath: string,
) {
  if (syncMode === 'navigation') {
    return renderNavigationSharedComponentContent(content, pagePath);
  }

  return content;
}

function upsertSharedComponent(
  manifest: HtmlSharedComponentsManifest,
  component: HtmlSharedComponentsManifest['components'][number],
): HtmlSharedComponentsManifest {
  const components = manifest.components.filter((item) => item.name !== component.name);

  return {
    components: [
      ...components,
      {
        ...component,
        usedBy: uniquePaths(component.usedBy),
      },
    ],
  };
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
}
