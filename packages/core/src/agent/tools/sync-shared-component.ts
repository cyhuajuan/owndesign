import {
  HTML_SHARED_COMPONENTS_MANIFEST_PATH,
  parseHtmlSharedComponentsManifest,
  serializeHtmlSharedComponentsManifest,
  type HtmlSharedComponentsManifest,
} from '@owndesign/core/html-shared-components';
import { z } from 'zod';

import type { WorkspaceToolDefinition } from './core';
import { readProjectWorkspaceFileIfExists } from './tool-paths';
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
      'Create or update a shared Web Component module and record it in the shared component manifest.',
    inputSchema: z
      .object({
        content: z
          .string()
          .describe(
            'Complete JavaScript module that defines the shared custom element. Omit to reuse the current source file.',
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
        tagName: z.string().describe('Custom element tag name, such as od-navigation.').optional(),
        usedBy: z
          .array(
            z.string().describe('Relative HTML page path that imports or uses this component.'),
          )
          .optional(),
      })
      .strict(),
    name: 'syncSharedComponent',
    parallelSafe: false,
    execute: async (
      { content, description, name, tagName, usedBy },
      { projectId, workspaceStore },
    ) => {
      const componentName = name.trim();

      if (!COMPONENT_NAME_PATTERN.test(componentName)) {
        throw new Error(`Shared component name must be a lowercase slug: ${name}`);
      }

      const resolvedTagName = tagName?.trim() || `od-${componentName}`;
      const source = `components/${resolvedTagName}.js`;
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
      const resolvedUsedBy = uniquePaths(usedBy ?? existingComponent?.usedBy ?? []);

      await workspaceStore.writeProjectWorkspaceFile(projectId, source, rawComponentContent);
      await workspaceStore.writeProjectWorkspaceFile(
        projectId,
        HTML_SHARED_COMPONENTS_MANIFEST_PATH,
        serializeHtmlSharedComponentsManifest(
          upsertSharedComponent(manifest, {
            description: description?.trim() || existingComponent?.description,
            name: componentName,
            source,
            tagName: resolvedTagName,
            usedBy: resolvedUsedBy,
          }),
        ),
      );

      return {
        manifestUpdated: true,
        skippedPages: [],
        source,
        updatedPages: resolvedUsedBy,
      };
    },
  };
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
