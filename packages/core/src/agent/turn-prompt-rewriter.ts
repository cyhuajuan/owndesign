import { generateText, type LanguageModel, type ToolLoopAgentSettings } from 'ai';

import type { PageEditMode, PageEditModePolicy } from '@owndesign/core/agent/page-edit-mode';
import { loadPrompt } from '@owndesign/core/prompts';

export type TurnPromptRewriteInput = {
  model: LanguageModel;
  originalUserPrompt: string;
  pageEditMode: PageEditMode;
  pageEditModePolicy: PageEditModePolicy;
  previewPath?: string;
  providerOptions?: ToolLoopAgentSettings['providerOptions'];
};

export type TurnPromptRewriteResult = {
  rewrittenPrompt: string;
};

export async function rewriteTurnPrompt({
  model,
  originalUserPrompt,
  pageEditMode,
  pageEditModePolicy,
  previewPath,
  providerOptions,
}: TurnPromptRewriteInput): Promise<TurnPromptRewriteResult> {
  const result = await generateText({
    model,
    providerOptions,
    system: buildTurnPromptRewriterSystemPrompt(),
    prompt: buildTurnPromptRewriterPrompt({
      originalUserPrompt,
      pageEditMode,
      pageEditModePolicy,
      previewPath,
    }),
  });
  const rewrittenPrompt = cleanRewrittenPrompt(result.text);

  if (!rewrittenPrompt) {
    throw new Error('TurnPromptRewriter returned an empty prompt.');
  }

  return { rewrittenPrompt };
}

export function buildTurnPromptRewriterSystemPrompt() {
  return loadPrompt('agents/turn-prompt-rewriter');
}

export function buildTurnPromptRewriterPrompt({
  originalUserPrompt,
  pageEditMode,
  pageEditModePolicy,
  previewPath,
}: Omit<TurnPromptRewriteInput, 'model' | 'providerOptions'>) {
  return [
    `currentPreviewFile: ${previewPath ?? 'none'}`,
    `pageEditMode: ${pageEditMode}`,
    formatPolicyLine(pageEditModePolicy),
    '',
    'Rewrite rules:',
    "- Keep the user's requested change unchanged in meaning.",
    '- Make the target page/action explicit when the edit mode provides one.',
    '- For duplicate_edit, tell the agent to use copyFile to copy the source page to the target page, then modify only the target HTML page.',
    '- For duplicate_edit, allow inspection of other files but forbid modifying any HTML page except the target page.',
    '- For new_page, tell the agent to create a new page, but do not forbid related edits such as navigation links, shared component reuse, or inserting shared component markers.',
    '- For direct_edit, tell the agent to edit the current preview page directly.',
    '',
    'Original user request:',
    originalUserPrompt,
  ].join('\n');
}

function formatPolicyLine(policy: PageEditModePolicy) {
  if (policy.mode === 'duplicate_edit') {
    return `duplicateSourcePath: ${policy.sourcePath}\nduplicateTargetPath: ${policy.targetPath}`;
  }

  if (policy.mode === 'direct_edit') {
    return `targetPath: ${policy.targetPath}`;
  }

  if (policy.mode === 'new_page') {
    return `currentPreviewFile: ${policy.currentPreviewPath ?? 'none'}`;
  }

  return 'targetPath: none';
}

function cleanRewrittenPrompt(text: string) {
  return text
    .trim()
    .replace(/^```(?:text)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}
