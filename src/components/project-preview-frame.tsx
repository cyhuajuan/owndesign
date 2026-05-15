"use client";

import { useEffect, useRef, useState } from "react";

type ProjectPreviewFrameProps = {
  initialUpdatedAt: string;
  projectId: string;
  projectName: string;
};

type PreviewSessionResponse = {
  url: string;
};

const PREVIEW_HREF_EVENT = "hjdesign:preview-href-updated";
const HEARTBEAT_INTERVAL_MS = 30_000;

export function ProjectPreviewFrame({
  initialUpdatedAt,
  projectId,
  projectName,
}: ProjectPreviewFrameProps) {
  const clientId = useRef(createClientId());
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(initialUpdatedAt);

  useEffect(() => {
    let isActive = true;
    const sessionBody = JSON.stringify({ clientId: clientId.current });

    async function requestPreviewSession(endpoint: string) {
      const response = await fetch(endpoint, {
        body: sessionBody,
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Preview session request failed: ${response.status}`);
      }

      return (await response.json()) as PreviewSessionResponse;
    }

    async function acquirePreviewSession() {
      setPreviewUrl(undefined);
      publishPreviewHref(undefined);

      try {
        const session = await requestPreviewSession(
          `/api/projects/${encodeURIComponent(projectId)}/preview-session`,
        );

        if (!isActive) {
          return;
        }

        setPreviewUrl(session.url);
        publishPreviewHref(session.url);
      } catch {
        if (isActive) {
          setPreviewUrl(undefined);
          publishPreviewHref(undefined);
        }
      }
    }

    void acquirePreviewSession();

    const heartbeatTimer = window.setInterval(() => {
      void requestPreviewSession(
        `/api/projects/${encodeURIComponent(projectId)}/preview-session/heartbeat`,
      )
        .then((session) => {
          if (!isActive) {
            return;
          }

          setPreviewUrl(session.url);
          publishPreviewHref(session.url);
        })
        .catch(() => {
          if (isActive) {
            setPreviewUrl(undefined);
            publishPreviewHref(undefined);
          }
        });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(heartbeatTimer);
      publishPreviewHref(undefined);
      void fetch(
        `/api/projects/${encodeURIComponent(projectId)}/preview-session`,
        {
          body: sessionBody,
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          method: "DELETE",
        },
      );
    };
  }, [projectId]);

  useEffect(() => {
    const handleProjectOutputUpdated = (event: Event) => {
      if (event.type === "hjdesign:preview-refresh") {
        setRefreshKey(String(Date.now()));
        return;
      }

      if (
        event instanceof CustomEvent &&
        event.detail?.projectId === projectId
      ) {
        setRefreshKey(String(Date.now()));
      }
    };

    window.addEventListener(
      "hjdesign:project-output-updated",
      handleProjectOutputUpdated,
    );
    window.addEventListener("hjdesign:preview-refresh", handleProjectOutputUpdated);

    return () => {
      window.removeEventListener(
        "hjdesign:project-output-updated",
        handleProjectOutputUpdated,
      );
      window.removeEventListener(
        "hjdesign:preview-refresh",
        handleProjectOutputUpdated,
      );
    };
  }, [projectId]);

  if (!previewUrl) {
    return (
      <div className="grid size-full place-items-center bg-white text-sm text-muted-foreground">
        预览服务启动中...
      </div>
    );
  }

  return (
    <iframe
      className="size-full border-0 bg-white"
      key={refreshKey}
      sandbox="allow-scripts"
      src={previewUrl}
      title={`${projectName} HTML 预览`}
    />
  );
}

function createClientId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
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
