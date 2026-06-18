import { createWorkspaceToolRegistry } from './core';
import { createEditToolDefinition } from './edit';
import { createGlobToolDefinition } from './glob';
import { createGrepToolDefinition } from './grep';
import { createPreviewRefreshToolDefinition } from './preview-refresh';
import { createReadToolDefinition } from './read';
import type { ProjectWorkspaceToolContext } from './types';
import { createWriteToolDefinition } from './write';

export function createProjectWorkspaceToolDefinitions() {
  return [
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
