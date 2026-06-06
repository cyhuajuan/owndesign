import { describe, expect, it } from 'vitest';

import {
  getHtmlPageSlug,
  parseHtmlSharedComponentsManifest,
  renderNavigationSharedComponentContent,
  replaceHtmlSharedComponentMarkerContent,
} from './html-shared-components';

describe('html-shared-components', () => {
  it('parses missing or invalid manifests as empty', () => {
    expect(parseHtmlSharedComponentsManifest(undefined)).toEqual({ components: [] });
    expect(parseHtmlSharedComponentsManifest('not json')).toEqual({ components: [] });
    expect(parseHtmlSharedComponentsManifest('{"components":"bad"}')).toEqual({ components: [] });
  });

  it('defaults old manifests to exact sync mode', () => {
    expect(
      parseHtmlSharedComponentsManifest(
        JSON.stringify({
          components: [
            {
              name: 'footer',
              source: 'components/footer.html',
              usedBy: ['index.html'],
            },
          ],
        }),
      ),
    ).toEqual({
      components: [
        {
          name: 'footer',
          source: 'components/footer.html',
          syncMode: 'exact',
          usedBy: ['index.html'],
        },
      ],
    });
  });

  it('preserves shared component descriptions and sync modes', () => {
    expect(
      parseHtmlSharedComponentsManifest(
        JSON.stringify({
          components: [
            {
              description: '全站顶部导航',
              name: 'nav',
              source: 'components/nav.html',
              syncMode: 'navigation',
              usedBy: ['index-v1.html', 'index-v1.html'],
            },
          ],
        }),
      ),
    ).toEqual({
      components: [
        {
          description: '全站顶部导航',
          name: 'nav',
          source: 'components/nav.html',
          syncMode: 'navigation',
          usedBy: ['index-v1.html'],
        },
      ],
    });
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

  it('derives page slugs from versioned html paths', () => {
    expect(getHtmlPageSlug('index.html')).toBe('index');
    expect(getHtmlPageSlug('index-v2.html')).toBe('index');
    expect(getHtmlPageSlug('pages/products-v3.html')).toBe('products');
  });

  it('renders navigation active state from the target page slug', () => {
    const rendered = renderNavigationSharedComponentContent(
      [
        '<nav>',
        '<a class="nav-link active" aria-current="page" href="index-v1.html" data-owndesign-nav-item="index">Home</a>',
        '<a class="nav-link" href="products-v1.html" data-owndesign-nav-item="products">Products</a>',
        '</nav>',
      ].join('\n'),
      'products-v2.html',
    );

    expect(rendered).toContain(
      '<a class="nav-link" href="index-v1.html" data-owndesign-nav-item="index">Home</a>',
    );
    expect(rendered).toContain(
      '<a class="nav-link active" href="products-v1.html" data-owndesign-nav-item="products" aria-current="page">Products</a>',
    );
  });
});
