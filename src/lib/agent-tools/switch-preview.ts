import { isHtmlPath, normalizeToolPath } from "./cdn-guard";
import type { WorkspaceToolDefinition } from "./core";
import type { SwitchPreviewInput } from "./types";

export function createSwitchPreviewToolDefinition(): WorkspaceToolDefinition<
  SwitchPreviewInput,
  { path: string }
> {
  return {
    description:
      "Switch the frontend preview to an existing HTML file in the current Project Workspace after creating or updating the target page.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative HTML file path inside the Project Workspace to show in the Preview Pane.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    name: "switchPreview",
    parallelSafe: true,
    execute: async (input, { projectId, workspaceStore }) => {
      const targetPath = normalizeToolPath(input.path);

      if (!targetPath || targetPath === ".") {
        throw new Error("Preview switch target path must not be empty.");
      }

      if (!isHtmlPath(targetPath)) {
        throw new Error(`Preview switch target must end with .html: ${targetPath}`);
      }

      const htmlFiles = await workspaceStore.listProjectHtmlFiles(projectId);

      if (!htmlFiles.includes(targetPath)) {
        throw new Error(`Project Workspace HTML file was not found: ${targetPath}`);
      }

      return {
        path: targetPath,
      };
    },
  };
}
