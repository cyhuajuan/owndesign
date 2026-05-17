import { jsonSchema, tool } from "ai";

import {
  editProjectWorkspaceFileWithCdnGuard,
  writeProjectWorkspaceFileWithCdnGuard,
} from "./cdn-guard";
import type { PatchInput, ProjectWorkspaceToolContext } from "./types";

export function createPatchTool({
  approvedCdnUrls,
  projectId,
  workspaceStore,
}: ProjectWorkspaceToolContext) {
  return tool({
    description:
      "Apply coordinated UTF-8 file changes inside the current Project Workspace. Supports add/write, edit, and delete changes.",
    inputSchema: jsonSchema<PatchInput>({
      type: "object",
      properties: {
        changes: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description:
                  "Complete file content for add or write operations.",
              },
              newString: {
                type: "string",
                description: "Replacement text for edit operations.",
              },
              oldString: {
                type: "string",
                description: "Text to replace for edit operations.",
              },
              operation: {
                type: "string",
                enum: ["add", "write", "edit", "delete"],
              },
              path: {
                type: "string",
                description:
                  "Relative file or directory path inside the Project Workspace.",
              },
              replaceAll: {
                type: "boolean",
                description:
                  "For edit operations, replace every occurrence of oldString.",
              },
            },
            required: ["operation", "path"],
            additionalProperties: false,
          },
        },
      },
      required: ["changes"],
      additionalProperties: false,
    }),
    execute: async ({ changes }) => {
      const results = [];

      for (const change of changes) {
        if (change.operation === "delete") {
          results.push({
            operation: change.operation,
            result: await workspaceStore.deleteProjectWorkspacePath(
              projectId,
              change.path,
            ),
          });
          continue;
        }

        if (change.operation === "edit") {
          results.push({
            operation: change.operation,
            result: await editProjectWorkspaceFileWithCdnGuard(
              workspaceStore,
              projectId,
              change.path,
              change.oldString,
              change.newString,
              change.replaceAll,
              approvedCdnUrls,
            ),
          });
          continue;
        }

        results.push({
          operation: change.operation,
          result: await writeProjectWorkspaceFileWithCdnGuard(
            workspaceStore,
            projectId,
            change.path,
            change.content,
            approvedCdnUrls,
          ),
        });
      }

      return {
        changed: results.length,
        results,
      };
    },
  });
}
