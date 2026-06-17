const MAX_LINE_LENGTH = 2000;

export function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string,
) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

export function countOccurrences(content: string, needle: string) {
  if (!needle) {
    return 0;
  }

  return content.split(needle).length - 1;
}

export function applyTextEdit(
  content: string,
  oldText: string,
  newText: string,
  replaceAll = false,
  relativePath: string,
) {
  if (!oldText) {
    throw new Error('oldText must not be empty.');
  }

  if (oldText === newText) {
    throw new Error('No changes to apply: oldText and newText are identical.');
  }

  const normalizedOldText = convertToLineEnding(oldText, detectLineEnding(content));
  const normalizedNewText = convertToLineEnding(newText, detectLineEnding(content));
  const firstIndex = content.indexOf(normalizedOldText);

  if (firstIndex === -1) {
    const deEscaped = deEscapeQuotes(normalizedOldText);

    if (deEscaped !== normalizedOldText && content.includes(deEscaped)) {
      throw new Error(
        `oldText was not found in Project Workspace file: ${relativePath}. It looks like oldText contains backslash-escaped quotes/backticks (\\" \\' \\\`) that are not in the file. Provide oldText as the literal file content without adding escape characters.`,
      );
    }

    throw new Error(`oldText was not found in Project Workspace file: ${relativePath}`);
  }

  const replacements = countOccurrences(content, normalizedOldText);

  if (!replaceAll && replacements > 1) {
    throw new Error(`oldText appears more than once in Project Workspace file: ${relativePath}`);
  }

  return {
    content: replaceAll
      ? content.split(normalizedOldText).join(normalizedNewText)
      : content.slice(0, firstIndex) +
        normalizedNewText +
        content.slice(firstIndex + normalizedOldText.length),
    replacements: replaceAll ? replacements : 1,
  };
}

function deEscapeQuotes(text: string) {
  return text.replaceAll('\\"', '"').replaceAll("\\'", "'").replaceAll('\\`', '`');
}

function detectLineEnding(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function convertToLineEnding(text: string, ending: '\n' | '\r\n') {
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');

  return ending === '\n' ? normalized : normalized.replaceAll('\n', '\r\n');
}

export function truncateLineMiddle(line: string) {
  if (line.length <= MAX_LINE_LENGTH) {
    return {
      line,
      truncated: false,
    };
  }

  const half = Math.floor((MAX_LINE_LENGTH - 19) / 2);

  return {
    line: `${line.slice(0, half)}...<truncated>...${line.slice(-half)}`,
    truncated: true,
  };
}
