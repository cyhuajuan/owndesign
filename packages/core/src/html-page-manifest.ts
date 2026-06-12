export type HtmlPageManifestPage = {
  componentSource: string;
  componentTag: string;
  displayName: string;
  htmlPath: string;
  slug: string;
};

export type HtmlPageManifest = {
  pages: HtmlPageManifestPage[];
};

export const HTML_PAGE_MANIFEST_PATH = '.owndesign-pages.json';

const EMPTY_HTML_PAGE_MANIFEST: HtmlPageManifest = {
  pages: [],
};

export function parseHtmlPageManifest(content: string | undefined): HtmlPageManifest {
  if (!content) {
    return EMPTY_HTML_PAGE_MANIFEST;
  }

  let value: unknown;

  try {
    value = JSON.parse(content);
  } catch {
    return EMPTY_HTML_PAGE_MANIFEST;
  }

  if (!isRecord(value) || !Array.isArray(value.pages)) {
    return EMPTY_HTML_PAGE_MANIFEST;
  }

  const pages = value.pages
    .filter(isRecord)
    .map((page) => ({
      componentSource: typeof page.componentSource === 'string' ? page.componentSource.trim() : '',
      componentTag: typeof page.componentTag === 'string' ? page.componentTag.trim() : '',
      displayName: typeof page.displayName === 'string' ? page.displayName.trim() : '',
      htmlPath: typeof page.htmlPath === 'string' ? page.htmlPath.trim() : '',
      slug: typeof page.slug === 'string' ? page.slug.trim() : '',
    }))
    .filter(
      (page) =>
        page.slug && page.displayName && page.htmlPath && page.componentTag && page.componentSource,
    );

  return { pages };
}

export function getHtmlPageDisplayName(manifest: HtmlPageManifest | undefined, slug: string) {
  return manifest?.pages.find((page) => page.slug === slug)?.displayName ?? slug;
}

export function serializeHtmlPageManifest(manifest: HtmlPageManifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
