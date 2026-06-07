import { describe, expect, it } from 'vitest';

import { getHtmlPageDisplayName, parseHtmlPageManifest } from './html-page-manifest';

describe('html-page-manifest', () => {
  it('parses valid page display names', () => {
    expect(
      parseHtmlPageManifest(
        JSON.stringify({
          pages: [
            {
              componentSource: 'pages/od-index-page.js',
              componentTag: 'od-index-page',
              displayName: '小说阅读器首页',
              htmlPath: 'index.html',
              slug: 'index',
            },
            {
              componentSource: 'pages/od-detail-page.js',
              componentTag: 'od-detail-page',
              displayName: '作品详情页',
              htmlPath: 'detail.html',
              slug: 'detail',
            },
          ],
        }),
      ),
    ).toEqual({
      pages: [
        {
          componentSource: 'pages/od-index-page.js',
          componentTag: 'od-index-page',
          displayName: '小说阅读器首页',
          htmlPath: 'index.html',
          slug: 'index',
        },
        {
          componentSource: 'pages/od-detail-page.js',
          componentTag: 'od-detail-page',
          displayName: '作品详情页',
          htmlPath: 'detail.html',
          slug: 'detail',
        },
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
            {
              componentSource: 'pages/od-index-page.js',
              componentTag: 'od-index-page',
              displayName: '小说阅读器首页',
              htmlPath: 'index.html',
              slug: 'index',
            },
            { displayName: '', slug: 'empty-name' },
            { displayName: 'Missing slug' },
            null,
          ],
        }),
      ),
    ).toEqual({
      pages: [
        {
          componentSource: 'pages/od-index-page.js',
          componentTag: 'od-index-page',
          displayName: '小说阅读器首页',
          htmlPath: 'index.html',
          slug: 'index',
        },
      ],
    });
  });

  it('returns display names with slug fallback', () => {
    const manifest = parseHtmlPageManifest(
      JSON.stringify({
        pages: [
          {
            componentSource: 'pages/od-index-page.js',
            componentTag: 'od-index-page',
            displayName: '小说阅读器首页',
            htmlPath: 'index.html',
            slug: 'index',
          },
        ],
      }),
    );

    expect(getHtmlPageDisplayName(manifest, 'index')).toBe('小说阅读器首页');
    expect(getHtmlPageDisplayName(manifest, 'detail')).toBe('detail');
  });
});
