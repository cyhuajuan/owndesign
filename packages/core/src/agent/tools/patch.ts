import { assertHtmlPathOperationAllowed } from "@owndesign/core/agent/page-edit-mode";

import { applyProjectWorkspacePatchWithCdnGuard } from "./cdn-guard";
import type { WorkspaceToolDefinition } from "./core";
import type { PatchInput } from "./types";

export function createPatchToolDefinition(): WorkspaceToolDefinition<
  PatchInput,
  Awaited<ReturnType<typeof applyProjectWorkspacePatchWithCdnGuard>>
> {
  return {
    description:
      "Apply coordinated UTF-8 file changes inside the current Project Workspace. Supports add/write, edit, and delete changes.",
    inputSchema: {
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
    },
    name: "patch",
    parallelSafe: false,
    validate: validatePatchInput,
    execute: async (
      { changes },
      { approvedCdnUrls, pageEditModePolicy, projectId, workspaceStore },
    ) => {
      for (const change of changes) {
        assertHtmlPathOperationAllowed(
          pageEditModePolicy,
          change.operation === "delete" ? "delete" : "mutate",
          change.path,
        );
      }

      return applyProjectWorkspacePatchWithCdnGuard(
        workspaceStore,
        projectId,
        changes,
        approvedCdnUrls,
      );
    },
  };
}

function validatePatchInput(input: PatchInput) {
  if (!Array.isArray(input.changes) || input.changes.length === 0) {
    throw new Error("patch.changes must include at least one change.");
  }

  for (const [index, change] of input.changes.entries()) {
    const label = `patch.changes[${index}]`;

    if (!change.path) {
      throw new Error(`${label}.path must not be empty.`);
    }

    if (change.operation === "edit") {
      if (typeof change.oldString !== "string" || typeof change.newString !== "string") {
        throw new Error(`${label} edit changes require oldString and newString.`);
      }
      if ("content" in change) {
        throw new Error(`${label} edit changes must not include content.`);
      }
      continue;
    }

    if (change.operation === "add" || change.operation === "write") {
      if (typeof change.content !== "string") {
        throw new Error(`${label} ${change.operation} changes require content.`);
      }
      if ("oldString" in change || "newString" in change || "replaceAll" in change) {
        throw new Error(`${label} ${change.operation} changes must not include edit fields.`);
      }
      continue;
    }

    if (change.operation === "delete") {
      if (
        "content" in change ||
        "oldString" in change ||
        "newString" in change ||
        "replaceAll" in change
      ) {
        throw new Error(`${label} delete changes must not include content or edit fields.`);
      }
      continue;
    }

    throw new Error(`${label}.operation is not supported.`);
  }
}
