import { createWorkspaceStore } from "@/server/owndesign";
import { registerFrontendConnection } from "@/server/realtime/frontend-command-bus";

type FrontendCapabilityStreamRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(
  request: Request,
  context: FrontendCapabilityStreamRouteContext,
) {
  const { projectId } = await context.params;
  const tabId = new URL(request.url).searchParams.get("tabId")?.trim();

  if (!tabId) {
    return new Response("Invalid frontend capability stream request.", {
      status: 400,
    });
  }

  await createWorkspaceStore().getProject(projectId);

  const stream = registerFrontendConnection({
    frontendTabId: tabId,
    projectId,
    signal: request.signal,
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
