import { jsonSchema, tool } from "ai";

import type { GrepInput, ProjectWorkspaceToolContext } from "./types";

export function createGrepTool({
  projectId,
  workspaceStore,
}: ProjectWorkspaceToolContext) {
  return tool({
    description:
      "Search UTF-8 text files in the current Project Workspace using a JavaScript regular expression.",
    inputSchema: jsonSchema<GrepInput>({
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
    }),
    execute: async ({ include, path, pattern }) => ({
      matches: await workspaceStore.grepProjectWorkspace(projectId, pattern, {
        include,
        path,
      }),
    }),
  });
}
