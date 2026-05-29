import path from "node:path";

import { isHtmlPath, normalizeToolPath } from "./tools/cdn-guard";
import type { WorkspaceStore } from "@owndesign/core/workspace-store";

export const PAGE_EDIT_MODES = [
  "auto",
  "new_page",
  "direct_edit",
  "duplicate_edit",
] as const;

export type PageEditMode = (typeof PAGE_EDIT_MODES)[number];

export type PageEditModePolicy =
  | { mode: "auto" }
  | {
      createdHtmlPath?: string;
      currentPreviewPath?: string;
      mode: "new_page";
    }
  | {
      mode: "direct_edit";
      targetPath: string;
    }
  | {
      mode: "duplicate_edit";
      sourcePath: string;
      targetPath: string;
    };

export function parsePageEditMode(value: unknown): PageEditMode | undefined {
  if (value === undefined || value === null || value === "") {
    return "auto";
  }

  return PAGE_EDIT_MODES.includes(value as PageEditMode)
    ? (value as PageEditMode)
    : undefined;
}

export async function buildPageEditModePolicy({
  currentPreviewPath,
  mode = "auto",
  projectId,
  workspaceStore,
}: {
  currentPreviewPath?: string;
  mode?: PageEditMode;
  projectId: string;
  workspaceStore: WorkspaceStore;
}): Promise<PageEditModePolicy> {
  if (mode === "auto") {
    return { mode };
  }

  if (mode === "new_page") {
    return {
      currentPreviewPath: currentPreviewPath
        ? normalizeRequiredHtmlPath(currentPreviewPath, mode)
        : undefined,
      mode,
    };
  }

  const sourcePath = normalizeRequiredHtmlPath(currentPreviewPath, mode);
  const sourceContent = await readRequiredHtmlFile(
    workspaceStore,
    projectId,
    sourcePath,
    mode,
  );

  if (mode === "direct_edit") {
    return {
      mode,
      targetPath: sourcePath,
    };
  }

  const targetPath = await createDuplicateHtmlFile({
    content: sourceContent,
    projectId,
    sourcePath,
    workspaceStore,
  });

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
  if (!policy || policy.mode === "auto") {
    return;
  }

  const targetPath = normalizeToolPath(relativePath);

  if (policy.mode === "new_page") {
    if (policy.currentPreviewPath && targetPath === policy.currentPreviewPath) {
      throw new Error(
        `Page edit mode "new_page" must create a new HTML page, not overwrite the current preview page: ${targetPath}`,
      );
    }

    if (policy.createdHtmlPath && targetPath !== policy.createdHtmlPath) {
      throw new Error(
        `Page edit mode "new_page" already created ${policy.createdHtmlPath}; continue editing that page.`,
      );
    }

    return;
  }

  throw new Error(
    `Page edit mode "${policy.mode}" does not allow creating new HTML pages.`,
  );
}

export function markCreatedHtmlPath(
  policy: PageEditModePolicy | undefined,
  relativePath: string,
) {
  if (policy?.mode === "new_page") {
    policy.createdHtmlPath = normalizeToolPath(relativePath);
  }
}

export function assertHtmlMutationAllowed(
  policy: PageEditModePolicy | undefined,
  relativePath: string,
) {
  if (!policy || policy.mode === "auto" || !isHtmlPath(relativePath)) {
    return;
  }

  const targetPath = normalizeToolPath(relativePath);

  if (policy.mode === "new_page") {
    if (policy.currentPreviewPath && targetPath === policy.currentPreviewPath) {
      throw new Error(
        `Page edit mode "new_page" cannot edit the current preview page: ${targetPath}`,
      );
    }

    if (!policy.createdHtmlPath) {
      throw new Error(
        'Page edit mode "new_page" must call createHtml before editing an HTML page.',
      );
    }

    if (targetPath !== policy.createdHtmlPath) {
      throw new Error(
        `Page edit mode "new_page" can only edit the newly created page: ${policy.createdHtmlPath}`,
      );
    }

    return;
  }

  if (targetPath !== policy.targetPath) {
    throw new Error(
      `Page edit mode "${policy.mode}" can only edit ${policy.targetPath}; attempted ${targetPath}.`,
    );
  }
}

export function buildPageEditModePolicyPrompt(
  policy: PageEditModePolicy,
) {
  if (policy.mode === "auto") {
    return [
      "## Page Edit Mode Policy",
      "Mode: auto.",
      "Use the runtime page target protocol normally.",
    ].join("\n");
  }

  if (policy.mode === "new_page") {
    return [
      "## Page Edit Mode Policy",
      "Mode: new_page.",
      "The user's mode selection overrides conflicting prompt wording.",
      "You must create a new HTML page with `createHtml`, even if the user asks to modify the current page.",
      policy.currentPreviewPath
        ? `Current preview page ${policy.currentPreviewPath} must not be edited as the target.`
        : "No current preview page is required for this mode.",
      "After creating the new page, continue editing only that new page and switch the preview to it.",
    ].join("\n");
  }

  if (policy.mode === "direct_edit") {
    return [
      "## Page Edit Mode Policy",
      "Mode: direct_edit.",
      "The user's mode selection overrides conflicting prompt wording.",
      `You must edit the current preview page directly: ${policy.targetPath}.`,
      "Do not create a new HTML page, even if the user asks for one.",
      "After the changes, refresh the preview unless another frontend action is strictly required.",
    ].join("\n");
  }

  return [
    "## Page Edit Mode Policy",
    "Mode: duplicate_edit.",
    "The user's mode selection overrides conflicting prompt wording.",
    `The current preview page has already been copied from ${policy.sourcePath} to ${policy.targetPath}.`,
    `You must edit only the copied page: ${policy.targetPath}.`,
    "Do not edit the original source page.",
    "After the changes, switch the preview to the copied page.",
  ].join("\n");
}

function normalizeRequiredHtmlPath(
  relativePath: string | undefined,
  mode: PageEditMode,
) {
  if (!relativePath) {
    throw new Error(`Page edit mode "${mode}" requires a current preview page.`);
  }

  const normalizedPath = normalizeToolPath(relativePath);

  if (!isHtmlPath(normalizedPath)) {
    throw new Error(
      `Page edit mode "${mode}" requires an HTML preview page: ${normalizedPath}`,
    );
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

async function createDuplicateHtmlFile({
  content,
  projectId,
  sourcePath,
  workspaceStore,
}: {
  content: string;
  projectId: string;
  sourcePath: string;
  workspaceStore: WorkspaceStore;
}) {
  const targetPath = await resolveUniqueCopyPath(
    workspaceStore,
    projectId,
    sourcePath,
  );

  await workspaceStore.writeProjectWorkspaceFile(projectId, targetPath, content);

  return targetPath;
}

async function resolveUniqueCopyPath(
  workspaceStore: WorkspaceStore,
  projectId: string,
  sourcePath: string,
) {
  const parsed = path.posix.parse(sourcePath);
  const directory = parsed.dir ? `${parsed.dir}/` : "";
  const baseName = parsed.name;
  const extension = parsed.ext || ".html";

  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? "copy" : `copy-${index}`;
    const candidatePath = `${directory}${baseName}.${suffix}${extension}`;

    try {
      await workspaceStore.readProjectWorkspaceFile(projectId, candidatePath);
    } catch {
      return candidatePath;
    }
  }

  throw new Error(`Could not create a unique copy path for ${sourcePath}.`);
}
