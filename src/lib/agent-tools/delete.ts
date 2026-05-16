import { jsonSchema, tool } from "ai";

import type { DeleteInput, ProjectWorkspaceToolContext } from "./types";

export function createDeleteTool({
  projectId,
  workspaceStore,
}: ProjectWorkspaceToolContext) {
  return tool({
    description:
      "Recursively delete a file or directory from the current Project Workspace.",
    inputSchema: jsonSchema<DeleteInput>({
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative file or directory path inside the Project Workspace.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    }),
    execute: async ({ path }) =>
      workspaceStore.deleteProjectWorkspacePath(projectId, path),
  });
}
