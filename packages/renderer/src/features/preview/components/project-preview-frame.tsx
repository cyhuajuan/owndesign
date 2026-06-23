'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderIcon, LoaderCircleIcon } from 'lucide-react';

import { PreviewEmptyState } from '@/features/preview/components/preview-empty-state';
import { useApiClient } from '@/api/context';
import { useI18n } from '@/features/i18n/context';
import type { PreviewDevice } from '@/features/preview/preview-device';

type ProjectPreviewFrameProps = {
  initialUpdatedAt: string;
  previewDevice?: PreviewDevice;
  projectId: string;
  projectName: string;
};

type PreviewSessionResponse = {
  previewFileExists: boolean;
  url?: string;
};

type PreviewSessionStatus = 'empty' | 'loading' | 'ready';

const PREVIEW_HREF_EVENT = 'owndesign:preview-href-updated';
const PREVIEW_ROUTE_EVENT = 'owndesign:preview-route-updated';
const HEARTBEAT_INTERVAL_MS = 30_000;

export function ProjectPreviewFrame({
  initialUpdatedAt,
  previewDevice = 'desktop',
  projectId,
  projectName,
}: ProjectPreviewFrameProps) {
  const api = useApiClient();
  const { t } = useI18n();
  const clientId = useRef(createClientId());
  const previewFrameRef = useRef<HTMLIFrameElement | null>(null);
  const previewProjectIdRef = useRef<string | undefined>(undefined);
  const previewUrlRef = useRef<string | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [previewSessionStatus, setPreviewSessionStatus] =
    useState<PreviewSessionStatus>('loading');
  const [refreshKey, setRefreshKey] = useState(initialUpdatedAt);

  const requestPreviewSession = useCallback(async (endpoint: string) => {
    const response = await fetch(endpoint, {
      body: JSON.stringify({
        clientId: clientId.current,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`Preview session request failed: ${response.status}`);
    }

    return (await response.json()) as PreviewSessionResponse;
  }, []);

  const applyPreviewSession = useCallback(
    (session: PreviewSessionResponse, { updateFrameSrc }: { updateFrameSrc: boolean }) => {
      previewProjectIdRef.current = projectId;

      if (!session.previewFileExists || !session.url) {
        previewUrlRef.current = undefined;
        publishPreviewHref(undefined);
        publishPreviewRoute(projectId, '');
        setPreviewUrl(undefined);
        setPreviewSessionStatus('empty');
        return;
      }

      const hadPreviewUrl = Boolean(previewUrlRef.current);
      previewUrlRef.current = session.url;
      publishPreviewHref(session.url);
      setPreviewSessionStatus('ready');

      if (updateFrameSrc || !hadPreviewUrl) {
        setPreviewUrl(session.url);
      }
    },
    [projectId],
  );

  useEffect(() => {
    clearLegacyPreviewPathQuery();
  }, [projectId]);

  useEffect(() => {
    let isActive = true;

    async function acquirePreviewSession() {
      const canKeepCurrentPreview =
        previewProjectIdRef.current === projectId && Boolean(previewUrlRef.current);

      if (!canKeepCurrentPreview) {
        setPreviewUrl(undefined);
        previewUrlRef.current = undefined;
        publishPreviewHref(undefined);
        publishPreviewRoute(projectId, '');
      }

      try {
        const session = await requestPreviewSession(
          api.buildUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-session`),
        );

        if (isActive) {
          applyPreviewSession(session, { updateFrameSrc: true });
        }
      } catch {
        if (isActive && !canKeepCurrentPreview) {
          setPreviewUrl(undefined);
          previewUrlRef.current = undefined;
          setPreviewSessionStatus('loading');
          publishPreviewHref(undefined);
          publishPreviewRoute(projectId, '');
        }
      }
    }

    void acquirePreviewSession();

    const heartbeatTimer = window.setInterval(() => {
      void requestPreviewSession(
        api.buildUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-session/heartbeat`),
      )
        .then((session) => {
          if (isActive) {
            applyPreviewSession(session, { updateFrameSrc: false });
          }
        })
        .catch(() => {
          if (isActive) {
            setPreviewUrl(undefined);
            previewUrlRef.current = undefined;
            setPreviewSessionStatus('loading');
            publishPreviewHref(undefined);
            publishPreviewRoute(projectId, '');
          }
        });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(heartbeatTimer);
    };
  }, [api, applyPreviewSession, projectId, requestPreviewSession]);

  const syncPreviewSession = async () => {
    try {
      const session = await requestPreviewSession(
        api.buildUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-session/heartbeat`),
      );

      applyPreviewSession(session, { updateFrameSrc: false });
    } catch {
      setPreviewUrl(undefined);
      previewUrlRef.current = undefined;
      setPreviewSessionStatus('loading');
      publishPreviewHref(undefined);
      publishPreviewRoute(projectId, '');
    }
  };

  useEffect(() => {
    const currentClientId = clientId.current;

    return () => {
      publishPreviewHref(undefined);
      publishPreviewRoute(projectId, '');
      void fetch(api.buildUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-session`), {
        body: JSON.stringify({
          clientId: currentClientId,
        }),
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        method: 'DELETE',
      });
    };
  }, [api, projectId]);

  useEffect(() => {
    const handleProjectOutputUpdated = (event: Event) => {
      if (event.type === 'owndesign:preview-refresh') {
        if (previewUrlRef.current) {
          setPreviewUrl(previewUrlRef.current);
          setRefreshKey(String(Date.now()));
          return;
        }

        void requestPreviewSession(
          api.buildUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-session/heartbeat`),
        )
          .then((session) => {
            applyPreviewSession(session, { updateFrameSrc: true });
          })
          .catch(() => {
            setPreviewSessionStatus('loading');
          });
        return;
      }

      if (event instanceof CustomEvent && event.detail?.projectId === projectId) {
        if (previewUrlRef.current) {
          setPreviewUrl(previewUrlRef.current);
          setRefreshKey(String(Date.now()));
          return;
        }

        void requestPreviewSession(
          api.buildUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-session/heartbeat`),
        )
          .then((session) => {
            applyPreviewSession(session, { updateFrameSrc: true });
          })
          .catch(() => {
            setPreviewSessionStatus('loading');
          });
      }
    };

    window.addEventListener('owndesign:project-output-updated', handleProjectOutputUpdated);
    window.addEventListener('owndesign:preview-refresh', handleProjectOutputUpdated);

    return () => {
      window.removeEventListener('owndesign:project-output-updated', handleProjectOutputUpdated);
      window.removeEventListener('owndesign:preview-refresh', handleProjectOutputUpdated);
    };
  }, [api, applyPreviewSession, projectId, requestPreviewSession]);

  useEffect(() => {
    const handlePreviewRouteMessage = (event: MessageEvent) => {
      const frameWindow = previewFrameRef.current?.contentWindow;

      if (!frameWindow || event.source !== frameWindow) {
        return;
      }

      const previewOrigin = getUrlOrigin(previewUrlRef.current);

      if (!previewOrigin || event.origin !== previewOrigin) {
        return;
      }

      if (!isPreviewRouteMessage(event.data)) {
        return;
      }

      publishPreviewRoute(projectId, event.data.hash);
    };

    window.addEventListener('message', handlePreviewRouteMessage);

    return () => {
      window.removeEventListener('message', handlePreviewRouteMessage);
    };
  }, [projectId]);

  if (previewSessionStatus === 'empty') {
    return (
      <PreviewEmptyState
        badge="Preview"
        description={t('preview.emptyDescription')}
        icon={<FolderIcon />}
        title={t('preview.emptyTitle')}
      />
    );
  }

  if (!previewUrl) {
    return (
      <PreviewEmptyState
        badge="Loading"
        description={t('preview.serviceStartingDescription')}
        icon={<LoaderCircleIcon className="animate-spin" />}
        title={t('preview.serviceStartingTitle')}
      />
    );
  }

  const previewFrame = (
    <iframe
      className="size-full border-0 bg-white"
      key={refreshKey}
      onLoad={() => {
        void syncPreviewSession();
      }}
      sandbox="allow-scripts allow-same-origin"
      src={previewUrl}
      ref={previewFrameRef}
      title={t('preview.htmlTitle', { projectName })}
    />
  );

  if (previewDevice === 'mobile') {
    return (
      <div className="flex size-full overflow-auto bg-muted/40 p-4" data-testid="mobile-preview">
        <div className="m-auto h-[844px] max-h-full w-[390px] shrink-0 overflow-hidden border border-border bg-white shadow-xl">
          {previewFrame}
        </div>
      </div>
    );
  }

  return previewFrame;
}

function createClientId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clearLegacyPreviewPathQuery() {
  const url = new URL(window.location.href);

  if (!url.searchParams.has('previewPath')) {
    return;
  }

  url.searchParams.delete('previewPath');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function publishPreviewHref(href: string | undefined) {
  window.dispatchEvent(
    new CustomEvent(PREVIEW_HREF_EVENT, {
      detail: { href },
    }),
  );
}

function publishPreviewRoute(projectId: string, hash: string) {
  window.dispatchEvent(
    new CustomEvent(PREVIEW_ROUTE_EVENT, {
      detail: { hash, projectId },
    }),
  );
}

function getUrlOrigin(url: string | undefined) {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function isPreviewRouteMessage(value: unknown): value is {
  hash: string;
  source: 'owndesign-preview';
  type: 'route-changed';
  version: 1;
} {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    record.source === 'owndesign-preview' &&
    record.type === 'route-changed' &&
    record.version === 1 &&
    typeof record.hash === 'string' &&
    (record.hash === '' || record.hash.startsWith('#')) &&
    !hasControlCharacter(record.hash)
  );
}

function hasControlCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;

    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }

  return false;
}
