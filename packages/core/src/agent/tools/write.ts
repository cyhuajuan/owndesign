import { assertHtmlMutationAllowed } from "@owndesign/core/agent/page-edit-mode";

import { writeProjectWorkspaceFileWithCdnGuard } from "./cdn-guard";
import type { WorkspaceToolDefinition } from "./core";
import type { WriteInput } from "./types";

export function createWriteToolDefinition(): WorkspaceToolDefinition<
  WriteInput,
  Awaited<ReturnType<typeof writeProjectWorkspaceFileWithCdnGuard>>
> {
  return {
    description:
      "Create or overwrite one UTF-8 text file in the current Project Workspace.",
    inputSchema: {
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
    },
    name: "write",
    parallelSafe: false,
    execute: async ({ content, path }, {
      approvedCdnUrls,
      pageEditModePolicy,
      projectId,
      workspaceStore,
    }) => {
      assertHtmlMutationAllowed(pageEditModePolicy, path);

      return writeProjectWorkspaceFileWithCdnGuard(
        workspaceStore,
        projectId,
        path,
        content,
        approvedCdnUrls,
      );
    },
  };
}
