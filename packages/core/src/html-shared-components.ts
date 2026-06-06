export type HtmlSharedComponent = {
  description?: string;
  name: string;
  source: string;
  syncMode: HtmlSharedComponentSyncMode;
  usedBy: string[];
};

export type HtmlSharedComponentSyncMode = 'exact' | 'navigation' | 'pattern';

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
      syncMode: parseHtmlSharedComponentSyncMode(component.syncMode),
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

export function renderNavigationSharedComponentContent(content: string, pagePath: string) {
  const pageSlug = getHtmlPageSlug(pagePath);

  return content.replace(/<([a-z][\w:-]*)(?=[^>]*\sdata-owndesign-nav-item\s*=)[^>]*>/gi, (tag) => {
    const itemSlug = getHtmlAttribute(tag, 'data-owndesign-nav-item');
    let updatedTag = removeHtmlAttribute(tag, 'aria-current');
    updatedTag = setClassTokens(
      updatedTag,
      getClassTokens(updatedTag).filter((className) => className !== 'active'),
    );

    if (itemSlug === pageSlug) {
      updatedTag = setClassTokens(updatedTag, [...getClassTokens(updatedTag), 'active']);
      updatedTag = setHtmlAttribute(updatedTag, 'aria-current', 'page');
    }

    return updatedTag;
  });
}

export function getHtmlPageSlug(pagePath: string) {
  const fileName = pagePath.replaceAll('\\', '/').split('/').pop() ?? pagePath;
  const withoutExtension = fileName.replace(/\.html$/i, '');

  return withoutExtension.replace(/-v[1-9]\d*$/i, '');
}

function parseHtmlSharedComponentSyncMode(value: unknown): HtmlSharedComponentSyncMode {
  if (value === 'navigation' || value === 'pattern') {
    return value;
  }

  return 'exact';
}

function getClassTokens(tag: string) {
  return (getHtmlAttribute(tag, 'class') ?? '').split(/\s+/).filter(Boolean);
}

function setClassTokens(tag: string, classNames: string[]) {
  const uniqueClassNames = Array.from(new Set(classNames));

  if (!uniqueClassNames.length) {
    return removeHtmlAttribute(tag, 'class');
  }

  return setHtmlAttribute(tag, 'class', uniqueClassNames.join(' '));
}

function getHtmlAttribute(tag: string, name: string) {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(pattern);

  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function removeHtmlAttribute(tag: string, name: string) {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');

  return tag.replace(pattern, '');
}

function setHtmlAttribute(tag: string, name: string, value: string) {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const attribute = ` ${name}="${escapeHtmlAttribute(value)}"`;

  if (pattern.test(tag)) {
    return tag.replace(pattern, attribute);
  }

  return tag.replace(/>$/, `${attribute}>`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
