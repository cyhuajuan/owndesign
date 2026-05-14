import { NextResponse } from "next/server";

import { createWorkspaceStore } from "@/lib/hjdesign";

type PreviewRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(_request: Request, context: PreviewRouteContext) {
  const { projectId } = await context.params;
  const workspaceStore = createWorkspaceStore();

  try {
    const project = await workspaceStore.getProject(projectId);
    const html = await workspaceStore.readProjectOutput(
      projectId,
      project.outputType,
    );

    return new NextResponse(html, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch {
    return new NextResponse(buildEmptyPreviewHtml(), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }
}

function buildEmptyPreviewHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HJDesign Preview</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #f8fafc;
      color: #475569;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 28rem;
      padding: 2rem;
      text-align: center;
    }
    h1 {
      margin: 0 0 .75rem;
      color: #0f172a;
      font-size: 1.25rem;
    }
    p {
      margin: 0;
      line-height: 1.7;
    }
  </style>
</head>
<body>
  <main>
    <h1>等待生成 HTML</h1>
    <p>在左侧输入“设计一个 XXX 的界面”，生成结果会显示在这里。</p>
  </main>
</body>
</html>`;
}
