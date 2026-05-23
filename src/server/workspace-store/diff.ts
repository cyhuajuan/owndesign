import { truncateLineMiddle } from "./text";

const MAX_DIFF_LINES = 80;

export function buildUnifiedDiff(
  oldContent: string,
  newContent: string,
  relativePath: string,
) {
  if (oldContent === newContent) {
    return "";
  }

  const oldLines = oldContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);
  const lines = [`--- ${relativePath}`, `+++ ${relativePath}`];
  const maxLines = Math.max(oldLines.length, newLines.length);
  let emitted = 0;
  let omitted = 0;

  for (let index = 0; index < maxLines; index += 1) {
    const oldLine = oldLines[index];
    const newLine = newLines[index];

    if (oldLine === newLine) {
      continue;
    }

    if (emitted >= MAX_DIFF_LINES) {
      omitted += 1;
      continue;
    }

    lines.push(`@@ line ${index + 1}`);

    if (oldLine !== undefined) {
      lines.push(`-${truncateLineMiddle(oldLine).line}`);
    }

    if (newLine !== undefined) {
      lines.push(`+${truncateLineMiddle(newLine).line}`);
    }

    emitted += 1;
  }

  if (omitted > 0) {
    lines.push(`... ${omitted} changed line(s) omitted ...`);
  }

  return lines.join("\n");
}
