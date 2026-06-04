export function globToRegExp(glob: string) {
  const normalized = glob.replaceAll('\\', '/');
  let source = '^';

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '*') {
      if (next === '*') {
        const afterGlobstar = normalized[index + 2];
        index += 1;

        if (afterGlobstar === '/') {
          source += '(?:.*\\/)?';
          index += 1;
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }

      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    if (char === '{') {
      const closeIndex = normalized.indexOf('}', index + 1);

      if (closeIndex !== -1) {
        const alternatives = normalized
          .slice(index + 1, closeIndex)
          .split(',')
          .map(escapeRegExp)
          .join('|');
        source += `(?:${alternatives})`;
        index = closeIndex;
        continue;
      }
    }

    source += escapeRegExp(char);
  }

  source += '$';

  return new RegExp(source);
}

function escapeRegExp(value: string) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}
