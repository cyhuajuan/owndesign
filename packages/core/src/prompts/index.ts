import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPT_FILES = {
  'agents/component-audit': 'agents/component-audit.md',
  'agents/design-page': 'agents/design-page.md',
  'agents/turn-prompt-rewriter': 'agents/turn-prompt-rewriter.md',
} as const;

export type PromptName = keyof typeof PROMPT_FILES;

export function loadPrompt(name: PromptName) {
  const promptFile = PROMPT_FILES[name];

  if (!promptFile) {
    throw new Error(`Unsupported prompt: ${String(name)}`);
  }

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.join(currentDir, 'prompts', promptFile),
    path.join(currentDir, promptFile),
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

  throw new Error(`Prompt "${name}" was not found. Searched: ${candidatePaths.join(', ')}`);
}

function isNotFoundError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
