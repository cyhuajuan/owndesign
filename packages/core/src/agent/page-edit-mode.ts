import { isHtmlPath, normalizeToolPath } from './tools/cdn-guard';
import { resolveNextHtmlVersionPath } from '@owndesign/core/html-versioning';
import type { WorkspaceStore } from '@owndesign/core/workspace-store';

export const PAGE_EDIT_MODES = ['auto', 'new_page', 'direct_edit', 'duplicate_edit'] as const;

export type PageEditMode = (typeof PAGE_EDIT_MODES)[number];

export type PageEditModePolicy =
  | { mode: 'auto' }
  | {
      createdHtmlPath?: string;
      currentPreviewPath?: string;
      mode: 'new_page';
    }
  | {
      mode: 'direct_edit';
      targetPath: string;
    }
  | {
      mode: 'duplicate_edit';
      sourcePath: string;
      targetPath: string;
    };

export type HtmlPathOperation = 'copy' | 'create' | 'delete' | 'mutate' | 'preview' | 'read';

export function parsePageEditMode(value: unknown): PageEditMode | undefined {
  if (value === undefined || value === null || value === '') {
    return 'auto';
  }

  return PAGE_EDIT_MODES.includes(value as PageEditMode) ? (value as PageEditMode) : undefined;
}

export async function buildPageEditModePolicy({
  currentPreviewPath,
  mode = 'auto',
  projectId,
  workspaceStore,
}: {
  currentPreviewPath?: string;
  mode?: PageEditMode;
  projectId: string;
  workspaceStore: WorkspaceStore;
}): Promise<PageEditModePolicy> {
  if (mode === 'auto') {
    return { mode };
  }

  if (mode === 'new_page') {
    return {
      currentPreviewPath: currentPreviewPath
        ? normalizeRequiredHtmlPath(currentPreviewPath, mode)
        : undefined,
      mode,
    };
  }

  const sourcePath = normalizeRequiredHtmlPath(currentPreviewPath, mode);
  await readRequiredHtmlFile(workspaceStore, projectId, sourcePath, mode);

  if (mode === 'direct_edit') {
    return {
      mode,
      targetPath: sourcePath,
    };
  }

  const targetPath = await resolveUniqueCopyPath(workspaceStore, projectId, sourcePath);

  return {
    mode,
    sourcePath,
    targetPath,
  };
}

export function assertCreateHtmlAllowed(
  policy: PageEditModePolicy | undefined,
  relativePath: string,
) {
  assertHtmlPathOperationAllowed(policy, 'create', relativePath);
}

export function markCreatedHtmlPath(policy: PageEditModePolicy | undefined, relativePath: string) {
  if (policy?.mode === 'new_page') {
    policy.createdHtmlPath = normalizeToolPath(relativePath);
  }
}

export function assertCopyFileAllowed(
  policy: PageEditModePolicy | undefined,
  sourcePath: string,
  targetPath: string,
) {
  if (!policy || policy.mode !== 'duplicate_edit') {
    return;
  }

  const normalizedSourcePath = normalizeToolPath(sourcePath);
  const normalizedTargetPath = normalizeToolPath(targetPath);

  if (normalizedSourcePath !== policy.sourcePath || normalizedTargetPath !== policy.targetPath) {
    throw new Error(
      `Page edit mode "duplicate_edit" can only copy ${policy.sourcePath} to ${policy.targetPath}; attempted ${normalizedSourcePath} to ${normalizedTargetPath}.`,
    );
  }
}

export function assertHtmlMutationAllowed(
  policy: PageEditModePolicy | undefined,
  relativePath: string,
) {
  assertHtmlPathOperationAllowed(policy, 'mutate', relativePath);
}

export function resolveHtmlOperationPathForPageEditModePolicy(
  policy: PageEditModePolicy | undefined,
  operation: HtmlPathOperation,
  relativePath: string,
) {
  if (!policy || policy.mode === 'auto') {
    return relativePath;
  }

  const targetPath = normalizeToolPath(relativePath);

  if (!isHtmlPath(targetPath)) {
    return relativePath;
  }

  assertHtmlPathOperationAllowed(policy, operation, targetPath);

  return targetPath;
}

export function assertHtmlPathOperationAllowed(
  policy: PageEditModePolicy | undefined,
  operation: HtmlPathOperation,
  relativePath: string,
) {
  if (!policy || policy.mode !== 'duplicate_edit') {
    return;
  }

  const targetPath = normalizeToolPath(relativePath);

  if (!isHtmlPath(targetPath)) {
    return;
  }

  if (operation === 'read') {
    return;
  }

  if (operation === 'copy' && targetPath === policy.targetPath) {
    return;
  }

  if (targetPath !== policy.targetPath) {
    throw new Error(
      `Page edit mode "duplicate_edit" can only ${formatHtmlOperation(operation)} ${policy.targetPath}; attempted ${targetPath}.`,
    );
  }
}

export function getAllowedHtmlPath(policy: PageEditModePolicy | undefined) {
  if (!policy || policy.mode === 'auto') {
    return undefined;
  }

  if (policy.mode === 'new_page') {
    return policy.createdHtmlPath;
  }

  return policy.targetPath;
}

function formatHtmlOperation(operation: HtmlPathOperation) {
  switch (operation) {
    case 'copy':
      return 'copy';
    case 'create':
      return 'create';
    case 'delete':
      return 'delete';
    case 'mutate':
      return 'edit';
    case 'preview':
      return 'preview';
    case 'read':
      return 'read';
  }
}

function normalizeRequiredHtmlPath(relativePath: string | undefined, mode: PageEditMode) {
  if (!relativePath) {
    throw new Error(`Page edit mode "${mode}" requires a current preview page.`);
  }

  const normalizedPath = normalizeToolPath(relativePath);

  if (!isHtmlPath(normalizedPath)) {
    throw new Error(`Page edit mode "${mode}" requires an HTML preview page: ${normalizedPath}`);
  }

  return normalizedPath;
}

async function readRequiredHtmlFile(
  workspaceStore: WorkspaceStore,
  projectId: string,
  relativePath: string,
  mode: PageEditMode,
) {
  try {
    return await workspaceStore.readProjectWorkspaceFile(projectId, relativePath);
  } catch {
    throw new Error(
      `Page edit mode "${mode}" requires an existing current preview page: ${relativePath}`,
    );
  }
}

async function resolveUniqueCopyPath(
  workspaceStore: WorkspaceStore,
  projectId: string,
  sourcePath: string,
) {
  const htmlFiles = await workspaceStore.listProjectHtmlFiles(projectId);
  const candidatePath = resolveNextHtmlVersionPath(htmlFiles, sourcePath);

  try {
    await workspaceStore.readProjectWorkspaceFile(projectId, candidatePath);
  } catch {
    return candidatePath;
  }

  throw new Error(`Could not create a unique version path for ${sourcePath}.`);
}
