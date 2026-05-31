import type { WorkspaceGlobMatch } from "@owndesign/core/workspace-store";
import {
  filterHtmlPathsForPageEditModePolicy,
  resolveHtmlReadPathForPageEditModePolicy,
} from "@owndesign/core/agent/page-edit-mode";

import type { WorkspaceToolDefinition } from "./core";
import type { GlobInput } from "./types";

export function createGlobToolDefinition(): WorkspaceToolDefinition<
  GlobInput,
  { matches: WorkspaceGlobMatch[]; totalMatches: number; truncated: boolean }
> {
  return {
    description:
      "Find files and directories in the current Project Workspace by glob pattern, sorted by most recently modified first.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Optional relative directory path inside the Project Workspace to search from.",
        },
        pattern: {
          type: "string",
          description:
            'Glob pattern such as "**/*.html", "assets/*.{css,js}", or "index.html".',
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    name: "glob",
    parallelSafe: true,
    execute: async ({ path, pattern }, {
      pageEditModePolicy,
      projectId,
      workspaceStore,
    }) => {
      const searchPath = path
        ? resolveHtmlReadPathForPageEditModePolicy(pageEditModePolicy, path)
        : undefined;

      const result = await workspaceStore.globProjectWorkspace(
        projectId,
        pattern,
        searchPath,
      );
      const matches = filterHtmlPathsForPageEditModePolicy(
        pageEditModePolicy,
        result.matches,
      );

      return {
        ...result,
        matches,
        totalMatches: matches.length,
        truncated: false,
      };
    },
  };
}
