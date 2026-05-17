"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { PreviewEmptyState } from "@/components/preview-empty-state";

type ProjectPreviewFrameProps = {
  initialUpdatedAt: string;
  projectId: string;
  projectName: string;
};

type PreviewSessionResponse = {
  activePath: string;
  files: string[];
  url: string;
};

const PREVIEW_HREF_EVENT = "hjdesign:preview-href-updated";
const PREVIEW_FILES_EVENT = "hjdesign:preview-files-updated";
const HEARTBEAT_INTERVAL_MS = 30_000;

export function ProjectPreviewFrame({
  initialUpdatedAt,
  projectId,
  projectName,
}: ProjectPreviewFrameProps) {
  const clientId = useRef(createClientId());
  const searchParams = useSearchParams();
  const selectedPreviewPath = searchParams.get("previewPath") ?? undefined;
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [activePath, setActivePath] = useState<string>("index.html");
  const [refreshKey, setRefreshKey] = useState(initialUpdatedAt);

  useEffect(() => {
    let isActive = true;
    const buildSessionBody = () =>
      JSON.stringify({
        clientId: clientId.current,
        previewPath: selectedPreviewPath,
      });

    async function requestPreviewSession(endpoint: string) {
      const response = await fetch(endpoint, {
        body: buildSessionBody(),
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
        setActivePath(session.activePath);
        publishPreviewHref(session.url);
        publishPreviewFiles(session.files, session.activePath);
      } catch {
        if (isActive) {
          setPreviewUrl(undefined);
          setActivePath("index.html");
          publishPreviewHref(undefined);
          publishPreviewFiles([], "index.html");
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
          setActivePath(session.activePath);
          publishPreviewHref(session.url);
          publishPreviewFiles(session.files, session.activePath);
        })
        .catch(() => {
          if (isActive) {
            setPreviewUrl(undefined);
            setActivePath("index.html");
            publishPreviewHref(undefined);
            publishPreviewFiles([], "index.html");
          }
        });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(heartbeatTimer);
    };
  }, [projectId, selectedPreviewPath]);

  useEffect(() => {
    const currentClientId = clientId.current;

    return () => {
      publishPreviewHref(undefined);
      publishPreviewFiles([], "index.html");
      void fetch(
        `/api/projects/${encodeURIComponent(projectId)}/preview-session`,
        {
          body: JSON.stringify({
            clientId: currentClientId,
          }),
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
      <PreviewEmptyState
        badge="Loading"
        description="正在为当前项目启动预览环境。准备完成后，这里会自动显示最新页面。"
        icon={<LoaderCircleIcon className="animate-spin" />}
        title="预览服务启动中"
      />
    );
  }

  return (
    <iframe
      className="size-full border-0 bg-white"
      key={`${activePath}:${refreshKey}`}
      sandbox="allow-scripts allow-same-origin"
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

function publishPreviewFiles(files: string[], activePath: string) {
  window.dispatchEvent(
    new CustomEvent(PREVIEW_FILES_EVENT, {
      detail: { activePath, files },
    }),
  );
}
