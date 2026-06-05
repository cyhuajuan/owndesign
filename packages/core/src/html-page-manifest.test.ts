import { describe, expect, it } from 'vitest';

import { getHtmlPageDisplayName, parseHtmlPageManifest } from './html-page-manifest';

describe('html-page-manifest', () => {
  it('parses valid page display names', () => {
    expect(
      parseHtmlPageManifest(
        JSON.stringify({
          pages: [
            { displayName: '小说阅读器首页', slug: 'index' },
            { displayName: '作品详情页', slug: 'detail' },
          ],
        }),
      ),
    ).toEqual({
      pages: [
        { displayName: '小说阅读器首页', slug: 'index' },
        { displayName: '作品详情页', slug: 'detail' },
      ],
    });
  });

  it('returns an empty manifest when content is missing or invalid', () => {
    expect(parseHtmlPageManifest(undefined)).toEqual({ pages: [] });
    expect(parseHtmlPageManifest('{')).toEqual({ pages: [] });
    expect(parseHtmlPageManifest(JSON.stringify({ pages: {} }))).toEqual({ pages: [] });
  });

  it('ignores invalid page entries', () => {
    expect(
      parseHtmlPageManifest(
        JSON.stringify({
          pages: [
            { displayName: '小说阅读器首页', slug: 'index' },
            { displayName: '', slug: 'empty-name' },
            { displayName: 'Missing slug' },
            null,
          ],
        }),
      ),
    ).toEqual({
      pages: [{ displayName: '小说阅读器首页', slug: 'index' }],
    });
  });

  it('returns display names with slug fallback', () => {
    const manifest = parseHtmlPageManifest(
      JSON.stringify({
        pages: [{ displayName: '小说阅读器首页', slug: 'index' }],
      }),
    );

    expect(getHtmlPageDisplayName(manifest, 'index')).toBe('小说阅读器首页');
    expect(getHtmlPageDisplayName(manifest, 'detail')).toBe('detail');
  });
});
