import {
  filterHtmlPathsForPageEditModePolicy,
  resolveHtmlReadPathForPageEditModePolicy,
} from "@owndesign/core/agent/page-edit-mode";

import type { WorkspaceToolDefinition } from "./core";
import type { ReadInput } from "./types";

export function createReadToolDefinition(): WorkspaceToolDefinition<
  ReadInput,
  Awaited<ReturnType<import("@owndesign/core/workspace-store").WorkspaceStore["readProjectWorkspaceEntry"]>>
> {
  return {
    description:
      "Read one UTF-8 file or directory from the current Project Workspace. Files are returned with 1-indexed line numbers.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description:
            "Maximum number of lines or directory entries to read. Defaults to 2000.",
        },
        offset: {
          type: "number",
          description:
            "1-indexed line or directory-entry offset to start reading from. Defaults to 1.",
        },
        path: {
          type: "string",
          description:
            "Relative file or directory path inside the Project Workspace.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    name: "read",
    parallelSafe: true,
    execute: async ({ limit, offset, path }, {
      pageEditModePolicy,
      projectId,
      workspaceStore,
    }) => {
      const readPath = resolveHtmlReadPathForPageEditModePolicy(
        pageEditModePolicy,
        path,
      );

      const result = await workspaceStore.readProjectWorkspaceEntry(
        projectId,
        readPath,
        {
          limit,
          offset,
        },
      );

      if (result.type !== "directory") {
        return result;
      }

      const entries = filterHtmlPathsForPageEditModePolicy(
        pageEditModePolicy,
        result.entries,
      );

      return {
        ...result,
        entries,
        totalEntries: entries.length,
        truncated: false,
      };
    },
  };
}
