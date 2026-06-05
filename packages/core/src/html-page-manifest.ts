export type HtmlPageManifestPage = {
  displayName: string;
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
      displayName: typeof page.displayName === 'string' ? page.displayName.trim() : '',
      slug: typeof page.slug === 'string' ? page.slug.trim() : '',
    }))
    .filter((page) => page.slug && page.displayName);

  return { pages };
}

export function getHtmlPageDisplayName(manifest: HtmlPageManifest | undefined, slug: string) {
  return manifest?.pages.find((page) => page.slug === slug)?.displayName ?? slug;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
