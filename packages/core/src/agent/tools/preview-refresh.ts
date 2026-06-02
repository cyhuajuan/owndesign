import { sendFrontendCommand } from "@owndesign/core/realtime/frontend-command-bus";
import { z } from "zod";

import type { WorkspaceToolDefinition } from "./core";

type PreviewRefreshInput = Record<string, never>;

export function createPreviewRefreshToolDefinition(): WorkspaceToolDefinition<
  PreviewRefreshInput,
  {
    capability: "preview.refresh";
    delivered: boolean;
    payload: Record<string, never>;
  }
> {
  return {
    description:
      "Refresh the current Preview Pane after successful previewable HTML changes without changing HTML file.",
    inputSchema: z.object({}).strict(),
    name: "previewRefresh",
    parallelSafe: false,
    execute: (_input, context) => {
      if (!context.frontendTabId) {
        throw new Error("Frontend tab id is required to refresh the preview.");
      }

      const payload = {};
      const result = sendFrontendCommand({
        capability: "preview.refresh",
        frontendTabId: context.frontendTabId,
        payload,
        projectId: context.projectId,
      });

      return {
        capability: "preview.refresh",
        delivered: result?.delivered ?? false,
        payload,
      };
    },
  };
}
