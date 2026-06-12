export const FRONTEND_CAPABILITIES = {
  'preview.refresh': {
    description: 'Refresh the current Preview Pane without changing HTML file.',
    payloadSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
} as const;

export type FrontendCapabilityId = keyof typeof FRONTEND_CAPABILITIES;

export type FrontendCapabilityPayloads = {
  'preview.refresh': Record<string, never>;
};

export type FrontendCommand = {
  [Capability in FrontendCapabilityId]: {
    capability: Capability;
    id: string;
    payload: FrontendCapabilityPayloads[Capability];
  };
}[FrontendCapabilityId];

export const FRONTEND_CAPABILITY_IDS = Object.keys(FRONTEND_CAPABILITIES) as FrontendCapabilityId[];

export function isFrontendCapabilityId(value: unknown): value is FrontendCapabilityId {
  return (
    typeof value === 'string' && FRONTEND_CAPABILITY_IDS.includes(value as FrontendCapabilityId)
  );
}

export function validateFrontendCapabilityPayload(
  capability: FrontendCapabilityId,
  payload: unknown,
) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Frontend capability payload must be an object: ${capability}`);
  }

  if (capability === 'preview.refresh') {
    if (Object.keys(payload).length > 0) {
      throw new Error('preview.refresh payload must be empty.');
    }

    return {};
  }

  throw new Error(`Unsupported frontend capability: ${capability}`);
}

export function buildFrontendCapabilityPrompt() {
  return [
    '## Frontend Capabilities',
    'Use preview tools only to notify the browser UI after Project Workspace file changes are complete. They do not create, edit, or validate files.',
    'After successful previewable HTML changes, call exactly one `previewRefresh` before the final user-facing summary.',
    'Do not call a preview tool when no previewable HTML file changed or the file operation failed.',
    'Use `previewRefresh` when `index.html` changed and should reload.',
    'Do not use workspace file tools to simulate preview switching or refreshing.',
    'Available capabilities:',
    ...FRONTEND_CAPABILITY_IDS.map((capability) => {
      const schema = JSON.stringify(FRONTEND_CAPABILITIES[capability].payloadSchema);

      return `- ${capability}: ${FRONTEND_CAPABILITIES[capability].description} Payload schema: ${schema}`;
    }),
  ].join('\n');
}
