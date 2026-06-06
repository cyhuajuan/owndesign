import type { LanguageModel, ToolLoopAgentSettings } from 'ai';

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
  originalUserPrompt,
  pageEditMode,
  pageEditModePolicy,
  previewPath,
}: TurnPromptRewriteInput): Promise<TurnPromptRewriteResult> {
  const rewrittenPrompt = buildTurnPromptRewriterPrompt({
    originalUserPrompt,
    pageEditMode,
    pageEditModePolicy,
    previewPath,
  });

  if (!rewrittenPrompt) {
    throw new Error('TurnPromptRewriter returned an empty prompt.');
  }

  return { rewrittenPrompt };
}

export function buildTurnPromptRewriterPrompt({
  originalUserPrompt,
  pageEditMode,
  pageEditModePolicy,
  previewPath,
}: Omit<TurnPromptRewriteInput, 'model' | 'providerOptions'>) {
  if (pageEditMode === 'auto' || pageEditModePolicy.mode === 'auto') {
    return originalUserPrompt;
  }

  if (pageEditModePolicy.mode === 'duplicate_edit') {
    return renderTurnPromptTemplate('turn-templates/duplicate-edit', {
      currentPreviewPath: previewPath,
      originalUserPrompt,
      sourcePath: pageEditModePolicy.sourcePath,
      targetPath: pageEditModePolicy.targetPath,
    });
  }

  if (pageEditModePolicy.mode === 'direct_edit') {
    return renderTurnPromptTemplate('turn-templates/direct-edit', {
      currentPreviewPath: previewPath,
      originalUserPrompt,
      targetPath: pageEditModePolicy.targetPath,
    });
  }

  return renderTurnPromptTemplate('turn-templates/new-page', {
    currentPreviewPath: pageEditModePolicy.currentPreviewPath ?? previewPath,
    originalUserPrompt,
  });
}

function renderTurnPromptTemplate(
  name: 'turn-templates/direct-edit' | 'turn-templates/duplicate-edit' | 'turn-templates/new-page',
  values: Record<string, string | undefined>,
) {
  return loadPrompt(name).replace(/\{\{([a-zA-Z0-9]+)\}\}/g, (_match, key: string) => {
    return values[key]?.trim() || 'none';
  });
}
