import type { WorkspaceGrepResult } from "@/server/workspace-store";

import type { WorkspaceToolDefinition } from "./core";
import type { GrepInput } from "./types";

export function createGrepToolDefinition(): WorkspaceToolDefinition<
  GrepInput,
  WorkspaceGrepResult
> {
  return {
    description:
      "Search UTF-8 text files in the current Project Workspace using a JavaScript regular expression.",
    inputSchema: {
      type: "object",
      properties: {
        include: {
          type: "string",
          description:
            'Optional file glob to include, such as "*.html" or "**/*.{css,js}".',
        },
        path: {
          type: "string",
          description:
            "Optional relative file or directory path inside the Project Workspace to search.",
        },
        pattern: {
          type: "string",
          description: "JavaScript regular expression pattern to search for.",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    name: "grep",
    parallelSafe: true,
    execute: async ({ include, path, pattern }, { projectId, workspaceStore }) =>
      workspaceStore.grepProjectWorkspace(projectId, pattern, {
        include,
        path,
      }),
  };
}
