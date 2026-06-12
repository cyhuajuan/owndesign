export type HtmlSharedComponent = {
  description?: string;
  name: string;
  source: string;
  tagName: string;
  usedBy: string[];
};

export type HtmlSharedComponentsManifest = {
  components: HtmlSharedComponent[];
};

export const HTML_SHARED_COMPONENTS_MANIFEST_PATH = '.owndesign-components.json';

const EMPTY_HTML_SHARED_COMPONENTS_MANIFEST: HtmlSharedComponentsManifest = {
  components: [],
};

export function parseHtmlSharedComponentsManifest(
  content: string | undefined,
): HtmlSharedComponentsManifest {
  if (!content) {
    return EMPTY_HTML_SHARED_COMPONENTS_MANIFEST;
  }

  let value: unknown;

  try {
    value = JSON.parse(content);
  } catch {
    return EMPTY_HTML_SHARED_COMPONENTS_MANIFEST;
  }

  if (!isRecord(value) || !Array.isArray(value.components)) {
    return EMPTY_HTML_SHARED_COMPONENTS_MANIFEST;
  }

  const components = value.components
    .filter(isRecord)
    .map((component) => ({
      description:
        typeof component.description === 'string' && component.description.trim()
          ? component.description.trim()
          : undefined,
      name: typeof component.name === 'string' ? component.name.trim() : '',
      source: typeof component.source === 'string' ? component.source.trim() : '',
      tagName: typeof component.tagName === 'string' ? component.tagName.trim() : '',
      usedBy: Array.isArray(component.usedBy)
        ? component.usedBy.filter((path): path is string => typeof path === 'string')
        : [],
    }))
    .filter((component) => component.name && component.source && component.tagName)
    .map((component) => ({
      ...component,
      usedBy: Array.from(new Set(component.usedBy.map((path) => path.trim()).filter(Boolean))),
    }));

  return { components };
}

export function serializeHtmlSharedComponentsManifest(
  manifest: HtmlSharedComponentsManifest,
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function getHtmlPageSlug(pagePath: string) {
  const fileName = pagePath.replaceAll('\\', '/').split('/').pop() ?? pagePath;
  return fileName.replace(/\.html$/i, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
