'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderIcon, LoaderCircleIcon } from 'lucide-react';

import { PreviewEmptyState } from '@/features/preview/components/preview-empty-state';
import { useApiClient } from '@/api/context';
import { useI18n } from '@/features/i18n/context';
import type { PreviewDevice } from '@/features/preview/preview-device';
import { setCurrentPreviewPath, usePreviewPath } from '@/features/preview/preview-path';

type ProjectPreviewFrameProps = {
  initialUpdatedAt: string;
  previewDevice?: PreviewDevice;
  projectId: string;
  projectName: string;
};

type PreviewSessionResponse = {
  activePath?: string;
  files: string[];
  url: string;
};

type PreviewSessionStatus = 'empty' | 'loading' | 'ready';

const PREVIEW_HREF_EVENT = 'owndesign:preview-href-updated';
const PREVIEW_FILES_EVENT = 'owndesign:preview-files-updated';
const PREVIEW_MANUAL_SWITCH_EVENT = 'owndesign:preview-manual-switch';
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
  const [selectedPreviewPath, setPreviewPath] = usePreviewPath();
  const pendingRouteSyncPathRef = useRef<string | undefined>(undefined);
  const previewProjectIdRef = useRef<string | undefined>(undefined);
  const previewUrlRef = useRef<string | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [previewSessionStatus, setPreviewSessionStatus] =
    useState<PreviewSessionStatus>('loading');
  const [refreshKey, setRefreshKey] = useState(initialUpdatedAt);
  const [manualSwitchKey, setManualSwitchKey] = useState('');
  const requestPreviewSession = useCallback(
    async (endpoint: string, previewPath?: string) => {
      const body: { clientId: string; previewPath?: string } = {
        clientId: clientId.current,
      };

      if (previewPath) {
        body.previewPath = previewPath;
      }

      const response = await fetch(endpoint, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Preview session request failed: ${response.status}`);
      }

      return (await response.json()) as PreviewSessionResponse;
    },
    [],
  );
  const applyPreviewSession = useCallback(
    (session: PreviewSessionResponse, { updateFrameSrc }: { updateFrameSrc: boolean }) => {
      previewProjectIdRef.current = projectId;
      if (session.files.length === 0) {
        previewUrlRef.current = undefined;
        setCurrentPreviewPath(undefined);
        publishPreviewHref(undefined);
        publishPreviewFiles([]);
        setPreviewUrl(undefined);
        setPreviewSessionStatus('empty');
        return;
      }

      const hadPreviewUrl = Boolean(previewUrlRef.current);
      previewUrlRef.current = session.url;
      setCurrentPreviewPath(session.activePath);
      publishPreviewHref(session.url);
      publishPreviewFiles(session.files, session.activePath);
      setPreviewSessionStatus('ready');

      if (updateFrameSrc || !hadPreviewUrl) {
        setPreviewUrl(session.url);
      }
    },
    [projectId],
  );

  useEffect(() => {
    let isActive = true;
    const shouldAcquirePreviewSession =
      !selectedPreviewPath || pendingRouteSyncPathRef.current !== selectedPreviewPath;

    if (selectedPreviewPath && pendingRouteSyncPathRef.current === selectedPreviewPath) {
      pendingRouteSyncPathRef.current = undefined;
    }

    async function acquirePreviewSession() {
      const canKeepCurrentPreview =
        previewProjectIdRef.current === projectId && Boolean(previewUrlRef.current);

      if (!canKeepCurrentPreview) {
        setPreviewUrl(undefined);
        previewUrlRef.current = undefined;
        publishPreviewHref(undefined);
      }

      try {
        const session = await requestPreviewSession(
          api.buildUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-session`),
          selectedPreviewPath,
        );

        if (!isActive) {
          return;
        }

        applyPreviewSession(session, { updateFrameSrc: true });
      } catch {
        if (isActive && !canKeepCurrentPreview) {
          setPreviewUrl(undefined);
          previewUrlRef.current = undefined;
          setPreviewSessionStatus('loading');
          publishPreviewHref(undefined);
          publishPreviewFiles([]);
        }
      }
    }

    if (shouldAcquirePreviewSession) {
      void acquirePreviewSession();
    }

    const heartbeatTimer = window.setInterval(() => {
      void requestPreviewSession(
        api.buildUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-session/heartbeat`),
      )
        .then((session) => {
          if (!isActive) {
            return;
          }

          applyPreviewSession(session, { updateFrameSrc: false });
        })
        .catch(() => {
          if (isActive) {
            setPreviewUrl(undefined);
            previewUrlRef.current = undefined;
            setPreviewSessionStatus('loading');
            publishPreviewHref(undefined);
            publishPreviewFiles([]);
          }
        });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(heartbeatTimer);
    };
  }, [api, applyPreviewSession, projectId, requestPreviewSession, selectedPreviewPath]);

  const syncPreviewSession = async () => {
    try {
      const response = await fetch(
        api.buildUrl(`/api/projects/${encodeURIComponent(projectId)}/preview-session/heartbeat`),
        {
          body: JSON.stringify({
            clientId: clientId.current,
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      );

      if (!response.ok) {
        throw new Error(`Preview session request failed: ${response.status}`);
      }

      const session = (await response.json()) as PreviewSessionResponse;

      applyPreviewSession(session, { updateFrameSrc: false });

      if (session.activePath && session.activePath !== selectedPreviewPath) {
        pendingRouteSyncPathRef.current = session.activePath;
        setPreviewPath(session.activePath);
      } else if (!session.activePath && selectedPreviewPath) {
        pendingRouteSyncPathRef.current = undefined;
        setPreviewPath(undefined);
      }
    } catch {
      setPreviewUrl(undefined);
      previewUrlRef.current = undefined;
      setPreviewSessionStatus('loading');
      publishPreviewHref(undefined);
      publishPreviewFiles([]);
    }
  };

  useEffect(() => {
    const currentClientId = clientId.current;

    return () => {
      setCurrentPreviewPath(undefined);
      publishPreviewHref(undefined);
      publishPreviewFiles([]);
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
    const handleManualPreviewSwitch = (event: Event) => {
      const nextKey =
        event instanceof CustomEvent && typeof event.detail?.key === 'string'
          ? event.detail.key
          : String(Date.now());

      setManualSwitchKey(nextKey);
    };

    window.addEventListener(PREVIEW_MANUAL_SWITCH_EVENT, handleManualPreviewSwitch);

    return () => {
      window.removeEventListener(PREVIEW_MANUAL_SWITCH_EVENT, handleManualPreviewSwitch);
    };
  }, []);

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
      key={`${refreshKey}:${manualSwitchKey}`}
      onLoad={() => {
        void syncPreviewSession();
      }}
      sandbox="allow-scripts allow-same-origin"
      src={previewUrl}
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

function publishPreviewHref(href: string | undefined) {
  window.dispatchEvent(
    new CustomEvent(PREVIEW_HREF_EVENT, {
      detail: { href },
    }),
  );
}

function publishPreviewFiles(files: string[], activePath?: string) {
  window.dispatchEvent(
    new CustomEvent(PREVIEW_FILES_EVENT, {
      detail: { activePath, files },
    }),
  );
}
