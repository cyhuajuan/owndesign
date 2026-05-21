"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  isFrontendCapabilityId,
  type FrontendCommand,
} from "@/lib/frontend-capabilities";

export const FRONTEND_TAB_ID = createFrontendTabId();

const PROJECT_OUTPUT_UPDATED_EVENT = "hjdesign:project-output-updated";
const PREVIEW_REFRESH_EVENT = "hjdesign:preview-refresh";

type FrontendCapabilityBridgeProps = {
  projectId?: string;
};

export function FrontendCapabilityBridge({
  projectId,
}: FrontendCapabilityBridgeProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!projectId) {
      return;
    }

    const eventSource = new EventSource(
      `/api/projects/${encodeURIComponent(
        projectId,
      )}/frontend-capabilities/stream?tabId=${encodeURIComponent(
        FRONTEND_TAB_ID,
      )}`,
    );

    eventSource.addEventListener("frontend-command", (event) => {
      const command = parseFrontendCommand(event);

      if (!command) {
        return;
      }

      if (command.capability === "preview.refresh") {
        window.dispatchEvent(new Event(PREVIEW_REFRESH_EVENT));
        return;
      }

      const params = new URLSearchParams(searchParams.toString());
      params.set("previewPath", command.payload.path);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      window.dispatchEvent(
        new CustomEvent(PROJECT_OUTPUT_UPDATED_EVENT, {
          detail: { projectId },
        }),
      );
    });

    return () => {
      eventSource.close();
    };
  }, [pathname, projectId, router, searchParams]);

  return null;
}

function parseFrontendCommand(event: Event): FrontendCommand | undefined {
  if (!("data" in event) || typeof event.data !== "string") {
    return undefined;
  }

  try {
    const command = JSON.parse(event.data) as Partial<FrontendCommand>;

    if (!isFrontendCapabilityId(command.capability)) {
      return undefined;
    }

    if (command.capability === "preview.refresh") {
      return {
        capability: command.capability,
        id: typeof command.id === "string" ? command.id : "",
        payload: {},
      };
    }

    if (
      command.payload &&
      typeof command.payload === "object" &&
      "path" in command.payload &&
      typeof command.payload.path === "string" &&
      command.payload.path.trim()
    ) {
      return {
        capability: command.capability,
        id: typeof command.id === "string" ? command.id : "",
        payload: { path: command.payload.path },
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function createFrontendTabId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
