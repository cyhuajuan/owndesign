import path from 'node:path';

import { normalizeWorkspaceRelativePath } from '@owndesign/core/workspace-store/paths';

const PROTECTED_ROOT_DESIGN_DOCUMENT_PATH = 'design.md';

export function assertAgentWorkspaceMutationPathAllowed(relativePath: string) {
  const normalizedPath = normalizeAgentWorkspaceMutationPath(relativePath);

  if (normalizedPath.toLowerCase() === PROTECTED_ROOT_DESIGN_DOCUMENT_PATH) {
    throw new Error('Agent workspace mutation tools cannot modify root-level DESIGN.md.');
  }
}

function normalizeAgentWorkspaceMutationPath(relativePath: string) {
  const slashNormalizedPath = normalizeWorkspaceRelativePath(relativePath);
  const normalizedPath = path.posix.normalize(slashNormalizedPath);

  return normalizedPath === '.' ? '' : normalizedPath.replace(/^\.\//, '');
}
