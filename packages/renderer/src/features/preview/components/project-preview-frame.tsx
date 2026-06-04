'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';

import { PreviewEmptyState } from '@/features/preview/components/preview-empty-state';
import { useApiClient } from '@/api/context';
import { useI18n } from '@/features/i18n/context';
import { setCurrentPreviewPath, usePreviewPath } from '@/features/preview/preview-path';

type ProjectPreviewFrameProps = {
  initialUpdatedAt: string;
  projectId: string;
  projectName: string;
};

type PreviewSessionResponse = {
  activePath?: string;
  files: string[];
  url: string;
};

const PREVIEW_HREF_EVENT = 'owndesign:preview-href-updated';
const PREVIEW_FILES_EVENT = 'owndesign:preview-files-updated';
const PREVIEW_MANUAL_SWITCH_EVENT = 'owndesign:preview-manual-switch';
const HEARTBEAT_INTERVAL_MS = 30_000;

export function ProjectPreviewFrame({
  initialUpdatedAt,
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
  const [refreshKey, setRefreshKey] = useState(initialUpdatedAt);
  const [manualSwitchKey, setManualSwitchKey] = useState('');
  const applyPreviewSession = useCallback(
    (session: PreviewSessionResponse, { updateFrameSrc }: { updateFrameSrc: boolean }) => {
      previewProjectIdRef.current = projectId;
      previewUrlRef.current = session.url;
      setCurrentPreviewPath(session.activePath);
      publishPreviewHref(session.url);
      publishPreviewFiles(session.files, session.activePath);

      if (updateFrameSrc) {
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

    const buildSessionBody = (previewPath?: string) => {
      const body: { clientId: string; previewPath?: string } = {
        clientId: clientId.current,
      };

      if (previewPath) {
        body.previewPath = previewPath;
      }

      return JSON.stringify(body);
    };

    async function requestPreviewSession(endpoint: string, previewPath?: string) {
      const response = await fetch(endpoint, {
        body: buildSessionBody(previewPath),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Preview session request failed: ${response.status}`);
      }

      return (await response.json()) as PreviewSessionResponse;
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
            publishPreviewHref(undefined);
            publishPreviewFiles([]);
          }
        });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(heartbeatTimer);
    };
  }, [api, applyPreviewSession, projectId, selectedPreviewPath]);

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
        }

        setRefreshKey(String(Date.now()));
        return;
      }

      if (event instanceof CustomEvent && event.detail?.projectId === projectId) {
        if (previewUrlRef.current) {
          setPreviewUrl(previewUrlRef.current);
        }

        setRefreshKey(String(Date.now()));
      }
    };

    window.addEventListener('owndesign:project-output-updated', handleProjectOutputUpdated);
    window.addEventListener('owndesign:preview-refresh', handleProjectOutputUpdated);

    return () => {
      window.removeEventListener('owndesign:project-output-updated', handleProjectOutputUpdated);
      window.removeEventListener('owndesign:preview-refresh', handleProjectOutputUpdated);
    };
  }, [projectId]);

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

  return (
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
