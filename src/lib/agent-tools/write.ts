import { jsonSchema, tool } from "ai";

import { writeProjectWorkspaceFileWithCdnGuard } from "./cdn-guard";
import type { ProjectWorkspaceToolContext, WriteInput } from "./types";

export function createWriteTool({
  projectId,
  workspaceStore,
}: ProjectWorkspaceToolContext) {
  return tool({
    description:
      "Create or overwrite one UTF-8 text file in the current Project Workspace.",
    inputSchema: jsonSchema<WriteInput>({
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Complete UTF-8 text file content.",
        },
        path: {
          type: "string",
          description: "Relative file path inside the Project Workspace.",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    }),
    execute: async ({ content, path }) =>
      writeProjectWorkspaceFileWithCdnGuard(
        workspaceStore,
        projectId,
        path,
        content,
      ),
  });
}
