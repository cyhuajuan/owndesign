export type HtmlSharedComponent = {
  name: string;
  source: string;
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
      name: typeof component.name === 'string' ? component.name.trim() : '',
      source: typeof component.source === 'string' ? component.source.trim() : '',
      usedBy: Array.isArray(component.usedBy)
        ? component.usedBy.filter((path): path is string => typeof path === 'string')
        : [],
    }))
    .filter((component) => component.name && component.source)
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

export function getHtmlSharedComponentMarker(name: string) {
  return {
    end: `<!-- owndesign:component ${name} end -->`,
    start: `<!-- owndesign:component ${name} start -->`,
  };
}

export function replaceHtmlSharedComponentMarkerContent(
  html: string,
  name: string,
  content: string,
) {
  const marker = getHtmlSharedComponentMarker(name);
  const pattern = new RegExp(
    `${escapeRegExp(marker.start)}[\\s\\S]*?${escapeRegExp(marker.end)}`,
    'g',
  );

  if (!pattern.test(html)) {
    return undefined;
  }

  const lineEnding = html.includes('\r\n') ? '\r\n' : '\n';
  const normalizedContent = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const replacement = [
    marker.start,
    normalizedContent.replaceAll('\n', lineEnding),
    marker.end,
  ].join(lineEnding);

  return html.replace(pattern, replacement);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
