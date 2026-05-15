import { NextResponse } from "next/server";

import { createWorkspaceStore } from "@/lib/hjdesign";
import { getPreviewServerManager } from "@/lib/preview-server-manager";

type PreviewHeartbeatRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type PreviewHeartbeatBody = {
  clientId?: unknown;
};

export async function POST(
  request: Request,
  context: PreviewHeartbeatRouteContext,
) {
  const { projectId } = await context.params;
  const clientId = await readClientId(request);

  if (!clientId) {
    return new Response("Invalid preview heartbeat request.", { status: 400 });
  }

  const workspaceStore = createWorkspaceStore();
  const manager = getPreviewServerManager(workspaceStore);
  const session = await manager.heartbeat(projectId, clientId);

  return NextResponse.json(session);
}

async function readClientId(request: Request) {
  try {
    const body = (await request.json()) as PreviewHeartbeatBody;

    return asNonEmptyString(body.clientId);
  } catch {
    return undefined;
  }
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
