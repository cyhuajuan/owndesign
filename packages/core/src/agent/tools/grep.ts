import type { WorkspaceGrepResult } from "@owndesign/core/workspace-store";
import { z } from "zod";

import type { WorkspaceToolDefinition } from "./core";
import type { GrepInput } from "./types";

export function createGrepToolDefinition(): WorkspaceToolDefinition<
  GrepInput,
  WorkspaceGrepResult
> {
  return {
    description:
      "Search UTF-8 text files in the current Project Workspace using a JavaScript regular expression.",
    inputSchema: z.object({
      include: z
        .string()
        .describe('Optional file glob to include, such as "*.html" or "**/*.{css,js}".')
        .optional(),
      path: z
        .string()
        .describe("Optional relative file or directory path inside the Project Workspace to search.")
        .optional(),
      pattern: z.string().describe("JavaScript regular expression pattern to search for."),
    }).strict(),
    name: "grep",
    parallelSafe: true,
    execute: async ({ include, path, pattern }, {
      projectId,
      workspaceStore,
    }) => {
      return workspaceStore.grepProjectWorkspace(projectId, pattern, {
        include,
        path,
      });
    },
  };
}
