import { describe, expect, it } from 'vitest';

import { getHtmlPageSlug, parseHtmlSharedComponentsManifest } from './html-shared-components';

describe('html-shared-components', () => {
  it('parses missing or invalid manifests as empty', () => {
    expect(parseHtmlSharedComponentsManifest(undefined)).toEqual({ components: [] });
    expect(parseHtmlSharedComponentsManifest('not json')).toEqual({ components: [] });
    expect(parseHtmlSharedComponentsManifest('{"components":"bad"}')).toEqual({ components: [] });
  });

  it('parses shared Web Component manifests', () => {
    expect(
      parseHtmlSharedComponentsManifest(
        JSON.stringify({
          components: [
            {
              description: 'Site navigation',
              name: 'navigation',
              source: 'components/od-navigation.js',
              tagName: 'od-navigation',
              usedBy: ['index.html', 'index.html'],
            },
          ],
        }),
      ),
    ).toEqual({
      components: [
        {
          description: 'Site navigation',
          name: 'navigation',
          source: 'components/od-navigation.js',
          tagName: 'od-navigation',
          usedBy: ['index.html'],
        },
      ],
    });
  });

  it('rejects component entries missing Web Component fields', () => {
    expect(
      parseHtmlSharedComponentsManifest(
        JSON.stringify({
          components: [
            {
              name: 'product-card',
              source: 'components/od-product-card.js',
              usedBy: ['index.html'],
            },
          ],
        }),
      ),
    ).toEqual({ components: [] });
  });

  it('derives page slugs from stable html paths', () => {
    expect(getHtmlPageSlug('index.html')).toBe('index');
    expect(getHtmlPageSlug('products.html')).toBe('products');
  });
});
