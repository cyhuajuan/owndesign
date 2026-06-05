import { describe, expect, it } from 'vitest';

import {
  groupHtmlVersionFiles,
  parseHtmlVersionPath,
  resolveNextHtmlVersionPath,
} from './html-versioning';

describe('html-versioning', () => {
  it('parses flat html version paths', () => {
    expect(parseHtmlVersionPath('index-v1.html')).toEqual({
      path: 'index-v1.html',
      slug: 'index',
      version: 1,
    });
    expect(parseHtmlVersionPath('detail-v10.html')).toEqual({
      path: 'detail-v10.html',
      slug: 'detail',
      version: 10,
    });
  });

  it('ignores non-version and nested html files', () => {
    expect(parseHtmlVersionPath('pages/detail-v1.html')).toBeUndefined();
    expect(parseHtmlVersionPath('index.html')).toBeUndefined();
    expect(parseHtmlVersionPath('index-copy.html')).toBeUndefined();
    expect(parseHtmlVersionPath('index-v0.html')).toBeUndefined();
  });

  it('groups version files by slug and keeps other files', () => {
    expect(
      groupHtmlVersionFiles([
        'index-v1.html',
        'index-v2.html',
        'detail-v10.html',
        'index.html',
        'pages/detail-v1.html',
      ]),
    ).toEqual({
      groups: [
        {
          latestPath: 'detail-v10.html',
          latestVersion: 10,
          slug: 'detail',
          versions: [{ path: 'detail-v10.html', slug: 'detail', version: 10 }],
        },
        {
          latestPath: 'index-v2.html',
          latestVersion: 2,
          slug: 'index',
          versions: [
            { path: 'index-v2.html', slug: 'index', version: 2 },
            { path: 'index-v1.html', slug: 'index', version: 1 },
          ],
        },
      ],
      otherFiles: ['index.html', 'pages/detail-v1.html'],
    });
  });

  it('resolves the next version from the latest existing version', () => {
    expect(resolveNextHtmlVersionPath(['index-v1.html', 'index-v2.html'], 'index-v2.html')).toBe(
      'index-v3.html',
    );
    expect(resolveNextHtmlVersionPath(['index-v1.html', 'index-v3.html'], 'index-v1.html')).toBe(
      'index-v4.html',
    );
    expect(resolveNextHtmlVersionPath([], 'index.html')).toBe('index-v1.html');
  });
});
