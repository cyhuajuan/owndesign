import { jsonSchema, tool } from "ai";

import { editProjectWorkspaceFileWithCdnGuard } from "./cdn-guard";
import type { EditInput, ProjectWorkspaceToolContext } from "./types";

export function createEditTool({
  approvedCdnUrls,
  projectId,
  workspaceStore,
}: ProjectWorkspaceToolContext) {
  return tool({
    description:
      "Edit one UTF-8 text file by replacing oldString with newString. By default oldString must occur exactly once; set replaceAll to replace every occurrence.",
    inputSchema: jsonSchema<EditInput>({
      type: "object",
      properties: {
        newString: {
          type: "string",
          description: "Replacement text.",
        },
        oldString: {
          type: "string",
          description: "Text to replace.",
        },
        path: {
          type: "string",
          description: "Relative file path inside the Project Workspace.",
        },
        replaceAll: {
          type: "boolean",
          description:
            "Replace every occurrence of oldString instead of requiring exactly one match.",
        },
      },
      required: ["path", "oldString", "newString"],
      additionalProperties: false,
    }),
    execute: async ({ newString, oldString, path, replaceAll }) =>
      editProjectWorkspaceFileWithCdnGuard(
        workspaceStore,
        projectId,
        path,
        oldString,
        newString,
        replaceAll,
        approvedCdnUrls,
      ),
  });
}
