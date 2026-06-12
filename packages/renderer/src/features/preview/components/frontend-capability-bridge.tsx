'use client';

import { useEffect } from 'react';

import {
  isFrontendCapabilityId,
  type FrontendCommand,
} from '@owndesign/core/realtime/frontend-capabilities';
import { useApiClient } from '@/api/context';

export const FRONTEND_TAB_ID = createFrontendTabId();

const PREVIEW_REFRESH_EVENT = 'owndesign:preview-refresh';

type FrontendCapabilityBridgeProps = {
  projectId?: string;
};

export function FrontendCapabilityBridge({ projectId }: FrontendCapabilityBridgeProps) {
  const api = useApiClient();

  useEffect(() => {
    if (!projectId) {
      return;
    }

    const eventSource = new EventSource(
      api.buildUrl(
        `/api/projects/${encodeURIComponent(
          projectId,
        )}/frontend-capabilities/stream?tabId=${encodeURIComponent(FRONTEND_TAB_ID)}`,
      ),
    );

    eventSource.addEventListener('frontend-command', (event) => {
      const command = parseFrontendCommand(event);

      if (!command) {
        return;
      }

      if (command.capability === 'preview.refresh') {
        window.dispatchEvent(new Event(PREVIEW_REFRESH_EVENT));
      }
    });

    return () => {
      eventSource.close();
    };
  }, [api, projectId]);

  return null;
}

function parseFrontendCommand(event: Event): FrontendCommand | undefined {
  if (!('data' in event) || typeof event.data !== 'string') {
    return undefined;
  }

  try {
    const command = JSON.parse(event.data) as Partial<FrontendCommand>;

    if (!isFrontendCapabilityId(command.capability)) {
      return undefined;
    }

    if (command.capability === 'preview.refresh') {
      return {
        capability: command.capability,
        id: typeof command.id === 'string' ? command.id : '',
        payload: {},
      };
    }

  } catch {
    return undefined;
  }

  return undefined;
}

function createFrontendTabId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
