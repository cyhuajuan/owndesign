import { NextResponse } from "next/server";

import { createWorkspaceStore } from "@/lib/owndesign";
import { getPreviewServerManager } from "@/lib/preview-server-manager";

type PreviewSessionRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type PreviewSessionBody = {
  clientId?: unknown;
  previewPath?: unknown;
};

export async function POST(request: Request, context: PreviewSessionRouteContext) {
  const { projectId } = await context.params;
  const body = await readPreviewSessionBody(request);
  const clientId = asNonEmptyString(body?.clientId);

  if (!clientId) {
    return new Response("Invalid preview session request.", { status: 400 });
  }

  const workspaceStore = createWorkspaceStore();
  const manager = getPreviewServerManager(workspaceStore);
  const session = await manager.ensure(
    projectId,
    clientId,
    asNonEmptyString(body?.previewPath),
  );

  return NextResponse.json(session);
}

export async function DELETE(
  request: Request,
  context: PreviewSessionRouteContext,
) {
  const { projectId } = await context.params;
  const body = await readPreviewSessionBody(request);
  const clientId = asNonEmptyString(body?.clientId);

  if (!clientId) {
    return new Response("Invalid preview session request.", { status: 400 });
  }

  const workspaceStore = createWorkspaceStore();
  const manager = getPreviewServerManager(workspaceStore);

  await manager.release(projectId, clientId);

  return new Response(null, { status: 204 });
}

async function readPreviewSessionBody(request: Request) {
  try {
    return (await request.json()) as PreviewSessionBody;
  } catch {
    return undefined;
  }
}

function asNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
