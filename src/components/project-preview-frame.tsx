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

    return () => {
      window.removeEventListener(
        "hjdesign:project-output-updated",
        handleProjectOutputUpdated,
      );
    };
  }, [projectId]);

  return (
    <iframe
      className="h-[calc(100vh-9rem)] min-h-[32rem] w-full overflow-hidden rounded-md border bg-white"
      sandbox="allow-scripts"
      src={`/api/projects/${projectId}/preview?updatedAt=${encodeURIComponent(refreshKey)}`}
      title={`${projectName} HTML 预览`}
    />
  );
}
