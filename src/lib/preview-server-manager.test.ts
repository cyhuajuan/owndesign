import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PreviewServerManager } from "./preview-server-manager";
import { WorkspaceStore, type ProjectRecord } from "./workspace-store";

const tempRoots: string[] = [];
const managers: PreviewServerManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stopAll()));
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true });
    }),
  );
});

describe("PreviewServerManager", () => {
  it("reuses one server for multiple clients of the same Project", async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);

    const firstSession = await manager.ensure("project-1", "client-1");
    const secondSession = await manager.ensure("project-1", "client-2");

    expect(secondSession.url).toBe(firstSession.url);
    expect(manager.getActiveServerCount()).toBe(1);
    expect(manager.getLeaseCount("project-1")).toBe(2);
  });

  it("keeps the server alive until the last client releases it", async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);

    await manager.ensure("project-1", "client-1");
    await manager.ensure("project-1", "client-2");
    await manager.release("project-1", "client-1");

    expect(manager.getActiveServerCount()).toBe(1);
    expect(manager.getLeaseCount("project-1")).toBe(1);

    await manager.release("project-1", "client-2");

    expect(manager.getActiveServerCount()).toBe(0);
  });

  it("refreshes a lease on heartbeat", async () => {
    let now = 1_000;
    const { manager, workspaceStore } = await createPreviewManager({
      leaseTtlMs: 100,
      now: () => now,
    });
    await createProject(workspaceStore);

    await manager.ensure("project-1", "client-1");
    now = 1_050;
    await manager.heartbeat("project-1", "client-1");
    now = 1_120;
    await manager.cleanupExpiredLeases();

    expect(manager.getActiveServerCount()).toBe(1);
    expect(manager.getLeaseCount("project-1")).toBe(1);
  });

  it("closes a server after all leases expire", async () => {
    let now = 1_000;
    const { manager, workspaceStore } = await createPreviewManager({
      leaseTtlMs: 100,
      now: () => now,
    });
    await createProject(workspaceStore);

    await manager.ensure("project-1", "client-1");
    now = 1_101;
    await manager.cleanupExpiredLeases();

    expect(manager.getActiveServerCount()).toBe(0);
  });

  it("stops a project server explicitly", async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);

    await manager.ensure("project-1", "client-1");
    await manager.stop("project-1");

    expect(manager.getActiveServerCount()).toBe(0);
  });

  it("serves index.html from the Project Workspace", async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      "project-1",
      "index.html",
      "<main>Preview works</main>",
    );

    const session = await manager.ensure("project-1", "client-1");
    const response = await fetch(session.url);

    await expect(response.text()).resolves.toContain("Preview works");
  });

  it("serves styled empty preview HTML when index.html is missing", async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);

    const session = await manager.ensure("project-1", "client-1");
    const response = await fetch(session.url);
    const html = await response.text();

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("等待生成 HTML");
    expect(html).toContain("class=\"badge\">Preview");
    expect(html).toContain("--bg-base: #0a0a0b");
  });
});

async function createPreviewManager(options: {
  leaseTtlMs?: number;
  now?: () => number;
} = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "hjdesign-preview-"));
  tempRoots.push(tempRoot);

  const workspaceStore = new WorkspaceStore({
    workspaceRoot: path.join(tempRoot, ".hjdesign"),
  });
  const manager = new PreviewServerManager({
    cleanupIntervalMs: 60_000,
    leaseTtlMs: options.leaseTtlMs,
    now: options.now,
    workspaceStore,
  });
  managers.push(manager);

  return { manager, workspaceStore };
}

async function createProject(workspaceStore: WorkspaceStore) {
  await workspaceStore.createProject({
    createdAt: "2026-05-15T00:00:00.000Z",
    id: "project-1",
    name: "Project One",
    outputType: "html",
    updatedAt: "2026-05-15T00:00:00.000Z",
  } satisfies ProjectRecord);
}
