export const OWNDESIGN_RUNTIME_ATTRIBUTE = 'data-owndesign-runtime="preview-route-bridge"';

export const OWNDESIGN_RUNTIME_SCRIPT_TAG = `<script ${OWNDESIGN_RUNTIME_ATTRIBUTE}>
(() => {
  const sendRoute = () => {
    window.parent?.postMessage(
      {
        source: 'owndesign-preview',
        type: 'route-changed',
        version: 1,
        hash: window.location.hash || '',
      },
      '*',
    );
  };

  const scheduleRouteUpdate = () => {
    window.requestAnimationFrame(sendRoute);
  };

  const patchHistory = (method) => {
    const original = window.history[method];

    window.history[method] = function patchedHistoryMethod(...args) {
      const result = original.apply(this, args);
      scheduleRouteUpdate();
      return result;
    };
  };

  patchHistory('pushState');
  patchHistory('replaceState');
  window.addEventListener('hashchange', scheduleRouteUpdate);
  window.addEventListener('popstate', scheduleRouteUpdate);
  window.addEventListener('pageshow', scheduleRouteUpdate);
  document.addEventListener('DOMContentLoaded', scheduleRouteUpdate);
  scheduleRouteUpdate();

  if (window.lucide) {
    lucide.createIcons();
  }
})();
</script>`;

const BODY_CLOSE_PATTERN = /<\/body\s*>/gi;
const BODY_OPEN_PATTERN = /<body(?:\s[^>]*)?>/i;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

export function assertOwnDesignRuntimeScript(content: string) {
  const normalizedContent = normalizeLineEndings(content);
  const normalizedRuntimeScript = normalizeLineEndings(OWNDESIGN_RUNTIME_SCRIPT_TAG);
  const runtimeScriptCount = countOccurrences(normalizedContent, normalizedRuntimeScript);

  if (runtimeScriptCount !== 1) {
    throw new Error(
      'Keep the OwnDesign runtime script unchanged and include it exactly once as the last element inside <body>.',
    );
  }

  const bodyOpen = BODY_OPEN_PATTERN.exec(normalizedContent);
  BODY_OPEN_PATTERN.lastIndex = 0;
  const bodyClose = getLastMatch(normalizedContent, BODY_CLOSE_PATTERN);

  if (!bodyOpen || !bodyClose) {
    throw new Error(
      'Keep the OwnDesign runtime script inside <body> as the last element.',
    );
  }

  const runtimeScriptIndex = normalizedContent.indexOf(normalizedRuntimeScript);
  const runtimeScriptEnd = runtimeScriptIndex + normalizedRuntimeScript.length;
  const bodyContentStart = bodyOpen.index + bodyOpen[0].length;

  if (runtimeScriptIndex < bodyContentStart || runtimeScriptEnd > bodyClose.index) {
    throw new Error(
      'Keep the OwnDesign runtime script inside <body> as the last element.',
    );
  }

  const trailingBodyContent = normalizedContent
    .slice(runtimeScriptEnd, bodyClose.index)
    .replace(HTML_COMMENT_PATTERN, '')
    .trim();

  if (trailingBodyContent) {
    throw new Error(
      'Keep the OwnDesign runtime script as the last element inside <body>.',
    );
  }
}

export function isProtectedSingleHtmlPath(relativePath: string) {
  return normalizeRelativePath(relativePath).toLowerCase() === 'index.html';
}

function normalizeLineEndings(value: string) {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function countOccurrences(content: string, needle: string) {
  return content.split(needle).length - 1;
}

function normalizeRelativePath(relativePath: string) {
  const segments: string[] = [];

  for (const segment of relativePath.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') {
        segments.pop();
      } else {
        segments.push(segment);
      }
      continue;
    }

    segments.push(segment);
  }

  return segments.join('/');
}

function getLastMatch(content: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  let lastMatch: RegExpExecArray | null = null;
  let currentMatch: RegExpExecArray | null;

  while ((currentMatch = pattern.exec(content))) {
    lastMatch = currentMatch;
  }

  pattern.lastIndex = 0;
  return lastMatch;
}
