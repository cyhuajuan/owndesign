import path from 'node:path';

import type { WorkspaceStore } from '@owndesign/core/workspace-store';

export async function readProjectWorkspaceFileIfExists(
  workspaceStore: WorkspaceStore,
  projectId: string,
  relativePath: string,
) {
  try {
    return await workspaceStore.readProjectWorkspaceFile(projectId, relativePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }

    throw error;
  }
}

export function isHtmlPath(relativePath: string) {
  return normalizeToolPath(relativePath).toLowerCase().endsWith('.html');
}

export function normalizeToolPath(relativePath: string) {
  return path.posix.normalize(relativePath.replaceAll('\\', '/'));
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
