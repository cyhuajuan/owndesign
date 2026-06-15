import { createWorkspaceToolRegistry } from './core';
import { createCopyFileToolDefinition } from './copy-file';
import { createCreateHtmlToolDefinition } from './create-html';
import { createDeleteToolDefinition } from './delete';
import { createEditToolDefinition } from './edit';
import { createGlobToolDefinition } from './glob';
import { createGrepToolDefinition } from './grep';
import { createPreviewRefreshToolDefinition } from './preview-refresh';
import { createReadToolDefinition } from './read';
import type { ProjectWorkspaceToolContext } from './types';
import { createWriteToolDefinition } from './write';

export function createProjectWorkspaceToolDefinitions() {
  return [
    createCopyFileToolDefinition(),
    createCreateHtmlToolDefinition(),
    createDeleteToolDefinition(),
    createEditToolDefinition(),
    createGlobToolDefinition(),
    createGrepToolDefinition(),
    createPreviewRefreshToolDefinition(),
    createReadToolDefinition(),
    createWriteToolDefinition(),
  ];
}

export function createProjectWorkspaceTools(context: ProjectWorkspaceToolContext) {
  return createWorkspaceToolRegistry(createProjectWorkspaceToolDefinitions(), context);
}
