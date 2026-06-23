import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { serve, type ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

import { WorkspaceStore } from '@owndesign/core/workspace-store';

type PreviewServerManagerOptions = {
  cleanupIntervalMs?: number;
  leaseTtlMs?: number;
  now?: () => number;
  workspaceStore: WorkspaceStore;
};

type PreviewServerEntry = {
  baseUrl: string;
  expiresAt: number;
  key: string;
  projectId: string;
  server?: ServerType;
};

export type PreviewSession = {
  previewFileExists: boolean;
  url?: string;
};

const DEFAULT_CLEANUP_INTERVAL_MS = 30_000;
const DEFAULT_LEASE_TTL_MS = 90_000;
const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_CACHE_CONTROL = 'no-store';

declare global {
  var __owndesignPreviewServerManager: PreviewServerManager | undefined;
}

export class PreviewServerManager {
  private readonly cleanupIntervalMs: number;
  private readonly entries = new Map<string, PreviewServerEntry>();
  private readonly leaseTtlMs: number;
  private readonly now: () => number;
  private readonly starts = new Map<string, Promise<PreviewServerEntry>>();
  private readonly workspaceStore: WorkspaceStore;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: PreviewServerManagerOptions) {
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.workspaceStore = options.workspaceStore;
  }

  async ensure(projectId: string, clientId: string) {
    const entry = await this.getOrStartEntry(projectId, clientId);
    const previewFileExists = await indexHtmlExists(
      this.workspaceStore.getProjectWorkspaceDirectory(projectId),
    );

    this.touchLease(entry);
    this.ensureCleanupTimer();

    return {
      previewFileExists,
      ...(previewFileExists ? { url: buildPreviewUrl(entry.baseUrl) } : {}),
    } satisfies PreviewSession;
  }

  async heartbeat(projectId: string, clientId: string) {
    return this.ensure(projectId, clientId);
  }

  async release(projectId: string, clientId: string) {
    const entry = this.entries.get(buildEntryKey(projectId, clientId));

    if (!entry) {
      return;
    }

    await this.closeEntry(entry);
  }

  async stop(projectId: string) {
    await Promise.all(
      Array.from(this.starts, async ([key, starting]) => {
        if (key.startsWith(`${projectId}:`)) {
          await starting;
        }
      }),
    );
    await Promise.all(
      Array.from(this.entries.values())
        .filter((entry) => entry.projectId === projectId)
        .map((entry) => this.closeEntry(entry)),
    );
  }

  async stopAll() {
    await Promise.all(Array.from(this.starts.values()));
    await Promise.all(Array.from(this.entries.values(), (entry) => this.closeEntry(entry)));
  }

  getActiveServerCount() {
    return this.entries.size;
  }

  getLeaseCount(projectId: string) {
    return Array.from(this.entries.values()).filter((entry) => entry.projectId === projectId)
      .length;
  }

  async cleanupExpiredLeases() {
    const now = this.now();

    await Promise.all(
      Array.from(this.entries.values(), async (entry) => {
        if (entry.expiresAt <= now) {
          await this.closeEntry(entry);
        }
      }),
    );
  }

  private async getOrStartEntry(projectId: string, clientId: string) {
    const key = buildEntryKey(projectId, clientId);
    const existingEntry = this.entries.get(key);

    if (existingEntry) {
      return existingEntry;
    }

    const existingStart = this.starts.get(key);

    if (existingStart) {
      return existingStart;
    }

    const start = this.startEntry(projectId, key);
    this.starts.set(key, start);

    try {
      return await start;
    } finally {
      this.starts.delete(key);
    }
  }

  private async startEntry(projectId: string, key: string): Promise<PreviewServerEntry> {
    await this.workspaceStore.getProject(projectId);

    const workspaceDirectory = this.workspaceStore.getProjectWorkspaceDirectory(projectId);
    const app = new Hono();
    const entry: PreviewServerEntry = {
      baseUrl: '',
      expiresAt: this.now() + this.leaseTtlMs,
      key,
      projectId,
    };

    app.get('/', async () => readIndexHtmlOrNotFound(workspaceDirectory));
    app.get('/index.html', async () => readIndexHtmlOrNotFound(workspaceDirectory));
    app.use('*', async (context, next) => {
      context.header('Cache-Control', PREVIEW_CACHE_CONTROL);
      await next();
    });
    app.use('*', async (context, next) => {
      if (context.req.path.toLowerCase().endsWith('.html')) {
        return new Response(null, {
          headers: {
            'Cache-Control': PREVIEW_CACHE_CONTROL,
          },
          status: 404,
        });
      }

      await next();
    });
    app.use(
      '*',
      serveStatic({
        root: workspaceDirectory,
      }),
    );

    const server = await listenOnRandomPort(app);
    entry.server = server.server;
    entry.baseUrl = server.baseUrl;

    this.entries.set(key, entry);

    return entry;
  }

  private touchLease(entry: PreviewServerEntry) {
    entry.expiresAt = this.now() + this.leaseTtlMs;
  }

  private async closeEntry(entry: PreviewServerEntry) {
    this.entries.delete(entry.key);
    await closeServer(entry.server);

    if (this.entries.size === 0) {
      this.clearCleanupTimer();
    }
  }

  private ensureCleanupTimer() {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      void this.cleanupExpiredLeases();
    }, this.cleanupIntervalMs);
    this.cleanupTimer.unref?.();
  }

  private clearCleanupTimer() {
    if (!this.cleanupTimer) {
      return;
    }

    clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }
}

function htmlResponse(html: string) {
  return new Response(html, {
    headers: {
      'Cache-Control': PREVIEW_CACHE_CONTROL,
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}

function listenOnRandomPort(app: Hono) {
  return new Promise<{ baseUrl: string; server: ServerType }>((resolve) => {
    const server = serve(
      {
        fetch: app.fetch,
        hostname: PREVIEW_HOST,
        port: 0,
      },
      (info) => {
        resolve({
          baseUrl: `http://${PREVIEW_HOST}:${info.port}`,
          server,
        });
      },
    );
  });
}

function closeServer(server: ServerType | undefined) {
  if (!server) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function getPreviewServerManager(workspaceStore: WorkspaceStore) {
  globalThis.__owndesignPreviewServerManager ??= new PreviewServerManager({
    workspaceStore,
  });

  return globalThis.__owndesignPreviewServerManager;
}

async function readIndexHtmlOrNotFound(workspaceDirectory: string) {
  const indexPath = path.join(workspaceDirectory, 'index.html');

  try {
    await access(indexPath);
    return htmlResponse(await readFile(indexPath, 'utf8'));
  } catch {
    return new Response(null, {
      headers: {
        'Cache-Control': PREVIEW_CACHE_CONTROL,
      },
      status: 404,
    });
  }
}

async function indexHtmlExists(workspaceDirectory: string) {
  try {
    await access(path.join(workspaceDirectory, 'index.html'));
    return true;
  } catch {
    return false;
  }
}

function buildPreviewUrl(baseUrl: string) {
  return `${baseUrl}/index.html`;
}

function buildEntryKey(projectId: string, clientId: string) {
  return `${projectId}:${clientId}`;
}
