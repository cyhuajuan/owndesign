"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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

const PREVIEW_HREF_EVENT = "owndesign:preview-href-updated";
const PREVIEW_FILES_EVENT = "owndesign:preview-files-updated";
const HEARTBEAT_INTERVAL_MS = 30_000;

export function ProjectPreviewFrame({
  initialUpdatedAt,
  projectId,
  projectName,
}: ProjectPreviewFrameProps) {
  const clientId = useRef(createClientId());
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedPreviewPath = searchParams.get("previewPath") ?? undefined;
  const pendingRouteSyncPathRef = useRef<string | undefined>(undefined);
  const previewUrlRef = useRef<string | undefined>(undefined);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(initialUpdatedAt);
  const applyPreviewSession = useCallback(
    (
      session: PreviewSessionResponse,
      { updateFrameSrc }: { updateFrameSrc: boolean },
    ) => {
      previewUrlRef.current = session.url;
      publishPreviewHref(session.url);
      publishPreviewFiles(session.files, session.activePath);

      if (updateFrameSrc) {
        setPreviewUrl(session.url);
      }
    },
    [],
  );

  useEffect(() => {
    let isActive = true;
    const shouldAcquirePreviewSession =
      !selectedPreviewPath ||
      pendingRouteSyncPathRef.current !== selectedPreviewPath;

    if (
      selectedPreviewPath &&
      pendingRouteSyncPathRef.current === selectedPreviewPath
    ) {
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

    async function requestPreviewSession(
      endpoint: string,
      previewPath?: string,
    ) {
      const response = await fetch(endpoint, {
        body: buildSessionBody(previewPath),
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
      previewUrlRef.current = undefined;
      publishPreviewHref(undefined);

      try {
        const session = await requestPreviewSession(
          `/api/projects/${encodeURIComponent(projectId)}/preview-session`,
          selectedPreviewPath,
        );

        if (!isActive) {
          return;
        }

        applyPreviewSession(session, { updateFrameSrc: true });
      } catch {
        if (isActive) {
          setPreviewUrl(undefined);
          previewUrlRef.current = undefined;
          publishPreviewHref(undefined);
          publishPreviewFiles([], "index.html");
        }
      }
    }

    if (shouldAcquirePreviewSession) {
      void acquirePreviewSession();
    }

    const heartbeatTimer = window.setInterval(() => {
      void requestPreviewSession(
        `/api/projects/${encodeURIComponent(projectId)}/preview-session/heartbeat`,
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
            publishPreviewFiles([], "index.html");
          }
        });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      isActive = false;
      window.clearInterval(heartbeatTimer);
    };
  }, [applyPreviewSession, projectId, selectedPreviewPath]);

  const syncPreviewSession = async () => {
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/preview-session/heartbeat`,
        {
          body: JSON.stringify({
            clientId: clientId.current,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error(`Preview session request failed: ${response.status}`);
      }

      const session = (await response.json()) as PreviewSessionResponse;

      applyPreviewSession(session, { updateFrameSrc: false });

      const currentPath = selectedPreviewPath ?? "index.html";

      if (session.activePath !== currentPath) {
        const params = new URLSearchParams(searchParams.toString());
        params.set("previewPath", session.activePath);
        pendingRouteSyncPathRef.current = session.activePath;
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    } catch {
      setPreviewUrl(undefined);
      previewUrlRef.current = undefined;
      publishPreviewHref(undefined);
      publishPreviewFiles([], "index.html");
    }
  };

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
      if (event.type === "owndesign:preview-refresh") {
        if (previewUrlRef.current) {
          setPreviewUrl(previewUrlRef.current);
        }

        setRefreshKey(String(Date.now()));
        return;
      }

      if (
        event instanceof CustomEvent &&
        event.detail?.projectId === projectId
      ) {
        if (previewUrlRef.current) {
          setPreviewUrl(previewUrlRef.current);
        }

        setRefreshKey(String(Date.now()));
      }
    };

    window.addEventListener(
      "owndesign:project-output-updated",
      handleProjectOutputUpdated,
    );
    window.addEventListener("owndesign:preview-refresh", handleProjectOutputUpdated);

    return () => {
      window.removeEventListener(
        "owndesign:project-output-updated",
        handleProjectOutputUpdated,
      );
      window.removeEventListener(
        "owndesign:preview-refresh",
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
      key={refreshKey}
      onLoad={() => {
        void syncPreviewSession();
      }}
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
