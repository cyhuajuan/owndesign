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
    const response = await fetch(session.url);

    expect(session.activePath).toBe('index.html');
    expect(session.files).toEqual(['index.html']);
    expect(session.url).not.toContain('?');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.text()).resolves.toContain('Preview works');
  });

  it('serves a requested nested HTML file from the Project Workspace', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Index</main>');
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'pages/about.html',
      '<main>About works</main>',
    );

    const session = await manager.ensure('project-1', 'client-1', 'pages/about.html');
    const response = await fetch(session.url);

    expect(session.activePath).toBe('pages/about.html');
    expect(session.files).toEqual(['index.html', 'pages/about.html']);
    expect(session.url).toMatch(/\/pages\/about\.html$/);
    expect(session.url).not.toContain('?');
    await expect(response.text()).resolves.toContain('About works');
  });

  it('tracks the last served HTML path for a client heartbeat', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Index</main>');
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'pages/about.html',
      '<main>About works</main>',
    );

    const session = await manager.ensure('project-1', 'client-1');
    await fetch(new URL('/pages/about.html', session.url));

    const heartbeat = await manager.heartbeat('project-1', 'client-1');

    expect(heartbeat.activePath).toBe('pages/about.html');
    expect(heartbeat.url).toMatch(/\/pages\/about\.html$/);
    expect(heartbeat.url).not.toContain('?');
  });

  it('does not update the active HTML path for static assets', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Index</main>');
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'pages/about.html',
      '<main>About works</main>',
    );
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'assets/site.css',
      'body { color: black; }',
    );

    const session = await manager.ensure('project-1', 'client-1', 'pages/about.html');
    const response = await fetch(new URL('/assets/site.css', session.url));

    const heartbeat = await manager.heartbeat('project-1', 'client-1');

    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(heartbeat.activePath).toBe('pages/about.html');
  });

  it('lets an explicit preview path override the recorded HTML path', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile('project-1', 'index.html', '<main>Index</main>');
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'pages/about.html',
      '<main>About works</main>',
    );

    const session = await manager.ensure('project-1', 'client-1');
    await fetch(new URL('/pages/about.html', session.url));

    const nextSession = await manager.ensure('project-1', 'client-1', 'index.html');

    expect(nextSession.activePath).toBe('index.html');
    expect(nextSession.url).toMatch(/\/index\.html$/);
  });

  it('falls back to index.html when the requested HTML file is missing', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'index.html',
      '<main>Fallback</main>',
    );

    const session = await manager.ensure('project-1', 'client-1', 'missing.html');
    const response = await fetch(session.url);

    expect(session.activePath).toBe('index.html');
    await expect(response.text()).resolves.toContain('Fallback');
  });

  it('falls back to the first HTML file when index.html is missing', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);
    await workspaceStore.writeProjectWorkspaceFile(
      'project-1',
      'landing.html',
      '<main>Landing</main>',
    );

    const session = await manager.ensure('project-1', 'client-1', 'missing.html');
    const response = await fetch(session.url);

    expect(session.activePath).toBe('landing.html');
    await expect(response.text()).resolves.toContain('Landing');
  });

  it('returns 404 for the preview root without publishing a fake active path when no HTML exists', async () => {
    const { manager, workspaceStore } = await createPreviewManager();
    await createProject(workspaceStore);

    const session = await manager.ensure('project-1', 'client-1');
    const response = await fetch(session.url);

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(session).not.toHaveProperty('activePath');
    expect(session.files).toEqual([]);
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
