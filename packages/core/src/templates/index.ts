import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_FILES = {
  'html/page-shell': 'html/page-shell.html',
} as const;

export type TemplateName = keyof typeof TEMPLATE_FILES;

export function loadTemplate(name: TemplateName) {
  const templateFile = TEMPLATE_FILES[name];

  if (!templateFile) {
    throw new Error(`Unsupported template: ${String(name)}`);
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.join(currentDir, 'templates', templateFile),
    path.join(currentDir, templateFile),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      return readFileSync(candidatePath, 'utf8').trim();
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  throw new Error(`Template "${name}" was not found. Searched: ${candidatePaths.join(', ')}`);
}

function isNotFoundError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
