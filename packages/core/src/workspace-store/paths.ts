import path from 'node:path';

export function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export function normalizeWorkspaceRelativePath(relativePath: string) {
  return relativePath.split(path.sep).join('/');
}
