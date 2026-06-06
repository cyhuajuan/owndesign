import { describe, expect, it } from 'vitest';

import {
  parseHtmlSharedComponentsManifest,
  replaceHtmlSharedComponentMarkerContent,
} from './html-shared-components';

describe('html-shared-components', () => {
  it('parses missing or invalid manifests as empty', () => {
    expect(parseHtmlSharedComponentsManifest(undefined)).toEqual({ components: [] });
    expect(parseHtmlSharedComponentsManifest('not json')).toEqual({ components: [] });
    expect(parseHtmlSharedComponentsManifest('{"components":"bad"}')).toEqual({ components: [] });
  });

  it('replaces component marker contents while preserving markers', () => {
    expect(
      replaceHtmlSharedComponentMarkerContent(
        [
          '<body>',
          '<!-- owndesign:component nav start -->',
          '<nav>Old</nav>',
          '<!-- owndesign:component nav end -->',
          '</body>',
        ].join('\n'),
        'nav',
        '<nav>New</nav>',
      ),
    ).toBe(
      [
        '<body>',
        '<!-- owndesign:component nav start -->',
        '<nav>New</nav>',
        '<!-- owndesign:component nav end -->',
        '</body>',
      ].join('\n'),
    );
  });

  it('returns undefined when marker is missing', () => {
    expect(
      replaceHtmlSharedComponentMarkerContent('<nav>Old</nav>', 'nav', '<nav>New</nav>'),
    ).toBeUndefined();
  });
});
