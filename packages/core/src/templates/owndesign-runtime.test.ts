import { describe, expect, it } from 'vitest';

import {
  OWNDESIGN_RUNTIME_ATTRIBUTE,
  OWNDESIGN_RUNTIME_SCRIPT_TAG,
  assertOwnDesignRuntimeScript,
} from './owndesign-runtime';
import { buildSingleHtmlTemplate } from './single-html';

describe('OwnDesign runtime script', () => {
  it('renders the protected runtime script as the last body element', () => {
    const html = buildSingleHtmlTemplate({ title: 'Dashboard' });

    expect(html).toContain(OWNDESIGN_RUNTIME_ATTRIBUTE);
    expect(html).toContain('source: \'owndesign-preview\'');
    expect(html).toContain('type: \'route-changed\'');
    expect(html).toContain('lucide.createIcons();');
    expect(countOccurrences(html, OWNDESIGN_RUNTIME_SCRIPT_TAG)).toBe(1);
    expect(() => assertOwnDesignRuntimeScript(html)).not.toThrow();
  });

  it('rejects missing, changed, duplicated, or non-final runtime scripts', () => {
    const html = buildSingleHtmlTemplate({ title: 'Dashboard' });

    expect(() => assertOwnDesignRuntimeScript(html.replace(OWNDESIGN_RUNTIME_SCRIPT_TAG, ''))).toThrow(
      'OwnDesign runtime script',
    );
    expect(() =>
      assertOwnDesignRuntimeScript(html.replace('route-changed', 'route-updated')),
    ).toThrow('OwnDesign runtime script');
    expect(() =>
      assertOwnDesignRuntimeScript(html.replace('</body>', `${OWNDESIGN_RUNTIME_SCRIPT_TAG}\n</body>`)),
    ).toThrow('OwnDesign runtime script');
    expect(() =>
      assertOwnDesignRuntimeScript(html.replace('</body>', '<div>After</div>\n</body>')),
    ).toThrow('last element');
  });

  it('allows only whitespace or comments after the runtime script before body closes', () => {
    const html = buildSingleHtmlTemplate({ title: 'Dashboard' }).replace(
      '</body>',
      '<!-- generated marker -->\n</body>',
    );

    expect(() => assertOwnDesignRuntimeScript(html)).not.toThrow();
  });
});

function countOccurrences(content: string, needle: string) {
  return content.split(needle).length - 1;
}
