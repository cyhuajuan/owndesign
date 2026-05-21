export const FRONTEND_CAPABILITIES = {
  "preview.refresh": {
    description: "Refresh the current Preview Pane without changing HTML file.",
    payloadSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  "preview.switchHtml": {
    description: "Switch the Preview Pane to an existing HTML file.",
    payloadSchema: {
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
  },
} as const;

export type FrontendCapabilityId = keyof typeof FRONTEND_CAPABILITIES;

export type FrontendCapabilityPayloads = {
  "preview.refresh": Record<string, never>;
  "preview.switchHtml": {
    path: string;
  };
};

export type FrontendCommand = {
  [Capability in FrontendCapabilityId]: {
    capability: Capability;
    id: string;
    payload: FrontendCapabilityPayloads[Capability];
  };
}[FrontendCapabilityId];

export const FRONTEND_CAPABILITY_IDS = Object.keys(
  FRONTEND_CAPABILITIES,
) as FrontendCapabilityId[];

export function isFrontendCapabilityId(
  value: unknown,
): value is FrontendCapabilityId {
  return (
    typeof value === "string" &&
    FRONTEND_CAPABILITY_IDS.includes(value as FrontendCapabilityId)
  );
}

export function validateFrontendCapabilityPayload(
  capability: FrontendCapabilityId,
  payload: unknown,
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Frontend capability payload must be an object: ${capability}`);
  }

  if (capability === "preview.refresh") {
    if (Object.keys(payload).length > 0) {
      throw new Error("preview.refresh payload must be empty.");
    }

    return {};
  }

  if (
    !("path" in payload) ||
    typeof payload.path !== "string" ||
    !payload.path.trim()
  ) {
    throw new Error("preview.switchHtml payload.path must be a non-empty string.");
  }

  return {
    path: payload.path,
  };
}

export function buildFrontendCapabilityPrompt() {
  return [
    "## Frontend Capabilities",
    "Use `callFrontendCapability` when the browser UI should perform one of these fixed frontend capabilities.",
    "Do not use workspace file tools to simulate preview switching or refreshing.",
    ...FRONTEND_CAPABILITY_IDS.map((capability) => {
      const schema = JSON.stringify(
        FRONTEND_CAPABILITIES[capability].payloadSchema,
      );

      return `- ${capability}: ${FRONTEND_CAPABILITIES[capability].description} Payload schema: ${schema}`;
    }),
  ].join("\n");
}
