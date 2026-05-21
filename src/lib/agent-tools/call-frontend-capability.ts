import {
  FRONTEND_CAPABILITY_IDS,
  isFrontendCapabilityId,
  validateFrontendCapabilityPayload,
  type FrontendCapabilityPayloads,
} from "@/lib/frontend-capabilities";
import { sendFrontendCommand } from "@/lib/frontend-command-bus";

import { isHtmlPath, normalizeToolPath } from "./cdn-guard";
import type { WorkspaceToolDefinition } from "./core";
import type {
  CallFrontendCapabilityInput,
  ProjectWorkspaceToolContext,
} from "./types";

export function createCallFrontendCapabilityToolDefinition(): WorkspaceToolDefinition<
  CallFrontendCapabilityInput,
  {
    capability: string;
    delivered: true;
    payload: unknown;
  }
> {
  return {
    description:
      "Call a fixed frontend browser capability for the active tab, such as switching or refreshing the Preview Pane.",
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          enum: FRONTEND_CAPABILITY_IDS,
          description: "Frontend capability ID to call.",
        },
        payload: {
          type: "object",
          description: "Capability-specific payload.",
        },
      },
      required: ["capability", "payload"],
      additionalProperties: false,
    },
    name: "callFrontendCapability",
    parallelSafe: false,
    execute: async (input, context) => {
      if (!context.frontendTabId) {
        throw new Error("Frontend tab id is required to call frontend capabilities.");
      }

      if (!isFrontendCapabilityId(input.capability)) {
        throw new Error(`Unknown frontend capability: ${input.capability}`);
      }

      const payload = await normalizePayload(input.capability, input.payload, context);
      sendCapabilityCommand(input.capability, payload, context);

      return {
        capability: input.capability,
        delivered: true,
        payload,
      };
    },
  };
}

async function normalizePayload<Capability extends keyof FrontendCapabilityPayloads>(
  capability: Capability,
  payload: unknown,
  context: ProjectWorkspaceToolContext,
): Promise<FrontendCapabilityPayloads[Capability]> {
  const validated = validateFrontendCapabilityPayload(capability, payload);

  if (capability === "preview.refresh") {
    return validated as FrontendCapabilityPayloads[Capability];
  }

  const targetPath = normalizeToolPath((validated as { path: string }).path);

  if (!targetPath || targetPath === ".") {
    throw new Error("Preview switch target path must not be empty.");
  }

  if (!isHtmlPath(targetPath)) {
    throw new Error(`Preview switch target must end with .html: ${targetPath}`);
  }

  const htmlFiles = await context.workspaceStore.listProjectHtmlFiles(
    context.projectId,
  );

  if (!htmlFiles.includes(targetPath)) {
    throw new Error(`Project Workspace HTML file was not found: ${targetPath}`);
  }

  return {
    path: targetPath,
  } as FrontendCapabilityPayloads[Capability];
}

function sendCapabilityCommand(
  capability: keyof FrontendCapabilityPayloads,
  payload: FrontendCapabilityPayloads[keyof FrontendCapabilityPayloads],
  context: ProjectWorkspaceToolContext,
) {
  if (capability === "preview.refresh") {
    sendFrontendCommand({
      capability,
      frontendTabId: context.frontendTabId ?? "",
      payload: payload as FrontendCapabilityPayloads["preview.refresh"],
      projectId: context.projectId,
    });
    return;
  }

  sendFrontendCommand({
    capability,
    frontendTabId: context.frontendTabId ?? "",
    payload: payload as FrontendCapabilityPayloads["preview.switchHtml"],
    projectId: context.projectId,
  });
}
