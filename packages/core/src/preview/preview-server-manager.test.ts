import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PreviewServerManager } from './preview-server-manager';
import { WorkspaceStore, type ProjectRecord } from '@owndesign/core/workspace-store';

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

describe('PreviewServerManager', () => {
  it('starts one server per project client', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<main>Index</main>',
    );

    const firstSession = await manager.ensure('project-1', 'client-1');
    const secondSession = await manager.ensure('project-1', 'client-2');

    expect(secondSession.url).not.toBe(firstSession.url);
    expect(manager.getActiveServerCount()).toBe(2);
    expect(manager.getLeaseCount('project-1')).toBe(2);
  });

  it('releases one client server without affecting another client', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);

    await manager.ensure('project-1', 'client-1');
    await manager.ensure('project-1', 'client-2');
    await manager.release('project-1', 'client-1');

    expect(manager.getActiveServerCount()).toBe(1);
    expect(manager.getLeaseCount('project-1')).toBe(1);

    await manager.release('project-1', 'client-2');

    expect(manager.getActiveServerCount()).toBe(0);
  });

  it('refreshes a lease on heartbeat', async () => {
    let now = 1_000;
    const { manager, workspaceStore } = await createPreviewManager({
      leaseTtlMs: 100,
      now: () => now,
    });
    await createProject(workspaceStore);

    await manager.ensure('project-1', 'client-1');
    now = 1_050;
    await manager.heartbeat('project-1', 'client-1');
    now = 1_120;
    await manager.cleanupExpiredLeases();

    expect(manager.getActiveServerCount()).toBe(1);
    expect(manager.getLeaseCount('project-1')).toBe(1);
  });

  it('closes a server after all leases expire', async () => {
    let now = 1_000;
    const { manager, workspaceStore } = await createPreviewManager({
      leaseTtlMs: 100,
      now: () => now,
    });
    await createProject(workspaceStore);

    await manager.ensure('project-1', 'client-1');
    now = 1_101;
    await manager.cleanupExpiredLeases();

    expect(manager.getActiveServerCount()).toBe(0);
  });

  it('stops a project server explicitly', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);

    await manager.ensure('project-1', 'client-1');
    await manager.stop('project-1');

    expect(manager.getActiveServerCount()).toBe(0);
  });

  it('serves index.html from the Project Workspace', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<main>Preview works</main>',
    );

    const session = await manager.ensure('project-1', 'client-1');
    const response = await fetch(expectPreviewUrl(session));

    expect(session).toEqual({
      previewFileExists: true,
      url: expect.stringMatching(/\/index\.html$/),
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.text()).resolves.toContain('Preview works');
  });

  it('does not serve non-index HTML files from the Project Workspace', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Index</main>');
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'pages/about.html',
      '<main>About works</main>',
    );

    const session = await manager.ensure('project-1', 'client-1');
    const response = await fetch(new URL('/pages/about.html', expectPreviewUrl(session)));

    expect(session.previewFileExists).toBe(true);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('keeps the preview session pointed at index.html after non-index HTML requests', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Index</main>');
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'pages/about.html',
      '<main>About works</main>',
    );

    const session = await manager.ensure('project-1', 'client-1');
    await fetch(new URL('/pages/about.html', expectPreviewUrl(session)));

    const heartbeat = await manager.heartbeat('project-1', 'client-1');

    expect(heartbeat).toEqual({
      previewFileExists: true,
      url: expect.stringMatching(/\/index\.html$/),
    });
  });

  it('continues serving static assets for index.html', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Index</main>');
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'assets/site.css',
      'body { color: black; }',
    );

    const session = await manager.ensure('project-1', 'client-1');
    const response = await fetch(new URL('/assets/site.css', expectPreviewUrl(session)));

    const heartbeat = await manager.heartbeat('project-1', 'client-1');

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.text()).resolves.toBe('body { color: black; }');
    expect(heartbeat.previewFileExists).toBe(true);
  });

  it('uses stable index.html when other HTML files also exist', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<main>Index</main>',
    );
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'detail.html',
      '<main>Detail</main>',
    );

    const session = await manager.ensure('project-1', 'client-1');
    const response = await fetch(expectPreviewUrl(session));

    expect(session.url).toMatch(/\/index\.html$/);
    await expect(response.text()).resolves.toContain('Index');
  });

  it('ignores a legacy page manifest in the preview session', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<main>Index</main>',
    );
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      '.owndesign-pages.json',
      JSON.stringify({
        pages: [
          {
            componentSource: 'pages/od-index-page.js',
            componentTag: 'od-index-page',
            displayName: '小说阅读器首页',
            htmlPath: 'index.html',
            slug: 'index',
          },
        ],
      }),
    );

    const session = await manager.ensure('project-1', 'client-1');

    expect(session).not.toHaveProperty('pageManifest');
    expect(session.previewFileExists).toBe(true);
  });

  it('reports an empty preview session when index.html is missing', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'landing.html',
      '<main>Landing</main>',
    );

    const session = await manager.ensure('project-1', 'client-1');

    expect(session).toEqual({ previewFileExists: false });
  });
});

async function createPreviewManager(
  options: {
    leaseTtlMs?: number;
    now?: () => number;
  } = {},
) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'owndesign-preview-'));
  tempRoots.push(tempRoot);

  const workspaceStore = new WorkspaceStore({
    workspaceRoot: path.join(tempRoot, '.owndesign'),
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
    createdAt: '2026-05-15T00:00:00.000Z',
    id: 'project-1',
    name: 'Project One',
    outputType: 'html',
    updatedAt: '2026-05-15T00:00:00.000Z',
  } satisfies ProjectRecord);
}

function expectPreviewUrl(session: { url?: string }) {
  if (!session.url) {
    throw new Error('Expected preview session URL.');
  }

  return session.url;
}
