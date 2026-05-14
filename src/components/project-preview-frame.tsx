"use client";

import { useEffect, useState } from "react";

type ProjectPreviewFrameProps = {
  initialUpdatedAt: string;
  projectId: string;
  projectName: string;
};

export function ProjectPreviewFrame({
  initialUpdatedAt,
  projectId,
  projectName,
}: ProjectPreviewFrameProps) {
  const [refreshKey, setRefreshKey] = useState(initialUpdatedAt);

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

  return (
    <iframe
      className="size-full border-0 bg-white"
      sandbox="allow-scripts"
      src={`/api/projects/${projectId}/preview?updatedAt=${encodeURIComponent(refreshKey)}`}
      title={`${projectName} HTML 预览`}
    />
  );
}
