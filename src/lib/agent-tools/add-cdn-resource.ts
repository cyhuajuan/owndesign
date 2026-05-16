import { jsonSchema, tool } from "ai";

import {
  buildCdnTag,
  buildEmptyIndexHtml,
  insertBeforeClosingTag,
  parseHttpsCdnUrl,
  readProjectWorkspaceFileIfExists,
} from "./cdn-guard";
import type { AddCdnResourceInput, ProjectWorkspaceToolContext } from "./types";

export function createAddCdnResourceTool({
  projectId,
  workspaceStore,
}: ProjectWorkspaceToolContext) {
  return tool({
    description:
      "Add an approved external HTTPS CDN script or stylesheet tag to index.html in the current Project Workspace.",
    needsApproval: true,
    inputSchema: jsonSchema<AddCdnResourceInput>({
      type: "object",
      properties: {
        crossorigin: {
          type: "string",
          description:
            "Optional crossorigin attribute for the CDN tag, such as anonymous.",
        },
        integrity: {
          type: "string",
          description: "Optional subresource integrity hash for the CDN tag.",
        },
        resourceType: {
          type: "string",
          enum: ["script", "stylesheet"],
          description:
            "Whether to add a stylesheet link in head or a script tag before body close.",
        },
        url: {
          type: "string",
          description: "HTTPS CDN URL to add to index.html.",
        },
      },
      required: ["url", "resourceType"],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const url = parseHttpsCdnUrl(input.url);
      const existingHtml = await readProjectWorkspaceFileIfExists(
        workspaceStore,
        projectId,
        "index.html",
      );
      const createdIndexHtml = existingHtml === undefined;
      const html = existingHtml ?? buildEmptyIndexHtml();

      if (html.includes(input.url) || html.includes(url.href)) {
        return {
          added: false,
          createdIndexHtml: false,
          path: "index.html",
          reason: "already-exists",
          url: url.href,
        };
      }

      const tag = buildCdnTag({ ...input, url: url.href });
      const updatedHtml =
        input.resourceType === "stylesheet"
          ? insertBeforeClosingTag(html, "</head>", tag, "prepend")
          : insertBeforeClosingTag(html, "</body>", tag, "append");

      await workspaceStore.writeProjectWorkspaceFile(
        projectId,
        "index.html",
        updatedHtml,
      );

      return {
        added: true,
        createdIndexHtml,
        path: "index.html",
        resourceType: input.resourceType,
        url: url.href,
      };
    },
  });
}
