import { jsonSchema, tool } from "ai";

import type { GlobInput, ProjectWorkspaceToolContext } from "./types";

export function createGlobTool({
  projectId,
  workspaceStore,
}: ProjectWorkspaceToolContext) {
  return tool({
    description:
      "Find files and directories in the current Project Workspace by glob pattern, sorted by most recently modified first.",
    inputSchema: jsonSchema<GlobInput>({
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
    }),
    execute: async ({ path, pattern }) => ({
      matches: await workspaceStore.globProjectWorkspace(
        projectId,
        pattern,
        path,
      ),
    }),
  });
}
