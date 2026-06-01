import { createCallFrontendCapabilityToolDefinition } from "./call-frontend-capability";
import { createWorkspaceToolRegistry } from "./core";
import { createCopyFileToolDefinition } from "./copy-file";
import { createCreateHtmlToolDefinition } from "./create-html";
import { createDeleteToolDefinition } from "./delete";
import { createEditToolDefinition } from "./edit";
import { createGlobToolDefinition } from "./glob";
import { createGrepToolDefinition } from "./grep";
import { createPatchToolDefinition } from "./patch";
import { createReadToolDefinition } from "./read";
import type { ProjectWorkspaceToolContext } from "./types";
import { createWriteToolDefinition } from "./write";

export function createProjectWorkspaceToolDefinitions() {
  return [
    createCallFrontendCapabilityToolDefinition(),
    createCopyFileToolDefinition(),
    createCreateHtmlToolDefinition(),
    createDeleteToolDefinition(),
    createEditToolDefinition(),
    createGlobToolDefinition(),
    createGrepToolDefinition(),
    createPatchToolDefinition(),
    createReadToolDefinition(),
    createWriteToolDefinition(),
  ];
}

export function createProjectWorkspaceTools(
  context: ProjectWorkspaceToolContext,
) {
  return createWorkspaceToolRegistry(
    createProjectWorkspaceToolDefinitions(),
    context,
  );
}
