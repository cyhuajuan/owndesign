import { jsonSchema, tool } from "ai";

import {
  buildCdnTag,
  buildEmptyIndexHtml,
  isHtmlPath,
  insertBeforeClosingTag,
  normalizeToolPath,
  parseHttpsCdnUrl,
  readProjectWorkspaceFileIfExists,
} from "./cdn-guard";
import type { AddCdnResourceInput, ProjectWorkspaceToolContext } from "./types";

export function createAddCdnResourceTool({
  approvedCdnUrls,
  projectId,
  workspaceStore,
}: ProjectWorkspaceToolContext) {
  const approvedUrls = new Set(
    (approvedCdnUrls ?? []).map(normalizeApprovedUrl).filter(Boolean),
  );

  return tool({
    description:
      "Add an approved external HTTPS CDN script or stylesheet tag to an HTML file in the current Project Workspace.",
    needsApproval: (input) => {
      const url = normalizeApprovedUrl(input.url);

      return !url || !approvedUrls.has(url);
    },
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
          enum: ["script", "style-import", "stylesheet"],
          description:
            "Whether to add a stylesheet link in head, a style @import block in head, or a script tag before body close.",
        },
        path: {
          type: "string",
          description:
            "Optional HTML file path inside the Project Workspace. Defaults to index.html.",
        },
        url: {
          type: "string",
          description: "HTTPS CDN URL to add to the target HTML file.",
        },
      },
      required: ["url", "resourceType"],
      additionalProperties: false,
    }),
    execute: async (input) => {
      const url = parseHttpsCdnUrl(input.url);
      const targetPath = normalizeToolPath(input.path || "index.html");

      if (!isHtmlPath(targetPath)) {
        throw new Error(`CDN resources can only be added to HTML files: ${targetPath}`);
      }

      const existingHtml = await readProjectWorkspaceFileIfExists(
        workspaceStore,
        projectId,
        targetPath,
      );
      const createdIndexHtml = existingHtml === undefined;
      const html = existingHtml ?? buildEmptyIndexHtml();

      if (html.includes(input.url) || html.includes(url.href)) {
        return {
          added: false,
          createdIndexHtml: false,
          path: targetPath,
          reason: "already-exists",
          url: url.href,
        };
      }

      const tag = buildCdnTag({ ...input, url: url.href });
      const updatedHtml =
        input.resourceType === "stylesheet" || input.resourceType === "style-import"
          ? insertBeforeClosingTag(html, "</head>", tag, "prepend")
          : insertBeforeClosingTag(html, "</body>", tag, "append");

      await workspaceStore.writeProjectWorkspaceFile(
        projectId,
        targetPath,
        updatedHtml,
      );

      return {
        added: true,
        createdIndexHtml,
        path: targetPath,
        resourceType: input.resourceType,
        url: url.href,
      };
    },
  });
}

function normalizeApprovedUrl(value: string) {
  try {
    const url = new URL(value);

    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
