import { editProjectWorkspaceFileWithCdnGuard } from "./cdn-guard";
import type { WorkspaceToolDefinition } from "./core";
import type { EditInput } from "./types";

export function createEditToolDefinition(): WorkspaceToolDefinition<
  EditInput,
  Awaited<ReturnType<typeof editProjectWorkspaceFileWithCdnGuard>>
> {
  return {
    description:
      "Edit one UTF-8 text file by replacing oldString with newString. By default oldString must occur exactly once; set replaceAll to replace every occurrence.",
    inputSchema: {
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
    },
    name: "edit",
    parallelSafe: false,
    execute: async ({ newString, oldString, path, replaceAll }, {
      approvedCdnUrls,
      projectId,
      workspaceStore,
    }) =>
      editProjectWorkspaceFileWithCdnGuard(
        workspaceStore,
        projectId,
        path,
        oldString,
        newString,
        replaceAll,
        approvedCdnUrls,
      ),
  };
}
