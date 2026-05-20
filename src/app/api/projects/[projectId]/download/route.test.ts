import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceStore } from "@/lib/workspace-store";

const routeMocks = vi.hoisted(() => {
  return {
    createWorkspaceStore: vi.fn(),
    tempZipRoot: "",
    tmpdir: vi.fn(() => ""),
  };
});

vi.mock("node:os", () => ({
  default: {
    tmpdir: routeMocks.tmpdir,
  },
  tmpdir: routeMocks.tmpdir,
}));

vi.mock("@/lib/hjdesign", () => ({
  createWorkspaceStore: routeMocks.createWorkspaceStore,
}));

import { GET } from "./route";

let workspaceRoot: string;
let tempZipRoot: string;
let store: WorkspaceStore;

beforeEach(async () => {
  workspaceRoot = path.join(
    await mkdtemp(path.join(os.tmpdir(), "hjdesign-download-workspace-")),
    ".hjdesign",
  );
  tempZipRoot = await mkdtemp(path.join(os.tmpdir(), "hjdesign-download-tmp-"));
  routeMocks.tempZipRoot = tempZipRoot;
  routeMocks.tmpdir.mockImplementation(() => tempZipRoot);
  store = new WorkspaceStore({ workspaceRoot });
  routeMocks.createWorkspaceStore.mockReturnValue(store);
});

afterEach(async () => {
  routeMocks.createWorkspaceStore.mockReset();
  routeMocks.tmpdir.mockReset();
  await Promise.all([
    rm(path.dirname(workspaceRoot), { force: true, recursive: true }),
    rm(tempZipRoot, { force: true, recursive: true }),
  ]);
});

describe("/api/projects/[projectId]/download", () => {
  it("downloads the current html file as an attachment", async () => {
    await createProject("project-1", "Project One");
    await store.writeProjectWorkspaceFile(
      "project-1",
      "pages/detail.html",
      "<!doctype html><h1>Detail</h1>",
    );

    const response = await GET(
      new Request(
        "http://localhost/api/projects/project-1/download?kind=current-html&previewPath=pages/detail.html",
      ),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="detail.html"; filename*=UTF-8\'\'detail.html',
    );
    await expect(response.text()).resolves.toBe("<!doctype html><h1>Detail</h1>");
  });

  it("rejects missing or invalid current html download requests", async () => {
    await createProject("project-1", "Project One");

    const missingPreviewPath = await GET(
      new Request("http://localhost/api/projects/project-1/download?kind=current-html"),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );
    const invalidPreviewPath = await GET(
      new Request(
        "http://localhost/api/projects/project-1/download?kind=current-html&previewPath=..%2Fsecret.txt",
      ),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );
    const missingFile = await GET(
      new Request(
        "http://localhost/api/projects/project-1/download?kind=current-html&previewPath=index.html",
      ),
      { params: Promise.resolve({ projectId: "project-1" }) },
    );

    expect(missingPreviewPath.status).toBe(400);
    expect(invalidPreviewPath.status).toBe(400);
    expect(missingFile.status).toBe(404);
  });

  it("downloads the full workspace as a zip and cleans up temporary files", async () => {
    await createProject("project-zip", 'Project: Zip/Test');
    await store.writeProjectWorkspaceFile(
      "project-zip",
      "index.html",
      "<!doctype html><h1>Home</h1>",
    );
    await store.writeProjectWorkspaceFile(
      "project-zip",
      "assets/app.js",
      "console.log('zip');",
    );

    const response = await GET(
      new Request("http://localhost/api/projects/project-zip/download?kind=workspace-zip"),
      { params: Promise.resolve({ projectId: "project-zip" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Project-Zip-Test-workspace.zip"; filename*=UTF-8\'\'Project-%20Zip-Test-workspace.zip',
    );

    const zipBuffer = Buffer.from(await response.arrayBuffer());
    const zipText = zipBuffer.toString("utf8");

    expect(zipBuffer.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(zipText).toContain("index.html");
    expect(zipText).toContain("assets/app.js");
    expect(zipText).not.toContain("workspace/index.html");

    await waitForCleanup(tempZipRoot);
    await expect(readdir(tempZipRoot)).resolves.toEqual([]);
  });

  it("still creates a zip when the workspace has only one file", async () => {
    await createProject("project-single", "Single");
    await store.writeProjectWorkspaceFile(
      "project-single",
      "index.html",
      "<!doctype html><h1>Single</h1>",
    );

    const response = await GET(
      new Request(
        "http://localhost/api/projects/project-single/download?kind=workspace-zip",
      ),
      { params: Promise.resolve({ projectId: "project-single" }) },
    );

    const zipBuffer = Buffer.from(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(zipBuffer.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(zipBuffer.toString("utf8")).toContain("index.html");
  });
});

async function createProject(projectId: string, name: string) {
  await store.createProject({
    createdAt: "2026-05-20T00:00:00.000Z",
    id: projectId,
    name,
    outputType: "html",
    updatedAt: "2026-05-20T00:00:00.000Z",
  });
}

async function waitForCleanup(directory: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const entries = await readdir(directory);

    if (entries.length === 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
