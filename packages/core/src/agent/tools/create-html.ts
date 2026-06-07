import type { ResourceLibrary } from '@owndesign/core/settings/settings-service';
import { loadTemplate } from '@owndesign/core/templates';
import { z } from 'zod';

import { assertCreateHtmlAllowed, markCreatedHtmlPath } from '@owndesign/core/agent/page-edit-mode';
import {
  buildCdnTag,
  isHtmlPath,
  normalizeToolPath,
  readProjectWorkspaceFileIfExists,
} from './cdn-guard';
import type { WorkspaceToolDefinition } from './core';
import type { CreateHtmlInput } from './types';

const DEFAULT_TITLE = 'OwnDesign Preview';
const HTML_PAGE_PATH_PATTERN = /^[a-z][a-z0-9-]*\.html$/;

export function createCreateHtmlToolDefinition(): WorkspaceToolDefinition<
  CreateHtmlInput,
  {
    componentSource: string;
    componentTag: string;
    fontLibrary?: { cdn: string; name: string };
    iconLibrary?: { cdn: string; name: string };
    path: string;
    slug: string;
    title: string;
  }
> {
  return {
    description:
      'Create a new previewable HTML file from the configured resource template before designing a missing target HTML page. Never overwrites existing files.',
    inputSchema: z
      .object({
        fontLibraryName: z
          .string()
          .describe(
            'Optional configured font library name. Omit to use the default font library. Pass an empty string to disable font resources.',
          )
          .optional(),
        iconLibraryName: z
          .string()
          .describe(
            'Optional configured icon library name. Omit to use the default icon library. Pass an empty string to disable icon resources.',
          )
          .optional(),
        path: z
          .string()
          .describe(
            'Relative root HTML file path inside the Project Workspace, such as index.html or detail.html.',
          ),
        title: z
          .string()
          .describe('Optional document title. Defaults to OwnDesign Preview.')
          .optional(),
      })
      .strict(),
    name: 'createHtml',
    parallelSafe: false,
    execute: async (input, { pageEditModePolicy, projectId, resources, workspaceStore }) => {
      const targetPath = normalizeToolPath(input.path);
      assertCreateHtmlAllowed(pageEditModePolicy, targetPath);

      if (!isHtmlPath(targetPath)) {
        throw new Error(`HTML initialization target must end with .html: ${targetPath}`);
      }

      if (!HTML_PAGE_PATH_PATTERN.test(targetPath)) {
        throw new Error(`HTML initialization target must be a root slug HTML path: ${targetPath}`);
      }

      const existingHtml = await readProjectWorkspaceFileIfExists(
        workspaceStore,
        projectId,
        targetPath,
      );

      if (existingHtml !== undefined) {
        throw new Error(`Project Workspace HTML file already exists: ${targetPath}`);
      }

      const fontLibrary = selectLibrary(resources.fontLibraries, input.fontLibraryName, 'font');
      const iconLibrary = selectLibrary(resources.iconLibraries, input.iconLibraryName, 'icon');
      const slug = targetPath.replace(/\.html$/i, '');
      const componentTag = `od-${slug}-page`;
      const componentSource = `pages/${componentTag}.js`;
      const existingComponent = await readProjectWorkspaceFileIfExists(
        workspaceStore,
        projectId,
        componentSource,
      );

      if (existingComponent !== undefined) {
        throw new Error(`Project Workspace page component already exists: ${componentSource}`);
      }

      const title = input.title?.trim() || DEFAULT_TITLE;
      const html = buildHtmlTemplate({
        componentSource,
        componentTag,
        fontLibrary,
        iconLibrary,
        title,
      });

      await workspaceStore.writeProjectWorkspaceFile(projectId, targetPath, html);
      await workspaceStore.writeProjectWorkspaceFile(
        projectId,
        componentSource,
        buildPageComponentTemplate({ componentTag, title }),
      );
      markCreatedHtmlPath(pageEditModePolicy, targetPath);

      return {
        componentSource,
        componentTag,
        fontLibrary: formatSelectedLibrary(fontLibrary),
        iconLibrary: formatSelectedLibrary(iconLibrary),
        path: targetPath,
        slug,
        title,
      };
    },
  };
}

