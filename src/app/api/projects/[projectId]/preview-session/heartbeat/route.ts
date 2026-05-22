import { NextResponse } from "next/server";

import { createWorkspaceStore } from "@/lib/owndesign";
import { getPreviewServerManager } from "@/lib/preview-server-manager";

type PreviewHeartbeatRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type PreviewHeartbeatBody = {
  clientId?: unknown;
  previewPath?: unknown;
};

export async function POST(
  request: Request,
  context: PreviewHeartbeatRouteContext,
) {
  const { projectId } = await context.params;
  const body = await readPreviewHeartbeatBody(request);
  const clientId = asNonEmptyString(body?.clientId);

  if (!clientId) {
    return new Response("Invalid preview heartbeat request.", { status: 400 });
  }

  const workspaceStore = createWorkspaceStore();
  const manager = getPreviewServerManager(workspaceStore);
  const session = await manager.heartbeat(
    projectId,
    clientId,
    asNonEmptyString(body?.previewPath),
  );

  return NextResponse.json(session);
}

async function readPreviewHeartbeatBody(request: Request) {
  try {
    return (await request.json()) as PreviewHeartbeatBody;
  } catch {
    return undefined;
  }
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