function selectLibrary(
  libraries: ResourceLibrary[],
  name: string | undefined,
  kind: 'font' | 'icon',
) {
  if (name === '') {
    return undefined;
  }

  if (name !== undefined) {
    const library = libraries.find((item) => item.name === name);

    if (!library) {
      throw new Error(`Configured ${kind} library was not found: ${name}`);
    }

    return library;
  }

  return libraries.find((library) => library.isDefault) ?? libraries[0];
}

function buildHtmlTemplate({
  componentSource,
  componentTag,
  fontLibrary,
  iconLibrary,
  title,
}: {
  componentSource: string;
  componentTag: string;
  fontLibrary?: ResourceLibrary;
  iconLibrary?: ResourceLibrary;
  title: string;
}) {
  const headTags = [
    fontLibrary?.cdn ? buildCdnTag({ resourceType: 'style-import', url: fontLibrary.cdn }) : '',
    iconLibrary?.cdn && inferIconLibraryResourceType(iconLibrary.cdn) === 'stylesheet'
      ? buildCdnTag({ resourceType: 'stylesheet', url: iconLibrary.cdn })
      : '',
  ].filter(Boolean);
  const bodyScripts = [
    iconLibrary?.cdn && inferIconLibraryResourceType(iconLibrary.cdn) === 'script'
      ? buildCdnTag({ resourceType: 'script', url: iconLibrary.cdn })
      : '',
    isLucideLibrary(iconLibrary) ? '  <script>window.lucide?.createIcons?.();</script>' : '',
  ].filter(Boolean);

  return renderTemplate(loadTemplate('html/page-shell'), {
    bodyScripts: bodyScripts.map((tag) => indentMultiline(tag, '  ')).join('\n'),
    componentSource,
    componentTag,
    headTags: headTags.map((tag) => indentMultiline(tag, '  ')).join('\n'),
    lang: 'zh-CN',
    title: escapeHtmlText(title),
  });
}

function buildPageComponentTemplate({
  componentTag,
  title,
}: {
  componentTag: string;
  title: string;
}) {
  const className = componentTag
    .split('-')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');

  return [
    `class ${className} extends HTMLElement {`,
    '  connectedCallback() {',
    '    this.innerHTML = `',
    '      <style>',
    '        .od-page { min-height: 100vh; display: grid; place-items: center; padding: 48px; font-family: system-ui, sans-serif; }',
    '        .od-page__content { text-align: center; }',
    '      </style>',
    '      <main class="od-page">',
    '        <section class="od-page__content">',
    `          <h1>${escapeTemplateText(title)}</h1>`,
    '        </section>',
    '      </main>',
    '    `;',
    '  }',
    '}',
    '',
    `customElements.define('${componentTag}', ${className});`,
    '',
  ].join('\n');
}

function renderTemplate(template: string, values: Record<string, string>) {
  return `${template.replace(/\{\{([a-zA-Z0-9]+)\}\}/g, (_match, key: string) => values[key] ?? '')}\n`;
}

function inferIconLibraryResourceType(cdn: string): 'script' | 'stylesheet' {
  const normalized = cdn.toLowerCase();

  return normalized.includes('.css') ||
    normalized.includes('/css/') ||
    normalized.includes('font-awesome')
    ? 'stylesheet'
    : 'script';
}

function isLucideLibrary(library: ResourceLibrary | undefined) {
  if (!library?.cdn) {
    return false;
  }

  const value = `${library.name} ${library.cdn}`.toLowerCase();

  return value.includes('lucide');
}

function formatSelectedLibrary(library: ResourceLibrary | undefined) {
  return library
    ? {
        cdn: library.cdn,
        name: library.name,
      }
    : undefined;
}

function indentMultiline(value: string, indent: string) {
  return value
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
}

function escapeHtmlText(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeTemplateText(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('${', '\\${')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
